import { describe, expect, it } from 'vitest'
import sonyFx from '../../../tests/fixtures/real-sony.normalized.json'
import logiFx from '../../../tests/fixtures/real-logitech.normalized.json'
import samsungFx from '../../../tests/fixtures/real-samsung.normalized.json'
import type { NormalizedOffer } from '../pricing-types'
import { ANOMALY_RATIO, assessPrices, buildComparison, MIN_INDEPENDENT_SELLERS, median, sellerKey, identifySeller, summarizeFiltering, detectTarget } from './index'
import type { ProductTarget } from './types'

const sony: ProductTarget = { family: 'sony-wh-1000xm5', variant: {} }
const logi: ProductTarget = { family: 'logitech-mx-master-3s', variant: { edition: 'standard' } }
const sam = (capacity = '2TB', heatsink = 'without'): ProductTarget => ({ family: 'samsung-990-pro', variant: { capacity, heatsink } })

let n = 0
/** An offer from its own independent retailer site (distinct seller). */
function shop(price: number, title = 'Sony WH-1000XM5 Headphones', i = n++, over: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    seller: `Shop ${i}`,
    sellerUrl: `https://shop${i}.example`,
    price,
    currency: 'USD',
    title,
    listingUrl: `https://shop${i}.example/p/${n++}`,
    stockText: 'In stock',
    availability: 'in_stock',
    deliveryInfo: null,
    condition: 'unknown',
    observedAt: null,
    ...over,
  }
}
/** Several listings from one named seller. */
const sameSeller = (name: string, prices: number[], title = 'Sony WH-1000XM5 Headphones') =>
  prices.map((p, k) => shop(p, title, 9000, { seller: name, sellerUrl: `https://${name}.example`, listingUrl: `https://${name}.example/p/${k}` }))

const six = (price: number) => Array.from({ length: 6 }, () => shop(price))
type Cmp = ReturnType<typeof buildComparison>
const all = (c: Cmp) => [...c.comparable, ...c.priceCheck]
const status = (c: Cmp, price: number) => all(c).find((a) => a.offer.price === price)!.priceSignal
const offersOf = (fx: { candidates: unknown[] }) => (fx.candidates as { offers: NormalizedOffer[] }[]).flatMap((c) => c.offers)

describe('anomaly rule and wording', () => {
  it('threshold is still 60% and the minimum is six independent sellers', () => {
    expect(ANOMALY_RATIO).toBe(0.6)
    expect(MIN_INDEPENDENT_SELLERS).toBe(6)
  })
  it('flags a price more than 40% below the median: visible, explained, and still eligible as the lowest reported offer', () => {
    const c = buildComparison(sony, [...Array.from({ length: 6 }, (_, k) => shop(250 + k * 10)), shop(99)], '2026-11-19T00:00:00Z')
    expect(c.priceCheck).toHaveLength(1)
    const sig = c.priceCheck[0].priceSignal
    expect(sig.status).toBe('unusually_low')
    if (sig.status !== 'unusually_low') throw new Error('unreachable')
    expect(sig.explanation).toMatch(/^Unusually low compared with other listings — \d+% below the median of \d+ independent sellers/)
    expect(sig.explanation).toMatch(/not evidence of a problem with the listing and not a guarantee of a good deal/)
    expect(sig.explanation).not.toMatch(/fraud|scam|suspicious/i)
    expect(sig.percentBelow).toBe(Math.round((1 - 99 / sig.baseline.median) * 100))
    expect(c.priceCheck[0].offer.price).toBe(99) // still listed
    // Flagged offers stay eligible: the lowest reported offer IS the flagged one, shown with a warning.
    expect(c.cheapest!.offer.offer.price).toBe(99)
    expect(c.cheapest!.flagged).toBe(true)
    expect(c.cheapest!.caveats.join(' ')).toMatch(/Unusually low compared with other listings/)
    // ...with the lowest unflagged offer as a secondary reference
    expect(c.lowestUnflagged!.offer.offer.price).toBe(250)
    expect(c.lowestUnflagged!.flagged).toBe(false)
  })
  it('exactly 60% is not flagged; just under is', () => {
    const base = Array.from({ length: 6 }, (_, k) => ({ id: `b${k}`, price: 100, confirmed: true, sellerKey: `s${k}` }))
    expect(assessPrices([...base, { id: 't', price: 60, confirmed: true, sellerKey: 't' }], 'USD').get('t')!.status).toBe('not_unusually_low')
    expect(assessPrices([...base, { id: 't', price: 59, confirmed: true, sellerKey: 't' }], 'USD').get('t')!.status).toBe('unusually_low')
  })
  it('an ordinary discount is not flagged', () => {
    expect(status(buildComparison(sony, [...six(250), shop(170)], null), 170).status).toBe('not_unusually_low')
  })
})

