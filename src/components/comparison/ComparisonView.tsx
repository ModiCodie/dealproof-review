/**
 * Renders a Comparison (see src/lib/matching). Presentation only: every decision
 * shown here was made by the deterministic matching module, and each offer shows
 * the module's own plain-language explanation.
 *
 * Each offer is described along three independent dimensions, never merged:
 *   A. Product match    - does the listing refer to the chosen product and variant?
 *   B. Purchase details - condition, availability, seller, shipping (unknown stays unknown)
 *   C. Price            - API-reported, not independently verified; plus the anomaly signal
 * Wording rules: never call a price verified, never say "deal" / "best" /
 * "guaranteed" (no price history), and show "Not provided" for missing data.
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { NormalizedOffer } from '@/lib/pricing-types'
import { buildComparison, FAMILIES, targetLabel } from '@/lib/matching'
import type { Availability, Comparison, Condition, MatchClass, OfferAnalysis, ProductTarget } from '@/lib/matching'

const MATCH_LABEL: Record<MatchClass, string> = {
  EXACT: 'Same model and variant',
  LIKELY: 'Likely the same, some details missing',
  AMBIGUOUS: 'Cannot tell from the listing',
  DIFFERENT_VARIANT: 'Different variant',
  REJECTED: 'Different product',
}
const MATCH_STYLE: Record<MatchClass, string> = {
  EXACT: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  LIKELY: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  AMBIGUOUS: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  DIFFERENT_VARIANT: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  REJECTED: 'bg-muted text-muted-foreground',
}
const CONDITION_LABEL: Record<Condition, string> = {
  new: 'New (per title)',
  used: 'Used',
  refurbished: 'Refurbished',
  open_box: 'Open-box',
  unknown: 'Condition unknown',
}
const AVAILABILITY_LABEL: Record<Availability, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  backorder: 'Backordered',
  unknown: 'Availability unknown',
}

export function ComparisonView({
  offers,
  scrapedAt,
  initialTarget,
  renderActions,
  lockVariant,
}: {
  offers: NormalizedOffer[]
  scrapedAt: string | null
  initialTarget: ProductTarget
  /** Slot next to the product name (e.g. the Save button). Gets the variant currently chosen. */
  renderActions?: (target: ProductTarget) => ReactNode
  /** Show the variant as fixed text instead of pickers (a saved product is one exact variant). */
  lockVariant?: boolean
}) {
  const [target, setTarget] = useState<ProductTarget>(initialTarget)
  const family = FAMILIES[target.family]
  const comparison = useMemo(() => buildComparison(target, offers, scrapedAt), [target, offers, scrapedAt])

  return (
    <div data-testid="comparison" className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">You are comparing</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground" data-testid="target-label">{targetLabel(target)}</h2>
          </div>
          {renderActions?.(target)}
        </div>
        {family.dimensions.length > 0 && !lockVariant && (
          <div className="mt-3 flex flex-wrap gap-4">
            {family.dimensions.map((d) => (
              <label key={d.key} className="text-sm text-muted-foreground">
                {d.label}{' '}
                <select
                  className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-foreground"
                  value={target.variant[d.key] ?? d.default}
                  onChange={(e) => setTarget({ ...target, variant: { ...target.variant, [d.key]: e.target.value } })}
                  data-testid={`variant-${d.key}`}
                >
                  {d.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {lockVariant ? 'This saved product is one exact variant. ' : ''}
          Matching uses fixed rules on listing titles, not a model, so every decision has a stated reason.
          Colour does not count as a variant.
        </p>
      </section>

      <CheapestBox comparison={comparison} observedAt={comparison.sourceScrapedAt} />

      <p data-testid="filter-summary" className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
        {comparison.filterSummary}
      </p>

      {comparison.notes.map((n) => (
        <p key={n} className="text-sm text-muted-foreground">{n}</p>
      ))}

      <Section
        testId="section-comparable"
        title="Matching listings"
        hint="Matched to your chosen model and variant by known attributes, with condition new or not stated, and price not flagged. Condition, seller and final checkout cost can still differ between these listings. Sorted by listed price."
        offers={comparison.comparable}
        observedAt={comparison.sourceScrapedAt}
        empty="No listings could be placed here."
        defaultOpen
      />
      <Section
        testId="section-pricecheck"
        title="Unusually low compared with other listings"
        hint="These match your chosen product and variant, but the listed price is below 60% of the median of other matching sellers. The 60% line is a rule of thumb based on other listings: it is not evidence that anything is wrong with the listing, and it is not a guarantee of a good deal. These offers can still be the lowest reported offer above."
        offers={comparison.priceCheck}
        observedAt={comparison.sourceScrapedAt}
        tone="warn"
        defaultOpen
      />
      <Section
        testId="section-ambiguous"
        title="Cannot tell if these are the same product"
        hint="The listing does not give enough information, or contradicts itself."
        offers={comparison.ambiguous}
        observedAt={comparison.sourceScrapedAt}
        tone="warn"
      />
      {comparison.differentVariants.length > 0 && (
        <div data-testid="section-variants" className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">Different variants (not comparable to your choice)</h3>
          {comparison.differentVariants.map((v) => (
            <Section key={v.label} title={v.label} offers={v.offers} observedAt={comparison.sourceScrapedAt} small />
          ))}
        </div>
      )}
      <Section
        testId="section-secondhand"
        title="Used, refurbished or open-box"
        hint="Same model and variant, but not new, so not compared with new prices."
        offers={comparison.secondHand}
        observedAt={comparison.sourceScrapedAt}
      />
      <Section
        testId="section-rejected"
        title="Different products and accessories"
        hint="Shown for transparency; excluded from the comparison."
        offers={comparison.rejected}
        observedAt={comparison.sourceScrapedAt}
      />

      <p className="text-xs text-muted-foreground" data-testid="comparison-stats">
        DealProof has no price history, so it says nothing about whether a price is high or low compared with the past.
      </p>
    </div>
  )
}

function CheapestBox({ comparison, observedAt }: { comparison: Comparison; observedAt: string | null }) {
  const c = comparison.cheapest
  if (!c) {
    return (
      <section data-testid="cheapest-none" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        No lowest reported offer to show: no in-stock listing was confidently matched to the product and variant you chose.
      </section>
    )
  }
  const o = c.offer
  const alt = comparison.lowestUnflagged
  const likely = o.match.class === 'LIKELY'
  const seller = o.seller.raw ?? 'Unknown seller'
  return (
    <section data-testid="cheapest" className="rounded-lg border-2 border-primary/40 bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Lowest reported matching offer</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-3xl font-semibold text-foreground">{formatPrice(o.offer.price, o.offer.currency)}</p>
        <p className="text-sm text-foreground">at {seller}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="cheapest-match">
        <Tag className={MATCH_STYLE[o.match.class]}>{MATCH_LABEL[o.match.class]}</Tag>
        {likely && <span className="text-foreground">Not confirmed as the exact variant: {o.match.summary}</span>}
      </div>

      {c.flagged && o.priceSignal.status === 'unusually_low' && (
        <p data-testid="cheapest-flag" role="note" className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm text-foreground">
          {o.priceSignal.explanation}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-sm" data-testid="cheapest-details">
        <dt className="text-muted-foreground">Condition</dt>
        <dd className="text-foreground">{CONDITION_LABEL[o.condition.value]}</dd>
        <dt className="text-muted-foreground">Availability</dt>
        <dd className="text-foreground">{AVAILABILITY_LABEL[o.availability]}</dd>
        <dt className="text-muted-foreground">Shipping</dt>
        <dd className="text-foreground">{o.shipping ?? 'Not provided'}</dd>
        <dt className="text-muted-foreground">Price checked</dt>
        <dd className="text-foreground">Not independently verified (feed-reported)</dd>
        <dt className="text-muted-foreground">Price observed</dt>
        <dd className="text-foreground">{formatObserved(observedAt)}</dd>
      </dl>

      {o.offer.listingUrl && (
        <a
          href={o.offer.listingUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          data-testid="cheapest-link"
          className="mt-3 inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-primary hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          View this listing at {seller} (opens in a new tab)
        </a>
      )}

      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">Before you rely on this</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {c.caveats.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>

      {alt && (
        <p data-testid="lowest-unflagged" className="mt-3 border-t border-border pt-2 text-sm text-muted-foreground">
          For reference, the lowest matching offer <em>without</em> a low-price flag:{' '}
          <span className="font-medium text-foreground">{formatPrice(alt.offer.offer.price, alt.offer.offer.currency)}</span> from{' '}
          {alt.offer.seller.raw ?? 'an unknown seller'}
          {alt.offer.match.class === 'LIKELY' ? ' (likely match, not confirmed)' : ''}.
        </p>
      )}
    </section>
  )
}

function Section({
  title,
  hint,
  offers,
  empty,
  tone,
  defaultOpen,
  small,
  testId,
  observedAt,
}: {
  title: string
  hint?: string
  offers: OfferAnalysis[]
  empty?: string
  tone?: 'warn'
  defaultOpen?: boolean
  small?: boolean
  testId?: string
  observedAt: string | null
}) {
  if (offers.length === 0 && !empty) return null
  return (
    <details
      open={defaultOpen}
      data-testid={testId}
      className={`rounded-lg border bg-card ${tone === 'warn' ? 'border-amber-500/40' : 'border-border'}`}
    >
      <summary className={`cursor-pointer select-none px-4 py-3 font-medium text-foreground ${small ? 'text-sm' : 'text-base'}`}>
        {title} <span className="font-normal text-muted-foreground">({offers.length})</span>
      </summary>
      {hint && <p className="px-4 pb-2 text-xs text-muted-foreground">{hint}</p>}
      {offers.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {offers.map((a) => (
            <OfferCard key={a.id} a={a} observedAt={observedAt} />
          ))}
        </ul>
      )}
    </details>
  )
}

function OfferCard({ a, observedAt }: { a: OfferAnalysis; observedAt: string | null }) {
  const o = a.offer
  const seller = a.seller.platform && a.seller.sellerName ? `${a.seller.platform} · seller ${a.seller.sellerName}` : (o.seller ?? 'Unknown seller')
  const sig = a.priceSignal
  return (
    <li className="space-y-2 px-4 py-3 text-sm" data-testid="offer">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-semibold text-foreground">
          <span className="mr-1 text-xs font-normal text-muted-foreground">Listed price</span>
          {formatPrice(o.price, o.currency)}
        </span>
        {a.duplicateCount > 0 && <Tag>{a.duplicateCount + 1} identical listings merged</Tag>}
      </div>
      <p className="text-muted-foreground">{o.title ?? 'No title provided'}</p>

      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Product match</dt>
        <dd>
          <Tag className={MATCH_STYLE[a.match.class]}>{MATCH_LABEL[a.match.class]}</Tag>
          <span className="ml-2 text-foreground">{a.match.summary}</span>
        </dd>

        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Purchase details</dt>
        <dd className="space-y-0.5 text-foreground">
          <p>
            Retailer:{' '}
            {o.listingUrl ? (
              <a href={o.listingUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline-offset-2 hover:underline">
                {seller}
              </a>
            ) : (
              seller
            )}
            <span className="text-muted-foreground"> ({a.seller.evidence})</span>
          </p>
          <p>Condition: {CONDITION_LABEL[a.condition.value]}{a.condition.evidence ? <span className="text-muted-foreground"> ({a.condition.evidence})</span> : null}</p>
          <p>Availability: {AVAILABILITY_LABEL[a.availability]}</p>
          <p>Shipping: {a.shipping ?? 'Not provided'}</p>
        </dd>

        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Price</dt>
        <dd className="space-y-0.5">
          <p className="text-foreground">Price verification: Not independently verified (API-reported price)</p>
          <p className="text-foreground">Source observation: {formatObserved(observedAt)}</p>
          {sig.status === 'unusually_low' && <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-1.5 text-foreground" data-testid="price-flag">{sig.explanation}</p>}
          {sig.status === 'insufficient_evidence' && <p className="text-muted-foreground" data-testid="price-insufficient">{sig.explanation}</p>}
          {sig.status === 'not_unusually_low' && <p className="text-xs text-muted-foreground">{sig.explanation}</p>}
        </dd>
      </dl>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Why this product-match decision?</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {a.match.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {a.match.evidence.map((e, i) => (
            <li key={i}>
              {e.attribute}: {e.value} ({e.effect === 'supports' ? 'matches' : e.effect === 'conflicts' ? 'conflicts' : 'noted'}, from {e.from.replace('_', ' ')})
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}

function formatObserved(iso: string | null): string {
  if (!iso) return 'Not provided'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Not provided' : d.toLocaleString()
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 ${className ?? 'bg-muted text-muted-foreground'}`}>{children}</span>
}

export function formatPrice(price: number | null, currency: string | null): string {
  if (price === null) return 'No price'
  if (!currency) return `${price.toFixed(2)} (currency unknown)`
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price)
  } catch {
    return `${price.toFixed(2)} ${currency}`
  }
}
