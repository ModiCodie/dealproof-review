import { describe, expect, it } from 'vitest'
import sony from '../../../tests/fixtures/real-sony.normalized.json'
import { getSavedComparison } from './comparison'
import { makeFakeTools } from '../pricing/test-helpers'
import { SAVED_COLLECTION, toSavedRow } from '../../lib/saved'
import { cacheKey } from '../pricing/normalize'
import source from './comparison.ts?raw'

const T0 = Date.UTC(2026, 10, 20, 12, 0, 0)
const HOUR = 3_600_000
const QUERY = 'Sony WH-1000XM5'

async function seed(opts: { cachedAgoMs?: number | null; owner?: string } = {}) {
  const tools = makeFakeTools()
  const row = { ...toSavedRow({ family: 'sony-wh-1000xm5', variant: {} }, QUERY), userId: opts.owner ?? 'user-a' }
  const created = await tools.create(SAVED_COLLECTION, row)
  if (!created.success) throw new Error('seed failed')
  if (opts.cachedAgoMs !== null) {
    const cachedAtMs = T0 - (opts.cachedAgoMs ?? HOUR)
    await tools.create('search_cache', {
      key: cacheKey('us', QUERY),
      market: 'us',
      query: QUERY,
      payload: { candidates: sony.candidates, source: sony.source },
      cachedAtMs,
      expiresAtMs: cachedAtMs + 12 * HOUR,
    })
  }
  return { tools, id: created.data.recordId }
}

const call = (tools: ReturnType<typeof makeFakeTools>, id: unknown, userId = 'user-a') =>
  getSavedComparison(id, { tools, userId, now: () => T0 })

describe('getSavedComparison: ownership', () => {
  it("answers the owner with the stored data", async () => {
    const { tools, id } = await seed()
    const r = await call(tools, id)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.result?.candidates.length).toBeGreaterThan(0)
      expect(r.data.stale).toBe(false)
      expect(r.data.saved.query).toBe(QUERY)
    }
  })

  it("refuses another user's record with the same answer as a missing one (no probing)", async () => {
    const { tools, id } = await seed({ owner: 'user-a' })
    const other = await call(tools, id, 'user-b')
    const missing = await call(tools, 'does-not-exist', 'user-b')
    expect(other).toEqual(missing)
    expect(other).toMatchObject({ success: false, code: 'not_found' })
    expect(JSON.stringify(other)).not.toContain('Sony')
  })

  it('refuses malformed ids and an empty caller id', async () => {
    const { tools, id } = await seed()
    for (const bad of [undefined, null, 5, '', {}, 'x'.repeat(500)]) {
      expect(await call(tools, bad)).toMatchObject({ success: false, code: 'not_found' })
    }
    expect(await call(tools, id, '')).toMatchObject({ success: false, code: 'not_found' })
  })
})

describe('getSavedComparison: stale and missing data never trigger a paid request', () => {
  it('returns old data labelled stale, without fetching or using quota', async () => {
    const { tools, id } = await seed({ cachedAgoMs: 30 * HOUR })
    const r = await call(tools, id)
    expect(r.success && r.data.stale).toBe(true)
    expect(r.success && r.data.result?.candidates.length).toBeGreaterThan(0)
    expect(tools.dump('usage_claims')).toHaveLength(0) // no quota slot, no lock
  })

  it('reports missing data as result: null (not an error) and still uses no quota', async () => {
    const { tools, id } = await seed({ cachedAgoMs: null })
    const r = await call(tools, id)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.result).toBeNull()
      expect(r.data.stale).toBe(false)
    }
    expect(tools.dump('usage_claims')).toHaveLength(0)
    expect(tools.dump('search_cache')).toHaveLength(0)
  })

  it('reports the real remaining quota without changing it', async () => {
    const { tools, id } = await seed()
    await tools.create('usage_claims', { claimKey: 'u:user-a:2026-11-20:1', kind: 'user', userId: 'user-a', day: '2026-11-20', createdAtMs: T0 })
    const r = await call(tools, id)
    expect(r.success && r.data.quota).toEqual({ userDailyLimit: 3, userRemainingToday: 2 })
    expect(tools.dump('usage_claims')).toHaveLength(1)
  })

  it('does not import the upstream client at all (structural guarantee)', () => {
    // strip comments so the explanatory header does not count
    const src = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/pricesapi|searchPricesApi|claimSlot|acquireLock|fetch\(/)
  })
})

describe('getSavedComparison: data model', () => {
  it('derives the cache key from the saved query, so a forged key field cannot redirect it', async () => {
    const { tools, id } = await seed()
    const rec = tools.dump(SAVED_COLLECTION)[0]
    rec.data.cacheKey = 'us|some other query' // ignored: the key is derived
    const r = await call(tools, id)
    expect(r.success && r.data.result?.query).toBe(QUERY)
  })

  it('rejects a saved row whose query is invalid', async () => {
    const { tools, id } = await seed()
    tools.dump(SAVED_COLLECTION)[0].data.query = 'http://evil.example'
    expect(await call(tools, id)).toMatchObject({ success: false, code: 'invalid_saved_product' })
  })
})

describe('saved_products: duplicates (fake mirrors the DO uniqueOn rule)', () => {
  it('refuses a second row for the same user and product key', async () => {
    const tools = makeFakeTools()
    const row = { ...toSavedRow({ family: 'sony-wh-1000xm5', variant: {} }, QUERY), userId: 'user-a' }
    expect((await tools.create(SAVED_COLLECTION, row)).success).toBe(true)
    expect((await tools.create(SAVED_COLLECTION, row)).success).toBe(false)
    expect((await tools.create(SAVED_COLLECTION, { ...row, userId: 'user-b' })).success).toBe(true)
  })
})