describe('independent sellers', () => {
  it('duplicate listings are merged and do not add observations', () => {
    const dup = shop(100)
    const c = buildComparison(sony, [dup, dup, dup, dup, dup, dup, ...Array.from({ length: 3 }, () => shop(300))], null)
    expect(c.stats.duplicatesRemoved).toBe(5)
    expect(all(c).every((a) => a.priceSignal.status === 'insufficient_evidence')).toBe(true) // only 4 sellers
  })
  it('many listings from one seller count once: that seller cannot set the baseline', () => {
    const offers = [...sameSeller('bargain-bin', [100, 100, 100, 100, 100, 100, 100, 100]), ...Array.from({ length: 5 }, () => shop(300))]
    const c = buildComparison(sony, offers, null)
    // Day 3 behaviour: the median of all 13 prices is 100, so nothing would be flagged.
    expect(median(offers.map((o) => o.price as number))).toBe(100)
    const sig = status(c, 100)
    expect(sig.status).toBe('unusually_low')
    if (sig.status === 'unusually_low') {
      expect(sig.baseline.independentSellers).toBe(6)
      expect(sig.baseline.median).toBe(300)
    }
  })
  it('fewer than six independent sellers: "insufficient evidence", never "normal"', () => {
    const offers = Array.from({ length: 5 }, (_, i) => sameSeller(`seller-${i}`, [200, 200, 200, 210])).flat() // 20 listings, 5 sellers
    offers.push(...sameSeller('seller-0', [20])) // a wild low price from one of them
    const c = buildComparison(sony, offers, null)
    expect(c.priceCheck).toHaveLength(0)
    for (const a of all(c)) {
      expect(a.priceSignal.status).toBe('insufficient_evidence')
      expect(a.priceSignal.status).not.toBe('not_unusually_low')
    }
    const sig = status(c, 20)
    expect(sig.explanation).toMatch(/Insufficient evidence/)
    expect(sig.explanation).toMatch(/only 5 independent sellers/)
    expect(c.comparable.find((a) => a.offer.price === 20)).toBeTruthy() // still visible
    expect(c.cheapest!.offer.offer.price).toBe(20)
    expect(c.cheapest!.flagged).toBe(false) // insufficient evidence is not a flag...
    expect(c.lowestUnflagged).toBeNull()
    expect(c.cheapest!.caveats.join(' ')).toMatch(/Too few independent sellers/) // ...and is worded differently
    expect(c.cheapest!.caveats.join(' ')).not.toMatch(/Unusually low/)
  })
  it('marketplace listings with a named seller are independent; with no seller name they are not counted', () => {
    const ebayNamed = Array.from({ length: 6 }, (_, i) =>
      shop(300, 'Sony WH-1000XM5 Headphones', 100 + i, { seller: `eBay - user${i}`, sellerUrl: 'https://www.ebay.com', listingUrl: `https://www.ebay.com/itm/${i}` }),
    )
    expect(status(buildComparison(sony, ebayNamed, null), 300).status).toBe('not_unusually_low') // 6 distinct eBay sellers
    const ebayAnonymous = Array.from({ length: 6 }, (_, i) =>
      shop(300, 'Sony WH-1000XM5 Headphones', 200 + i, { seller: 'eBay', sellerUrl: 'https://www.ebay.com', listingUrl: `https://www.ebay.com/itm/9${i}` }),
    )
    expect(all(buildComparison(sony, ebayAnonymous, null))[0].priceSignal.status).toBe('insufficient_evidence') // six listings, zero identifiable sellers
  })
  it('sellerKey: marketplace seller names separate sellers; the same retailer at two listings is one key', () => {
    const k = (seller: string, url: string) => sellerKey(identifySeller(shop(1, 't', 1, { seller, sellerUrl: null, listingUrl: url })))
    expect(k('eBay - alice', 'https://www.ebay.com/itm/1')).not.toBe(k('eBay - bob', 'https://www.ebay.com/itm/2'))
    expect(k('eBay - alice', 'https://www.ebay.com/itm/1')).toBe(k('eBay - alice', 'https://www.ebay.com/itm/3'))
    expect(k('eBay', 'https://www.ebay.com/itm/1')).toBeNull()
    expect(k('Bulk Devices', 'https://bulkdevices.com/a')).toBe(k('Bulk Devices', 'https://bulkdevices.com/b'))
    expect(k('Walmart - Third', 'https://www.walmart.com/ip/x?selectedSellerId=5')).not.toBe(k('Walmart', 'https://www.walmart.com/ip/x?selectedSellerId=0'))
  })
})

