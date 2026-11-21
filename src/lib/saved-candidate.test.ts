/**
 * Saved generic comparisons keep the product group that was picked, so reopening and
 * refreshing compare the same product. Invented groups/offers only (no real data).
 */
import { describe, expect, it } from 'vitest'
import airpods from '../../tests/fixtures/synthetic/airpods.json'
import sony from '../../tests/fixtures/real-sony.normalized.json'
import type { NormalizedOffer, ProductCandidate } from './pricing-types'
import { targetForCandidate, offersForView, viewCandidates } from './candidates'
import { buildComparison } from './matching'
import { parseSaved, savedOffers, toSavedRow, productKey } from './saved'
import { candidateRef, resolveCandidate } from './saved-candidate'

const base = (airpods as unknown as { candidates: ProductCandidate[] }).candidates[0]
const offers = (prefix: string, n: number, price: number): NormalizedOffer[] =>
  Array.from({ length: n }, (_, i) => ({ ...base.offers[i % base.offers.length], seller: `${prefix} ${i}`, sellerUrl: `https://${prefix}${i}.example/`, listingUrl: `https://${prefix}${i}.example/p`, price: price + i, title: `Apple AirPods Pro 2nd Generation New ${prefix}${i}`, condition: 'unknown' } as NormalizedOffer))
const group = (pid: number, title: string, o: NormalizedOffer[]): ProductCandidate => ({ ...base, pid, productRef: { id: String(pid), idType: 'pricesapi', market: 'us' }, catalogId: `cat${pid}`, clusterId: `clu${pid}`, title, offerCount: o.length, offers: o })

// two groups with similar titles and different listings
const A = group(1001, 'Apple AirPods Pro 2nd Generation Wireless Earbuds', offers('alpha', 4, 150))
const B = group(1002, 'Apple AirPods Pro 2nd Generation Wireless Earbuds with MagSafe Case', offers('beta', 4, 220))
const QUERY = 'Apple AirPods Pro 2'
const SCRAPED = '2026-11-21T15:00:00.000Z'

/** What the app does at save time for a pick, and at reopen time from a stored result. */
function saveAs(pick: ProductCandidate, result: ProductCandidate[], chosen: Record<string, string> = {}) {
  const { target } = targetForCandidate(QUERY, pick, pick.offers.map((o) => o.title))
  const t = { ...target, variant: { ...target.variant, ...chosen } }
  const row = toSavedRow(t, QUERY, pick)
  const saved = parseSaved({ recordId: 'r1', createdAt: SCRAPED, data: { ...row, userId: 'u1' } })!
  const live = buildComparison(t, pick.offers, SCRAPED)
  const reopened = (cands: ProductCandidate[]) => {
    const s = savedOffers(saved, cands)
    return { ...s, comparison: buildComparison(saved.target, s.offers, SCRAPED) }
  }
  return { row, saved, live, reopened, result }
}
const titles = (c: ReturnType<typeof buildComparison>) => [...c.comparable, ...c.priceCheck, ...c.unknownCondition, ...c.ambiguous, ...c.secondHand, ...c.defective, ...c.needsConfig, ...c.rejected].map((a) => a.offer.title)

describe('what is saved', () => {
  it('records the query, the picked group ids + title, and the selected variant', () => {
    const { row, saved } = saveAs(A, [A, B], { connector: 'USB-C' })
    expect(row.query).toBe(QUERY)
    expect(row.variant).toMatchObject({ cp: '1001', cc: 'cat1001', cl: 'clu1001', t: expect.any(String), dim_connector: 'USB-C' })
    expect(saved.candidate).toEqual({ pid: '1001', catalogId: 'cat1001', clusterId: 'clu1001', title: A.title })
    expect(saved.target.family === 'generic' && saved.target.variant.connector).toBe('USB-C')
  })
  it('does not use the position in the result list', () => {
    const { row } = saveAs(A, [A, B])
    expect(JSON.stringify(row)).not.toMatch(/"index"|"pos"/)
  })
  it('rejects a row whose identifier is malformed instead of guessing', () => {
    const { row } = saveAs(A, [A, B])
    expect(parseSaved({ recordId: 'r', createdAt: SCRAPED, data: { ...row, variant: { ...row.variant, cp: 12345 as unknown as string } } as never })).toBeNull()
    expect(parseSaved({ recordId: 'r', createdAt: SCRAPED, data: { ...row, variant: { ...row.variant, cc: 'x'.repeat(200) } } as never })).toBeNull()
  })
})

