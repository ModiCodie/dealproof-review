/**
 * Opt-in, FREE replay of the one real response captured by live-validation.spec.ts.
 * `searchProducts` is answered from the saved file, so nothing reaches PricesAPI.
 * Screenshots go to the gitignored experiments/price-api/out/screens/ (they contain
 * real third-party listings, so they are not committed).
 *
 *   DP_REPLAY=1 npx deepspace test run e2e --grep "live replay" --port 5199
 *
 * Why earlier full-page shots were mostly blank: the app scrolls inside <main>, so
 * Playwright's `fullPage` only captured one viewport of an otherwise empty document.
 * `shoot` grows the viewport to the content height instead and waits for real
 * readiness (the expected element visible, fonts loaded, layout settled) rather than a delay.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

const FILE = 'experiments/price-api/out/live-validation-response.json'
test.skip(!process.env.DP_REPLAY || !fs.existsSync(FILE), 'opt-in: DP_REPLAY=1 and a captured response')
test.skip(loadAllTestAccounts().length < 1, 'needs a test account')
test.setTimeout(180_000)

const SIZES = { desktop: { width: 1280, height: 1000 }, mobile: { width: 390, height: 844 } } as const
const OUT = 'experiments/price-api/out/screens'

async function settle(p: Page) {
  await p.evaluate(() => document.fonts.ready)
  // layout is settled when the content height stops changing between two animation frames
  await p.waitForFunction(() => new Promise<boolean>((res) => {
    const h = () => (document.querySelector('main')?.scrollHeight ?? document.documentElement.scrollHeight)
    const a = h()
    requestAnimationFrame(() => requestAnimationFrame(() => res(h() === a)))
  }))
}
async function shoot(p: Page, name: string, size: keyof typeof SIZES, max = 9000) {
  await settle(p)
  const h = await p.evaluate(() => {
    const main = document.querySelector('main')
    return main ? main.scrollHeight + main.getBoundingClientRect().top : document.documentElement.scrollHeight
  })
  await p.setViewportSize({ width: SIZES[size].width, height: Math.min(Math.max(h, SIZES[size].height), max) })
  await settle(p)
  await p.screenshot({ path: `${OUT}/${name}-${size}.png` })
  await p.setViewportSize(SIZES[size])
}

test('live replay: real AirPods Pro 2 response rendered from file', async ({ users }) => {
  const [u] = await users(1)
  const p = u.page
  const direct: string[] = []
  p.on('request', (r) => { if (/pricesapi\.io/i.test(r.url())) direct.push(r.url()) })
  await p.route('**/api/actions/searchProducts', (r) => r.fulfill({ contentType: 'application/json', body: fs.readFileSync(FILE, 'utf8') }))
  fs.mkdirSync(OUT, { recursive: true })
  for (const size of ['desktop', 'mobile'] as const) {
    await p.setViewportSize(SIZES[size])
    await p.goto('/search')
    await p.getByTestId('product-search-input').fill('Apple AirPods Pro 2')
    await p.getByTestId('product-search-input').press('Enter')
    await expect(p.getByTestId('candidate-picker')).toBeVisible({ timeout: 30_000 })
    await expect(p.getByTestId('candidate-0')).toBeVisible()
    await shoot(p, '01-candidates', size)
    for (const i of [0, 1, 2]) {
      await p.getByTestId(`candidate-${i}`).click()
      await expect(p.getByTestId('comparison')).toBeVisible()
      await expect(p.getByTestId('section-comparable')).toBeVisible()
      await shoot(p, `02-comparison-group${i}`, size)
    }
    await p.getByTestId('candidate-1').click()
    await expect(p.getByTestId('price-unreliable')).toBeVisible()
    await p.getByTestId('section-defective').scrollIntoViewIfNeeded()
    await p.getByTestId('section-defective').screenshot({ path: `${OUT}/03-defective-section-${size}.png` })
  }
  expect(direct).toEqual([])
})

