/**
 * Snapshot persistence for saved GENERIC products. Invented offers/groups only.
 * The server copies prices from its own cache; every failure path must leave the saved prices untouched.
 */
import { describe, expect, it, vi } from 'vitest'
import airpods from '../../../tests/fixtures/synthetic/airpods.json'
import sony from '../../../tests/fixtures/real-sony.normalized.json'
import { getSavedComparison } from './comparison'
import { captureSavedSnapshot, discardSavedSnapshot, MAX_BYTES, MAX_OFFERS, SNAPSHOT_COLLECTION } from './snapshot'
import { makeFakeTools } from '../pricing/test-helpers'
import { SAVED_COLLECTION, toSavedRow } from '../../lib/saved'
import { targetForCandidate } from '../../lib/candidates'
import { cacheKey } from '../pricing/normalize'
import type { NormalizedOffer, ProductCandidate } from '../../lib/pricing-types'
import snapshotSource from './snapshot.ts?raw'
import { actions } from '../../actions'

const T0 = Date.UTC(2026, 10, 21, 12, 0, 0)
const HOUR = 3_600_000
const QUERY = 'Apple AirPods Pro 2'
const base = (airpods as unknown as { candidates: ProductCandidate[] }).candidates[0]
const offers = (p: string, n: number, price: number): NormalizedOffer[] =>
  Array.from({ length: n }, (_, i) => ({ ...base.offers[i % base.offers.length], seller: `${p} ${i}`, sellerUrl: `https://${p}${i}.example/`, listingUrl: `https://${p}${i}.example/p`, price: price + i, title: `Apple AirPods Pro 2nd Generation New ${p}${i}` }) as NormalizedOffer)
const group = (pid: number, title: string, o: NormalizedOffer[]): ProductCandidate => ({ ...base, pid, productRef: { id: String(pid), idType: 'pricesapi', market: 'us' }, catalogId: `cat${pid}`, clusterId: `clu${pid}`, title, offerCount: o.length, offers: o })
const A = group(1, 'Apple AirPods Pro 2nd Generation Wireless Earbuds', offers('alpha', 5, 150))
const B = group(2, 'Apple AirPods Pro 2nd Generation Wireless Earbuds with MagSafe Case', offers('beta', 5, 220))
const SRC = (iso: string) => ({ ...(airpods as { source: object }).source, scrapedAt: iso })

type Tools = ReturnType<typeof makeFakeTools>
async function setCache(tools: Tools, cands: ProductCandidate[], o: { scrapedAt?: string; cachedAgo?: number; query?: string } = {}) {
  const q = o.query ?? QUERY
  const existing = tools.dump('search_cache').find((r) => r.data.key === cacheKey('us', q))
  const cachedAtMs = T0 - (o.cachedAgo ?? 0)
  const data = { key: cacheKey('us', q), market: 'us', query: q, payload: { candidates: cands, source: SRC(o.scrapedAt ?? '2026-11-21T11:59:00.000Z') }, cachedAtMs, expiresAtMs: cachedAtMs + 12 * HOUR }
  if (existing) await tools.update('search_cache', existing.recordId, data)
  else await tools.create('search_cache', data)
}
async function saveAs(tools: Tools, pick: ProductCandidate, owner = 'u1', chosen: Record<string, string> = {}) {
  const { target } = targetForCandidate(QUERY, pick, pick.offers.map((o) => o.title))
  const t = { ...target, variant: { ...target.variant, ...chosen } }
  const c = await tools.create(SAVED_COLLECTION, { ...toSavedRow(t, QUERY, pick), userId: owner })
  if (!c.success) throw new Error('seed failed: ' + c.error)
  return c.data.recordId
}
const cap = (tools: Tools, id: unknown, userId = 'u1', now = T0) => captureSavedSnapshot(id, { tools, userId, now: () => now })
const open = (tools: Tools, id: unknown, userId = 'u1', now = T0) => getSavedComparison(id, { tools, userId, now: () => now })
const snapOf = async (tools: Tools, id: string) => {
  const r = await open(tools, id)
  return r.success ? r.data.snapshot ?? null : null
}

