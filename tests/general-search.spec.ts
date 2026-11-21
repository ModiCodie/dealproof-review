/**
 * Browser tests for general product search: search text -> candidates -> pick -> compare.
 *
 * Local dev server + real DeepSpace test accounts. PRICE data is always mocked
 * from tests/fixtures/synthetic (INVENTED listings, fictional retailers) or the
 * real featured fixtures, and a test fails if any request reaches PricesAPI,
 * so no paid request can happen. It never touches saved rows: saving a general
 * product is tested in saved-products.spec.ts (test 13), because spec files run
 * in parallel and share the same test accounts.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

test.skip(loadAllTestAccounts().length < 2, 'Needs two test accounts: npx deepspace test accounts create --email <name>@deepspace.test --password-stdin')
test.describe.configure({ mode: 'serial' })

const fx = (path: string) => JSON.parse(fs.readFileSync(`tests/fixtures/${path}.json`, 'utf8'))
const AIRPODS = fx('synthetic/airpods')
const VAGUE = fx('synthetic/vague')
const EMPTY = fx('synthetic/empty')
const SSD = fx('synthetic/ssd')
const SONY = fx('real-sony.normalized')

type Fx = { candidates: unknown[]; source: unknown }
const ok = (data: unknown) => ({ success: true, data })
function body(f: Fx, query: string) {
  const at = new Date()
  return ok({
    result: { query, market: 'us', candidates: f.candidates, source: f.source, cachedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 12 * 3_600_000).toISOString() },
    fromCache: false,
    quota: { userDailyLimit: 3, userRemainingToday: 2 },
  })
}
function guard(page: Page) {
  const s = { pricesapi: [] as string[], searches: [] as string[] }
  page.on('request', (r) => {
    if (/pricesapi\.io/i.test(r.url())) s.pricesapi.push(r.url())
    if (r.url().includes('/api/actions/searchProducts')) s.searches.push(r.postData() ?? '')
  })
  return s
}
async function mockSearch(page: Page, f: Fx) {
  await page.unroute('**/api/actions/searchProducts').catch(() => {})
  await page.route('**/api/actions/searchProducts', (r) => {
    const q = (r.request().postDataJSON() as { query?: string }).query ?? ''
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(body(f, q)) })
  })
}
async function search(page: Page, text: string) {
  await page.goto('/search')
  await expect(page.getByTestId('product-search-input')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('product-search-input').fill(text)
  await page.getByTestId('product-search-input').press('Enter')
}
const flat = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
test.describe('general product search', () => {
  test('1. search -> candidates -> pick -> comparison (nothing runs until Enter / Find product)', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const n = guard(p)
    await mockSearch(p, AIRPODS)
    await p.goto('/search')
    await p.getByTestId('product-search-input').fill('Apple AirPods Pro 2')
    await p.waitForTimeout(400)
    expect(n.searches).toHaveLength(0) // typing is not a search
    await p.getByTestId('product-search-submit').click()
    await expect(p.getByTestId('candidate-picker')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('candidate-picker')).toContainText('Which product did you mean?')
    expect(n.searches).toHaveLength(1)
    await expect(p.locator('[data-testid^="candidate-"][role="radio"]')).toHaveCount(3)
    // the 2nd-generation group is the single clear fit, so it is pre-selected and can be changed
    await expect(p.getByTestId('candidate-0')).toHaveAttribute('aria-checked', 'true')
    await expect(p.getByTestId('comparison')).toBeVisible()
    await expect(p.getByTestId('target-label')).toContainText('AirPods')
    await expect(p.getByTestId('cheapest')).toContainText('Lowest reported matching offer')
    await expect(p.getByTestId('cheapest-flag')).toBeVisible() // the invented $59 listing is flagged, not trusted
    await expect(p.getByTestId('variant-generation')).toHaveCount(0) // the search already names the generation, so no switch is invented
    await expect(p.getByTestId('section-variants')).toContainText('1st generation') // other generations are kept apart
    await expect(p.getByTestId('comparison')).not.toContainText(/\b(EXACT|LIKELY|AMBIGUOUS|REJECTED)\b/)
    // choosing another group changes the target; nothing new is searched
    await p.getByTestId('candidate-1').click()
    await expect(p.getByTestId('candidate-1')).toHaveAttribute('aria-checked', 'true')
    await expect(p.getByTestId('pick-mismatch')).toContainText('This isn’t the product you searched for')
    await expect(p.getByTestId('comparison')).toHaveCount(0) // never one product's name over another's offers
    await p.getByTestId('candidate-0').click()
    await expect(p.getByTestId('comparison')).toBeVisible()
    await expect(p.getByTestId('pick-mismatch')).toHaveCount(0)
    expect(n.searches).toHaveLength(1)
    expect(n.pricesapi).toEqual([])
  })

  test('2. too-short or empty input is refused before any request', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const n = guard(p)
    await p.goto('/search')
    await expect(p.getByTestId('product-search-input')).toBeVisible({ timeout: 20_000 })
    await p.getByTestId('product-search-input').fill(' a ')
    await p.getByTestId('product-search-submit').click()
    await expect(p.getByTestId('product-search-hint')).toContainText('at least 2 characters')
    await p.getByTestId('product-search-input').fill('')
    await p.getByTestId('product-search-submit').click()
    expect(n.searches).toEqual([])
    await expect(p.getByTestId('product-search-input')).toHaveAttribute('maxlength', '100')
  })

  test('3. no results: a clear empty state, no comparison, no candidate list', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const n = guard(p)
    await mockSearch(p, EMPTY)
    await search(p, 'Zorblax Quantum Teapot 9000')
    await expect(p.getByTestId('search-empty')).toContainText('No retailer offers found')
    await expect(p.getByTestId('search-empty')).toContainText('Zorblax Quantum Teapot 9000')
    await expect(p.getByTestId('candidate-picker')).toHaveCount(0)
    await expect(p.getByTestId('comparison')).toHaveCount(0)
    await expect(p.getByTestId('product-search-input')).toBeEnabled() // can try again
    expect(n.pricesapi).toEqual([])
  })

  test('4. ambiguous search: nothing pre-selected, nothing compared until the user picks', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    await mockSearch(p, VAGUE)
    await search(p, 'Dyson cordless vacuum')
    await expect(p.getByTestId('candidate-picker')).toBeVisible({ timeout: 20_000 })
    await expect(p.locator('[data-testid^="candidate-"][role="radio"][aria-checked="true"]')).toHaveCount(0)
    await expect(p.getByTestId('candidate-prompt')).toContainText('Nothing is compared until you do')
    await expect(p.getByTestId('comparison')).toHaveCount(0)
    await expect(p.getByTestId('cheapest')).toHaveCount(0)
    // picking a product that names a model supplies it, and says so
    await p.getByTestId('candidate-0').click()
    await expect(p.getByTestId('refined-note')).toContainText('dyson v15 detect')
    await expect(p.getByTestId('comparison')).toBeVisible()
  })

  test('5. a featured product typed into the box goes straight to its hand-written rules', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const n = guard(p)
    await mockSearch(p, SONY)
    await search(p, 'sony wh-1000xm5')
    await expect(p.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('candidate-picker')).toHaveCount(0)
    await expect(p.getByTestId('target-label')).toContainText('Sony WH-1000XM5')
    expect(n.searches).toHaveLength(1)
    expect(n.pricesapi).toEqual([])
  })

  test('6. API errors and quota limits keep the search box usable', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    await p.route('**/api/actions/searchProducts', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: false, code: 'user_limit_reached', error: 'You have used your 3 fresh searches today.', retryAfterSeconds: 3600 }) }),
    )
    await search(p, 'Dyson V15 Detect')
    await expect(p.getByTestId('search-error')).toContainText('Daily search limit reached')
    await expect(p.getByTestId('product-search-input')).toHaveValue('Dyson V15 Detect')
    await expect(p.getByTestId('product-search-submit')).toBeEnabled()
    await expect(p.getByTestId('comparison')).toHaveCount(0)
  })

  test('7. demo and live stay separate: the featured demo cannot be saved and is not a general search', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const n = guard(p)
    await p.goto('/search')
    await p.getByTestId('product-samsung').click()
    await p.getByTestId('sample-samsung').click()
    await expect(p.getByTestId('save-unavailable')).toBeVisible()
    await expect(p.getByTestId('save-button')).toHaveCount(0)
    await expect(p.getByTestId('candidate-picker')).toHaveCount(0)
    expect(n.searches).toEqual([])
  })

  test('8. responsive: search, candidates and comparison fit at 390px and 820px', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    await mockSearch(p, AIRPODS)
    for (const w of [390, 820]) {
      await p.setViewportSize({ width: w, height: 900 })
      await search(p, 'Apple AirPods Pro 2')
      await expect(p.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
      expect(await flat(p)).toBe(true)
      const box = await p.getByTestId('candidate-0').boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(w + 1)
    }
  })
})
