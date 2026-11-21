import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import samsung from '../../../tests/fixtures/real-samsung.normalized.json'
import sony from '../../../tests/fixtures/real-sony.normalized.json'
import { ComparisonView } from './ComparisonView'
import { detectTarget } from '@/lib/matching'
import type { NormalizedOffer } from '@/lib/pricing-types'

const offersOf = (fx: { candidates: unknown[] }) => (fx.candidates as { offers: NormalizedOffer[] }[]).flatMap((c) => c.offers)
const render = (fx: typeof samsung, q: string) =>
  renderToStaticMarkup(<ComparisonView offers={offersOf(fx)} scrapedAt={fx.source.scrapedAt} initialTarget={detectTarget(q)!} />)

const samsungHtml = render(samsung, 'Samsung 990 PRO 2TB')
const sonyHtml = render(sony as never, 'Sony WH-1000XM5')

describe('ComparisonView (rendered from real fixtures)', () => {
  it('separates product match, purchase details and price for each offer', () => {
    for (const label of ['Product match', 'Purchase details', 'Price verification: Not independently verified (API-reported price)', 'Source observation:', 'Listed price', 'Condition: Condition unknown', 'Shipping: Not provided']) {
      expect(samsungHtml).toContain(label)
    }
    expect(samsungHtml).toContain('Likely the same, some details missing')
    expect(sonyHtml).toContain('Same model and variant')
    expect(samsungHtml).toContain('Different variant')
    expect(samsungHtml).toContain('Availability: Backordered')
  })
  it('uses plain language, never internal enum names', () => {
    for (const html of [samsungHtml, sonyHtml]) {
      expect(html).not.toMatch(/DIFFERENT_VARIANT|AMBIGUOUS|REJECTED|\bEXACT\b|api_reported_not_verified|not_unusually_low/)
    }
  })
  it('the cheapest summary does not overstate confidence', () => {
    for (const html of [samsungHtml, sonyHtml]) {
      expect(html).toContain('Lowest reported matching offer')
      expect(html).toContain('Not independently verified (feed-reported)')
      expect(html).toContain('Final checkout cost may differ.')
      expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/\b(best deal|great deal|guaranteed lowest|verified cheapest|verified lowest|verified price|suspicious|scam|fraud)/i)
    }
  })
  it('explains the filtering from the real counts and says matching is not equivalence', () => {
    expect(samsungHtml).toContain('data-testid="filter-summary"')
    expect(samsungHtml).toContain('We found 118 listings')
    expect(samsungHtml).toContain('entered this comparison')
    expect(samsungHtml).toContain('does not guarantee that condition, seller or checkout cost are equivalent')
    expect(sonyHtml).toContain('We found 69 listings')
  })
  it('a flagged lowest offer carries a visible warning; flags use neutral wording and explain the 60% rule', () => {
    expect(sonyHtml).toContain('data-testid="cheapest-flag"')
    expect(sonyHtml).toContain('data-testid="lowest-unflagged"')
    expect(sonyHtml).toMatch(/Unusually low compared with other listings — \d+% below the median of \d+ independent sellers/)
    expect(sonyHtml).toContain('not evidence of a problem with the listing and not a guarantee of a good deal')
    expect(sonyHtml).toContain('rule of thumb based on other listings')
    // The group is titled "Unusually low prices"; the full neutral explanation stays one tap away ("Why this is flagged").
    expect(sonyHtml).toMatch(/<summary[^>]*><span[^>]*>Unusually low prices/)
    expect(sonyHtml).toContain('Why this is flagged')
  })

  const headline = (html: string) => html.slice(html.indexOf('data-testid="cheapest"'), html.indexOf('data-testid="filter-summary"'))

  it('a LIKELY match that sets the headline price is labelled as not confirmed, never as exact', () => {
    const h = headline(samsungHtml)
    expect(h).toContain('Likely the same, some details missing')
    expect(h).toContain('Not confirmed as the exact variant')
    expect(h).not.toContain('Same model and variant')
    // the reference offer is also a likely match and says so
    expect(h).toContain('likely match, not confirmed')
  })

  it('an exact headline match does not claim uncertainty', () => {
    const h = headline(sonyHtml)
    expect(h).toContain('Same model and variant')
    expect(h).not.toContain('Not confirmed as the exact variant')
  })

  it('the headline shows condition, availability, shipping, observation time and the retailer link', () => {
    for (const html of [samsungHtml, sonyHtml]) {
      const h = headline(html)
      for (const label of ['Condition', 'Availability', 'Shipping', 'Price observed', 'Price checked']) expect(h).toContain(label)
      expect(h).toMatch(/data-testid="cheapest-link"/)
      expect(h).toContain('target="_blank"')
      expect(h).toContain('noopener noreferrer')
    }
  })

  it('renders the actions slot and can lock the variant for a saved product', () => {
    const t = detectTarget('Samsung 990 PRO 2TB')!
    const html = renderToStaticMarkup(
      <ComparisonView
        offers={offersOf(samsung)}
        scrapedAt={samsung.source.scrapedAt}
        initialTarget={t}
        lockVariant
        renderActions={(x) => <button data-testid="slot">{x.family}</button>}
      />,
    )
    expect(html).toContain('data-testid="slot"')
    expect(html).not.toContain('data-testid="variant-capacity"')
    expect(html).toContain('one exact variant')
  })
})
