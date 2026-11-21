import { describe, expect, it, vi, afterEach } from 'vitest'
import sony from '../../../tests/fixtures/pricesapi-search-sony.json'
import samsung from '../../../tests/fixtures/pricesapi-search-samsung.json'
import { runSearch } from './search'
import { cacheKey, normalizeOffer, normalizeSearchResponse, validateQuery } from './normalize'
import { json, makeFakeTools, scriptedFetch } from './test-helpers'
import type { SearchActionResult, SearchFailure, SearchSuccess } from '../../lib/pricing-types'

const KEY = 'pk-SECRET-should-never-leak-123'
const T0 = Date.UTC(2026, 10, 19, 12, 0, 0)
const HOUR = 3_600_000

const sonyBody = sony.body
const samsungBody = samsung.body
const emptyBody = { success: true, data: { query: 'zzz', market: 'us', products: [] }, meta: { scraped_at: '2026-11-19T12:00:00Z' } }

function setup(over: { respond?: () => Response | Promise<Response>; apiKey?: string | undefined; now?: { t: number } } = {}) {
  const tools = makeFakeTools()
  const fetchImpl = scriptedFetch(over.respond ?? (() => json(sonyBody)))
  const clock = over.now ?? { t: T0 }
  const run = (q: unknown, userId = 'user-a', extra: Record<string, string> = {}) =>
    runSearch(q, {
      tools,
      userId,
      apiKey: 'apiKey' in over ? over.apiKey : KEY,
      fetchImpl,
      now: () => clock.t,
      configEnv: extra,
    })
  return { tools, fetchImpl, run, clock }
}

const ok = (r: SearchActionResult): SearchSuccess => {
  if (!r.success) throw new Error(`expected success, got ${r.code}: ${r.error}`)
  return r
}
const bad = (r: SearchActionResult): SearchFailure => {
  if (r.success) throw new Error('expected failure')
  return r
}

afterEach(() => vi.restoreAllMocks())