describe('reopening a saved candidate (A) never shows candidate B', () => {
  it('compares only group A, with the same results as at save time', () => {
    const { live, reopened } = saveAs(A, [A, B])
    const r = reopened([A, B])
    expect(r.resolution).toMatchObject({ status: 'matched', basis: 'ids_and_title' })
    expect(r.offers).toEqual(A.offers)
    expect(titles(r.comparison).some((t) => /beta/.test(t ?? ''))).toBe(false)
    // nothing about the price summary changes just by reopening
    expect(r.comparison.priceSummary).toEqual(live.priceSummary)
    expect(r.comparison.cheapest?.offer.offer.price).toBe(live.cheapest?.offer.offer.price)
    expect(r.comparison.stats).toEqual(live.stats)
  })
  it('saving B instead gives B only', () => {
    const r = saveAs(B, [A, B]).reopened([A, B])
    expect(r.offers).toEqual(B.offers)
  })
  it('keeps the selected variant unchanged on reopen', () => {
    const s = saveAs(A, [A, B], { connector: 'USB-C' })
    expect(s.reopened([A, B]).comparison.target.family === 'generic' && (s.reopened([A, B]).comparison.target as { variant: Record<string, string> }).variant.connector).toBe('USB-C')
  })
})

describe('refreshing (a new result for the same query)', () => {
  it('survives a change in candidate ordering', () => {
    const s = saveAs(A, [A, B])
    const r = s.reopened([B, A])
    expect(r.resolution).toMatchObject({ status: 'matched', indices: [1] })
    expect(r.offers).toEqual(A.offers)
  })
  it('picks up refreshed prices for the same group', () => {
    const s = saveAs(A, [A, B])
    const refreshed = group(1001, A.title!, offers('alpha', 4, 120))
    const r = s.reopened([B, refreshed])
    expect(r.offers).toEqual(refreshed.offers)
    expect(r.offers).not.toEqual(A.offers)
  })
  it('does not switch when the saved group disappears', () => {
    const s = saveAs(A, [A, B])
    const r = s.reopened([B])
    expect(r.resolution).toEqual({ status: 'unresolved', reason: 'missing' })
    expect(r.offers).toEqual([])
  })
  it('does not switch to a different group with a similar title', () => {
    const s = saveAs(A, [A, B])
    const lookalike = group(2001, 'Apple AirPods Pro 2nd Generation Wireless Earbuds Lightning', offers('gamma', 3, 100))
    const r = s.reopened([lookalike, B])
    expect(r.resolution).toMatchObject({ status: 'unresolved' })
    expect(r.offers).toEqual([])
  })
  it('does not trust the same title with different provider ids', () => {
    const s = saveAs(A, [A, B])
    const clone = { ...group(3001, A.title!, offers('delta', 3, 100)), catalogId: 'other', clusterId: 'other' }
    const r = s.reopened([clone])
    expect(r.resolution).toEqual({ status: 'unresolved', reason: 'ids_changed' })
    expect(r.offers).toEqual([])
  })
  it('ignores a same-id group with no offers', () => {
    const s = saveAs(A, [A, B])
    expect(s.reopened([{ ...A, offers: [], offerCount: 0 }, B]).resolution).toMatchObject({ status: 'unresolved' })
  })
})

describe('older saved records', () => {
  const legacy = (cands: ProductCandidate[]) => {
    const { row } = saveAs(A, [A, B])
    const variant = Object.fromEntries(Object.entries(row.variant).filter(([k]) => !['cp', 'cc', 'cl'].includes(k)))
    const saved = parseSaved({ recordId: 'old', createdAt: SCRAPED, data: { ...row, variant, userId: 'u1' } })!
    return { saved, ...savedOffers(saved, cands) }
  }
  it('still parse, with no provider ids', () => {
    expect(legacy([A, B]).saved.candidate).toEqual({ pid: null, catalogId: null, clusterId: null, title: A.title })
  })
  it('are matched by exact title only, and flagged as such, never pooled', () => {
    const r = legacy([B, A])
    expect(r.resolution).toMatchObject({ status: 'matched', basis: 'title_only' })
    expect(r.offers).toEqual(A.offers)
  })
  it('show a limitation, not unrelated offers, when no group has that title', () => {
    const r = legacy([B])
    expect(r.resolution).toEqual({ status: 'unresolved', reason: 'legacy' })
    expect(r.offers).toEqual([])
  })
})

describe('specialised families are unchanged', () => {
  it('Sony saved rows have no candidate and still pool every group', () => {
    const cands = (sony as unknown as { candidates: ProductCandidate[] }).candidates
    const row = toSavedRow({ family: 'sony-wh-1000xm5', variant: {} } as never, 'Sony WH-1000XM5')
    const saved = parseSaved({ recordId: 's', createdAt: SCRAPED, data: { ...row, userId: 'u1' } })
    expect(saved?.candidate).toBeNull()
    const s = savedOffers(saved!, cands)
    expect(s.resolution).toBeNull()
    expect(s.offers).toHaveLength(cands.flatMap((c) => c.offers).length)
    expect(productKey(saved!.target)).toBe(saved!.productKey)
  })
})

describe('resolveCandidate basics', () => {
  it('merges identical-title groups that carry the saved id, like the picker does', () => {
    const dup = { ...A, pid: 1009 }
    const r = resolveCandidate(candidateRef(A), [A, dup])
    expect(r).toMatchObject({ status: 'matched', indices: [0, 1] }) // both carry the saved catalog/cluster id and the same title
    expect(viewCandidates(QUERY, [A, dup])).toHaveLength(1)
    expect(offersForView(viewCandidates(QUERY, [A, B])[0], [A, B])).toEqual(A.offers)
  })
})
