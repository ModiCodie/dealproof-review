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