describe('capturing and reopening', () => {
  it('stores only the saved group, and reopening returns it without a cache and without quota', async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A, B])
    const id = await saveAs(tools, A)
    const r = await cap(tools, id)
    expect(r.success && r.data.captured).toBe(true)
    // the shared cache is replaced by someone else's search, then removed entirely
    await setCache(tools, [B], { scrapedAt: '2026-11-21T13:00:00.000Z' })
    tools.dump('search_cache').length = 0
    const s = await snapOf(tools, id)
    expect(s?.offers).toEqual(A.offers)
    expect(s?.offers.some((o) => /beta/.test(o.title ?? ''))).toBe(false)
    expect(s?.candidate).toMatchObject({ pid: '1', title: A.title })
    expect(s?.source.scrapedAt).toBe('2026-11-21T11:59:00.000Z')
    expect(tools.dump('usage_claims')).toHaveLength(0)
  })
  it('keeps the observation time and the capture time apart', async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A], { scrapedAt: '2026-11-21T10:00:00.000Z' })
    const id = await saveAs(tools, A)
    await cap(tools, id)
    const s = (await snapOf(tools, id))!
    expect(s.source.scrapedAt).toBe('2026-11-21T10:00:00.000Z')
    expect(s.capturedAt).toBe(new Date(T0).toISOString())
  })
  it('does not call the upstream API (structural guarantee)', () => {
    const src = snapshotSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/pricesapi|searchPricesApi|claimSlot|acquireLock|fetch\(/)
  })
  it('keeps the snapshot bounded', async () => {
    const tools = makeFakeTools()
    const many = group(7, A.title!, offers('big', 400, 100).map((o) => ({ ...o, title: `${o.title} ${'x'.repeat(3000)}` })))
    await setCache(tools, [many])
    const id = await saveAs(tools, many)
    await cap(tools, id)
    const s = (await snapOf(tools, id))!
    expect(s.truncated).toBe(true)
    expect(s.offers.length).toBeLessThanOrEqual(MAX_OFFERS)
    expect(JSON.stringify(s).length).toBeLessThanOrEqual(MAX_BYTES + 5000)
  })
})

describe('a failed or ambiguous refresh never replaces or erases the saved prices', () => {
  async function saved() {
    const tools = makeFakeTools()
    await setCache(tools, [A, B])
    const id = await saveAs(tools, A)
    await cap(tools, id)
    return { tools, id, before: (await snapOf(tools, id))! }
  }
  const unchanged = async (tools: Tools, id: string, before: Awaited<ReturnType<typeof snapOf>>) => expect(await snapOf(tools, id)).toEqual(before)

  it('reordered candidates: the same group is found and its new prices are saved', async () => {
    const { tools, id, before } = await saved()
    const A2 = group(1, A.title!, offers('alpha', 5, 120))
    await setCache(tools, [B, A2], { scrapedAt: '2026-11-21T12:30:00.000Z' })
    const r = await cap(tools, id, 'u1', T0 + HOUR)
    expect(r.success && r.data.captured).toBe(true)
    const after = (await snapOf(tools, id))!
    expect(after.offers).toEqual(A2.offers)
    expect(after.offers).not.toEqual(before.offers)
  })
  it('changed provider ids with the same title: not confirmed, saved prices kept', async () => {
    const { tools, id, before } = await saved()
    await setCache(tools, [{ ...group(9, A.title!, offers('zeta', 4, 90)), catalogId: 'x', clusterId: 'y' }, B], { scrapedAt: '2026-11-21T12:30:00.000Z' })
    const r = await cap(tools, id)
    expect(r.success && !r.data.captured && r.data.reason).toBe('identity_unconfirmed')
    await unchanged(tools, id, before)
  })
  it('original group disappears: not confirmed, saved prices kept', async () => {
    const { tools, id, before } = await saved()
    await setCache(tools, [B], { scrapedAt: '2026-11-21T12:30:00.000Z' })
    expect((await cap(tools, id)).success).toBe(true)
    await unchanged(tools, id, before)
  })
  it('a similarly named different group appears: not substituted', async () => {
    const { tools, id, before } = await saved()
    await setCache(tools, [group(3, 'Apple AirPods Pro 2nd Generation Wireless Earbuds Lightning', offers('gamma', 3, 80)), B], { scrapedAt: '2026-11-21T12:30:00.000Z' })
    const r = await cap(tools, id)
    expect(r.success && !r.data.captured).toBe(true)
    await unchanged(tools, id, before)
  })
  it('shared cache replaced by a different search result: saved prices kept, still reopenable', async () => {
    const { tools, id, before } = await saved()
    await setCache(tools, (sony as unknown as { candidates: ProductCandidate[] }).candidates, { scrapedAt: '2026-11-21T12:30:00.000Z' })
    await cap(tools, id)
    await unchanged(tools, id, before)
  })
  it('cache expired or missing: nothing is captured, saved prices kept', async () => {
    const { tools, id, before } = await saved()
    await setCache(tools, [A], { cachedAgo: 13 * HOUR })
    const r = await cap(tools, id)
    expect(r.success && !r.data.captured && r.data.reason).toBe('no_stored_data')
    tools.dump('search_cache').length = 0
    expect((await cap(tools, id)).success).toBe(true)
    await unchanged(tools, id, before)
  })
  it('older data never overwrites newer saved prices', async () => {
    const { tools, id, before } = await saved()
    await setCache(tools, [group(1, A.title!, offers('old', 5, 300))], { scrapedAt: '2026-11-20T00:00:00.000Z' })
    const r = await cap(tools, id)
    expect(r.success && !r.data.captured && r.data.reason).toBe('not_newer')
    await unchanged(tools, id, before)
  })
  it('a failed write leaves the previous snapshot (storage error is reported, nothing erased)', async () => {
    const { tools, id, before } = await saved()
    await setCache(tools, [group(1, A.title!, offers('alpha', 5, 100))], { scrapedAt: '2026-11-21T12:40:00.000Z' })
    const realUpdate = tools.update.bind(tools)
    tools.update = (async (c: string, ...rest: unknown[]) => (c === SNAPSHOT_COLLECTION ? { success: false, error: 'boom' } : (realUpdate as (...a: unknown[]) => unknown)(c, ...rest))) as never
    const r = await cap(tools, id)
    expect(r.success).toBe(false)
    tools.update = realUpdate
    await unchanged(tools, id, before)
  })
})