describe('baseline contains only the same product, variant and condition', () => {
  it('different capacities and heatsink versions do not enter a 2TB baseline', () => {
    const two = (p: number) => shop(p, 'Samsung 990 PRO 2TB NVMe SSD without heatsink')
    const offers = [
      ...Array.from({ length: 6 }, () => two(500)),
      ...Array.from({ length: 10 }, () => shop(900, 'Samsung 990 PRO 4TB NVMe SSD')),
      ...Array.from({ length: 10 }, () => shop(250, 'Samsung 990 PRO 1TB NVMe SSD')),
      ...Array.from({ length: 10 }, () => shop(560, 'Samsung 990 PRO 2TB NVMe SSD with heatsink')),
      two(260),
    ]
    const c = buildComparison(sam('2TB', 'without'), offers, null)
    const sig = status(c, 260)
    expect(sig.status).toBe('unusually_low')
    if (sig.status === 'unusually_low') expect(sig.baseline.median).toBe(500) // not dragged by 4TB / 1TB / heatsink offers
    expect(c.stats.matching).toBe(7)
  })
  it('used, refurbished and open-box offers are excluded; unknown condition is kept and never turned into "new"', () => {
    const offers = [...Array.from({ length: 8 }, () => shop(80, 'Refurbished Sony WH-1000XM5 Headphones')), ...six(250)]
    const c = buildComparison(sony, offers, null)
    expect(c.secondHand).toHaveLength(8)
    expect(c.priceCheck).toHaveLength(0)
    expect(c.comparable).toHaveLength(6)
    for (const a of c.comparable) expect(a.condition).toEqual({ value: 'unknown', evidence: null })
    for (const a of c.secondHand) expect(a.priceSignal.status).toBe('not_assessed')
  })
  it('prices in different currencies are not mixed', () => {
    const c = buildComparison(sony, [...six(250), shop(5, 'Sony WH-1000XM5', 77, { currency: 'EUR' })], null)
    expect(c.comparable.find((a) => a.offer.currency === 'EUR')!.priceSignal.status).toBe('not_assessed')
    expect(c.priceCheck).toHaveLength(0)
  })
  it('"likely" matches join the baseline only when confirmed matches alone are too few, and the explanation says so', () => {
    const likely = (p: number) => shop(p, 'Samsung 990 PRO 2TB NVMe SSD') // heatsink not stated -> LIKELY
    const exact = (p: number) => shop(p, 'Samsung 990 PRO 2TB NVMe SSD without heatsink')
    const mixed = buildComparison(sam(), [exact(500), exact(500), exact(500), likely(500), likely(500), likely(500), likely(250)], null)
    const sig = status(mixed, 250)
    expect(sig.status).toBe('unusually_low')
    if (sig.status === 'unusually_low') {
      expect(sig.baseline.basis).toBe('includes_likely')
      expect(sig.explanation).toMatch(/likely, not confirmed/)
    }
    const confirmed = buildComparison(sam(), [...Array.from({ length: 6 }, () => exact(500)), likely(250)], null)
    const sig2 = status(confirmed, 250)
    expect(sig2.status).toBe('unusually_low')
    if (sig2.status === 'unusually_low') expect(sig2.baseline.basis).toBe('confirmed_only')
  })
})

