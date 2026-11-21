/**
 * Opt-in design screenshots (desktop / tablet / mobile) for reviewing the UI.
 *
 *   DP_SHOTS=1 SHOT_DIR=docs/screenshots/redesign/after npx deepspace test run e2e --grep "design shots" --port 5199
 *
 * Skipped unless DP_SHOTS=1, so a normal `test run all` never rewrites tracked images.
 * Local dev server + a DeepSpace test account only. Prices are the bundled real
 * fixtures (via mocked `searchProducts` / `getSavedComparison`); the test fails if
 * the browser ever reaches PricesAPI, so no paid request can happen.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

test.skip(!process.env.DP_SHOTS, 'opt-in: set DP_SHOTS=1')
test.skip(loadAllTestAccounts().length < 1, 'needs a test account')
test.describe.configure({ mode: 'serial' })

const OUT = process.env.SHOT_DIR ?? 'docs/screenshots/redesign/after'
fs.mkdirSync(OUT, { recursive: true })
const fx = (n: string) => JSON.parse(fs.readFileSync(`tests/fixtures/real-${n}.normalized.json`, 'utf8'))
const FIX = { sony: fx('sony'), logitech: fx('logitech'), samsung: fx('samsung') }
const QUERY = { sony: 'Sony WH-1000XM5', logitech: 'Logitech MX Master 3S', samsung: 'Samsung 990 PRO 2TB' }

const SIZES = {
  desktop: { width: 1280, height: 1000 },
  tablet: { width: 820, height: 1100 },
  mobile: { width: 390, height: 844 },
} as const
type Size = keyof typeof SIZES

const result = (key: keyof typeof FIX, cachedAt = new Date()) => ({
  query: QUERY[key],
  market: 'us',
  candidates: FIX[key].candidates,
  source: FIX[key].source,
  cachedAt: cachedAt.toISOString(),
  expiresAt: new Date(cachedAt.getTime() + 12 * 3_600_000).toISOString(),
})

/** Take a screenshot of the whole scrollable app column by growing the viewport to fit it. */
async function full(page: Page, name: string, size: Size, max = 6000) {
  await page.setViewportSize(SIZES[size])
  await page.waitForTimeout(250)
  const h = await page.evaluate(() => {
    const main = document.querySelector('main')
    return main ? main.scrollHeight + main.getBoundingClientRect().top : document.documentElement.scrollHeight
  })
  await page.setViewportSize({ width: SIZES[size].width, height: Math.min(Math.max(h, SIZES[size].height), max) })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/${name}-${size}.png` })
  await page.setViewportSize(SIZES[size])
}

async function demo(page: Page, key: keyof typeof FIX) {
  await page.goto('/search')
  await expect(page.getByTestId('product-picker')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId(`product-${key}`).click()
  await page.getByTestId(`sample-${key}`).click()
  await expect(page.getByTestId('comparison')).toBeVisible()
}

test('design shots: public pages', async ({ page }) => {
  for (const size of ['desktop', 'mobile'] as const) {
    await page.setViewportSize(SIZES[size])
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: SIZES[size].width, height: h })
    await page.screenshot({ path: `${OUT}/01-landing-${size}.png` })
  }
})

test('design shots: compare flow and saved pages', async ({ users }) => {
  const [u] = await users(1)
  const p = u.page
  const bad: string[] = []
  p.on('request', (r) => { if (/pricesapi\.io/i.test(r.url())) bad.push(r.url()) })

  // Search page, idle (all sizes)
  for (const size of ['desktop', 'tablet', 'mobile'] as const) {
    await p.setViewportSize(SIZES[size])
    await p.goto('/search')
    await expect(p.getByTestId('product-picker')).toBeVisible({ timeout: 20_000 })
    await full(p, '02-compare-idle', size)
  }

  // Demo comparisons (Samsung = likely match + low-price flag, Logitech = editions, Sony = exact + flag)
  for (const size of ['desktop', 'mobile'] as const) {
    await p.setViewportSize(SIZES[size])
    await demo(p, 'samsung')
    await full(p, '03-samsung-demo', size)
    await demo(p, 'logitech')
    await full(p, '04-logitech-demo', size)
    await demo(p, 'sony')
    await full(p, '05-sony-demo', size)
  }
  // Close-ups
  await p.setViewportSize(SIZES.desktop)
  await demo(p, 'sony')
  await p.getByTestId('cheapest').scrollIntoViewIfNeeded()
  await p.getByTestId('cheapest').screenshot({ path: `${OUT}/06-low-price-warning-desktop.png` })
  await p.getByTestId('cheapest-flag').getByText('Why this is flagged').click()
  await p.getByTestId('cheapest').screenshot({ path: `${OUT}/06-low-price-warning-expanded-desktop.png` })
  await p.getByTestId('section-pricecheck').scrollIntoViewIfNeeded()
  await p.getByTestId('section-pricecheck').getByTestId('offer').first().getByText('Details', { exact: true }).click()
  await p.getByTestId('section-pricecheck').screenshot({ path: `${OUT}/06-low-price-section-desktop.png` })
  await p.setViewportSize(SIZES.mobile)
  await p.getByTestId('cheapest').scrollIntoViewIfNeeded()
  await p.getByTestId('cheapest').screenshot({ path: `${OUT}/06-low-price-warning-mobile.png` })

  // Variant switching (Samsung 4TB: too few sellers to judge)
  await p.setViewportSize(SIZES.desktop)
  await demo(p, 'samsung')
  await p.getByTestId('variant-capacity-4TB').click()
  await full(p, '07-samsung-4tb', 'desktop')

  // Loading / error / empty (mocked, no network)
  await p.route('**/api/actions/searchProducts', async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: false, code: 'user_limit_reached', error: 'You have used your 3 fresh searches today.', retryAfterSeconds: 7200 }) })
  })
  for (const size of ['desktop', 'mobile'] as const) {
    await p.setViewportSize(SIZES[size])
    await p.goto('/search')
    await p.getByTestId('search-submit').click()
    await expect(p.getByTestId('search-loading')).toBeVisible()
    await full(p, '08-loading', size)
    await expect(p.getByTestId('search-error')).toBeVisible({ timeout: 10_000 })
    await full(p, '09-error-limit', size)
  }
  await p.unroute('**/api/actions/searchProducts')

  // Live comparison with a Save control, then the Saved pages (mocked prices, real record storage)
  const stored = new Map<string, keyof typeof FIX>()
  let current: keyof typeof FIX = 'sony'
  await p.route('**/api/actions/searchProducts', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { result: result(current), fromCache: false, quota: { userDailyLimit: 3, userRemainingToday: 2 } } }) }),
  )
  await p.setViewportSize(SIZES.desktop)
  for (const key of ['sony', 'samsung'] as const) {
    current = key
    await p.goto('/search')
    await p.getByTestId(`product-${key}`).click()
    await p.getByTestId('search-submit').click()
    await expect(p.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('save-button')).toBeEnabled()
    if (key === 'sony') await full(p, '10-live-results', 'desktop')
    await p.getByTestId('save-button').click()
    await expect(p.getByTestId('save-state')).toBeVisible()
    if (key === 'samsung') {
      await p.getByTestId('save-control').scrollIntoViewIfNeeded()
      await p.getByTestId('save-control').screenshot({ path: `${OUT}/10-save-control-saved-desktop.png` })
    }
  }
  await p.goto('/saved')
  await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
  const items = p.getByTestId('saved-item')
  for (let i = 0; i < (await items.count()); i++) {
    const name = await items.nth(i).getByTestId('saved-name').innerText()
    const href = await items.nth(i).getByTestId('saved-open').getAttribute('href')
    stored.set(href!.split('/').pop()!, name.includes('Samsung') ? 'samsung' : 'sony')
  }
  await p.route('**/api/actions/getSavedComparison', async (route) => {
    const { savedId } = route.request().postDataJSON()
    const key = stored.get(savedId) ?? 'sony'
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { saved: { recordId: savedId, query: QUERY[key], family: '', variant: {} }, result: result(key), stale: false, quota: { userDailyLimit: 3, userRemainingToday: 2 } } }) })
  })
  for (const size of ['desktop', 'mobile'] as const) {
    await p.setViewportSize(SIZES[size])
    await p.goto('/saved')
    await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('saved-last-price').first()).toContainText('Last stored')
    await full(p, '11-saved-list', size)
    await p.getByTestId('saved-open').first().click()
    await expect(p.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
    await full(p, '12-saved-detail', size)
  }
  // stale detail + confirm-remove state
  await p.unroute('**/api/actions/getSavedComparison')
  await p.route('**/api/actions/getSavedComparison', async (route) => {
    const { savedId } = route.request().postDataJSON()
    const key = stored.get(savedId) ?? 'sony'
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { saved: { recordId: savedId, query: QUERY[key], family: '', variant: {} }, result: result(key, new Date(Date.now() - 30 * 3_600_000)), stale: true, quota: { userDailyLimit: 3, userRemainingToday: 2 } } }) })
  })
  await p.setViewportSize(SIZES.desktop)
  await p.goto('/saved')
  await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
  await p.getByTestId('saved-remove').first().click()
  await p.screenshot({ path: `${OUT}/13-saved-confirm-remove-desktop.png` })
  await p.getByTestId('saved-open').first().click()
  await expect(p.getByTestId('stale-banner')).toBeVisible({ timeout: 20_000 })
  await p.screenshot({ path: `${OUT}/14-saved-stale-desktop.png` })

  // Clean up this test account's saved rows, then the empty state
  await p.goto('/saved')
  await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
  while ((await p.getByTestId('saved-item').count()) > 0) {
    await p.getByTestId('saved-remove').first().click()
    await p.getByTestId('saved-remove-confirm').click()
    await p.waitForTimeout(300)
  }
  await expect(p.getByTestId('saved-empty')).toBeVisible()
  for (const size of ['desktop', 'mobile'] as const) {
    await p.setViewportSize(SIZES[size])
    await full(p, '15-saved-empty', size)
  }
  expect(bad).toEqual([])
})