/** Save -> reopen -> refresh -> missing-group, all from the saved real response (no network, no PricesAPI). */
test('live replay: saved comparison keeps its product group (real response)', async ({ users }) => {
  const [u] = await users(1)
  const p = u.page
  const direct: string[] = []
  p.on('request', (r) => { if (/pricesapi\.io/i.test(r.url())) direct.push(r.url()) })
  const real = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const Q = real.data.result.query as string
  const cands = real.data.result.candidates as { offers: unknown[] }[]
  const withCands = (c: unknown[]) => ({ ...real, data: { ...real.data, result: { ...real.data.result, candidates: c } } })
  const search = async (body: unknown) => {
    await p.unroute('**/api/actions/searchProducts').catch(() => {})
    await p.route('**/api/actions/searchProducts', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }))
  }
  const savedMock = async (c: unknown[]) => {
    await p.unroute('**/api/actions/getSavedComparison').catch(() => {})
    await p.route('**/api/actions/getSavedComparison', (r) => {
      const { savedId } = r.request().postDataJSON()
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { saved: { recordId: savedId, query: Q, family: '', variant: {} }, result: withCands(c).data.result, stale: false, quota: { userDailyLimit: 3, userRemainingToday: 2 } } }) })
    })
  }
  const clear = async () => {
    await p.goto('/saved')
    await expect(p.getByTestId('saved-list').or(p.getByTestId('saved-empty'))).toBeVisible({ timeout: 20_000 })
    while ((await p.getByTestId('saved-item').count()) > 0) {
      const before = await p.getByTestId('saved-item').count()
      await p.getByTestId('saved-remove').first().click()
      await p.getByTestId('saved-remove-confirm').click()
      await expect.poll(() => p.getByTestId('saved-item').count()).toBeLessThan(before)
    }
  }
  fs.mkdirSync(OUT, { recursive: true })
  await clear()
  for (const size of ['desktop', 'mobile'] as const) {
    await search(real) // each pass starts from the full real result
    await p.setViewportSize(SIZES[size])
    await p.goto('/search')
    await p.getByTestId('product-search-input').fill(Q)
    await p.getByTestId('product-search-input').press('Enter')
    await expect(p.getByTestId('candidate-picker')).toBeVisible({ timeout: 30_000 })
    await p.getByTestId('candidate-1').click()
    await expect(p.getByTestId('price-unreliable')).toBeVisible()
    const live = await p.getByTestId('price-unreliable').innerText()
    await expect(p.getByTestId('save-button')).toBeEnabled()
    await p.getByTestId('save-button').click()
    await expect(p.getByTestId('save-state')).toBeVisible()

    await savedMock(cands)
    await p.goto('/saved')
    await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
    await shoot(p, '04-saved-list', size)
    await p.getByTestId('saved-open').first().click()
    await expect(p.getByTestId('saved-candidate')).toContainText('MagSafe Case', { timeout: 20_000 })
    await expect(p.getByTestId('price-unreliable')).toBeVisible()
    expect(await p.getByTestId('price-unreliable').innerText()).toBe(live) // reopening does not change the summary
    await shoot(p, '05-saved-detail', size)

    await search(withCands([...cands].reverse()))
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('refresh-note')).toBeVisible()
    await expect(p.getByTestId('refresh-note')).not.toContainText('could not be identified')
    await expect(p.getByTestId('saved-candidate')).toContainText('MagSafe Case')
    await shoot(p, '06-refresh-reordered', size)

    await search(withCands([cands[0], cands[2]]))
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('refresh-note')).toContainText('could not be identified')
    await shoot(p, '07-refresh-group-gone', size)

    await savedMock([cands[0], cands[2]])
    await p.goto('/saved')
    await p.getByTestId('saved-open').first().click()
    await expect(p.getByTestId('candidate-unresolved')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('comparison')).toHaveCount(0)
    await shoot(p, '08-saved-missing-group', size)
    await clear()
  }
  expect(direct).toEqual([])
})
