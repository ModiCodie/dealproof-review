/**
 * Renders a Comparison (see src/lib/matching). Presentation only: every decision
 * shown here was made by the deterministic matching module, and each offer keeps
 * the module's own plain-language explanation (under "Details").
 *
 * Reading order, top to bottom:
 *   1. Product header   which product and variant is being compared (+ variant controls, + Save)
 *   2. Price overview   the lowest reported matching offer, with its match level and any flag
 *   3. Summary strip    how many listings were found and where they went
 *   4. Comparable offers (a retailer table on wide screens, cards on phones)
 *   5. Needs verification   unusually low prices; listings that cannot be placed
 *   6. Not comparable       other variants, used/refurbished, other products
 *
 * Each offer is described along three independent dimensions, never merged:
 *   A. Product match    - does the listing refer to the chosen product and variant?
 *   B. Purchase details - condition, availability, seller, shipping (unknown stays unknown)
 *   C. Price            - API-reported, not independently verified; plus the anomaly signal
 * Wording rules: never call a price verified, never say "deal" / "best" /
 * "guaranteed" (no price history), and show "Not provided" for missing data.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { CircleCheck, CircleHelp, CircleX, ExternalLink, GitBranch, Info, TriangleAlert } from 'lucide-react'
import type { NormalizedOffer } from '@/lib/pricing-types'
import { buildComparison, dimensionsFor, targetLabel } from '@/lib/matching'
import type { Availability, Comparison, Condition, MatchClass, OfferAnalysis, ProductTarget } from '@/lib/matching'
import { Disclosure, More, Notice, Pill, SegmentedControl, type Tone } from '@/components/dp/ui'
import { ProductIcon } from '@/components/dp/ProductIcon'
import { cn } from '@/lib/utils'

/** Full labels: used where there is room (price overview, offer details). */
const MATCH_LABEL: Record<MatchClass, string> = {
  EXACT: 'Same model and variant',
  LIKELY: 'Likely the same, some details missing',
  AMBIGUOUS: 'Cannot tell from the listing',
  DIFFERENT_VARIANT: 'Different variant',
  REJECTED: 'Different product',
}
/** Compact labels for table rows. The full label is the pill's tooltip. */
const MATCH_SHORT: Record<MatchClass, string> = {
  EXACT: 'Exact match',
  LIKELY: 'Likely match',
  AMBIGUOUS: 'Can’t tell',
  DIFFERENT_VARIANT: 'Different variant',
  REJECTED: 'Different product',
}
const MATCH_TONE: Record<MatchClass, Tone> = {
  EXACT: 'ok',
  LIKELY: 'likely',
  AMBIGUOUS: 'caution',
  DIFFERENT_VARIANT: 'variant',
  REJECTED: 'neutral',
}
const MATCH_ICON = {
  EXACT: CircleCheck,
  LIKELY: CircleHelp,
  AMBIGUOUS: CircleHelp,
  DIFFERENT_VARIANT: GitBranch,
  REJECTED: CircleX,
} as const
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

