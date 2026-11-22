/**
 * Saved-product price snapshots: keep the last successfully captured prices for a
 * saved GENERIC product, so reopening it never depends on the shared search cache.
 *
 * Rules (each covered by tests in snapshot.test.ts):
 *   - The owner is the verified `userId`; another user's record and a missing one answer the same `not_found`.
 *   - Prices are copied by the server from its own `search_cache`, never from the browser.
 *   - Only the saved product group's listings are kept, found by the saved identity
 *     (see src/lib/saved-candidate.ts). If the group cannot be confirmed, NOTHING is
 *     written and the previous snapshot stays exactly as it was.
 *   - It never calls PricesAPI and never uses quota.
 *   - A snapshot is deleted with its saved record; leftovers of records removed elsewhere are swept.
 *   - Size is bounded (MAX_BYTES) so one saved product cannot grow without limit.
 */

import type { ActionTools } from 'deepspace/worker'
import { parseSaved, savedOffers, SAVED_COLLECTION, type CaptureResult, type SavedRow, type SavedSnapshot } from '../../lib/saved'
import { UNRESOLVED_TEXT } from '../../lib/saved-candidate'
import { validateQuery } from '../pricing/normalize'
import { StorageError } from '../pricing/quota'
import { readCacheForQuery } from '../pricing/search'

export const SNAPSHOT_COLLECTION = 'saved_snapshots'
/** Offers kept per snapshot, and the serialized size ceiling (well under a Durable Object row limit). */
export const MAX_OFFERS = 150
export const MAX_BYTES = 400_000

export interface SnapshotDeps {
  tools: ActionTools
  /** Verified caller id from the session JWT. */
  userId: string
  now?: () => number
}

type SnapshotPayload = Omit<SavedSnapshot, 'capturedAt'>
type SnapshotRow = { savedId: string; userId: string; query: string; payload: SnapshotPayload; capturedAtMs: number }

const NOT_FOUND = { success: false as const, code: 'not_found' as const, error: 'Saved product not found.' }
const INTERNAL = { success: false as const, code: 'internal_error' as const, error: 'Something went wrong on our side. Please try again.' }

/** The snapshot stored for a saved product, only if it belongs to `userId`. */
export async function readSnapshot(tools: ActionTools, savedId: string, userId: string): Promise<SavedSnapshot | null> {
  const res = await tools.query<SnapshotRow & Record<string, unknown>>(SNAPSHOT_COLLECTION, { where: { savedId }, limit: 1 })
  if (!res.success) throw new StorageError(`snapshot read failed: ${res.error}`)
  const rec = res.data.records[0]
  if (!rec || rec.data.userId !== userId) return null
  const p = rec.data.payload
  if (!p || !Array.isArray(p.offers) || !p.candidate || !p.source) return null
  return { capturedAt: new Date(rec.data.capturedAtMs).toISOString(), source: p.source, candidate: p.candidate, offers: p.offers, truncated: !!p.truncated }
}

function bounded(payload: SnapshotPayload): SnapshotPayload {
  let offers = payload.offers.slice(0, MAX_OFFERS)
  let truncated = payload.truncated || offers.length < payload.offers.length
  while (offers.length > 1 && JSON.stringify({ ...payload, offers }).length > MAX_BYTES) {
    offers = offers.slice(0, Math.floor(offers.length * 0.8))
    truncated = true
  }
  return { ...payload, offers, truncated }
}

