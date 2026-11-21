/**
 * Browser verification of the DealProof search/comparison page.
 *
 * Runs against the local dev server only, signed in with a DeepSpace test
 * account (`deepspace test accounts`). It uses ONLY the saved real fixtures
 * (the "saved sample" buttons) and network-level mocks for the loading, error
 * and empty states, and it asserts that no request ever reaches PricesAPI.
 * So no paid PricesAPI call can happen.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

test.skip(loadAllTestAccounts().length < 1, 'Needs one test account: npx deepspace test accounts create --email <name>@deepspace.test --password-stdin')

const SHOTS = 'docs/screenshots'
fs.mkdirSync(SHOTS, { recursive: true })

/** Fail the test if the browser ever talks to PricesAPI, and count search action calls. */
function guardNoPaidCalls(page: Page) {
  const bad: string[] = []
  const searchCalls: string[] = []
  page.on('request', (r) => {
    if (/pricesapi\.io/i.test(r.url())) bad.push(r.url())
    if (r.url().includes('/api/actions/searchProducts')) searchCalls.push(r.url())
  })
  return { bad, searchCalls }
}

async function openSample(page: Page, key: 'sony' | 'logitech' | 'samsung') {
  await page.goto('/search')
  await expect(page.getByTestId('product-picker')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId(`product-${key}`).click()
  await page.getByTestId(`sample-${key}`).click()
  await expect(page.getByTestId('sample-results')).toBeVisible()
  await expect(page.getByTestId('comparison')).toBeVisible()
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

test.describe('DealProof comparison UI', () => {
  test('1. signed out: search page is protected', async ({ page }) => {
    await page.goto('/search')
    // Either redirected to sign-in or shows the sign-in affordance; never the search form.
    await expect(page.getByTestId('search-input')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('nav-sign-in-button').or(page.getByRole('button', { name: /sign in/i }).first())).toBeVisible({ timeout: 15_000 })
  })

  test('2. signed in: navigation and search page', async ({ users }) => {
    const [u] = await users(1)
    const net = guardNoPaidCalls(u.page)
    await u.page.goto('/home')
    await expect(u.page.getByTestId('app-navigation')).toBeVisible({ timeout: 20_000 })
    await expect(u.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })
    await u.page.goto('/search')
    await expect(u.page.getByTestId('product-picker')).toBeVisible({ timeout: 20_000 })
    await expect(u.page.getByRole('heading', { level: 1 })).toContainText('Compare the right listings')
    await expect(u.page.getByTestId('sample-picker')).toContainText('Explore demo')
    await expect(u.page.getByTestId('sample-picker')).toContainText('Check live prices')
    await u.page.screenshot({ path: `${SHOTS}/01-search-idle-desktop.png` })
    expect(net.bad).toEqual([])
    expect(net.searchCalls).toEqual([])
  })

  test('3. Sony saved sample: lowest reported offer, flag, explanations, labels, links', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const net = guardNoPaidCalls(p)
    await openSample(p, 'sony')

    // clearly a saved sample, not live
    await expect(p.getByRole('note').filter({ hasText: 'Demo data, not live prices' })).toBeVisible()
    await expect(p.getByRole('note').filter({ hasText: 'No search credit used' })).toBeVisible()
    await expect(p.getByTestId('target-label')).toHaveText(/Sony WH-1000XM5/)
    // demo samples cannot be saved (they are not stored server-side, so they could never be reopened)
    await expect(p.getByTestId('save-unavailable')).toContainText('Saving needs a live comparison')
    await expect(p.getByTestId('save-button')).toHaveCount(0)

    // filtering explanation is generated from real counts
    await expect(p.getByTestId('filter-summary')).toContainText('We found 69 listings')
    await expect(p.getByTestId('filter-summary')).toContainText('entered this comparison')
    await expect(p.getByTestId('filter-summary')).toContainText('does not guarantee that condition, seller or checkout cost are equivalent')

    // lowest reported matching offer: flagged offers stay eligible, with a visible warning
    const box = p.getByTestId('cheapest')
    await expect(box).toContainText('Lowest reported matching offer')
    await expect(box).toContainText('$115.00')
    await expect(p.getByTestId('cheapest-flag')).toBeVisible()
    await expect(p.getByTestId('cheapest-flag')).toContainText('Unusually low compared with other listings')
    await expect(p.getByTestId('cheapest-flag')).toContainText('not evidence of a problem with the listing and not a guarantee of a good deal')
    await expect(box).toContainText('not independently verified')
    await expect(box).toContainText("Condition isn't stated in the listing.")
    await expect(box).toContainText('Final checkout cost may differ')
    await expect(p.getByTestId('lowest-unflagged')).toContainText('without')
    await expect(p.getByTestId('lowest-unflagged')).toContainText('$181.15')

    // low-price section explains the 60% rule in neutral language
    const low = p.getByTestId('section-pricecheck')
    await expect(low).toBeVisible()
    await expect(low).toContainText('Unusually low compared with other listings')
    await expect(low).toContainText('rule of thumb based on other listings')
    await expect(low.getByTestId('price-flag').first()).toContainText('% below the median of 38 independent sellers')

    // three separate parts on an offer card, with unknown stated as unknown
    const card = p.getByTestId('section-comparable').getByTestId('offer').first()
    await expect(card).toContainText('Product match')
    await expect(card).toContainText('Purchase details')
    await expect(card).toContainText('Price verification: Not independently verified (API-reported price)')
    await expect(card).toContainText('Source observation:')
    await expect(card).toContainText('Condition: Condition unknown')
    await expect(card).toContainText('Shipping:') // some feeds give text, others do not (checked below)
    const section = p.getByTestId('section-comparable')
    expect(await section.getByTestId('offer').filter({ hasText: 'Shipping: Not provided' }).count()).toBeGreaterThan(0)
    expect(await section.getByTestId('offer').filter({ hasText: 'Condition: Condition unknown' }).count()).toBeGreaterThan(20)
    // missing shipping is never turned into "free"
    expect(await section.getByTestId('offer').filter({ hasText: /Shipping: Not provided/ }).filter({ hasText: /Shipping: (free|\$0)/i }).count()).toBe(0)
    await expect(card).toContainText('Same model and variant')
    await card.getByText('Details', { exact: true }).click()
    await card.getByText('Why this product-match decision?').click()
    await expect(card).toContainText('Title names WH-1000XM5')

    // other sections exist and are separate
    await expect(p.getByTestId('section-ambiguous')).toContainText('Cannot tell if these are the same product')
    await expect(p.getByTestId('section-secondhand')).toContainText('Used, refurbished or open-box')
    await expect(p.getByTestId('section-rejected')).toContainText('Different products and accessories')

    // retailer links open safely
    const links = p.getByTestId('offer').locator('a[href^="http"]')
    expect(await links.count()).toBeGreaterThan(10)
    for (const i of [0, 1, 2]) {
      const a = links.nth(i)
      await expect(a).toHaveAttribute('target', '_blank')
      await expect(a).toHaveAttribute('rel', /noopener/)
      await expect(a).toHaveAttribute('rel', /nofollow/)
    }
    await expect(p.locator('a[href*="bestbuy.com"]').first()).toBeVisible()

    // no overclaiming anywhere in visible text
    const text = (await p.locator('body').innerText()).toLowerCase()
    for (const bad of ['best deal', 'great deal', 'guaranteed lowest', 'verified lowest', 'verified cheapest', 'scam', 'fraud', 'suspicious']) {
      expect(text, `page must not say "${bad}"`).not.toMatch(new RegExp(`\\b${bad}\\b`))
    }

    await p.screenshot({ path: `${SHOTS}/02-sony-sample-desktop.png`, fullPage: false })
    await p.getByTestId('section-pricecheck').scrollIntoViewIfNeeded()
    await p.screenshot({ path: `${SHOTS}/03-sony-low-price-section-desktop.png` })
    expect(await noHorizontalScroll(p)).toBe(true)
    expect(net.bad).toEqual([])
    expect(net.searchCalls).toEqual([])
  })

  test('4. Logitech sample: edition selection regroups offers', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const net = guardNoPaidCalls(p)
    await openSample(p, 'logitech')
    await expect(p.getByTestId('target-label')).toContainText('Standard (Bluetooth Edition)')
    await expect(p.getByTestId('filter-summary')).toContainText('We found 142 listings')
    await expect(p.getByTestId('filter-summary')).toContainText('identical duplicates merged')
    const variants = p.getByTestId('section-variants')
    await variants.scrollIntoViewIfNeeded()
    await expect(variants).toContainText('MX Master 3S for Mac')
    await expect(variants).toContainText('MX Master 3S for Business')
    await expect(variants).toContainText('Different edition: for Mac')

    await p.getByTestId('variant-edition-mac').click()
    await expect(p.getByTestId('target-label')).toContainText('For Mac')
    await expect(p.getByTestId('section-comparable')).toBeVisible()
    // matching listings are now the Mac edition; the standard ones become "different variant"
    const matching = p.getByTestId('section-comparable')
    const exact = matching.getByTestId('offer').filter({ hasText: 'Same model and variant' }).first()
    await expect(exact).toContainText(/for mac/i)
    // listings that name no edition are only "likely" for the Mac edition, and say so
    await expect(matching.getByTestId('offer').filter({ hasText: "doesn't say whether it is the for Mac edition" }).first()).toBeVisible()
    await expect(p.getByTestId('section-variants')).toContainText('MX Master 3S standard edition')
    await p.screenshot({ path: `${SHOTS}/04-logitech-mac-desktop.png` })

    await p.getByTestId('variant-edition-business').click()
    await expect(p.getByTestId('target-label')).toContainText('For Business')
    expect(net.bad).toEqual([])
    expect(net.searchCalls).toEqual([])
  })

  test('4b. switching samples resets the product and variant pickers (regression)', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    await openSample(p, 'sony')
    await expect(p.getByTestId('target-label')).toContainText('Sony WH-1000XM5')
    await p.getByTestId('product-logitech').click() // while viewing a (free) demo, choosing a product shows that product's demo
    await expect(p.getByTestId('target-label')).toContainText('MX Master 3S')
    await expect(p.getByTestId('variant-edition')).toBeVisible()
    await p.getByTestId('product-samsung').click()
    await expect(p.getByTestId('target-label')).toContainText('990 PRO')
    await expect(p.getByTestId('variant-capacity')).toBeVisible()
  })

  test('5. Samsung sample: capacity and heatsink selection, insufficient evidence', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const net = guardNoPaidCalls(p)
    await openSample(p, 'samsung')
    await expect(p.getByTestId('target-label')).toContainText('2TB · Without heatsink')
    await expect(p.getByTestId('filter-summary')).toContainText('We found 118 listings')
    await expect(p.getByTestId('filter-summary')).toContainText('different variants')
    // most 2TB listings do not state a heatsink, so they are "likely", never "same model and variant"
    await expect(p.getByTestId('section-comparable')).toContainText('Likely the same, some details missing')
    await expect(p.getByTestId('section-comparable')).toContainText("doesn't say whether it has a heatsink")

    await p.getByTestId('variant-heatsink-with').click()
    await expect(p.getByTestId('target-label')).toContainText('With heatsink')
    await expect(p.getByTestId('section-comparable').getByTestId('offer').first()).toContainText(/heat ?sink/i)
    await expect(p.getByTestId('section-pricecheck')).toContainText('Unusually low compared with other listings')
    await expect(p.getByTestId('cheapest')).toContainText('Lowest reported matching offer')
    await p.screenshot({ path: `${SHOTS}/05-samsung-heatsink-desktop.png` })

    // too few independent sellers: "insufficient evidence", clearly different from "no flag"
    await p.getByTestId('variant-capacity-4TB').click()
    await p.getByTestId('variant-heatsink-without').click()
    await expect(p.getByTestId('target-label')).toContainText('4TB')
    await expect(p.getByTestId('price-insufficient').first()).toContainText('Insufficient evidence to judge whether this price is unusual')
    await expect(p.getByTestId('section-pricecheck')).toHaveCount(0)
    await expect(p.getByTestId('cheapest')).toContainText('Too few independent sellers to judge')
    await p.screenshot({ path: `${SHOTS}/06-samsung-4tb-insufficient-desktop.png` })
    expect(net.bad).toEqual([])
    expect(net.searchCalls).toEqual([])
  })

  test('6. loading, error, empty and validation states (mocked network, no paid calls)', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const net = guardNoPaidCalls(p)
    let mode: 'slow' | 'limit' | 'empty' = 'slow'
    let mocked = 0
    await p.route('**/api/actions/searchProducts', async (route) => {
      mocked++
      if (mode === 'slow') {
        await new Promise((r) => setTimeout(r, 2500))
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'upstream_error', error: 'Mocked upstream failure.' }) })
      } else if (mode === 'limit') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'user_limit_reached', error: 'You have used your 3 fresh searches today.', retryAfterSeconds: 7200 }) })
      } else {
        const now = new Date().toISOString()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              result: { query: 'nothing here', market: 'us', candidates: [], source: { scrapedAt: now, upstreamCacheSource: 'miss', upstreamCacheAgeSeconds: null, servedStale: null, degraded: null, upstreamLatencyMs: 10 }, cachedAt: now, expiresAt: now },
              fromCache: false,
              quota: { userRemainingToday: 3, userDailyLimit: 3 },
            },
          }),
        })
      }
    })
    await p.goto('/search')
    await expect(p.getByTestId('product-picker')).toBeVisible({ timeout: 20_000 })

    // choosing a product (or switching products) never starts a search
    await p.getByTestId('product-samsung').click()
    await p.getByTestId('product-sony').click()
    expect(mocked).toBe(0)

    // loading, then error
    await p.getByTestId('search-submit').click()
    await expect(p.getByTestId('search-loading')).toBeVisible()
    await expect(p.getByTestId('search-submit')).toBeDisabled()
    await p.screenshot({ path: `${SHOTS}/07-loading-desktop.png` })
    await expect(p.getByTestId('search-error')).toContainText('Mocked upstream failure.', { timeout: 10_000 })
    await expect(p.getByTestId('sample-picker')).toBeVisible() // fallback is offered, never substituted silently
    await expect(p.getByTestId('sample-results')).toHaveCount(0)

    // limit reached
    mode = 'limit'
    await p.getByTestId('search-submit').click()
    await expect(p.getByTestId('search-error')).toContainText('Daily search limit reached')
    await expect(p.getByTestId('search-error')).toContainText('about 2 hour(s)')
    await p.screenshot({ path: `${SHOTS}/08-error-limit-desktop.png` })

    // empty result
    mode = 'empty'
    await p.getByTestId('search-submit').click()
    await expect(p.getByTestId('search-empty')).toContainText('No retailer offers found')
    await expect(p.getByTestId('comparison')).toHaveCount(0)
    expect(mocked).toBe(3) // exactly one request per explicit "Check live prices" click
    expect(net.bad).toEqual([])
  })

  test('6b. the picker offers exactly the three supported products and no free-text box', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const net = guardNoPaidCalls(p)
    await p.goto('/search')
    await expect(p.getByTestId('product-picker')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByRole('radio')).toHaveCount(3)
    await expect(p.getByTestId('product-sony')).toHaveAttribute('aria-checked', 'true') // one product is always selected
    await expect(p.locator('input[type="text"], input[type="search"], textarea')).toHaveCount(0)
    await p.getByTestId('product-logitech').click()
    await expect(p.getByTestId('product-logitech')).toHaveAttribute('aria-checked', 'true')
    await expect(p.getByTestId('product-sony')).toHaveAttribute('aria-checked', 'false')
    // the live check is explicit: nothing ran just from choosing, and the demo does not search either
    await p.getByTestId('sample-logitech').click()
    await expect(p.getByTestId('save-unavailable')).toContainText('Saving needs a live comparison')
    expect(net.searchCalls).toEqual([])
    expect(net.bad).toEqual([])
  })

  test('7. mobile layout at 390px', async ({ users }) => {
    const [u] = await users(1)
    const p = u.page
    const net = guardNoPaidCalls(p)
    await p.setViewportSize({ width: 390, height: 844 })
    await p.goto('/search')
    await expect(p.getByTestId('product-picker')).toBeVisible({ timeout: 20_000 })
    expect(await noHorizontalScroll(p)).toBe(true)
    await p.screenshot({ path: `${SHOTS}/09-search-idle-mobile.png` })
    await p.getByTestId('sample-sony').click()
    await expect(p.getByTestId('comparison')).toBeVisible()
    await expect(p.getByTestId('cheapest')).toContainText('Lowest reported matching offer')
    await expect(p.getByTestId('cheapest-flag')).toBeVisible()
    expect(await noHorizontalScroll(p)).toBe(true)
    await p.screenshot({ path: `${SHOTS}/10-sony-sample-mobile.png` })
    await p.getByTestId('cheapest').scrollIntoViewIfNeeded()
    await p.screenshot({ path: `${SHOTS}/11-sony-lowest-offer-mobile.png` })
    const card = p.getByTestId('section-comparable').getByTestId('offer').first()
    await card.scrollIntoViewIfNeeded()
    await expect(card).toBeVisible()
    const box = await card.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(391)
    await p.screenshot({ path: `${SHOTS}/12-offer-card-mobile.png` })
    await p.getByTestId('product-samsung').click()
    await expect(p.getByTestId('variant-capacity')).toBeVisible()
    expect(await noHorizontalScroll(p)).toBe(true)
    expect(net.bad).toEqual([])
    expect(net.searchCalls).toEqual([])
  })
})
