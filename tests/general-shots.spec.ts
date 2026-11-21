/**
 * Opt-in screenshots for general product search (desktop / tablet / mobile).
 *
 *   DP_SHOTS=1 npx deepspace test run e2e --grep "general shots" --port 5199
 *
 * Skipped unless DP_SHOTS=1. Prices are INVENTED synthetic fixtures (fictional
 * retailers) or the bundled real Samsung sample; the test fails if the browser
 * ever reaches PricesAPI.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

test.skip(!process.env.DP_SHOTS, 'opt-in: set DP_SHOTS=1')
test.skip(loadAllTestAccounts().length < 1, 'needs a test account')
test.describe.configure({ mode: 'serial' })

const OUT = process.env.SHOT_DIR ?? 'docs/screenshots/general-search'
fs.mkdirSync(OUT, { recursive: true })
const fx = (p: string) => JSON.parse(fs.readFileSync(`tests/fixtures/${p}.json`, 'utf8'))
const F = { airpods: fx('synthetic/airpods'), ssd: fx('synthetic/ssd'), vague: fx('synthetic/vague'), empty: fx('synthetic/empty'), dyson: fx('synthetic/dyson') }
const SIZES = { desktop: { width: 1280, height: 1000 }, tablet: { width: 820, height: 1100 }, mobile: { width: 390, height: 844 } } as const
type Size = keyof typeof SIZES

const result = (f: { candidates: unknown[]; source: unknown }, query: string) => {
  const at = new Date()
  return { query, market: 'us', candidates: f.candidates, source: f.source, cachedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 12 * 3_600_000).toISOString() }
}
async function mock(page: Page, f: keyof typeof F) {
  await page.unroute('**/api/actions/searchProducts').catch(() => {})
  await page.route('**/api/actions/searchProducts', (r) => {
    const q = (r.request().postDataJSON() as { query: string }).query
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { result: result(F[f], q), fromCache: false, quota: { userDailyLimit: 3, userRemainingToday: 2 } } }) })
  })
}
async function full(page: Page, name: string, size: Size, max = 7000) {
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
async function go(page: Page, text: string) {
  await page.goto('/search')
  await expect(page.getByTestId('product-search-input')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('product-search-input').fill(text)
  await page.getByTestId('product-search-input').press('Enter')
}

test('general shots', async ({ users }) => {
  const [u] = await users(1)
  const p = u.page
  const bad: string[] = []
  p.on('request', (r) => { if (/pricesapi\.io/i.test(r.url())) bad.push(r.url()) })

  for (const size of ['desktop', 'tablet', 'mobile'] as const) {
    await p.setViewportSize(SIZES[size])
    await p.goto('/search')
    await expect(p.getByTestId('product-search-input')).toBeVisible({ timeout: 20_000 })
    await full(p, '01-general-search-featured', size)

    await mock(p, 'airpods')
    await go(p, 'Apple AirPods Pro 2')
    await expect(p.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
    await full(p, '03-generic-comparison', size)
    await p.getByTestId('candidate-picker').scrollIntoViewIfNeeded()
    await p.getByTestId('candidate-picker').screenshot({ path: `${OUT}/02-candidate-selection-${size}.png` })

    await mock(p, 'vague')
    await go(p, 'Dyson cordless vacuum')
    await expect(p.getByTestId('candidate-prompt')).toBeVisible({ timeout: 20_000 })
    await full(p, '04-ambiguous-candidates', size)
    await p.getByTestId('candidate-2').click() // "Dyson Outsize ..." names no model code
    await expect(p.getByTestId('cannot-compare')).toBeVisible()
    await full(p, '05-ambiguous-comparison', size)

    await mock(p, 'empty')
    await go(p, 'Zorblax Quantum Teapot 9000')
    await expect(p.getByTestId('search-empty')).toBeVisible({ timeout: 20_000 })
    await full(p, '06-no-results', size)

    await p.goto('/search')
    await p.getByTestId('product-samsung').click()
    await p.getByTestId('sample-samsung').click()
    await expect(p.getByTestId('comparison')).toBeVisible()
    await full(p, '07-existing-samsung', size)
  }

  // SSD with variant controls (discovered capacities) on desktop
  await p.setViewportSize(SIZES.desktop)
  await mock(p, 'ssd')
  await go(p, 'WD Black SN850X 2TB')
  await expect(p.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
  await full(p, '08-generic-ssd-variants', 'desktop')

  // Saved general product (real record storage, mocked prices)
  await p.goto('/saved')
  await expect(p.getByTestId('saved-list').or(p.getByTestId('saved-empty'))).toBeVisible({ timeout: 20_000 })
  while ((await p.getByTestId('saved-item').count()) > 0) {
    await p.getByTestId('saved-remove').first().click()
    await p.getByTestId('saved-remove-confirm').click()
    await p.waitForTimeout(300)
  }
  await go(p, 'WD Black SN850X 2TB')
  await expect(p.getByTestId('save-button')).toBeEnabled({ timeout: 20_000 })
  await p.getByTestId('save-button').click()
  await expect(p.getByTestId('save-state')).toBeVisible()
  await p.route('**/api/actions/getSavedComparison', (r) => {
    const { savedId } = r.request().postDataJSON()
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { saved: { recordId: savedId, query: 'WD Black SN850X 2TB', family: 'generic', variant: {} }, result: result(F.ssd, 'WD Black SN850X 2TB'), stale: false, quota: { userDailyLimit: 3, userRemainingToday: 2 } } }) })
  })
  for (const size of ['desktop', 'mobile'] as const) {
    await p.setViewportSize(SIZES[size])
    await p.goto('/saved')
    await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
    await full(p, '09-saved-general-list', size)
    await p.getByTestId('saved-open').first().click()
    await expect(p.getByTestId('comparison')).toBeVisible({ timeout: 20_000 })
    await full(p, '10-saved-general-detail', size)
  }
  // cleanup
  await p.goto('/saved')
  await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
  while ((await p.getByTestId('saved-item').count()) > 0) {
    await p.getByTestId('saved-remove').first().click()
    await p.getByTestId('saved-remove-confirm').click()
    await p.waitForTimeout(300)
  }
  expect(bad).toEqual([])
})
