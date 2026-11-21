/**
 * Opt-in, FREE replay of the one real response captured by live-validation.spec.ts.
 * `searchProducts` is answered from the saved file, so nothing reaches PricesAPI.
 * Screenshots go to the gitignored experiments/price-api/out/screens/ (they contain
 * real third-party listings, so they are not committed).
 *
 *   DP_REPLAY=1 npx deepspace test run e2e --grep "live replay" --port 5199
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import fs from 'node:fs'

const FILE = 'experiments/price-api/out/live-validation-response.json'
test.skip(!process.env.DP_REPLAY || !fs.existsSync(FILE), 'opt-in: DP_REPLAY=1 and a captured response')
test.skip(loadAllTestAccounts().length < 1, 'needs a test account')
test.setTimeout(120_000)

test('live replay: real AirPods Pro 2 response rendered from file', async ({ users }) => {
  const [u] = await users(1)
  const p = u.page
  const direct: string[] = []
  p.on('request', (r) => { if (/pricesapi\.io/i.test(r.url())) direct.push(r.url()) })
  await p.route('**/api/actions/searchProducts', (r) => r.fulfill({ contentType: 'application/json', body: fs.readFileSync(FILE, 'utf8') }))
  const OUT = 'experiments/price-api/out/screens'
  fs.mkdirSync(OUT, { recursive: true })
  for (const [name, size] of [['desktop', { width: 1280, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
    await p.setViewportSize(size)
    await p.goto('/search')
    await p.getByTestId('product-search-input').fill('Apple AirPods Pro 2')
    await p.getByTestId('product-search-input').press('Enter')
    await expect(p.getByTestId('candidate-picker')).toBeVisible({ timeout: 30_000 })
    await p.screenshot({ path: `${OUT}/01-candidates-${name}.png`, fullPage: true })
    await p.getByTestId('candidate-1').click()
    await expect(p.getByTestId('comparison')).toBeVisible()
    await p.screenshot({ path: `${OUT}/02-comparison-${name}.png`, fullPage: true })
  }
  expect(direct).toEqual([])
})
