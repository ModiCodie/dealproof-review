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

/** Save -> reopen -> refresh (updated / unconfirmed / failed) -> older record, from the saved real response (no network, no PricesAPI). */
test('live replay: saved comparison keeps its product group and last saved prices (real response)', async ({ users }) => {
  const [u] = await users(1)
  const p = u.page
  const direct: string[] = []
  p.on('request', (r) => { if (/pricesapi\.io/i.test(r.url())) direct.push(r.url()) })
  const real = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const Q = real.data.result.query as string
  const cands = real.data.result.candidates as { pid: number; catalogId: string | null; clusterId: string | null; title: string; offers: unknown[] }[]
  const g = cands[1]
  const withCands = (c: unknown[]) => ({ ...real, data: { ...real.data, result: { ...real.data.result, candidates: c } } })
  const snapOf = (capturedAt: Date) => ({ capturedAt: capturedAt.toISOString(), source: real.data.result.source, candidate: { pid: String(g.pid), catalogId: g.catalogId, clusterId: g.clusterId, title: g.title }, offers: g.offers, truncated: false })
  let snap: ReturnType<typeof snapOf> | null = null
  let capture: () => unknown = () => ({ success: true, data: { captured: true, snapshot: snap } })
  const search = async (body: unknown) => {
    await p.unroute('**/api/actions/searchProducts').catch(() => {})
    await p.route('**/api/actions/searchProducts', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }))
  }
  const savedMock = async (snapshot: typeof snap, c: unknown[] | null) => {
    await p.unroute('**/api/actions/getSavedComparison').catch(() => {})
    await p.route('**/api/actions/getSavedComparison', (r) => {
      const { savedId } = r.request().postDataJSON()
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { saved: { recordId: savedId, query: Q, family: '', variant: {} }, snapshot, result: c ? withCands(c).data.result : null, stale: false, quota: { userDailyLimit: 3, userRemainingToday: 2 } } }) })
    })
  }
  await p.route('**/api/actions/captureSavedSnapshot', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(capture()) }))
  await p.route('**/api/actions/discardSavedSnapshot', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { discarded: true } }) }))
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
    capture = () => ({ success: true, data: { captured: true, snapshot: snap } })
    await p.setViewportSize(SIZES[size])
    await p.goto('/search')
    await p.getByTestId('product-search-input').fill(Q)
    await p.getByTestId('product-search-input').press('Enter')
    await expect(p.getByTestId('candidate-picker')).toBeVisible({ timeout: 30_000 })
    await p.getByTestId('candidate-1').click()
    await expect(p.getByTestId('price-unreliable')).toBeVisible()
    const live = await p.getByTestId('price-unreliable').innerText()
    await expect(p.getByTestId('save-button')).toBeEnabled()
    snap = snapOf(new Date(Date.now() - 2 * 3_600_000))
    await p.getByTestId('save-button').click()
    await expect(p.getByTestId('save-message')).toContainText('Saved with these prices')

    // reopen with the shared cache gone: the saved snapshot alone
    await savedMock(snap, null)
    await p.goto('/saved')
    await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
    await shoot(p, '04-saved-list', size)
    await p.getByTestId('saved-open').first().click()
    await expect(p.getByTestId('snapshot-status')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('saved-candidate')).toContainText('MagSafe Case')
    await expect(p.getByTestId('price-unreliable')).toBeVisible()
    expect(await p.getByTestId('price-unreliable').innerText()).toBe(live) // reopening does not change the summary
    await shoot(p, '05-saved-detail', size)

    // refresh succeeds (candidates reordered): newly refreshed prices
    await search(withCands([...cands].reverse()))
    snap = snapOf(new Date())
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('refresh-note')).toContainText('Newly refreshed prices')
    await shoot(p, '06-refresh-updated', size)

    // refresh cannot confirm the product: notice, saved prices unchanged
    await search(withCands([cands[0], cands[2]]))
    capture = () => ({ success: true, data: { captured: false, reason: 'identity_unconfirmed', detail: 'No product group with this title is in the stored data any more.' } })
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('identity-unconfirmed')).toBeVisible()
    await shoot(p, '07-refresh-unconfirmed', size)

    // refresh itself fails
    await p.unroute('**/api/actions/searchProducts')
    await p.route('**/api/actions/searchProducts', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: false, code: 'upstream_timeout', error: 'The search took too long.' }) }))
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('refresh-failed')).toBeVisible()
    await shoot(p, '08-refresh-failed', size)

    // an older record with no snapshot, against data that no longer has its group
    await savedMock(null, [cands[0], cands[2]])
    await p.goto('/saved')
    await p.getByTestId('saved-open').first().click()
    await expect(p.getByTestId('candidate-unresolved')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('comparison')).toHaveCount(0)
    await shoot(p, '09-older-record-missing-group', size)
    await clear()
  }
  expect(direct).toEqual([])
})
