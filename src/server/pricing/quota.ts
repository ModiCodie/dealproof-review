/**
 * Atomic claims on top of the `usage_claims` collection.
 *
 * Why this is safe: the collection has `uniqueOn: ['claimKey']`, and the record
 * Durable Object checks that constraint and inserts in one synchronous step.
 * Two simultaneous `claim()` calls with the same key therefore cannot both
 * succeed; the loser gets `{ ok: false, reason: 'taken' }`.
 *
 * (Do NOT pass a `recordId` to tools.create here: that is an upsert and would
 * silently overwrite an existing claim instead of failing.)
 */

import type { ActionTools } from 'deepspace/worker'

const COLLECTION = 'usage_claims'

export type ClaimKind = 'user' | 'global' | 'lock'

export type ClaimResult =
  | { ok: true; recordId: string }
  | { ok: false; reason: 'taken' }

export class StorageError extends Error {}

export async function claim(
  tools: ActionTools,
  args: { claimKey: string; kind: ClaimKind; userId: string; day: string; now: number },
): Promise<ClaimResult> {
  const res = await tools.create(COLLECTION, {
    claimKey: args.claimKey,
    kind: args.kind,
    userId: args.userId,
    day: args.day,
    createdAtMs: args.now,
  })
  if (res.success) return { ok: true, recordId: res.data.recordId }
  if (/duplicate/i.test(res.error)) return { ok: false, reason: 'taken' }
  throw new StorageError(`claim failed: ${res.error}`)
}

export async function release(tools: ActionTools, recordId: string): Promise<void> {
  const res = await tools.remove(COLLECTION, recordId)
  if (!res.success) console.warn(`[pricing] release failed: ${res.error}`)
}

/** Claims the first free slot `prefix:1 .. prefix:max`. Returns its record id or null if all taken. */
export async function claimSlot(
  tools: ActionTools,
  args: {
    prefix: string
    max: number
    kind: 'user' | 'global'
    userId: string
    day: string
    now: number
  },
): Promise<string | null> {
  for (let n = 1; n <= args.max; n++) {
    const r = await claim(tools, {
      claimKey: `${args.prefix}:${n}`,
      kind: args.kind,
      userId: args.userId,
      day: args.day,
      now: args.now,
    })
    if (r.ok) return r.recordId
  }
  return null
}

/**
 * Takes the in-flight lock for a cache key, so concurrent identical searches
 * trigger one upstream call. An abandoned lock (older than `ttlMs`, e.g. the
 * Worker was killed mid-request) is taken over.
 */
export async function acquireLock(
  tools: ActionTools,
  args: { key: string; userId: string; day: string; now: number; ttlMs: number },
): Promise<string | null> {
  const claimKey = `lock:${args.key}`
  const first = await claim(tools, { claimKey, kind: 'lock', userId: args.userId, day: args.day, now: args.now })
  if (first.ok) return first.recordId

  const existing = await tools.query<{ createdAtMs: number }>(COLLECTION, {
    where: { claimKey },
    limit: 1,
  })
  if (!existing.success) throw new StorageError(`lock lookup failed: ${existing.error}`)
  const row = existing.data.records[0]
  if (row && args.now - Number(row.data.createdAtMs) > args.ttlMs) {
    await tools.remove(COLLECTION, row.recordId)
    const retry = await claim(tools, { claimKey, kind: 'lock', userId: args.userId, day: args.day, now: args.now })
    if (retry.ok) return retry.recordId
  }
  return null
}

/** How many user-slot claims the user holds for the given UTC day. */
export async function countUserClaims(
  tools: ActionTools,
  userId: string,
  day: string,
): Promise<number> {
  const res = await tools.query(COLLECTION, { where: { kind: 'user', userId, day }, limit: 100 })
  if (!res.success) throw new StorageError(`count failed: ${res.error}`)
  return res.data.count
}

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

export function secondsUntilNextUtcDay(nowMs: number): number {
  const d = new Date(nowMs)
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - nowMs) / 1000))
}
