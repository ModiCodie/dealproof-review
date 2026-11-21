/**
 * Browser tests for saved products, against the local dev server and its REAL
 * record storage (a local Durable Object with SQLite), signed in as two real
 * DeepSpace test accounts.
 *
 * What is real: authentication, the `saved_products` collection, its
 * permissions, uniqueness rule, owner stamping, and the `getSavedComparison`
 * server action when it is not mocked.
 * What is mocked: only the PRICE data. The dev server's .dev.vars holds a live
 * PricesAPI key, so `searchProducts` is always intercepted in the browser and
 * answered from saved fixtures; a test fails if any request reaches PricesAPI.
 * `getSavedComparison` is mocked only where a test needs stored price data
 * (the real dev cache is empty); the "no stored data" and ownership tests call
 * the real action.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

test.skip(loadAllTestAccounts().length < 2, 'Needs two test accounts: npx deepspace test accounts create --email <name>@deepspace.test --password-stdin')
test.describe.configure({ mode: 'serial' })

const SHOTS = 'docs/screenshots'
fs.mkdirSync(SHOTS, { recursive: true })
const fixture = (n: string) => JSON.parse(fs.readFileSync(`tests/fixtures/real-${n}.normalized.json`, 'utf8'))
const SONY = fixture('sony')
const SAMSUNG = fixture('samsung')
const SSD = JSON.parse(fs.readFileSync('tests/fixtures/synthetic/ssd.json', 'utf8')) // INVENTED listings (see tests/fixtures/synthetic)

type Fx = { candidates: unknown[]; source: unknown }
const ok = (data: unknown) => ({ success: true, data })

function searchBody(fx: Fx, query: string, cachedAt = new Date(), fromCache = false) {
  return ok({
    result: { query, market: 'us', candidates: fx.candidates, source: fx.source, cachedAt: cachedAt.toISOString(), expiresAt: new Date(cachedAt.getTime() + 12 * 3_600_000).toISOString() },
    fromCache,
    quota: { userDailyLimit: 3, userRemainingToday: 3 },
  })
}

/** Counts + guards. Nothing may reach PricesAPI; searchProducts is always answered locally. */
function net(page: Page) {
  const s = { pricesapi: [] as string[], searchCalls: 0, savedCalls: 0 }
  page.on('request', (r) => {
    if (/pricesapi\.io/i.test(r.url())) s.pricesapi.push(r.url())
    if (r.url().includes('/api/actions/searchProducts')) s.searchCalls++
    if (r.url().includes('/api/actions/getSavedComparison')) s.savedCalls++
  })
  return s
}
async function mockSearch(page: Page, fx: Fx, query: string, opts: { cachedAt?: Date; fromCache?: boolean } = {}) {
  await page.route('**/api/actions/searchProducts', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(searchBody(fx, query, opts.cachedAt, opts.fromCache)) }),
  )
}
async function mockSaved(page: Page, fx: Fx, query: string, o: { stale: boolean; cachedAt: Date; none?: boolean }) {
  await page.route('**/api/actions/getSavedComparison', async (r) => {
    const { savedId } = r.request().postDataJSON()
    const result = o.none ? null : (searchBody(fx, query, o.cachedAt).data as { result: unknown }).result
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(ok({ saved: { recordId: savedId, query, family: '', variant: {} }, result, stale: o.stale, quota: { userDailyLimit: 3, userRemainingToday: 2 } })) })
  })
}