export async function captureSavedSnapshot(rawId: unknown, deps: SnapshotDeps): Promise<CaptureResult> {
  const { tools, userId } = deps
  const now = deps.now ?? Date.now
  if (typeof rawId !== 'string' || rawId.length === 0 || rawId.length > 128 || !userId) return NOT_FOUND
  try {
    const got = await tools.get<SavedRow & Record<string, unknown>>(SAVED_COLLECTION, rawId)
    if (!got.success) return NOT_FOUND
    const rec = (got.data as { record?: { data?: SavedRow } }).record
    const row = rec?.data
    if (!row || row.userId !== userId) return NOT_FOUND
    const saved = parseSaved({ recordId: rawId, createdAt: '', data: row })
    if (!saved) return NOT_FOUND
    if (!saved.candidate) return { success: true, data: { captured: false, reason: 'not_applicable', detail: 'Only general product comparisons keep a price snapshot.' } }
    const v = validateQuery(row.query)
    if (!v.ok) return NOT_FOUND

    await sweepOrphans(deps)

    const cached = await readCacheForQuery(tools, v.query)
    if (!cached) return { success: true, data: { captured: false, reason: 'no_stored_data', detail: 'There are no stored prices for this search.' } }
    // Only fresh data is captured: an expired entry would stamp old prices with a new capture time.
    if (cached.row.expiresAtMs <= now()) return { success: true, data: { captured: false, reason: 'no_stored_data', detail: 'The stored prices for this search have expired. Refresh to get new ones.' } }
    const candidates = cached.row.payload.candidates
    const { offers, resolution } = savedOffers(saved, candidates)
    if (resolution?.status !== 'matched' || offers.length === 0) {
      const detail = resolution?.status === 'unresolved' ? UNRESOLVED_TEXT[resolution.reason] : 'The saved product group has no listings in the stored data.'
      return { success: true, data: { captured: false, reason: 'identity_unconfirmed', detail } }
    }
    const matched = resolution.indices.map((i) => candidates[i])
    const payload = bounded({
      candidate: { ...saved.candidate, title: resolution.title, pid: saved.candidate.pid ?? (matched[0].pid === null ? null : String(matched[0].pid)) },
      offers,
      source: cached.row.payload.source,
      truncated: false,
    })
    const capturedAtMs = now()
    const existing = await tools.query<SnapshotRow & Record<string, unknown>>(SNAPSHOT_COLLECTION, { where: { savedId: rawId }, limit: 1 })
    if (!existing.success) throw new StorageError(`snapshot read failed: ${existing.error}`)
    // Never replace saved prices with prices the feed observed earlier than the ones already saved.
    const prev = existing.data.records[0]?.data.payload?.source?.scrapedAt
    const next = payload.source.scrapedAt
    if (prev && next && Date.parse(next) < Date.parse(prev)) {
      return { success: true, data: { captured: false, reason: 'not_newer', detail: 'The stored data is older than the prices you already saved, so your saved prices were kept.' } }
    }
    const data = { savedId: rawId, userId, query: v.query, payload, capturedAtMs }
    const id = existing.data.records[0]?.recordId
    const wrote = id ? await tools.update(SNAPSHOT_COLLECTION, id, data) : await tools.create(SNAPSHOT_COLLECTION, data)
    if (!wrote.success) throw new StorageError(`snapshot write failed: ${wrote.error}`)
    return { success: true, data: { captured: true, snapshot: { ...payload, capturedAt: new Date(capturedAtMs).toISOString() } } }
  } catch (e) {
    console.error(`[snapshot] ${e instanceof StorageError ? e.message : 'unexpected error'}`)
    return INTERNAL
  }
}

/** Delete the snapshot of a saved product the caller owned. The saved row may already be gone; ownership is the snapshot's own. */
export async function discardSavedSnapshot(rawId: unknown, deps: SnapshotDeps): Promise<{ success: true; data: { discarded: boolean } } | typeof INTERNAL> {
  const { tools, userId } = deps
  if (typeof rawId !== 'string' || rawId.length === 0 || rawId.length > 128 || !userId) return { success: true, data: { discarded: false } }
  try {
    const res = await tools.query<SnapshotRow & Record<string, unknown>>(SNAPSHOT_COLLECTION, { where: { savedId: rawId }, limit: 1 })
    if (!res.success) throw new StorageError(`snapshot read failed: ${res.error}`)
    const rec = res.data.records[0]
    if (!rec || rec.data.userId !== userId) return { success: true, data: { discarded: false } }
    // Never discard the snapshot of a record that still exists: removing a saved product is what discards it.
    const still = await tools.get(SAVED_COLLECTION, rawId)
    if (still.success) return { success: true, data: { discarded: false } }
    await tools.remove(SNAPSHOT_COLLECTION, rec.recordId)
    return { success: true, data: { discarded: true } }
  } catch (e) {
    console.error(`[snapshot] ${e instanceof StorageError ? e.message : 'unexpected error'}`)
    return INTERNAL
  }
}

/** Remove the caller's snapshots whose saved record no longer exists (e.g. a removal whose cleanup call was lost). */
async function sweepOrphans(deps: SnapshotDeps): Promise<void> {
  const { tools, userId } = deps
  const mine = await tools.query<SnapshotRow & Record<string, unknown>>(SNAPSHOT_COLLECTION, { where: { userId }, limit: 200 })
  if (!mine.success) return
  for (const rec of mine.data.records) {
    const parent = await tools.get(SAVED_COLLECTION, String(rec.data.savedId))
    if (!parent.success) await tools.remove(SNAPSHOT_COLLECTION, rec.recordId)
  }
}
