/**
 * Candidate selection and saved-product persistence for general products:
 * a pick gives a stable target, switching it changes every result, products are
 * never mixed into one price summary, and a saved row rebuilds the same target.
 */
import { describe, expect, it } from 'vitest'
import airpods from '../../tests/fixtures/synthetic/airpods.json'
import ssd from '../../tests/fixtures/synthetic/ssd.json'
import type { NormalizedOffer, ProductCandidate } from './pricing-types'
import { targetForCandidate, viewCandidates } from './candidates'
import { buildComparison, detectTarget } from './matching'
import type { Comparison, ProductTarget } from './matching'
import { parseSaved, productKey, toSavedRow } from './saved'

const fx = (f: unknown) => (f as { candidates: ProductCandidate[]; source: { scrapedAt: string } })
const pool = (f: ReturnType<typeof fx>) => f.candidates.flatMap((c) => c.offers) as NormalizedOffer[]
const compare = (f: ReturnType<typeof fx>, query: string, pick: number) => {
  const offers = pool(f)
  const { target } = targetForCandidate(query, f.candidates[pick], offers.map((o) => o.title))
  return { target, cmp: buildComparison(target, offers, f.source.scrapedAt) }
}
const priced = (c: Comparison) => [...c.comparable, ...c.priceCheck, ...c.unknownCondition].map((a) => a.offer.title ?? '')

describe('selecting a candidate', () => {
  const A = fx(airpods)
  it('is deterministic: the same pick always gives the same target and results', () => {
    const a = compare(A, 'Apple AirPods Pro 2', 0)
    const b = compare(A, 'Apple AirPods Pro 2', 0)
    expect(a.target).toEqual(b.target)
    expect(a.cmp.cheapest?.offer.offer.price).toBe(b.cmp.cheapest?.offer.offer.price)
    expect(productKey(a.target)).toBe(productKey(b.target))
  })
  it('switching candidates re-derives the target and result groups; a pick the search rules out is flagged, not compared', () => {
    const views = viewCandidates('Apple AirPods Pro 2', A.candidates)
    expect(views.map((v) => v.fit)).toEqual(['fits', 'different', 'different'])
    const second = compare(A, 'Apple AirPods Pro 2', 0)
    const first = compare(A, 'Apple AirPods Pro 2', 1)
    expect(productKey(second.target)).not.toBe(productKey(first.target))
    // with a search that names the 1st generation, that group becomes the product and the results change
    const g1 = compare(A, 'Apple AirPods Pro 1st generation', 1)
    expect(priced(g1.cmp).length).toBeGreaterThan(0)
    expect(priced(g1.cmp)).not.toEqual(priced(second.cmp))
    expect(priced(g1.cmp).every((t) => /1st/i.test(t))).toBe(true)
  })
  it('never puts different products into one price summary', () => {
    const { cmp } = compare(A, 'Apple AirPods Pro 2', 0)
    const titles = priced(cmp)
    expect(titles.length).toBeGreaterThan(5)
    for (const t of titles) {
      expect(t).not.toMatch(/1st gen|AirPods Max|3rd gen|2-?pack|Case Cover|Ear Tips|Limited Edition/i)
      expect(t).toMatch(/Pro/i)
    }
    // the 1st-generation prices are outside the baseline: the median comes from 2nd-generation sellers only
    const sig = cmp.priceCheck[0].priceSignal
    if (sig.status === 'unusually_low') expect(sig.baseline.median).toBeGreaterThan(195)
  })
  it('a search that disagrees with the picked group is compared by the search text, not the pick', () => {
    // searching for the 2nd generation but picking the 1st-generation group: 1st-generation listings are not "the product"
    const { cmp } = compare(A, 'Apple AirPods Pro 2', 1)
    expect(cmp.comparable.every((a) => !/1st/i.test(a.offer.title ?? ''))).toBe(true)
  })
})

describe('saving, reopening and refreshing a general product', () => {
  const S = fx(ssd)
  const rebuild = (target: ProductTarget) => {
    const row = toSavedRow(target, 'WD Black SN850X 2TB')
    return parseSaved({ recordId: 'r', createdAt: '2026-11-21T10:00:00Z', data: { ...row, userId: 'u' } })!
  }
  it('rebuilds the same target, product key and results from the stored row', () => {
    const { target, cmp } = compare(S, 'WD Black SN850X 2TB', 0)
    const saved = rebuild(target)
    expect(saved.target).toEqual(target)
    expect(saved.productKey).toBe(productKey(target))
    const again = buildComparison(saved.target, pool(S), S.source.scrapedAt)
    expect(priced(again)).toEqual(priced(cmp))
    expect(again.cheapest?.offer.offer.price).toBe(cmp.cheapest?.offer.offer.price)
  })
  it('keeps the saved variant when a refresh brings different listings', () => {
    const { target } = compare(S, 'WD Black SN850X 2TB', 0)
    const saved = rebuild(target)
    const refreshed = pool(S).filter((o) => !/1TB|4TB/.test(o.title ?? '')) // a later fetch that no longer lists other sizes
    const cmp = buildComparison(saved.target, refreshed, S.source.scrapedAt)
    expect(saved.target.variant).toMatchObject({ storage: '2TB' })
    expect(priced(cmp).every((t) => !/1TB|4TB/.test(t))).toBe(true)
  })
  it('a different variant of the same model is a different saved product', () => {
    const two = compare(S, 'WD Black SN850X 2TB', 0).target
    const one = compare(S, 'WD Black SN850X 1TB', 1).target
    expect(productKey(one)).not.toBe(productKey(two))
  })
  it('rows saved for Sony, Logitech and Samsung still rebuild exactly their featured targets', () => {
    for (const q of ['Sony WH-1000XM5', 'Logitech MX Master 3S', 'Samsung 990 PRO 4TB']) {
      const t = detectTarget(q)!
      const saved = rebuild(t)
      expect(saved.target).toEqual(t)
      expect(saved.target.family).not.toBe('generic')
    }
  })
})
