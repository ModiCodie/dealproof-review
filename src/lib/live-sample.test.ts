/**
 * Offline sanity check over the one real PricesAPI response captured by
 * tests/live-validation.spec.ts. The raw file is gitignored, so on any machine
 * without it the glob is empty and this test skips. No network request is made.
 */
import { describe, expect, it } from 'vitest'
import { viewCandidates, targetForCandidate } from './candidates'
import { buildComparison } from './matching'

const raw = import.meta.glob('/experiments/price-api/out/live-validation-response.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const file = Object.values(raw)[0]

describe.skipIf(!file)('real AirPods Pro 2 response (offline)', () => {
  it('never fabricates certainty: no title-only EXACT, and every group is judged against the search text', () => {
    const d = JSON.parse(file).data.result
    const views = viewCandidates(d.query, d.candidates)
    expect(views.length).toBeGreaterThan(0)
    const offers = d.candidates.flatMap((c: { offers: unknown[] }) => c.offers)
    const { target } = targetForCandidate(d.query, d.candidates[0], offers.map((o: { title: string | null }) => o.title))
    const c = buildComparison(target, offers, d.source.scrapedAt)
    // "Apple AirPods Pro 2" has no model code, so nothing may be called an exact match
    expect([...c.comparable, ...c.priceCheck, ...c.ambiguous].some((a) => a.match.class === 'EXACT')).toBe(false)
    expect(c.stats.total).toBe(offers.length)
  })
})