describe('extreme outliers', () => {
  it('one absurdly high and one absurdly low price barely move the median; only the low one is flagged', () => {
    const c = buildComparison(sony, [...Array.from({ length: 7 }, (_, k) => shop(240 + k * 5)), shop(9999), shop(1)], null)
    expect(status(c, 1).status).toBe('unusually_low')
    expect(status(c, 9999).status).toBe('not_unusually_low') // high prices are not flagged
    const sig = status(c, 1)
    if (sig.status === 'unusually_low') expect(sig.baseline.median).toBeLessThan(270)
  })
})

describe('product match and price verification are separate', () => {
  it('every offer is API-reported / not independently verified, whatever its match class or price signal', () => {
    // the heatsink variant is used for Samsung because it has confirmed (EXACT) matches
    for (const [fx, t] of [[sonyFx, sony], [logiFx, logi], [samsungFx, sam('2TB', 'with')]] as const) {
      const c = buildComparison(t, offersOf(fx), fx.source.scrapedAt)
      const analysed = [c.comparable, c.priceCheck, c.ambiguous, c.secondHand, c.rejected, ...c.differentVariants.map((v) => v.offers)].flat()
      expect(analysed.length).toBeGreaterThan(0)
      for (const a of analysed) expect(a.priceVerification).toBe('api_reported_not_verified')
      expect(analysed.some((a) => a.match.class === 'EXACT' && a.priceSignal.status === 'not_unusually_low')).toBe(true)
    }
  })
  it('a "new" condition only ever comes with title evidence, in every real fixture', () => {
    for (const [fx, t] of [[sonyFx, sony], [logiFx, logi], [samsungFx, sam()]] as const) {
      const c = buildComparison(t, offersOf(fx), fx.source.scrapedAt)
      const analysed = [c.comparable, c.priceCheck, c.ambiguous, c.secondHand, c.rejected, ...c.differentVariants.map((v) => v.offers)].flat()
      for (const a of analysed) if (a.condition.value === 'new') expect(a.condition.evidence).toMatch(/Title says/)
      expect(analysed.some((a) => a.condition.value === 'unknown')).toBe(true)
    }
  })
})