/** Keep every record WebSocket reachable from page.evaluate (for forged-write tests). */
async function hookSockets(page: Page) {
  await page.addInitScript(() => {
    const W = window.WebSocket
    ;(window as unknown as { __ws: WebSocket[] }).__ws = []
    window.WebSocket = class extends W {
      constructor(...a: ConstructorParameters<typeof WebSocket>) {
        super(...a)
        ;(window as unknown as { __ws: WebSocket[] }).__ws.push(this)
      }
    }
  })
}
type Ack = { success?: boolean; error?: string; recordId?: string; timeout?: boolean }
/** Send a raw record-protocol frame on the page's own authenticated socket and wait for its ack. */
function forge(page: Page, type: string, payload: Record<string, unknown>): Promise<Ack> {
  return page.evaluate(
    async ({ type, payload }) => {
      const ws = (window as unknown as { __ws: WebSocket[] }).__ws.filter((w) => /\/ws\/app:/.test(w.url) && w.readyState === 1).at(-1)
      if (!ws) return { timeout: true, error: 'no socket' }
      const requestId = 'forge-' + Math.random().toString(36).slice(2)
      return await new Promise<Ack>((resolve) => {
        const t = setTimeout(() => resolve({ timeout: true }), 8000)
        const h = (ev: MessageEvent) => {
          try {
            const m = JSON.parse(String(ev.data))
            if (m.type === 'records.ack' && m.payload?.requestId === requestId) {
              clearTimeout(t)
              ws.removeEventListener('message', h)
              resolve(m.payload)
            }
          } catch { /* not json */ }
        }
        ws.addEventListener('message', h)
        ws.send(JSON.stringify({ type, payload: { ...payload, requestId } }))
      })
    },
    { type, payload },
  )
}
/** Subscribe to the whole collection with a forged query and return what the server sends back. */
function forgeSubscribe(page: Page, query: Record<string, unknown>): Promise<{ recordId: string; data: Record<string, unknown> }[] | null> {
  return page.evaluate(
    async (query) => {
      const ws = (window as unknown as { __ws: WebSocket[] }).__ws.filter((w) => /\/ws\/app:/.test(w.url) && w.readyState === 1).at(-1)
      if (!ws) return null
      const subscriptionId = 'forge-sub-' + Math.random().toString(36).slice(2)
      return await new Promise<{ recordId: string; data: Record<string, unknown> }[] | null>((resolve) => {
        const t = setTimeout(() => resolve(null), 8000)
        const h = (ev: MessageEvent) => {
          try {
            const m = JSON.parse(String(ev.data))
            if (m.type === 'core.query_result' && m.payload?.subscriptionId === subscriptionId) {
              clearTimeout(t)
              ws.removeEventListener('message', h)
              resolve(m.payload.records)
            }
          } catch { /* not json */ }
        }
        ws.addEventListener('message', h)
        ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId, query } }))
      })
    },
    query,
  )
}

/** Call a server action exactly as the app does: session cookie -> bearer token -> POST /api/actions/<name>. */
function actionAs(page: Page, name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ name, params }) => {
      const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      const { token } = (await t.json()) as { token: string }
      const r = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return (await r.json()) as Record<string, unknown>
    },
    { name, params },
  )
}

async function savedNames(page: Page): Promise<string[]> {
  await page.goto('/saved')
  await expect(page.getByTestId('saved-list').or(page.getByTestId('saved-empty'))).toBeVisible({ timeout: 20_000 })
  return page.getByTestId('saved-name').allTextContents()
}
/** Test hygiene: remove this test account's own saved rows through the real UI. */
async function clearOwn(page: Page) {
  await page.goto('/saved')
  await expect(page.getByTestId('saved-list').or(page.getByTestId('saved-empty'))).toBeVisible({ timeout: 20_000 })
  for (let i = 0; i < 20 && (await page.getByTestId('saved-item').count()) > 0; i++) {
    if ((await page.getByTestId('saved-remove').count()) > 0) {
      await page.getByTestId('saved-remove').first().click()
      await page.getByTestId('saved-remove-confirm').click()
    } else {
      await page.getByTestId('saved-remove-invalid').first().click() // an unrecognised row (e.g. forged) has a one-step remove
    }
    await page.waitForTimeout(250)
  }
  await expect(page.getByTestId('saved-empty')).toBeVisible()
}
const PRODUCT_FOR_QUERY: Record<string, string> = { 'Sony WH-1000XM5': 'sony', 'Logitech MX Master 3S': 'logitech', 'Samsung 990 PRO 2TB': 'samsung' }
/**
 * Choose the product in the picker, then press "Check live prices". `searchProducts` is mocked by the caller and
 * answers with `query` (which can carry a unique suffix to dodge the real cache); the page itself always sends the
 * product's fixed query, so the product is found by prefix.
 */
async function searchAndCompare(page: Page, query: string) {
  const key = Object.entries(PRODUCT_FOR_QUERY).find(([q]) => query.startsWith(q))?.[1]
  if (!key) throw new Error(`no supported product for query: ${query}`)
  await page.goto('/search')
  await page.getByTestId(`product-${key}`).click()
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
}
const SAME_ROW = { productKey: 'sony-wh-1000xm5', family: 'sony-wh-1000xm5', variant: {}, displayName: 'Sony WH-1000XM5 headphones', query: 'Sony WH-1000XM5', market: 'us' }
const flatScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

