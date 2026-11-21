/**
 * ONE real PricesAPI search through the local dev app (opt-in, costs ~10 credits).
 *
 *   DP_LIVE=1 DP_LIVE_QUERY="Apple AirPods Pro 2" npx deepspace test run e2e --grep "live validation" --port 5199
 *
 * Skipped unless DP_LIVE=1, so `test run all` can never spend credits. The search goes
 * browser -> local Worker action -> PricesAPI (the key stays server-side). Any second
 * searchProducts request is aborted before it leaves the browser, and the test fails
 * if the browser itself ever talks to PricesAPI. The normalized response is saved to
 * experiments/raw/ (gitignored) for inspection; screenshots go to docs/screenshots/live/.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import fs from 'node:fs'

test.skip(!process.env.DP_LIVE, 'opt-in: set DP_LIVE=1 (spends real PricesAPI credits)')
test.skip(loadAllTestAccounts().length < 1, 'needs a test account')

test('live validation: one real search', async ({ users }) => {
  const query = process.env.DP_LIVE_QUERY ?? 'Apple AirPods Pro 2'
  const [u] = await users(1)
  const p = u.page
  let sent = 0
  const direct: string[] = []
  p.on('request', (r) => { if (/pricesapi\.io/i.test(r.url())) direct.push(r.url()) })
  await p.route('**/api/actions/searchProducts', async (route) => {
    if (++sent > 1) return route.abort() // never a second paid search
    const resp = await route.fetch()
    const text = await resp.text()
    fs.mkdirSync('experiments/raw', { recursive: true })
    fs.writeFileSync('experiments/raw/live-validation-response.json', text)
    await route.fulfill({ response: resp, body: text })
  })
  fs.mkdirSync('docs/screenshots/live', { recursive: true })
  await p.setViewportSize({ width: 1280, height: 1000 })
  await p.goto('/search')
  await p.getByTestId('product-search-input').fill(query)
  await p.getByTestId('product-search-input').press('Enter')
  await expect(p.getByTestId('search-results').or(p.getByTestId('search-error'))).toBeVisible({ timeout: 120_000 })
  await p.waitForTimeout(1000)
  await p.screenshot({ path: 'docs/screenshots/live/live-result.png', fullPage: true })
  expect(sent).toBe(1)
  expect(direct).toEqual([])
})