describe('real fixtures: before (Day 3 rule) vs after (independent-seller baseline)', () => {
  /** The Day 3 rule, reproduced for comparison: median over every matching listing, n >= 6. */
  function dayThree(c: Cmp) {
    const pool = all(c)
    const prices = pool.map((a) => a.offer.price as number)
    const med = median(prices)
    return { med, flagged: new Set(pool.filter((a) => prices.length >= 6 && (a.offer.price as number) / med < 0.6).map((a) => `${a.offer.price}|${a.offer.seller}`)) }
  }
  const keys = (c: Cmp) => new Set(c.priceCheck.map((a) => `${a.offer.price}|${a.offer.seller}`))

  it('Sony: the $169.99 Best Buy listing sits on the 60% line: 60.4% of the Day 3 median, 58.0% of the independent-seller median', () => {
    const c = buildComparison(sony, offersOf(sonyFx), sonyFx.source.scrapedAt)
    const before = dayThree(c)
    const bb = all(c).find((a) => a.offer.seller === 'Best Buy' && a.offer.price === 169.99)!
    expect(169.99 / before.med).toBeGreaterThan(0.6) // Day 3: not flagged
    expect(before.flagged.has('169.99|Best Buy')).toBe(false)
    const sig = bb.priceSignal
    expect(sig.status).toBe('unusually_low') // now flagged, still visible, worded as an anomaly
    if (sig.status === 'unusually_low') {
      expect(sig.ratio).toBeGreaterThan(0.57)
      expect(sig.ratio).toBeLessThan(0.6)
      expect(sig.baseline.independentSellers).toBeGreaterThanOrEqual(30)
      expect(sig.explanation).toMatch(/rule-of-thumb comparison/)
    }
    expect(bb.match.class).toBe('EXACT')
    expect(c.priceCheck).toContain(bb)
    const added = [...keys(c)].filter((k) => !before.flagged.has(k)).sort()
    expect(added).toEqual(['169.99|Best Buy', '169.99|TikTok Shop', '170|mercari.com'])
    expect([...before.flagged].every((k) => keys(c).has(k))).toBe(true) // nothing previously flagged was dropped
    expect(c.stats.afterDedup).toBe(c.comparable.length + c.priceCheck.length + c.ambiguous.length + c.secondHand.length + c.rejected.length)
  })

  it('Sony: flagged offers are eligible for the lowest reported offer; the lowest unflagged offer is shown for reference', () => {
    const c = buildComparison(sony, offersOf(sonyFx), sonyFx.source.scrapedAt)
    const inStock = [...c.comparable, ...c.priceCheck].filter((a) => a.availability === 'in_stock')
    const lowest = Math.min(...inStock.map((a) => a.offer.price as number))
    expect(c.cheapest!.offer.offer.price).toBe(lowest) // 115, a flagged Reverb listing
    expect(c.cheapest!.flagged).toBe(true)
    expect(c.cheapest!.caveats.join(' ')).toMatch(/Unusually low compared with other listings/)
    const unflaggedLowest = Math.min(...inStock.filter((a) => a.priceSignal.status !== 'unusually_low').map((a) => a.offer.price as number))
    expect(c.lowestUnflagged!.offer.offer.price).toBe(unflaggedLowest)
    expect(c.lowestUnflagged!.offer.priceSignal.status).not.toBe('unusually_low')
    // the Best Buy $169.99 listing is flagged but is eligible (it is in the pool the lowest offer is chosen from)
    expect(inStock.some((a) => a.offer.seller === 'Best Buy' && a.offer.price === 169.99)).toBe(true)
  })

  it('flagging does not change the independent-seller median (same baseline, same numbers)', () => {
    const c = buildComparison(sony, offersOf(sonyFx), sonyFx.source.scrapedAt)
    const sig = all(c).find((a) => a.offer.seller === 'Best Buy' && a.offer.price === 169.99)!.priceSignal
    expect(sig.status).toBe('unusually_low')
    if (sig.status === 'unusually_low') {
      expect(sig.baseline.median).toBeCloseTo(292.915, 3)
      expect(sig.baseline.independentSellers).toBe(38)
    }
  })

  it('exclusions still apply: other variants, second-hand, ambiguous, out-of-stock and backordered listings never become the lowest reported offer', () => {
    const offers = [
      ...six(250),
      shop(50, 'Samsung 990 PRO 4TB'), // different product for Sony: rejected
      shop(60, 'Refurbished Sony WH-1000XM5 Headphones'),
      shop(70, 'Sony Wireless Noise Cancelling Headphones'), // ambiguous
      shop(80, 'Sony WH-1000XM5 Headphones', n++, { availability: 'out_of_stock', stockText: 'Out of stock' }),
      shop(90, 'Sony WH-1000XM5 Headphones', n++, { availability: 'backorder', stockText: 'Backordered' }),
      shop(95, 'Sony WH-1000XM5 Headphones', n++, { availability: 'unknown', stockText: null }),
    ]
    const c = buildComparison(sony, offers, null)
    expect(c.cheapest!.offer.offer.price).toBe(250)
    // and Samsung variants: a cheaper 4TB or heatsink listing never wins for the 2TB-without-heatsink target
    const sm = buildComparison(sam('2TB', 'without'), [...Array.from({ length: 6 }, () => shop(500, 'Samsung 990 PRO 2TB without heatsink')), shop(100, 'Samsung 990 PRO 4TB'), shop(120, 'Samsung 990 PRO 2TB with heatsink')], null)
    expect(sm.cheapest!.offer.offer.price).toBe(500)
  })

  it('Logitech: duplicates and repeats collapse to a small seller baseline; the $65 Mercari listing is no longer flagged, the $59.99 one still is', () => {
    const c = buildComparison(logi, offersOf(logiFx), logiFx.source.scrapedAt)
    expect(dayThree(c).flagged.has('65|Mercari')).toBe(true)
    expect(keys(c).has('65|Mercari')).toBe(false)
    expect(keys(c).has('59.99|AZ Discount USA')).toBe(true)
    expect(all(c).find((a) => a.offer.price === 65 && a.offer.seller === 'Mercari')!.priceSignal.status).toBe('not_unusually_low')
    const sig = status(c, 59.99)
    expect(sig.status).toBe('unusually_low')
    if (sig.status === 'unusually_low') expect(sig.baseline.independentSellers).toBeLessThan(all(c).length / 3)
  })

  it('Samsung 2TB: same single flag as before, now with a baseline that says it includes "likely" matches', () => {
    const c = buildComparison(sam(), offersOf(samsungFx), samsungFx.source.scrapedAt)
    expect([...keys(c)]).toEqual([...dayThree(c).flagged])
    const sig = status(c, 279.99)
    expect(sig.status).toBe('unusually_low')
    if (sig.status === 'unusually_low') {
      expect(sig.baseline.basis).toBe('includes_likely')
      expect(sig.baseline.independentSellers).toBeGreaterThanOrEqual(6)
    }
  })

  it('Samsung 2TB with heatsink: same four flags as before, from a confirmed-matches-only baseline', () => {
    const c = buildComparison(sam('2TB', 'with'), offersOf(samsungFx), samsungFx.source.scrapedAt)
    expect([...keys(c)].sort()).toEqual([...dayThree(c).flagged].sort())
    expect(c.priceCheck).toHaveLength(4)
    const sig = c.priceCheck[0].priceSignal
    expect(sig.status).toBe('unusually_low')
    if (sig.status === 'unusually_low') expect(sig.baseline.basis).toBe('confirmed_only')
  })

  it('a product with too few independent sellers gets "insufficient evidence", not a clean bill', () => {
    const offers = offersOf(samsungFx).filter((o) => /4 ?tb/i.test(o.title ?? ''))
    const c = buildComparison(sam('4TB', 'without'), offers, samsungFx.source.scrapedAt)
    const assessed = all(c)
    expect(assessed.length).toBeGreaterThan(0)
    expect(assessed.every((a) => a.priceSignal.status === 'insufficient_evidence')).toBe(true)
  })
})