describe('successful search + normalization (fixture)', () => {
  it('returns normalized candidates, offers and both timestamps', async () => {
    const { run, fetchImpl } = setup()
    const r = ok(await run('Sony WH-1000XM5'))
    expect(fetchImpl.calls).toHaveLength(1)
    expect(r.data.fromCache).toBe(false)
    const res = r.data.result
    expect(res.query).toBe('Sony WH-1000XM5')
    expect(res.market).toBe('us')
    expect(res.candidates).toHaveLength(3)
    const c = res.candidates[0]
    expect(c.productRef).toEqual({ id: '100569557', idType: 'pricesapi', market: 'us' })
    expect(c.offerCount).toBe(18) // the API's count, not the 3 offers kept in the truncated fixture
    const o = c.offers[0]
    expect(o).toMatchObject({ seller: 'Walmart - Secondipity', price: 147.26, currency: 'USD', availability: 'in_stock', condition: 'unknown', observedAt: null })
    expect(o.listingUrl).toMatch(/^https:\/\/www\.walmart\.com\//)
    // true source observation time is preserved separately from our cache time
    expect(res.source.scrapedAt).toBe('2026-11-19T21:56:10.161Z')
    expect(res.cachedAt).toBe(new Date(T0).toISOString())
    expect(res.source.scrapedAt).not.toBe(res.cachedAt)
  })

  it('sends the key only in the Authorization header and requests exactly one URL on the fixed host', async () => {
    const { run, fetchImpl } = setup()
    ok(await run('Sony WH-1000XM5'))
    const call = fetchImpl.calls[0]
    expect(call.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(call.url).not.toContain(KEY)
    const u = new URL(call.url)
    expect(u.origin).toBe('https://api.pricesapi.io')
    expect(u.pathname).toBe('/api/v1/products/search')
    expect(u.searchParams.get('market')).toBe('us')
  })
})

describe('missing API key', () => {
  it('fails with not_configured, makes no upstream call and consumes no quota', async () => {
    const { run, fetchImpl, tools } = setup({ apiKey: undefined })
    const r = bad(await run('Sony WH-1000XM5'))
    expect(r.code).toBe('not_configured')
    expect(fetchImpl.calls).toHaveLength(0)
    expect(tools.dump('usage_claims')).toHaveLength(0)
  })

  it('treats an empty-string key as missing', async () => {
    const { run, fetchImpl } = setup({ apiKey: '' })
    expect(bad(await run('Sony WH-1000XM5')).code).toBe('not_configured')
    expect(fetchImpl.calls).toHaveLength(0)
  })
})

describe('input validation', () => {
  it.each([
    [undefined], [null], [42], [{}], [['a']], [''], ['a'], ['   '], ['x'.repeat(101)],
    ['https://www.bestbuy.com/site/x'], ['www.example.com/product'], ['bad\u0000query'], ['line\nbreak\u0007'],
  ])('rejects %j without any upstream call', async (q) => {
    const { run, fetchImpl, tools } = setup()
    expect(bad(await run(q)).code).toBe('invalid_query')
    expect(fetchImpl.calls).toHaveLength(0)
    expect(tools.dump('usage_claims')).toHaveLength(0)
  })

  it('normalizes whitespace and treats case-insensitively equal queries as one cache key', async () => {
    const { run, fetchImpl } = setup()
    ok(await run('  Sony   WH-1000XM5 '))
    const second = ok(await run('sony wh-1000xm5'))
    expect(second.data.fromCache).toBe(true)
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('validateQuery returns the cleaned query', () => {
    expect(validateQuery('  Logitech   MX Master 3S ')).toEqual({ ok: true, query: 'Logitech MX Master 3S' })
  })
})

describe('empty API response', () => {
  it('returns an empty result, does not cache it and refunds the quota', async () => {
    const { run, tools } = setup({ respond: () => json(emptyBody) })
    const r = ok(await run('zzzz unlikely product'))
    expect(r.data.result.candidates).toEqual([])
    expect(r.data.quota.userRemainingToday).toBe(3)
    expect(tools.dump('search_cache')).toHaveLength(0)
    expect(tools.dump('usage_claims')).toHaveLength(0)
  })

  it('treats candidates with zero offers as empty (PricesAPI bills only when offers exist)', async () => {
    const body = { success: true, data: { products: [{ pid: 1, title: 'X', offers: [] }] }, meta: {} }
    const { run, tools } = setup({ respond: () => json(body) })
    ok(await run('some product'))
    expect(tools.dump('search_cache')).toHaveLength(0)
  })
})

describe('upstream failures', () => {
  it.each([
    [500, 'upstream_error'],
    [503, 'upstream_error'],
    [401, 'upstream_auth'],
    [403, 'upstream_credits'],
    [429, 'upstream_rate_limited'],
  ])('HTTP %i -> %s, no retry, quota refunded (free response)', async (status, code) => {
    const { run, fetchImpl, tools } = setup({ respond: () => json({ error: { code: 'X', message: KEY } }, status, { 'Retry-After': '7' }) })
    const r = bad(await run('Sony WH-1000XM5'))
    expect(r.code).toBe(code)
    expect(fetchImpl.calls).toHaveLength(1) // never retried
    expect(tools.dump('usage_claims')).toHaveLength(0)
    expect(JSON.stringify(r)).not.toContain(KEY) // upstream body is not forwarded
    if (status === 429) expect(r.retryAfterSeconds).toBe(7)
  })

  it('timeout -> upstream_timeout; claims are kept because the cost is unknown', async () => {
    const { run, fetchImpl, tools } = setup({
      respond: () => {
        const e = new Error('The operation timed out')
        e.name = 'TimeoutError'
        throw e
      },
    })
    const r = bad(await run('Sony WH-1000XM5'))
    expect(r.code).toBe('upstream_timeout')
    expect(fetchImpl.calls).toHaveLength(1)
    expect(tools.dump('usage_claims').filter((c) => c.data.kind === 'user')).toHaveLength(1)
    expect(tools.dump('usage_claims').some((c) => c.data.kind === 'lock')).toBe(false) // lock released
  })

  it('network error -> upstream_error', async () => {
    const { run } = setup({ respond: () => { throw new TypeError('fetch failed') } })
    expect(bad(await run('Sony WH-1000XM5')).code).toBe('upstream_error')
  })

  it('unexpected body shape -> upstream_error and nothing cached', async () => {
    const { run, tools } = setup({ respond: () => json({ hello: 'world' }) })
    expect(bad(await run('Sony WH-1000XM5')).code).toBe('upstream_error')
    expect(tools.dump('search_cache')).toHaveLength(0)
  })

  it('unreadable (non-JSON) body -> upstream_error', async () => {
    const { run } = setup({ respond: () => new Response('<html>oops</html>', { status: 200 }) })
    expect(bad(await run('Sony WH-1000XM5')).code).toBe('upstream_error')
  })
})

describe('cache', () => {
  it('serves the second identical search from cache with no upstream call and no quota use', async () => {
    const { run, fetchImpl } = setup()
    const first = ok(await run('Sony WH-1000XM5'))
    const second = ok(await run('Sony WH-1000XM5'))
    expect(fetchImpl.calls).toHaveLength(1)
    expect(second.data.fromCache).toBe(true)
    expect(second.data.quota.userRemainingToday).toBe(first.data.quota.userRemainingToday)
    expect(second.data.result.source.scrapedAt).toBe(first.data.result.source.scrapedAt)
  })

  it('serves a cached result to a different user and without needing the API key', async () => {
    const { run, tools, fetchImpl, clock } = setup()
    ok(await run('Sony WH-1000XM5', 'user-a'))
    const noKey = (q: string, u: string) =>
      runSearch(q, { tools, userId: u, apiKey: undefined, fetchImpl, now: () => clock.t })
    const r = ok(await noKey('Sony WH-1000XM5', 'user-b'))
    expect(r.data.fromCache).toBe(true)
    expect(r.data.quota.userRemainingToday).toBe(3)
  })

  it('expires after the configured TTL and refreshes the same cache row', async () => {
    const { run, fetchImpl, tools, clock } = setup()
    ok(await run('Sony WH-1000XM5'))
    clock.t = T0 + 12 * HOUR - 1
    expect(ok(await run('Sony WH-1000XM5')).data.fromCache).toBe(true)
    clock.t = T0 + 12 * HOUR + 1
    const r = ok(await run('Sony WH-1000XM5'))
    expect(r.data.fromCache).toBe(false)
    expect(fetchImpl.calls).toHaveLength(2)
    expect(tools.dump('search_cache')).toHaveLength(1) // updated in place, not duplicated
    expect(r.data.result.cachedAt).toBe(new Date(clock.t).toISOString())
  })

  it('honors a configurable TTL', async () => {
    const { run, fetchImpl, clock } = setup()
    ok(await run('Sony WH-1000XM5', 'user-a', { CACHE_TTL_HOURS: '1' }))
    clock.t = T0 + 2 * HOUR
    ok(await run('Sony WH-1000XM5', 'user-a', { CACHE_TTL_HOURS: '1' }))
    expect(fetchImpl.calls).toHaveLength(2)
  })

  it('keeps different queries separate', async () => {
    const { run, fetchImpl } = setup()
    ok(await run('Sony WH-1000XM5'))
    ok(await run('Samsung 990 PRO 2TB'))
    expect(fetchImpl.calls).toHaveLength(2)
  })
})

describe('rate limits', () => {
  it('allows 3 fresh searches per user per day, then refuses the 4th; cached queries still work', async () => {
    const { run, fetchImpl } = setup()
    expect(ok(await run('query one')).data.quota.userRemainingToday).toBe(2)
    expect(ok(await run('query two')).data.quota.userRemainingToday).toBe(1)
    expect(ok(await run('query three')).data.quota.userRemainingToday).toBe(0)
    const r = bad(await run('query four'))
    expect(r.code).toBe('user_limit_reached')
    expect(r.retryAfterSeconds).toBe(12 * 3600) // T0 is 12:00 UTC
    expect(fetchImpl.calls).toHaveLength(3)
    expect(ok(await run('query one')).data.fromCache).toBe(true) // cache needs no quota
  })

  it("does not let one user's usage affect another user", async () => {
    const { run } = setup()
    for (const q of ['q1', 'q2', 'q3']) ok(await run(q, 'user-a'))
    expect(bad(await run('q4', 'user-a')).code).toBe('user_limit_reached')
    expect(ok(await run('q4', 'user-b')).data.quota.userRemainingToday).toBe(2)
  })

  it('resets on the next UTC day', async () => {
    const { run, clock } = setup()
    for (const q of ['q1', 'q2', 'q3']) ok(await run(q))
    expect(bad(await run('q4')).code).toBe('user_limit_reached')
    clock.t = T0 + 13 * HOUR // next day, 01:00 UTC
    expect(ok(await run('q4')).data.fromCache).toBe(false)
  })

  it('enforces the global daily budget and refunds the user slot it had claimed', async () => {
    const { run, tools, fetchImpl } = setup()
    const cfg = { GLOBAL_DAILY_SEARCH_BUDGET: '2' }
    ok(await run('g1', 'user-a', cfg))
    ok(await run('g2', 'user-b', cfg))
    const r = bad(await run('g3', 'user-c', cfg))
    expect(r.code).toBe('global_budget_reached')
    expect(fetchImpl.calls).toHaveLength(2)
    expect(tools.dump('usage_claims').filter((c) => c.data.userId === 'user-c')).toHaveLength(0)
  })

  it('honors a configurable per-user limit', async () => {
    const { run } = setup()
    const cfg = { USER_DAILY_SEARCH_LIMIT: '1' }
    ok(await run('a1', 'user-a', cfg))
    expect(bad(await run('a2', 'user-a', cfg)).code).toBe('user_limit_reached')
  })

  it('a failed search that was free does not use up the daily allowance', async () => {
    let status = 500
    const { run } = setup({ respond: () => (status === 200 ? json(sonyBody) : json({}, status)) })
    for (let i = 0; i < 5; i++) expect(bad(await run('flaky')).code).toBe('upstream_error')
    status = 200
    expect(ok(await run('flaky')).data.quota.userRemainingToday).toBe(2)
  })
})

describe('duplicate in-flight requests', () => {
  it('two simultaneous identical searches make one upstream call', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { run, fetchImpl } = setup({ respond: async () => { await gate; return json(sonyBody) } })
    const a = run('Sony WH-1000XM5', 'user-a')
    const b = run('Sony WH-1000XM5', 'user-b')
    await new Promise((r) => setTimeout(r, 10))
    release()
    const results = await Promise.all([a, b])
    expect(fetchImpl.calls).toHaveLength(1)
    const failures = results.filter((r) => !r.success) as SearchFailure[]
    expect(failures).toHaveLength(1)
    expect(failures[0].code).toBe('search_in_progress')
    expect(results.filter((r) => r.success)).toHaveLength(1)
  })

  it('an abandoned lock older than the TTL is taken over', async () => {
    const { run, tools, fetchImpl } = setup()
    await tools.create('usage_claims', { claimKey: `lock:${cacheKey('us', 'Sony WH-1000XM5')}`, kind: 'lock', userId: 'x', day: '2026-11-19', createdAtMs: T0 - 10 * 60_000 })
    ok(await run('Sony WH-1000XM5'))
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('a fresh lock is respected', async () => {
    const { run, tools, fetchImpl } = setup()
    await tools.create('usage_claims', { claimKey: `lock:${cacheKey('us', 'Sony WH-1000XM5')}`, kind: 'lock', userId: 'x', day: '2026-11-19', createdAtMs: T0 - 1000 })
    expect(bad(await run('Sony WH-1000XM5')).code).toBe('search_in_progress')
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('releases the lock even when the upstream call fails', async () => {
    const { run, tools } = setup({ respond: () => json({}, 500) })
    await run('Sony WH-1000XM5')
    expect(tools.dump('usage_claims').some((c) => c.data.kind === 'lock')).toBe(false)
  })
})

describe('no secret leakage', () => {
  it('never appears in results, errors, or logs', async () => {
    const logs: string[] = []
    for (const m of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')))
    }
    const outputs: SearchActionResult[] = []
    for (const respond of [
      () => json(sonyBody),
      () => json({ error: KEY }, 500),
      () => json({ error: KEY }, 401),
      () => json({ error: KEY }, 429),
      () => new Response(`bad ${KEY}`, { status: 200 }),
      () => { throw new Error(`boom ${KEY}`) },
    ]) {
      const { run } = setup({ respond })
      outputs.push(await run(`probe ${outputs.length}`))
    }
    expect(JSON.stringify(outputs)).not.toContain(KEY)
    expect(logs.join('\n')).not.toContain(KEY)
  })
})

describe('normalization of missing / uncertain data', () => {
  it('keeps unknowns explicit instead of guessing', () => {
    const o = normalizeOffer({ seller: 'Shop', price: 0, currency: 'dollars', url: 'javascript:alert(1)', seller_url: 'ftp://x', stock_status: 'See merchant for availability' })!
    expect(o).toMatchObject({ seller: 'Shop', price: null, currency: null, listingUrl: null, sellerUrl: null, availability: 'unknown', deliveryInfo: null, title: null, condition: 'unknown', observedAt: null })
    expect(o.stockText).toBe('See merchant for availability')
  })

  it('never turns missing condition into "new", even when the candidate says nothing', () => {
    const n = normalizeSearchResponse({ success: true, data: { products: [{ title: 'T', offers: [{ seller: 'A', price: 5, currency: 'USD', url: 'https://a.example/x' }] }] }, meta: {} })!
    expect(n.candidates[0].conditionLabel).toBeNull()
    expect(n.candidates[0].offers[0].condition).toBe('unknown')
    expect(n.source.scrapedAt).toBeNull() // absent stays null; no invented timestamp
  })

  it('preserves backorder / out-of-stock and the API candidate condition label', () => {
    const n = normalizeSearchResponse(samsungBody)!
    expect(n.candidates.length).toBeGreaterThan(0)
    expect(n.candidates[0].conditionLabel).toBe('Pre-owned')
    expect(normalizeOffer({ stock_status: 'Out of stock' })!.availability).toBe('out_of_stock')
    expect(normalizeOffer({ stock_status: 'Backordered' })!.availability).toBe('backorder')
  })

  it('does not treat headline price as an offer price', () => {
    const n = normalizeSearchResponse(sonyBody)!
    expect(n.candidates[0].headlinePrice).toBe(147.26)
    expect(n.candidates[0].offers.every((o) => o.price !== null)).toBe(true)
  })

  it('truncates oversized strings and caps candidate/offer counts', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ seller: 'S' + i, price: 1, currency: 'USD', product_title: 'x'.repeat(5000), url: 'https://a.example/' + i }))
    const n = normalizeSearchResponse({ success: true, data: { products: Array.from({ length: 9 }, () => ({ title: 'y'.repeat(5000), offers: many })) }, meta: {} })!
    expect(n.candidates).toHaveLength(3)
    expect(n.candidates[0].offers).toHaveLength(60)
    expect(n.candidates[0].title!.length).toBe(300)
    expect(n.candidates[0].offers[0].title!.length).toBe(300)
  })

  it('rejects bodies without the documented shape', () => {
    expect(normalizeSearchResponse(null)).toBeNull()
    expect(normalizeSearchResponse({ success: false })).toBeNull()
    expect(normalizeSearchResponse({ success: true, data: {} })).toBeNull()
  })
})

describe('general search: query canonicalization, cache and quota', () => {
  const lookalikes = ['Sony WH-1000XM5', 'sony wh1000xm5', 'SONY  WH_1000XM5', ' Sony WH–1000XM5 ', 'sony wh-1000xm5!']

  it('trivial variations of the same text share one cache entry and one paid search', async () => {
    const { run, fetchImpl, tools } = setup()
    for (const q of lookalikes) ok(await run(q))
    expect(fetchImpl.calls).toHaveLength(1)
    expect(tools.dump('search_cache')).toHaveLength(1)
    expect(tools.dump('usage_claims').filter((r) => r.data.kind === 'user')).toHaveLength(1)
  })
  it('never merges materially different products: spacing and decimals inside a name matter', () => {
    const k = (q: string) => cacheKey('us', q)
    expect(k('Samsung Galaxy A5 5G')).not.toBe(k('Samsung Galaxy A55G'))
    expect(k('Dell 27.5 inch monitor')).not.toBe(k('Dell 275 inch monitor'))
    expect(k('Lens 12-24mm')).not.toBe(k('Lens 1224mm'))
    expect(k('Sony WH 1000 XM5')).not.toBe(k('Sony WH-1000XM5')) // a spelling variant costs one extra search, never a wrong merge
    expect(k('AirPods Pro 2')).not.toBe(k('AirPods Pro 22'))
  })
  it('different words stay different products, even when the letters are similar', () => {
    expect(cacheKey('us', 'Dyson V15 Detect')).not.toBe(cacheKey('us', 'Dyson V15 Detect Absolute'))
    expect(cacheKey('us', 'WD Black SN850X')).not.toBe(cacheKey('us', 'WD Black SN850'))
    expect(cacheKey('us', 'Sony WH-1000XM5')).not.toBe(cacheKey('uk', 'Sony WH-1000XM5'))
  })
  it('still serves an entry written under the previous cache key (saved products keep working)', async () => {
    const { run, fetchImpl, tools } = setup()
    await tools.create('search_cache', {
      key: 'us|sony wh-1000xm5', market: 'us', query: 'Sony WH-1000XM5',
      payload: { candidates: normalizeSearchResponse(sonyBody)!.candidates, source: normalizeSearchResponse(sonyBody)!.source },
      cachedAtMs: T0 - HOUR, expiresAtMs: T0 + 11 * HOUR,
    })
    const r = ok(await run('Sony WH-1000XM5'))
    expect(r.data.fromCache).toBe(true)
    expect(fetchImpl.calls).toHaveLength(0)
  })
  it('rejects text with no letters or digits and non-product input, without any upstream call or claim', async () => {
    const { run, fetchImpl, tools } = setup()
    for (const q of ['!!!', '---', '＋＋', '…']) expect(bad(await run(q)).code).toBe('invalid_query')
    expect(validateQuery('x'.repeat(100))).toMatchObject({ ok: true })
    expect(fetchImpl.calls).toHaveLength(0)
    expect(tools.dump('usage_claims')).toHaveLength(0)
  })
  it('accepts arbitrary product names, including accents, digits and symbols inside a name', () => {
    for (const q of ['Bose QuietComfort Ultra', 'Nintendo Switch 2', 'Café Barista 3000', 'AT&T iPhone 15', 'LG 27" 4K Monitor']) {
      expect(validateQuery(q)).toMatchObject({ ok: true })
    }
  })
  it('each user has their own daily limit; a cached result costs nothing', async () => {
    const { run, fetchImpl } = setup()
    ok(await run('Sony WH-1000XM5', 'user-a'))
    const b = ok(await run('Sony WH-1000XM5', 'user-b'))
    expect(b.data.fromCache).toBe(true)
    expect(b.data.quota.userRemainingToday).toBe(3)
    expect(fetchImpl.calls).toHaveLength(1)
  })
})