const COLUMNS = 'md:grid-cols-[minmax(0,2.4fr)_7rem_minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,2fr)]'

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
  /** Slot in the product header (e.g. the Save button). Gets the variant currently chosen. */
  renderActions?: (target: ProductTarget) => ReactNode
  /** Show the variant as fixed text instead of controls (a saved product is one exact variant). */
  lockVariant?: boolean
}) {
  const [target, setTarget] = useState<ProductTarget>(initialTarget)
  const identity = target.family === 'generic' ? target.spec : target.family
  const dimensions = useMemo(() => dimensionsFor(target, offers.map((o) => o.title)), [identity, offers])
  const comparison = useMemo(() => buildComparison(target, offers, scrapedAt), [target, offers, scrapedAt])
  const [title, ...variantParts] = targetLabel(target).split(' · ')
  const observedAt = comparison.sourceScrapedAt
  const otherVariants = comparison.differentVariants.reduce((n, g) => n + g.offers.length, 0)
  const needsLook = comparison.priceCheck.length + comparison.ambiguous.length
  const notComparable = otherVariants + comparison.secondHand.length + comparison.rejected.length

  return (
    <div data-testid="comparison" className="space-y-6">
      {/* 1. Product header */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(18,23,34,0.05)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ProductIcon family={target.family} />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">You are comparing</p>
              <h2 className="text-xl font-semibold text-foreground sm:text-2xl" data-testid="target-label">
                {title}
                {variantParts.length > 0 && (
                  <>
                    <span className="sr-only"> · </span>
                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{variantParts.join(' · ')}</span>
                  </>
                )}
              </h2>
            </div>
          </div>
          {renderActions?.(target)}
        </div>

        {dimensions.length > 0 && !lockVariant && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {dimensions.map((d) => (
                <SegmentedControl
                  key={d.key}
                  label={d.label}
                  testId={`variant-${d.key}`}
                  options={d.options}
                  value={target.variant[d.key] ?? d.default}
                  onChange={(v) => setTarget({ ...target, variant: { ...target.variant, [d.key]: v } })}
                />
              ))}
            </div>
            {dimensions.some((d) => d.note) && (
              <p className="text-xs text-muted-foreground" data-testid="variant-notes">
                {dimensions.filter((d) => d.note).map((d) => `${d.label}: ${d.note}`).join(' ')}
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {lockVariant ? 'This saved product is one exact variant. ' : ''}
          {target.family === 'generic'
            ? 'Listings are matched by fixed rules on their titles only: the price feed has no barcodes or model fields. Every decision has a stated reason, and nothing is guessed. Colour does not count as a variant.'
            : 'Listings are matched by fixed rules on their titles, not a model, so every decision has a stated reason. Colour does not count as a variant.'}
        </p>
      </section>

      {/* 2. Price overview (or why nothing can be compared safely) */}
      {comparison.limitation ? (
        <Notice testId="cannot-compare" tone="caution" icon={TriangleAlert} role="note" title="DealProof can't compare these safely yet">
          {comparison.limitation} The listings found are shown below, unsorted by product, with no lowest price.
        </Notice>
      ) : (
        <PriceOverview comparison={comparison} observedAt={observedAt} />
      )}

      {/* 3. Summary strip */}
      <div className="space-y-2">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="comparison-counts">
          <Stat label="Listings found" value={comparison.stats.total} />
          <Stat label="Comparable" value={comparison.stats.matching} tone="ok" />
          <Stat label="Need a closer look" value={needsLook} tone={needsLook > 0 ? 'caution' : undefined} />
          <Stat label="Not comparable" value={notComparable} />
        </dl>
        <details data-testid="filter-summary" className="group rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-primary">
            <Info className="size-4" aria-hidden /> How these listings were sorted
          </summary>
          <p className="mt-2 text-muted-foreground">{comparison.filterSummary}</p>
        </details>
        {comparison.notes.map((n) => (
          <p key={n} className="px-1 text-sm text-muted-foreground">{n}</p>
        ))}
      </div>

      {/* 4. Comparable */}
      <Section
        testId="section-comparable"
        title="Comparable offers"
        hint="Same model and variant, new or condition not stated, price not flagged. Lowest price first. Condition, seller and final checkout cost can still differ."
        offers={comparison.comparable}
        observedAt={observedAt}
        empty="No listings could be placed here."
        defaultOpen
      />

      {/* 5. Needs verification */}
      {needsLook > 0 && (
        <div className="space-y-3">
          <GroupLabel>Needs verification</GroupLabel>
          <Section
            testId="section-pricecheck"
            title="Unusually low prices"
            hint="These match your product and variant, but are priced below 60% of the median of other matching sellers."
            why="These match your chosen product and variant, but the listed price is below 60% of the median of other matching sellers. The 60% line is a rule of thumb based on other listings: it is not evidence that anything is wrong with the listing, and it is not a guarantee of a good deal. These offers can still be the lowest reported offer above."
            offers={comparison.priceCheck}
            observedAt={observedAt}
            tone="caution"
            defaultOpen
          />
          <Section
            testId="section-ambiguous"
            title="Cannot tell if these are the same product"
            hint="The listing does not give enough information, or contradicts itself."
            offers={comparison.ambiguous}
            observedAt={observedAt}
            tone="caution"
          />
        </div>
      )}

      {/* 6. Not comparable */}
      {notComparable > 0 && (
        <div className="space-y-3">
          <GroupLabel>Not comparable</GroupLabel>
          {comparison.differentVariants.length > 0 && (
            <div data-testid="section-variants" className="space-y-3">
              {comparison.differentVariants.map((v) => (
                <Section key={v.label} title={v.label} hint="A different configuration of the same product." offers={v.offers} observedAt={observedAt} />
              ))}
            </div>
          )}
          <Section
            testId="section-secondhand"
            title="Used, refurbished or open-box"
            hint="Same model and variant, but not new, so not compared with new prices."
            offers={comparison.secondHand}
            observedAt={observedAt}
          />
          <Section
            testId="section-rejected"
            title="Different products and accessories"
            hint="Shown for transparency; excluded from the comparison."
            offers={comparison.rejected}
            observedAt={observedAt}
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground" data-testid="comparison-stats">
        DealProof has no price history, so it says nothing about whether a price is high or low compared with the past.
      </p>
    </div>
  )
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <h3 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'caution' }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-xl font-semibold tabular-nums text-foreground', tone === 'ok' && 'text-ok', tone === 'caution' && 'text-caution')}>{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------- price overview

function PriceOverview({ comparison, observedAt }: { comparison: Comparison; observedAt: string | null }) {
  const c = comparison.cheapest
  if (!c) {
    return (
      <Notice testId="cheapest-none" icon={Info} tone="neutral" className="border-dashed">
        No lowest reported offer to show: no in-stock listing was confidently matched to the product and variant you chose.
      </Notice>
    )
  }
  const o = c.offer
  const alt = comparison.lowestUnflagged
  const likely = o.match.class === 'LIKELY'
  const seller = o.seller.raw ?? 'Unknown seller'
  const sig = o.priceSignal
  const MatchIcon = MATCH_ICON[o.match.class]
  return (
    <section data-testid="cheapest" className={cn('rounded-2xl border bg-card p-4 shadow-[0_4px_14px_rgba(18,23,34,0.06)] sm:p-6', c.flagged ? 'border-caution-line' : 'border-primary/30')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lowest reported matching offer</p>
        {c.flagged && <Pill tone="caution" icon={TriangleAlert}>Price unusually low</Pill>}
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="text-4xl font-semibold tabular-nums tracking-tight text-foreground sm:text-5xl">{formatPrice(o.offer.price, o.offer.currency)}</p>
        <p className="pb-1 text-base text-muted-foreground">
          at <span className="font-medium text-foreground">{seller}</span>
        </p>
      </div>

      <div className="mt-3 space-y-1.5" data-testid="cheapest-match">
        <Pill tone={MATCH_TONE[o.match.class]} icon={MatchIcon}>{MATCH_LABEL[o.match.class]}</Pill>
        {likely && <p className="text-sm text-foreground">Not confirmed as the exact variant: {o.match.summary}</p>}
      </div>

      {c.flagged && sig.status === 'unusually_low' && (
        <Notice testId="cheapest-flag" role="note" tone="caution" icon={TriangleAlert} className="mt-4" title={`${sig.percentBelow}% below the median of ${sig.baseline.independentSellers} independent sellers`}>
          <More label="Why this is flagged">{sig.explanation}</More>
        </Notice>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-3" data-testid="cheapest-details">
        <Fact label="Condition">{CONDITION_LABEL[o.condition.value]}</Fact>
        <Fact label="Availability">{AVAILABILITY_LABEL[o.availability]}</Fact>
        <Fact label="Shipping">{o.shipping ?? 'Not provided'}</Fact>
        <Fact label="Price observed">{formatObserved(observedAt)}</Fact>
        <Fact label="Price checked" className="col-span-2">Not independently verified (feed-reported)</Fact>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        {o.offer.listingUrl && (
          <a
            href={o.offer.listingUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            data-testid="cheapest-link"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            View at {seller}
            <ExternalLink className="size-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        <More label="Before you rely on this">
          <ul className="list-disc space-y-0.5 pl-5">
            {c.caveats.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </More>
      </div>

      {alt && (
        <div data-testid="lowest-unflagged" className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl bg-muted/70 px-4 py-3 text-sm">
          <p className="text-muted-foreground">
            Lowest matching offer <em>without</em> a low-price flag
            {alt.offer.match.class === 'LIKELY' ? ' (likely match, not confirmed)' : ''}
          </p>
          <p className="text-foreground">
            <span className="text-lg font-semibold tabular-nums">{formatPrice(alt.offer.offer.price, alt.offer.offer.currency)}</span>
            <span className="text-muted-foreground"> from {alt.offer.seller.raw ?? 'an unknown seller'}</span>
          </p>
        </div>
      )}
    </section>
  )
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  )
}

// ---------------------------------------------------------------- sections and offers

function Section({
  title,
  hint,
  why,
  offers,
  empty,
  tone,
  defaultOpen,
  testId,
  observedAt,
}: {
  title: string
  hint?: string
  /** The full explanation behind a flagged group, kept one tap away. */
  why?: string
  offers: OfferAnalysis[]
  empty?: string
  tone?: 'caution'
  defaultOpen?: boolean
  testId?: string
  observedAt: string | null
}) {
  if (offers.length === 0 && !empty) return null
  const shared = sharedSummary(offers)
  return (
    <Disclosure summary={title} meta={offers.length} tone={tone} defaultOpen={defaultOpen} testId={testId}>
      {hint && <p className="px-4 pb-3 text-sm text-muted-foreground sm:px-5">{hint}</p>}
      {shared && (
        <p className="px-4 pb-3 text-sm text-foreground sm:px-5" data-testid="shared-note">
          <Pill tone={MATCH_TONE[shared.cls]} className="mr-1.5">{MATCH_SHORT[shared.cls]}</Pill>
          {shared.text}
        </p>
      )}
      {why && (
        <div className="px-4 pb-3 sm:px-5">
          <More label="Why this is flagged">{why}</More>
        </div>
      )}
      {offers.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">{empty}</p>
      ) : (
        <div className="border-t border-border">
          <div className={cn('hidden gap-x-4 border-b border-border bg-muted/50 px-5 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid', COLUMNS)} aria-hidden>
            <span>Retailer</span>
            <span className="text-right">Price</span>
            <span>Shipping</span>
            <span>Condition</span>
            <span>Match</span>
          </div>
          <ul className="divide-y divide-border">
            {offers.map((a) => (
              <OfferRow key={a.id} a={a} observedAt={observedAt} hideSummary={shared?.text === a.match.summary} />
            ))}
          </ul>
        </div>
      )}
    </Disclosure>
  )
}

/**
 * When most offers in a group carry the very same match explanation (e.g. "Probably the 2TB model, but the
 * listing doesn't say whether it has a heatsink"), say it once for the group instead of on every row. The full
 * explanation of each offer is still under its "Details".
 */
function sharedSummary(offers: OfferAnalysis[]): { text: string; cls: MatchClass } | null {
  if (offers.length < 3) return null
  const counts = new Map<string, { n: number; cls: MatchClass }>()
  for (const a of offers) {
    if (a.match.class === 'EXACT') continue
    const e = counts.get(a.match.summary) ?? { n: 0, cls: a.match.class }
    e.n++
    counts.set(a.match.summary, e)
  }
  let best: { text: string; cls: MatchClass; n: number } | null = null
  for (const [text, e] of counts) if (!best || e.n > best.n) best = { text, cls: e.cls, n: e.n }
  return best && best.n >= 3 && best.n > offers.length / 2 ? { text: best.text, cls: best.cls } : null
}

function OfferRow({ a, observedAt, hideSummary }: { a: OfferAnalysis; observedAt: string | null; hideSummary?: boolean }) {
  const o = a.offer
  const seller = a.seller.platform && a.seller.sellerName ? `${a.seller.platform} · seller ${a.seller.sellerName}` : (o.seller ?? 'Unknown seller')
  const sig = a.priceSignal
  const MatchIcon = MATCH_ICON[a.match.class]
  const lowFlag = sig.status === 'unusually_low'
  const unavailable = a.availability === 'out_of_stock' || a.availability === 'backorder'
  return (
    <li className="px-4 py-4 text-sm sm:px-5" data-testid="offer">
      <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 md:items-start', COLUMNS)}>
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {o.listingUrl ? (
              <a href={o.listingUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline-offset-2 hover:underline">
                {seller}
              </a>
            ) : (
              seller
            )}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{o.title ?? 'No title provided'}</p>
        </div>

        <div className="md:text-right">
          <p className="text-lg font-semibold tabular-nums text-foreground">
            <span className="sr-only">Listed price </span>
            {formatPrice(o.price, o.currency)}
          </p>
          {a.duplicateCount > 0 && <p className="text-xs text-muted-foreground">{a.duplicateCount + 1} identical listings merged</p>}
        </div>

        <p className="col-span-2 text-muted-foreground md:col-span-1">
          <span className="text-xs md:hidden">Shipping: </span>
          <span className={a.shipping ? 'text-foreground' : undefined}>{a.shipping ?? 'Not provided'}</span>
        </p>
        <p className="col-span-2 text-muted-foreground md:col-span-1">
          {a.condition.value !== 'unknown' && <span className="text-xs md:hidden">Condition: </span>}
          <span className={a.condition.value === 'unknown' ? undefined : 'text-foreground'}>{CONDITION_LABEL[a.condition.value]}</span>
        </p>

        <div className="col-span-2 space-y-1.5 md:col-span-1">
          <div className="flex flex-wrap gap-1.5">
            <Pill tone={MATCH_TONE[a.match.class]} icon={MatchIcon} title={MATCH_LABEL[a.match.class]}>{MATCH_SHORT[a.match.class]}</Pill>
            {lowFlag && <Pill tone="caution" icon={TriangleAlert}>Price unusually low</Pill>}
            {unavailable && <Pill>{AVAILABILITY_LABEL[a.availability]}</Pill>}
          </div>
          {a.match.class !== 'EXACT' && !hideSummary && <p className="text-xs text-muted-foreground">{a.match.summary}</p>}
        </div>
      </div>

      <More label="Details" className="mt-2.5">
        <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-[7.5rem_1fr]">
          <dt className="text-xs font-medium uppercase tracking-wide">Product match</dt>
          <dd className="space-y-1">
            <p>
              <Pill tone={MATCH_TONE[a.match.class]}>{MATCH_LABEL[a.match.class]}</Pill>
              <span className="ml-2 text-foreground">{a.match.summary}</span>
            </p>
            <More label="Why this product-match decision?">
              <ul className="list-disc space-y-0.5 pl-5">
                {a.match.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
                {a.match.evidence.map((e, i) => (
                  <li key={i}>
                    {e.attribute}: {e.value} ({e.effect === 'supports' ? 'matches' : e.effect === 'conflicts' ? 'conflicts' : 'noted'}, from {e.from.replace('_', ' ')})
                  </li>
                ))}
              </ul>
            </More>
          </dd>

          <dt className="text-xs font-medium uppercase tracking-wide">Purchase details</dt>
          <dd className="space-y-0.5 text-foreground">
            <p>
              Retailer: {seller}
              <span className="text-muted-foreground"> ({a.seller.evidence})</span>
            </p>
            <p>
              Condition: {CONDITION_LABEL[a.condition.value]}
              {a.condition.evidence ? <span className="text-muted-foreground"> ({a.condition.evidence})</span> : null}
            </p>
            <p>Availability: {AVAILABILITY_LABEL[a.availability]}</p>
            <p>Shipping: {a.shipping ?? 'Not provided'}</p>
          </dd>

          <dt className="text-xs font-medium uppercase tracking-wide">Price</dt>
          <dd className="space-y-1 text-foreground">
            <p>Price verification: Not independently verified (API-reported price)</p>
            <p>Source observation: {formatObserved(observedAt)}</p>
            {sig.status === 'unusually_low' && (
              <p className="rounded-lg border border-caution-line bg-caution-soft p-2" data-testid="price-flag">
                {sig.explanation}
              </p>
            )}
            {sig.status === 'insufficient_evidence' && (
              <p className="text-muted-foreground" data-testid="price-insufficient">
                {sig.explanation}
              </p>
            )}
            {sig.status === 'not_unusually_low' && <p className="text-xs text-muted-foreground">{sig.explanation}</p>}
          </dd>
        </dl>
      </More>
    </li>
  )
}

function formatObserved(iso: string | null): string {
  if (!iso) return 'Not provided'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Not provided' : d.toLocaleString()
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