describe('two candidates of one search are saved independently', () => {
  it('A and B (same variant) both save, keep their own listings, and removing one keeps the other', async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A, B])
    const a = await saveAs(tools, A)
    const b = await saveAs(tools, B)
    expect(a).not.toBe(b)
    await cap(tools, a)
    await cap(tools, b)
    expect((await snapOf(tools, a))!.offers).toEqual(A.offers)
    expect((await snapOf(tools, b))!.offers).toEqual(B.offers)
    // remove A (the client removes the row, then asks for its snapshot to be discarded)
    await tools.remove(SAVED_COLLECTION, a)
    expect(await discardSavedSnapshot(a, { tools, userId: 'u1' })).toEqual({ success: true, data: { discarded: true } })
    expect(await open(tools, a)).toMatchObject({ success: false, code: 'not_found' })
    expect((await snapOf(tools, b))!.offers).toEqual(B.offers)
    expect(tools.dump(SNAPSHOT_COLLECTION)).toHaveLength(1)
  })
  it('refuses a second save only for an identical title (one product by design), never for a different title', async () => {
    const tools = makeFakeTools()
    await saveAs(tools, A)
    await saveAs(tools, B)
    await expect(saveAs(tools, { ...A, pid: 99, catalogId: 'other' })).rejects.toThrow(/Duplicate/)
  })
})