test.describe('saved products (real record storage, mocked prices)', () => {
  test('1. save a product from a search; it appears on the Saved page with its variant and time', async ({ users }) => {
    const [a] = await users(1)
    const n = net(a.page)
    await clearOwn(a.page)
    await mockSearch(a.page, SONY, 'Sony WH-1000XM5')
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await expect(a.page.getByTestId('save-button')).toBeEnabled()
    await a.page.screenshot({ path: `${SHOTS}/20-search-with-save-desktop.png` })
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toHaveText(/Saved/)
    await expect(a.page.getByTestId('save-message')).toContainText('does not monitor prices')

    expect(await savedNames(a.page)).toEqual(['Sony WH-1000XM5 headphones'])
    await expect(a.page.getByTestId('saved-item')).toContainText('Saved ')
    await expect(a.page.getByTestId('saved-item')).toContainText('Sony WH-1000XM5')
    await a.page.screenshot({ path: `${SHOTS}/21-saved-list-desktop.png` })
    expect(n.pricesapi).toEqual([])
    await clearOwn(a.page)
  })

  test('2. the exact selected variant is saved; different variants are different saved products', async ({ users }) => {
    const [a] = await users(1)
    await clearOwn(a.page)
    await mockSearch(a.page, SAMSUNG, 'Samsung 990 PRO 2TB')
    await searchAndCompare(a.page, 'Samsung 990 PRO 2TB')
    await a.page.getByTestId('save-button').click() // 2TB without heatsink (the search default)
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await a.page.getByTestId('variant-capacity-4TB').click()
    await a.page.getByTestId('variant-heatsink-with').click()
    // the save control follows the variant now on screen: this one is not saved yet
    await expect(a.page.getByTestId('save-button')).toBeVisible()
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    const names = await savedNames(a.page)
    expect(names.sort()).toEqual(['Samsung 990 PRO SSD · 2TB · Without heatsink', 'Samsung 990 PRO SSD · 4TB · With heatsink'])

    // reopening the 4TB/heatsink one shows exactly that variant, fixed
    await mockSaved(a.page, SAMSUNG, 'Samsung 990 PRO 2TB', { stale: false, cachedAt: new Date() })
    await a.page.getByTestId('saved-item').filter({ hasText: '4TB' }).getByTestId('saved-open').click()
    await expect(a.page.getByTestId('target-label')).toHaveText('Samsung 990 PRO SSD · 4TB · With heatsink')
    await expect(a.page.getByTestId('variant-capacity')).toHaveCount(0)
    await clearOwn(a.page)
  })

  test('3. duplicate saves are prevented (UI and the database rule)', async ({ users }) => {
    const [a] = await users(1)
    await hookSockets(a.page)
    await clearOwn(a.page)
    await mockSearch(a.page, SONY, 'Sony WH-1000XM5')
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await expect(a.page.getByTestId('save-button')).toHaveCount(0) // cannot click save twice

    // a forged second create with the same product key is refused by the Durable Object itself
    const dup = await forge(a.page, 'core.put', {
      collection: 'saved_products',
      recordId: 'forged-dup-' + Date.now(),
      data: { productKey: 'sony-wh-1000xm5', family: 'sony-wh-1000xm5', variant: {}, displayName: 'dup', query: 'Sony WH-1000XM5', market: 'us' },
    })
    expect(dup.success).toBe(false)
    expect(dup.error).toMatch(/Duplicate|already exists/i)
    expect(await savedNames(a.page)).toHaveLength(1)
    await clearOwn(a.page)
  })

  test('4. reopen a saved product: stored comparison, observation vs cache time, no paid request', async ({ users }) => {
    const [a] = await users(1)
    const n = net(a.page)
    await clearOwn(a.page)
    await mockSearch(a.page, SONY, 'Sony WH-1000XM5')
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    const searchesBefore = n.searchCalls
    await a.page.unroute('**/api/actions/searchProducts')
    await a.page.route('**/api/actions/searchProducts', (r) => r.abort()) // any search from here on would be a failure
    await mockSaved(a.page, SONY, 'Sony WH-1000XM5', { stale: false, cachedAt: new Date(Date.now() - 2 * 3_600_000) })

    await savedNames(a.page)
    await a.page.getByTestId('saved-open').click()
    await expect(a.page.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
    await expect(a.page.getByTestId('saved-title')).toHaveText('Sony WH-1000XM5 headphones')
    await expect(a.page.getByTestId('not-monitoring')).toContainText('not monitoring')
    await expect(a.page.getByTestId('observed-at')).toContainText('2026') // source scrape time from the fixture
    await expect(a.page.getByTestId('cached-at')).toContainText('2 hours ago')
    await expect(a.page.getByTestId('stale-banner')).toHaveCount(0)
    await expect(a.page.getByTestId('refresh-hint')).toContainText('without using a search')
    await expect(a.page.getByTestId('cheapest')).toContainText('Lowest reported matching offer')
    await a.page.screenshot({ path: `${SHOTS}/22-saved-detail-fresh-desktop.png`, fullPage: false })

    expect(n.searchCalls).toBe(searchesBefore) // opening never ran a search
    expect(n.savedCalls).toBeGreaterThan(0)
    expect(n.pricesapi).toEqual([])
    await a.page.unroute('**/api/actions/searchProducts')
    await clearOwn(a.page)
  })

  test('5. stale data is labelled and refreshed only on an explicit click', async ({ users }) => {
    const [a] = await users(1)
    const n = net(a.page)
    await clearOwn(a.page)
    await mockSearch(a.page, SONY, 'Sony WH-1000XM5')
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await mockSaved(a.page, SONY, 'Sony WH-1000XM5', { stale: true, cachedAt: new Date(Date.now() - 30 * 3_600_000) })

    await savedNames(a.page)
    const before = n.searchCalls
    await a.page.getByTestId('saved-open').click()
    await expect(a.page.getByTestId('stale-banner')).toContainText('out of date')
    await expect(a.page.getByTestId('cached-at')).toContainText('30 hours ago')
    await expect(a.page.getByTestId('refresh-hint')).toContainText('uses one of your fresh searches')
    await expect(a.page.getByTestId('refresh-button')).toHaveText('Get fresh prices')
    await a.page.screenshot({ path: `${SHOTS}/23-saved-detail-stale-desktop.png` })
    await a.page.waitForTimeout(1500)
    expect(n.searchCalls).toBe(before) // still nothing automatic

    await a.page.getByTestId('refresh-button').click()
    await expect(a.page.getByTestId('refresh-note')).toBeVisible()
    expect(n.searchCalls).toBe(before + 1) // exactly one, by explicit click (answered by the mock)
    await expect(a.page.getByTestId('stale-banner')).toHaveCount(0)
    expect(n.pricesapi).toEqual([])
    await clearOwn(a.page)
  })

  test('6. no stored data (real server action, real storage): explained, nothing fetched automatically', async ({ users }) => {
    const [a] = await users(1)
    const n = net(a.page)
    await clearOwn(a.page)
    // a query nobody has ever searched on this dev server, so the real cache has nothing for it
    const q = `Sony WH-1000XM5 e2e-nocache-${Date.now()}`
    await mockSearch(a.page, SONY, q)
    await searchAndCompare(a.page, q)
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await a.page.unroute('**/api/actions/searchProducts')
    await a.page.route('**/api/actions/searchProducts', (r) => r.abort())
    const before = n.searchCalls

    await savedNames(a.page)
    await a.page.getByTestId('saved-open').click()
    await expect(a.page.getByTestId('missing-banner')).toContainText('no stored prices')
    await expect(a.page.getByTestId('refresh-button')).toHaveText('Get fresh prices')
    await expect(a.page.getByTestId('comparison')).toHaveCount(0)
    await a.page.screenshot({ path: `${SHOTS}/24-saved-detail-missing-desktop.png` })
    await a.page.waitForTimeout(1000)
    expect(n.searchCalls).toBe(before)
    expect(n.savedCalls).toBeGreaterThan(0) // the REAL action ran (not mocked)
    expect(n.pricesapi).toEqual([])
    await a.page.unroute('**/api/actions/searchProducts')
    await clearOwn(a.page)
  })

  test('7. remove a saved product (list and detail page)', async ({ users }) => {
    const [a] = await users(1)
    await clearOwn(a.page)
    await mockSearch(a.page, SONY, 'Sony WH-1000XM5')
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    // from the search page's own control
    await a.page.getByTestId('unsave-button').click()
    await expect(a.page.getByTestId('save-button')).toBeVisible()
    expect(await savedNames(a.page)).toEqual([])

    // from the list, with a confirm step
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await savedNames(a.page)
    await a.page.getByTestId('saved-remove').click()
    await a.page.getByRole('button', { name: 'Cancel' }).click()
    await expect(a.page.getByTestId('saved-item')).toHaveCount(1) // cancel keeps it
    await a.page.getByTestId('saved-remove').click()
    await a.page.getByTestId('saved-remove-confirm').click()
    await expect(a.page.getByTestId('saved-empty')).toBeVisible()

    // from the detail page; it then goes back to the list
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await mockSaved(a.page, SONY, 'Sony WH-1000XM5', { stale: false, cachedAt: new Date() })
    await savedNames(a.page)
    await a.page.getByTestId('saved-open').click()
    await a.page.getByTestId('saved-remove').click()
    await a.page.getByTestId('saved-remove-confirm').click()
    await expect(a.page.getByTestId('saved-empty')).toBeVisible({ timeout: 10_000 })
    await a.page.reload()
    await expect(a.page.getByTestId('saved-empty')).toBeVisible({ timeout: 20_000 }) // really gone, not just hidden
  })

  test('8. saved data survives a page refresh and a fresh sign-in', async ({ users }) => {
    const [a] = await users(1)
    await clearOwn(a.page)
    await mockSearch(a.page, SONY, 'Sony WH-1000XM5')
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await savedNames(a.page)
    await a.page.reload()
    await expect(a.page.getByTestId('saved-name')).toHaveText('Sony WH-1000XM5 headphones', { timeout: 20_000 })

    // a brand-new browser context that signs in again (not the cached session)
    const [again] = await users(1, { force: true })
    expect(await savedNames(again.page)).toEqual(['Sony WH-1000XM5 headphones'])
    await clearOwn(again.page)
  })

  test('9. a likely match keeps its uncertainty label when saved and reopened', async ({ users }) => {
    const [a] = await users(1)
    await clearOwn(a.page)
    await mockSearch(a.page, SAMSUNG, 'Samsung 990 PRO 2TB')
    await searchAndCompare(a.page, 'Samsung 990 PRO 2TB')
    const live = a.page.getByTestId('cheapest')
    await expect(live.getByTestId('cheapest-match')).toContainText('Likely the same, some details missing')
    await expect(live.getByTestId('cheapest-match')).toContainText('Not confirmed as the exact variant')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()

    await mockSaved(a.page, SAMSUNG, 'Samsung 990 PRO 2TB', { stale: false, cachedAt: new Date() })
    await savedNames(a.page)
    await a.page.getByTestId('saved-open').click()
    const reopened = a.page.getByTestId('cheapest')
    await expect(reopened).toBeVisible({ timeout: 20_000 })
    await expect(reopened.getByTestId('cheapest-match')).toContainText('Likely the same, some details missing')
    await expect(reopened.getByTestId('cheapest-match')).toContainText('Not confirmed as the exact variant')
    await expect(reopened).not.toContainText('Title names the same model and variant')
    await clearOwn(a.page)
  })

  test('10. mobile layout (390px): search, saved list and saved detail have no horizontal scroll', async ({ users }) => {
    const [a] = await users(1)
    await clearOwn(a.page)
    await a.page.setViewportSize({ width: 390, height: 844 })
    await mockSearch(a.page, SAMSUNG, 'Samsung 990 PRO 2TB')
    await searchAndCompare(a.page, 'Samsung 990 PRO 2TB')
    await expect(a.page.getByTestId('save-button')).toBeVisible()
    expect(await flatScroll(a.page)).toBe(true)
    await a.page.screenshot({ path: `${SHOTS}/25-search-mobile.png` })
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await savedNames(a.page)
    expect(await flatScroll(a.page)).toBe(true)
    await a.page.screenshot({ path: `${SHOTS}/26-saved-list-mobile.png` })
    await mockSaved(a.page, SAMSUNG, 'Samsung 990 PRO 2TB', { stale: true, cachedAt: new Date(Date.now() - 30 * 3_600_000) })
    await a.page.getByTestId('saved-open').click()
    await expect(a.page.getByTestId('stale-banner')).toBeVisible({ timeout: 20_000 })
    expect(await flatScroll(a.page)).toBe(true)
    await a.page.screenshot({ path: `${SHOTS}/27-saved-detail-mobile.png` })
    await clearOwn(a.page)
  })

  test('11. keyboard: save and remove are reachable and operable without a mouse', async ({ users }) => {
    const [a] = await users(1)
    await clearOwn(a.page)
    await mockSearch(a.page, SONY, 'Sony WH-1000XM5')
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await expect(a.page.getByTestId('save-button')).toBeEnabled() // disabled until the saved list has loaded; a disabled button cannot take focus
    await a.page.getByTestId('save-button').focus()
    await expect(a.page.getByTestId('save-button')).toBeFocused()
    await a.page.keyboard.press('Enter')
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await a.page.getByTestId('unsave-button').focus()
    await expect(a.page.getByTestId('unsave-button')).toBeFocused()
    await a.page.keyboard.press('Space')
    await expect(a.page.getByTestId('save-button')).toBeVisible()
  })
})

test.describe('two accounts: ownership is enforced by the server', () => {
  test('12. user B cannot read, change, delete or probe user A\'s saved products; forged owner ids are overwritten', async ({ users }) => {
    const [a, b] = await users(2)
    const na = net(a.page)
    const nb = net(b.page)
    await hookSockets(a.page)
    await hookSockets(b.page)
    await clearOwn(a.page)
    await clearOwn(b.page)

    // A saves a product
    await mockSearch(a.page, SONY, 'Sony WH-1000XM5')
    await searchAndCompare(a.page, 'Sony WH-1000XM5')
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    await savedNames(a.page)
    const href = await a.page.getByTestId('saved-open').getAttribute('href')
    const aId = href!.split('/').pop()!
    expect(aId.length).toBeGreaterThan(5)

    // READ: B's own list is empty, and B's detail URL for A's id says "not found"
    expect(await savedNames(b.page)).toEqual([])
    await b.page.goto(`/saved/${aId}`)
    await expect(b.page.getByTestId('saved-not-found')).toBeVisible({ timeout: 20_000 })
    expect(nb.savedCalls).toBe(0) // the page never even asked the server for it

    // READ (forged): B subscribes to the whole collection, and by A's record id; the server returns nothing of A's
    await savedNames(b.page) // the record socket connects once a page subscribes to a collection
    const all = await forgeSubscribe(b.page, { collection: 'saved_products' })
    expect(all).not.toBeNull()
    expect(all!.some((r) => r.recordId === aId)).toBe(false)
    const byId = await forgeSubscribe(b.page, { collection: 'saved_products', where: { recordId: aId } })
    expect(byId ?? []).toEqual([])
    const byOwner = await forgeSubscribe(b.page, { collection: 'saved_products', where: { userId: a.userId } })
    expect(byOwner ?? []).toEqual([])

    // MODIFY (forged): B overwrites A's row
    const upd = await forge(b.page, 'core.put', {
      collection: 'saved_products',
      recordId: aId,
      data: SAME_ROW, // note: the DO answers 'Cannot modify immutable field' first; update:false (schema test) is the second wall
    })
    expect(upd.success).toBe(false)

    // DELETE (forged): B deletes A's row
    const del = await forge(b.page, 'core.delete', { collection: 'saved_products', recordId: aId })
    expect(del.success).toBe(false)
    expect(del.error).toMatch(/DELETE DENIED/) // a genuine ownership refusal ('own' rule), not a side effect
    console.log('[isolation] B forged update ->', JSON.stringify(upd), '| B forged delete ->', JSON.stringify(del))

    // SERVER ACTION (real, unmocked): B asks for A's saved comparison with B's own valid token.
    // The answer must be identical to asking for an id that does not exist at all (no probing).
    const asA = await actionAs(a.page, 'getSavedComparison', { savedId: aId })
    expect(asA.success).toBe(true) // the owner is served (no stored prices yet: result is null, no paid call)
    const asB = await actionAs(b.page, 'getSavedComparison', { savedId: aId })
    const asBMissing = await actionAs(b.page, 'getSavedComparison', { savedId: 'no-such-record-id' })
    expect(asB).toEqual({ success: false, code: 'not_found', error: 'Saved product not found.' })
    expect(asB).toEqual(asBMissing)
    expect(JSON.stringify(asB)).not.toMatch(/Sony|query/)
    // a client-supplied owner id is not a thing the action reads
    const forgedOwner = await actionAs(b.page, 'getSavedComparison', { savedId: aId, userId: a.userId, owner: a.userId })
    expect(forgedOwner).toEqual(asB)

    // FORGED OWNER ON CREATE: B writes a row claiming to belong to A; the server stamps B's id instead
    const own = await forge(b.page, 'core.put', {
      collection: 'saved_products',
      recordId: 'forged-owner-' + Date.now(),
      data: { userId: a.userId, productKey: 'sony-wh-1000xm5', family: 'sony-wh-1000xm5', variant: {}, displayName: 'Sony WH-1000XM5 headphones', query: 'Sony WH-1000XM5', market: 'us' },
    })
    expect(own.success).toBe(true)
    const bRows = await forgeSubscribe(b.page, { collection: 'saved_products' })
    expect(bRows).toHaveLength(1)
    expect(bRows![0].data.userId).toBe(b.userId)
    expect(bRows![0].data.userId).not.toBe(a.userId)
    // ...so A still has exactly one row (A's), and B's forged row never showed up for A
    expect(await savedNames(a.page)).toEqual(['Sony WH-1000XM5 headphones'])

    // the owner cannot edit a row either (rows are create / delete only)
    await savedNames(a.page)
    const aUpdate = await forge(a.page, 'core.put', {
      collection: 'saved_products',
      recordId: aId,
      data: SAME_ROW,
    })
    expect(aUpdate.success).toBe(false)
    console.log('[isolation] A own-row update ->', JSON.stringify(aUpdate))

    // A's data is untouched and still readable by A
    expect(await savedNames(a.page)).toEqual(['Sony WH-1000XM5 headphones'])
    expect(na.pricesapi).toEqual([])
    expect(nb.pricesapi).toEqual([])
    await clearOwn(a.page)
    await clearOwn(b.page)
  })

  test('13. a general (non-featured) product: pick, save, reopen with its exact variant, remove; user B never sees it', async ({ users }) => {
    const [a, b] = await users(2)
    const n = net(a.page)
    await clearOwn(a.page)
    await clearOwn(b.page)
    await mockSearch(a.page, SSD, 'WD Black SN850X 2TB')
    await a.page.goto('/search')
    await a.page.getByTestId('product-search-input').fill('WD Black SN850X 2TB')
    await a.page.getByTestId('product-search-input').press('Enter')
    await expect(a.page.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
    await expect(a.page.getByTestId('variant-storage-2TB')).toBeVisible()
    await expect(a.page.getByTestId('save-button')).toBeEnabled()
    await a.page.getByTestId('save-button').click()
    await expect(a.page.getByTestId('save-state')).toBeVisible()
    // the real server action ran (searches are mocked, so its cache is empty): the save stands and says the prices were not stored
    await expect(a.page.getByTestId('save-message')).toContainText('could not be stored')

    expect(await savedNames(a.page)).toHaveLength(1)
    await expect(a.page.getByTestId('saved-name')).toContainText('SN850X')
    const id = (await a.page.getByTestId('saved-open').getAttribute('href'))!.split('/').pop()!

    await mockSaved(a.page, SSD, 'WD Black SN850X 2TB', { stale: false, cachedAt: new Date() })
    await a.page.getByTestId('saved-open').click()
    await expect(a.page.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
    await expect(a.page.getByTestId('target-label')).toContainText('SN850X')
    await expect(a.page.getByTestId('variant-storage')).toHaveCount(0) // an exact saved variant is not switchable
    expect(n.pricesapi).toEqual([])

    expect(await savedNames(b.page)).toEqual([])
    await b.page.goto(`/saved/${id}`)
    await expect(b.page.getByTestId('saved-not-found')).toBeVisible({ timeout: 20_000 })

    await clearOwn(a.page)
    await expect(a.page.getByTestId('saved-empty')).toBeVisible()
  })

  test('14. a saved general comparison keeps its product group and its last captured prices through refreshes', async ({ users }) => {
    const [a] = await users(1)
    const p = a.page
    const n = net(p)
    const Q = 'WD Black SN850X'
    const [g2tb, g1tb] = SSD.candidates
    const snapFor = (g: { pid: number; catalogId: string | null; clusterId: string | null; title: string; offers: { price: number }[] }, capturedAt: Date, bump = 0) => ({
      capturedAt: capturedAt.toISOString(),
      source: { ...SSD.source, scrapedAt: capturedAt.toISOString() },
      candidate: { pid: String(g.pid), catalogId: g.catalogId, clusterId: g.clusterId, title: g.title },
      offers: g.offers.map((o) => ({ ...o, price: o.price + bump })),
      truncated: false,
    })
    // a scripted stand-in for the server's snapshot store (its real logic is covered in src/server/saved/snapshot.test.ts)
    let snap: ReturnType<typeof snapFor> | null = null
    let captureAnswer: () => unknown = () => ({ success: true, data: { captured: true, snapshot: snap } })
    await p.route('**/api/actions/captureSavedSnapshot', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(captureAnswer()) }))
    await p.route('**/api/actions/discardSavedSnapshot', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { discarded: true } }) }))
    await clearOwn(p)

    // 1. pick the 1TB group and save: the prices are captured with it
    await mockSearch(p, SSD, Q)
    await p.goto('/search')
    await p.getByTestId('product-search-input').fill(Q)
    await p.getByTestId('product-search-input').press('Enter')
    await expect(p.getByTestId('candidate-picker')).toBeVisible({ timeout: 20_000 })
    await p.getByTestId('candidate-1').click()
    await expect(p.getByTestId('comparison')).toBeVisible()
    await expect(p.getByTestId('save-button')).toBeEnabled()
    snap = snapFor(g1tb, new Date(Date.now() - 3 * 3_600_000))
    await p.getByTestId('save-button').click()
    await expect(p.getByTestId('save-message')).toContainText('Saved with these prices')

    const reopen = async (opts: { snapshot: typeof snap; candidates?: unknown[] }) => {
      await p.unroute('**/api/actions/getSavedComparison').catch(() => {})
      await p.route('**/api/actions/getSavedComparison', (r) => {
        const { savedId } = r.request().postDataJSON()
        const result = opts.candidates ? (searchBody({ ...SSD, candidates: opts.candidates }, Q, new Date()).data as { result: unknown }).result : null
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify(ok({ saved: { recordId: savedId, query: Q, family: '', variant: {} }, snapshot: opts.snapshot, result, stale: false, quota: { userDailyLimit: 3, userRemainingToday: 2 } })) })
      })
      await p.goto('/saved')
      await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
      await p.getByTestId('saved-open').first().click()
    }

    // 2. reopen with the shared cache GONE: the saved group and prices still show, labelled as the last saved prices, no search
    await reopen({ snapshot: snap })
    await expect(p.getByTestId('snapshot-status')).toContainText('Last saved prices', { timeout: 20_000 })
    await expect(p.getByTestId('saved-candidate')).toContainText('1TB')
    await expect(p.getByTestId('comparison')).toBeVisible()
    await expect(p.getByTestId('comparison')).not.toContainText('WDS200T2X0E')
    await expect(p.getByTestId('cached-at')).toBeVisible()
    expect(n.searchCalls).toBe(1) // only the original search

    // 3. refresh returns reordered candidates: the same group is found and its prices are updated
    const before = await p.getByTestId('cached-at').innerText()
    await p.unroute('**/api/actions/searchProducts')
    await mockSearch(p, { ...SSD, candidates: [g1tb, g2tb] }, Q)
    snap = snapFor(g1tb, new Date(), 5)
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('refresh-note')).toContainText('Newly refreshed prices')
    await expect(p.getByTestId('identity-unconfirmed')).toHaveCount(0)
    await expect(p.getByTestId('refresh-failed')).toHaveCount(0)
    expect(await p.getByTestId('cached-at').innerText()).not.toBe(before)
    const kept = await p.getByTestId('cached-at').innerText()

    // 4. refresh where the saved group cannot be confirmed: clear notice, prices and capture time unchanged, no other group shown
    await p.unroute('**/api/actions/searchProducts')
    await mockSearch(p, { ...SSD, candidates: [g2tb] }, Q)
    captureAnswer = () => ({ success: true, data: { captured: false, reason: 'identity_unconfirmed', detail: 'No product group with this title is in the stored data any more.' } })
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('identity-unconfirmed')).toContainText('could not confirm the product')
    await expect(p.getByTestId('identity-unconfirmed')).toContainText('did not switch to another product')
    await expect(p.getByTestId('refresh-note')).toHaveCount(0)
    expect(await p.getByTestId('cached-at').innerText()).toBe(kept)
    await expect(p.getByTestId('snapshot-status')).toContainText('Last saved prices')
    await expect(p.getByTestId('comparison')).not.toContainText('WDS200T2X0E')

    // 5. the refresh itself fails: "refresh unsuccessful", saved prices unchanged
    await p.unroute('**/api/actions/searchProducts')
    await p.route('**/api/actions/searchProducts', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: false, code: 'user_limit_reached', error: 'You have used your 3 fresh searches today.', retryAfterSeconds: 7200 }) }))
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('refresh-failed')).toContainText('Refresh unsuccessful')
    await expect(p.getByTestId('refresh-failed')).toContainText('were not changed')
    expect(await p.getByTestId('cached-at').innerText()).toBe(kept)

    // 6. sign-in/reload later: the same saved prices, from the server's snapshot, not the cache
    await reopen({ snapshot: snap })
    await expect(p.getByTestId('saved-candidate')).toContainText('1TB', { timeout: 20_000 })
    await expect(p.getByTestId('snapshot-status')).toBeVisible()

    // 7. an older record with no snapshot, against data that no longer has its group: a limitation, nothing compared
    await reopen({ snapshot: null, candidates: [g2tb] })
    await expect(p.getByTestId('candidate-unresolved')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('comparison')).toHaveCount(0)
    expect(n.pricesapi).toEqual([])
    await clearOwn(p)
  })

  test('14b. two different groups of one search are saved separately and removing one keeps the other', async ({ users }) => {
    const [a] = await users(1)
    const p = a.page
    const Q = 'WD Black SN850X'
    await p.route('**/api/actions/captureSavedSnapshot', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { captured: false, reason: 'no_stored_data', detail: 'x' } }) }))
    await p.route('**/api/actions/discardSavedSnapshot', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { discarded: true } }) }))
    await clearOwn(p)
    await mockSearch(p, SSD, Q)
    for (const i of [0, 1]) {
      await p.goto('/search')
      await p.getByTestId('product-search-input').fill(Q)
      await p.getByTestId('product-search-input').press('Enter')
      await expect(p.getByTestId('candidate-picker')).toBeVisible({ timeout: 20_000 })
      await p.getByTestId(`candidate-${i}`).click()
      await expect(p.getByTestId('save-button')).toBeEnabled()
      await p.getByTestId('save-button').click()
      await expect(p.getByTestId('save-state')).toBeVisible()
    }
    expect(await savedNames(p)).toHaveLength(2)
    const names = await savedNames(p)
    expect(new Set(names).size).toBe(2)
    await p.getByTestId('saved-remove').first().click()
    await p.getByTestId('saved-remove-confirm').click()
    await expect.poll(async () => (await savedNames(p)).length).toBe(1)
    await clearOwn(p)
  })
})