describe('filtering summary is generated from the real counts', () => {
  it('matches the classification result for each fixture', () => {
    for (const [fx, q] of [[sonyFx, 'Sony WH-1000XM5'], [logiFx, 'Logitech MX Master 3S'], [samsungFx, 'Samsung 990 PRO 2TB']] as const) {
      const c = buildComparison(detectTarget(q)!, offersOf(fx), fx.source.scrapedAt)
      expect(c.filterSummary).toContain(`We found ${c.stats.total} listings`)
      expect(c.filterSummary).toContain(`${c.stats.matching} entered this comparison`)
      expect(c.filterSummary).toMatch(/does not guarantee that condition, seller or checkout cost are equivalent/)
      const variants = c.differentVariants.reduce((k, v) => k + v.offers.length, 0)
      if (variants) expect(c.filterSummary).toContain(`${variants} ${variants === 1 ? 'is a different variant' : 'are different variants'}`)
      if (c.rejected.length) expect(c.filterSummary).toContain(String(c.rejected.length))
    }
  })
  it('changes with the data and omits empty categories', () => {
    const base = { total: 10, duplicates: 0, comparable: 4, priceCheck: 0, variants: 0, rejected: 0, ambiguous: 0, secondHand: 0 }
    expect(summarizeFiltering(base)).toMatch(/^We found 10 listings, and 4 entered/)
    expect(summarizeFiltering(base)).not.toMatch(/rest were set aside/)
    const s = summarizeFiltering({ ...base, total: 25, duplicates: 3, comparable: 9, priceCheck: 2, variants: 5, rejected: 1, ambiguous: 2, secondHand: 1 })
    expect(s).toContain('We found 25 listings (3 identical duplicates merged)')
    expect(s).toContain('11 entered this comparison')
    expect(s).toContain('2 of them flagged')
    expect(s).toContain('5 are different variants')
    expect(s).toContain('1 is a different product or accessory')
    expect(s).toContain('2 have too little information')
    expect(s).toContain('1 is used, refurbished or open-box')
  })
})