describe('ownership, discard and legacy records', () => {
  it("another user can neither capture, read nor discard someone else's snapshot", async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A])
    const id = await saveAs(tools, A, 'u1')
    await cap(tools, id)
    expect(await cap(tools, id, 'u2')).toMatchObject({ success: false, code: 'not_found' })
    expect(await open(tools, id, 'u2')).toMatchObject({ success: false, code: 'not_found' })
    expect(await discardSavedSnapshot(id, { tools, userId: 'u2' })).toEqual({ success: true, data: { discarded: false } })
    expect(tools.dump(SNAPSHOT_COLLECTION)).toHaveLength(1)
  })
  it('the snapshot collection is closed to every client role', async () => {
    const { savedSnapshotsSchema } = await import('../../schemas/saved-schema')
    for (const role of ['*', 'viewer', 'member', 'admin']) expect(savedSnapshotsSchema.permissions?.[role]).toEqual({ read: false, create: false, update: false, delete: false })
  })
  it('discard never removes the snapshot of a record that still exists', async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A])
    const id = await saveAs(tools, A)
    await cap(tools, id)
    expect(await discardSavedSnapshot(id, { tools, userId: 'u1' })).toEqual({ success: true, data: { discarded: false } })
    expect(tools.dump(SNAPSHOT_COLLECTION)).toHaveLength(1)
  })
  it("a capture sweeps the caller's snapshots whose record was removed elsewhere", async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A, B])
    const a = await saveAs(tools, A)
    const b = await saveAs(tools, B)
    await cap(tools, a)
    await tools.remove(SAVED_COLLECTION, a) // the cleanup call was lost
    await cap(tools, b)
    expect(tools.dump(SNAPSHOT_COLLECTION).map((r) => r.data.savedId)).toEqual([b])
  })
  it('a legacy generic record (no ids, no snapshot) reopens from the cache, and gets a snapshot on capture when its exact title is found', async () => {
    const tools = makeFakeTools()
    await setCache(tools, [B, A])
    const id = await saveAs(tools, A)
    const rec = tools.dump(SAVED_COLLECTION).find((r) => r.recordId === id)!
    for (const k of ['cp', 'cc', 'cl']) delete (rec.data.variant as Record<string, string>)[k]
    const r = await open(tools, id)
    expect(r.success && r.data.snapshot).toBeNull()
    expect(r.success && r.data.result?.candidates).toHaveLength(2)
    expect((await cap(tools, id)).success).toBe(true)
    expect((await snapOf(tools, id))!.offers).toEqual(A.offers)
  })
  it('Sony records never get a snapshot and still reopen from the cache', async () => {
    const tools = makeFakeTools()
    const c = await tools.create(SAVED_COLLECTION, { ...toSavedRow({ family: 'sony-wh-1000xm5', variant: {} }, 'Sony WH-1000XM5'), userId: 'u1' })
    if (!c.success) throw new Error('seed')
    await tools.create('search_cache', { key: cacheKey('us', 'Sony WH-1000XM5'), market: 'us', query: 'Sony WH-1000XM5', payload: { candidates: sony.candidates, source: sony.source }, cachedAtMs: T0, expiresAtMs: T0 + 12 * HOUR })
    expect(await cap(tools, c.data.recordId)).toEqual({ success: true, data: { captured: false, reason: 'not_applicable', detail: expect.any(String) } })
    const r = await open(tools, c.data.recordId)
    expect(r.success && r.data.snapshot).toBeNull()
    expect(r.success && r.data.result?.candidates.length).toBeGreaterThan(0)
    expect(tools.dump(SNAPSHOT_COLLECTION)).toHaveLength(0)
  })
})

describe('security: nothing the browser sends is trusted', () => {
  it('capturing before the saved record exists (a race ahead of the confirmed create) writes nothing', async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A])
    expect(await cap(tools, 'not-created-yet')).toMatchObject({ success: false, code: 'not_found' })
    expect(tools.dump(SNAPSHOT_COLLECTION)).toHaveLength(0)
  })
  it('the action takes only the saved id: supplied prices, owner or contents are ignored', async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A, B])
    const id = await saveAs(tools, A, 'u1')
    const evil = [{ ...A.offers[0], title: 'EVIL INJECTED', price: 0.01 }]
    vi.useFakeTimers({ toFake: ['Date'] }) // the action reads the real clock; the cached data is pinned to T0
    vi.setSystemTime(T0)
    try {
      const r = (await actions.captureSavedSnapshot({ userId: 'u1', params: { savedId: id, offers: evil, userId: 'u2', payload: { offers: evil }, candidate: { title: 'x' } }, tools, env: {} } as never)) as { success: boolean }
    expect(r.success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    const rows = tools.dump(SNAPSHOT_COLLECTION)
    expect(rows).toHaveLength(1)
    expect(rows[0].data.userId).toBe('u1') // the verified caller, never a parameter
    expect(JSON.stringify(rows[0].data)).not.toContain('EVIL INJECTED')
    expect((rows[0].data.payload as { offers: unknown[] }).offers).toEqual(A.offers)
  })
  it('the stored offer count and size never exceed the limits, even for a huge cached group', async () => {
    const tools = makeFakeTools()
    const huge = group(5, A.title!, offers('huge', 1000, 50))
    await setCache(tools, [huge])
    const id = await saveAs(tools, huge)
    await cap(tools, id)
    const row = tools.dump(SNAPSHOT_COLLECTION)[0].data
    expect((row.payload as { offers: unknown[] }).offers.length).toBeLessThanOrEqual(MAX_OFFERS)
    expect(JSON.stringify(row.payload).length).toBeLessThanOrEqual(MAX_BYTES)
  })
  it('the caller id is required: an empty verified id is refused everywhere', async () => {
    const tools = makeFakeTools()
    await setCache(tools, [A])
    const id = await saveAs(tools, A, 'u1')
    expect(await cap(tools, id, '')).toMatchObject({ success: false, code: 'not_found' })
    expect(await discardSavedSnapshot(id, { tools, userId: '' })).toEqual({ success: true, data: { discarded: false } })
  })
})
