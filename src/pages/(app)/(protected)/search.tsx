/**
 * Compare page (route /search).
 *
 * For now DealProof only has matching rules for a short list of products
 * (src/lib/catalog.ts), so this page offers a product picker instead of a
 * free-text box. The picker is driven entirely by that list and the rest of the
 * page only sees a product + variant target, so a different way of choosing a
 * product can replace <ProductPicker> without touching the comparison. Two explicit actions:
 *   - Explore demo        bundled sample data; free; never saved.
 *   - Check live prices   the PricesAPI-backed server action (per-user daily
 *                         limit, 12-hour cache). It runs ONLY when this button
 *                         is pressed: choosing a product, switching variants
 *                         or navigating never starts a paid search.
 * The server still validates every query; the queries sent here are the same
 * ones the previous text box was used with (see src/lib/catalog.ts).
 *
 * Flow: live check -> searchProducts() -> POST /api/actions/searchProducts ->
 * Worker action -> cache / PricesAPI -> normalized result -> matched and
 * compared by the deterministic module in src/lib/matching.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, Clock, FlaskConical, Lock, SearchX, Zap } from 'lucide-react'
import { Button } from '@/components/ui'
import { searchProducts } from '@/lib/api'
import { ComparisonView, formatPrice } from '@/components/comparison/ComparisonView'
import { SaveControl } from '@/components/saved/SaveControl'
import { ErrorPanel } from '@/components/SearchPanels'
import { Disclosure, More, Notice, Page, Pill, Skeleton } from '@/components/dp/ui'
import { ProductIcon } from '@/components/dp/ProductIcon'
import { CATALOG, catalogProduct, SUPPORTED_COUNT, variantSummary, type CatalogKey, type CatalogProduct } from '@/lib/catalog'
import { formatDate, formatTime, formatWait } from '@/lib/format'
import { detectTarget } from '@/lib/matching'
import { usePageTitle } from '@/lib/use-page-title'
import { cn } from '@/lib/utils'
import type {
  NormalizedOffer,
  ProductCandidate,
  SearchFailure,
  SearchResponse,
  SearchSource,
} from '@/lib/pricing-types'

type State =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'error'; failure: SearchFailure }
  | { status: 'done'; response: SearchResponse }
  | { status: 'sample'; sample: Sample }

interface Sample {
  key: CatalogKey
  query: string
  candidates: ProductCandidate[]
  source: SearchSource
}

type SampleModule = { default: { candidates: ProductCandidate[]; source: SearchSource } }
const SAMPLE_LOADERS: Record<CatalogKey, () => Promise<SampleModule>> = {
  sony: () => import('../../../../tests/fixtures/real-sony.normalized.json') as never,
  logitech: () => import('../../../../tests/fixtures/real-logitech.normalized.json') as never,
  samsung: () => import('../../../../tests/fixtures/real-samsung.normalized.json') as never,
}
/** When the bundled samples were captured (they are saved real search results). */
const SAMPLE_CAPTURED = '2026-11-19T12:00:00.000Z'

export default function SearchPage() {
  usePageTitle('Compare')
  const [params, setParams] = useSearchParams()
  const [productKey, setProductKey] = useState<CatalogKey>(() => catalogProduct(params.get('product'))?.key ?? 'sony')
  const [state, setState] = useState<State>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const product = catalogProduct(productKey) as CatalogProduct
  const loading = state.status === 'loading'

  // Cancel any in-flight request if the page unmounts.
  useEffect(() => () => controller.current?.abort(), [])

  async function loadDemo(key: CatalogKey) {
    const mod = await SAMPLE_LOADERS[key]()
    const fx = mod.default
    const p = catalogProduct(key) as CatalogProduct
    setState({ status: 'sample', sample: { key, query: p.query, candidates: fx.candidates, source: fx.source } })
  }

  function choose(key: CatalogKey) {
    if (loading || key === productKey) return
    setProductKey(key)
    setParams({ product: key }, { replace: true })
    // Switching products while looking at the (free) demo shows that product's demo.
    // Anything else resets to the picker: a paid search is never started by choosing a product.
    if (state.status === 'sample') void loadDemo(key)
    else setState({ status: 'idle' })
  }

  async function checkLive() {
    if (loading) return
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    setState({ status: 'loading', query: product.query })
    try {
      const r = await searchProducts(product.query, c.signal)
      setState(r.success ? { status: 'done', response: r.data } : { status: 'error', failure: r })
    } catch {
      /* aborted: ignore */
    }
  }

  return (
    <Page>
      <header className="max-w-2xl">
        <p className="text-sm font-medium text-primary">Price comparison · {SUPPORTED_COUNT} products available now</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground sm:text-4xl">Compare the right listings, not just the cheapest</h1>
        <p className="mt-3 text-base text-muted-foreground">
          Pick a product, then explore a demo or check live prices. Every listing is matched by model and variant first, so a 1TB drive is never compared with a 2TB one.
        </p>
      </header>

      <ProductPicker products={CATALOG} value={productKey} onChange={choose} disabled={loading} />

      <section className="mt-8" aria-labelledby="how-heading" data-testid="sample-picker">
        <h2 id="how-heading" className="text-sm font-semibold text-foreground">
          <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground" aria-hidden>2</span>
          Choose how to compare {product.brand} {product.model}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ActionCard
            icon={<FlaskConical className="size-5" aria-hidden />}
            title="Explore demo"
            badge={<Pill tone="neutral">Free</Pill>}
            body={`Saved real offers from ${formatDate(SAMPLE_CAPTURED)}. No search credit used. Demo results can’t be saved.`}
          >
            <Button type="button" variant="outline" onClick={() => void loadDemo(productKey)} disabled={loading} data-testid={`sample-${productKey}`}>
              Show demo
            </Button>
          </ActionCard>
          <ActionCard
            icon={<Zap className="size-5" aria-hidden />}
            title="Check live prices"
            badge={<Pill tone="likely">Uses a daily search</Pill>}
            body="Fetches current US offers. Counts as one of your fresh searches unless a result under 12 hours old is already stored."
            primary
          >
            <Button type="button" onClick={checkLive} disabled={loading} data-testid="search-submit">
              {loading ? 'Checking…' : 'Check live prices'}
            </Button>
          </ActionCard>
        </div>
      </section>

      {state.status === 'loading' && <LoadingPanel query={state.query} />}
      {state.status === 'error' && <ErrorPanel failure={state.failure} />}
      {state.status === 'done' && <Results response={state.response} />}
      {state.status === 'sample' && <SampleResults sample={state.sample} />}
      {state.status === 'idle' && <Legend />}
    </Page>
  )
}

// ------------------------------------------------------------------ picker

function ProductPicker({ products, value, onChange, disabled }: { products: readonly CatalogProduct[]; value: CatalogKey; onChange: (k: CatalogKey) => void; disabled: boolean }) {
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = products[(i + step + products.length) % products.length]
    onChange(next.key)
    ;(e.currentTarget.parentElement?.querySelector(`[data-key="${next.key}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <section className="mt-8" aria-labelledby="pick-heading">
      <h2 id="pick-heading" className="text-sm font-semibold text-foreground">
        <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground" aria-hidden>1</span>
        Choose a product
      </h2>
      <div role="radiogroup" aria-labelledby="pick-heading" data-testid="product-picker" className="mt-3 grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {products.map((p, i) => {
          const selected = p.key === value
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              data-key={p.key}
              data-testid={`product-${p.key}`}
              onClick={() => onChange(p.key)}
              onKeyDown={(e) => move(e, i)}
              className={cn(
                'relative flex items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-[0_1px_2px_rgba(18,23,34,0.05)] transition hover:shadow-[0_4px_14px_rgba(18,23,34,0.08)] disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-input',
              )}
            >
              <ProductIcon family={p.family} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">{p.brand}</span>
                <span className="block text-base font-semibold text-foreground">{p.model}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{p.category}</span>
                <span className="mt-2 block text-xs text-muted-foreground">{variantSummary(p.family)}</span>
              </span>
              {selected && (
                <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                  <Check className="size-3.5" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ActionCard({ icon, title, badge, body, primary, children }: { icon: React.ReactNode; title: string; badge: React.ReactNode; body: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgba(18,23,34,0.05)] sm:p-5', primary ? 'border-primary/30' : 'border-border')}>
      <div className="flex items-center gap-2.5">
        <span className={cn('flex size-9 items-center justify-center rounded-lg', primary ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{icon}</span>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <span className="ml-auto">{badge}</span>
      </div>
      <p className="mt-3 flex-1 text-sm text-muted-foreground">{body}</p>
      <div className="mt-4">{children}</div>
    </div>
  )
}

/** Shown before any result: what the labels in a comparison mean, in one glance. */
function Legend() {
  const items: { tone: 'ok' | 'likely' | 'variant' | 'caution'; label: string; text: string }[] = [
    { tone: 'ok', label: 'Exact match', text: 'The listing names your model and every variant detail you chose.' },
    { tone: 'likely', label: 'Likely match', text: 'Probably the right product, but the listing leaves a detail out.' },
    { tone: 'variant', label: 'Different variant', text: 'Same product family, other configuration. Kept out of your comparison.' },
    { tone: 'caution', label: 'Price unusually low', text: 'Far below other sellers. Worth a closer look before you rely on it.' },
  ]
  return (
    <section className="mt-10" aria-labelledby="legend-heading" data-testid="legend">
      <h2 id="legend-heading" className="text-sm font-semibold text-foreground">What the labels mean</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5">
            <Pill tone={i.tone} className="mt-0.5">{i.label}</Pill>
            <p className="text-sm text-muted-foreground">{i.text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Prices come from a retailer data feed and are not checked at checkout.</p>
    </section>
  )
}

// ------------------------------------------------------------------ results

function LoadingPanel({ query }: { query: string }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div data-testid="search-loading" role="status" aria-live="polite" className="mt-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="text-sm font-medium text-foreground">Checking retailers for “{query}”… {seconds}s</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">A fresh live search usually takes 20–40 seconds. Please keep this page open.</p>
      <div className="mt-5 space-y-3" aria-hidden>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-5/6" />
      </div>
    </div>
  )
}

function Results({ response }: { response: SearchResponse }) {
  const { result, fromCache, quota } = response
  const hasAny = result.candidates.some((c) => c.offers.length > 0)
  return (
    <section className="mt-8 space-y-6" data-testid="search-results">
      <div className="rounded-2xl border border-border bg-card p-4" data-testid="result-meta">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Pill tone={fromCache ? 'neutral' : 'ok'} icon={fromCache ? Clock : Zap}>{fromCache ? 'Stored result' : 'New result'}</Pill>
          <p className="text-muted-foreground">
            Prices observed <span className="font-medium text-foreground" data-testid="scraped-at">{formatTime(result.source.scrapedAt) ?? 'Unknown'}</span>
          </p>
          <p className="text-muted-foreground">
            Stored by DealProof <span className="text-foreground">{formatTime(result.cachedAt)}</span>
          </p>
          <p className="text-muted-foreground sm:ml-auto">
            Fresh searches left today: <span className="font-medium text-foreground">{quota.userRemainingToday} of {quota.userDailyLimit}</span>
          </p>
        </div>
        <More label="About this data" className="mt-2 text-xs">
          <p data-testid="upstream-source">Price feed: {describeUpstream(result.source)}</p>
          {fromCache && <p>The DealProof cache entry expires {formatTime(result.expiresAt)}.</p>}
          <p className="mt-1">
            Prices come from a retailer data feed and are <strong>not independently verified</strong>. Condition is unknown unless a listing says otherwise, and shipping is often missing.
          </p>
        </More>
      </div>

      {hasAny && <Compared query={result.query} candidates={result.candidates} scrapedAt={result.source.scrapedAt} />}

      {!hasAny ? (
        <div data-testid="search-empty" className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <SearchX className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium text-foreground">No retailer offers found</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Nothing was returned for this product right now. This check did not use any of your daily allowance.</p>
        </div>
      ) : (
        <RawOffers candidates={result.candidates} />
      )}
    </section>
  )
}

function Compared({ query, candidates, scrapedAt, isSample }: { query: string; candidates: ProductCandidate[]; scrapedAt: string | null; isSample?: boolean }) {
  const target = useMemo(() => detectTarget(query), [query])
  const offers = useMemo(() => candidates.flatMap((c) => c.offers), [candidates])
  if (!target) {
    return (
      <Notice testId="unsupported" tone="neutral" className="mt-6">
        DealProof can only compare Sony WH-1000XM5, Logitech MX Master 3S and Samsung 990 PRO.
      </Notice>
    )
  }
  return (
    <div>
      {/* keyed so a new result or another sample starts from its own product and variant */}
      <ComparisonView
        key={`${query}|${scrapedAt ?? ''}`}
        offers={offers}
        scrapedAt={scrapedAt}
        initialTarget={target}
        renderActions={(t) =>
          isSample ? (
            <p className="flex max-w-xs items-start gap-1.5 text-xs text-muted-foreground sm:text-right" data-testid="save-unavailable">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>Saving needs a live comparison. Demo results are not stored, so they can’t be reopened later.</span>
            </p>
          ) : (
            <SaveControl target={t} query={query} />
          )
        }
      />
    </div>
  )
}

function SampleResults({ sample }: { sample: Sample }) {
  const p = catalogProduct(sample.key) as CatalogProduct
  return (
    <section className="mt-8 space-y-6" data-testid="sample-results">
      <Notice role="note" tone="caution" icon={FlaskConical} title="Demo data, not live prices">
        Real offers for {p.brand} {p.model} captured {formatTime(sample.source.scrapedAt) ?? 'on an unknown date'}. Prices and stock have almost certainly changed. No search credit used.
      </Notice>
      <Compared query={sample.query} candidates={sample.candidates} scrapedAt={sample.source.scrapedAt} isSample />
      <RawOffers candidates={sample.candidates} />
    </section>
  )
}

function RawOffers({ candidates }: { candidates: ProductCandidate[] }) {
  return (
    <Disclosure testId="raw-offers" summary={<span className="text-sm">Advanced: raw feed groupings (unmatched, as received)</span>}>
      <div className="space-y-6 border-t border-border p-3 sm:p-4">
        {candidates.map((c, i) => (
          <Candidate key={`${c.pid ?? 'x'}-${i}`} candidate={c} index={i} />
        ))}
      </div>
    </Disclosure>
  )
}

function Candidate({ candidate: c, index }: { candidate: ProductCandidate; index: number }) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card" data-testid="candidate">
      <header className="border-b border-border p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Candidate {index + 1} (unverified grouping)</p>
        <h3 className="mt-1 text-base font-medium text-foreground">{c.title ?? 'Untitled product'}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {c.offerCount} offer{c.offerCount === 1 ? '' : 's'} reported
          {c.offers.length < c.offerCount ? `, ${c.offers.length} shown` : ''}
          {c.productRef ? ` · id ${c.productRef.id}` : ''}
          {c.conditionLabel ? ` · feed condition label: ${c.conditionLabel}` : ''}
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Merchant</th>
              <th className="px-4 py-2 font-medium">Listing title</th>
              <th className="px-4 py-2 font-medium">Price</th>
              <th className="px-4 py-2 font-medium">Stock</th>
              <th className="px-4 py-2 font-medium">Delivery</th>
              <th className="px-4 py-2 font-medium">Condition</th>
            </tr>
          </thead>
          <tbody>
            {c.offers.map((o, i) => (
              <OfferRow key={i} offer={o} />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}

function OfferRow({ offer: o }: { offer: NormalizedOffer }) {
  return (
    <tr className="border-t border-border align-top" data-testid="offer-row">
      <td className="px-4 py-2">
        {o.listingUrl ? (
          <a href={o.listingUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline-offset-2 hover:underline">
            {o.seller ?? 'Unknown merchant'}
          </a>
        ) : (
          <span>{o.seller ?? 'Unknown merchant'}</span>
        )}
      </td>
      <td className="max-w-xs px-4 py-2 text-muted-foreground">{o.title ?? 'Not provided'}</td>
      <td className="whitespace-nowrap px-4 py-2 font-medium text-foreground">{formatPrice(o.price, o.currency)}</td>
      <td className="px-4 py-2 text-muted-foreground">{o.stockText ?? 'Unknown'}</td>
      <td className="px-4 py-2 text-muted-foreground">{o.deliveryInfo ?? 'Not provided'}</td>
      <td className="px-4 py-2 text-muted-foreground">Unknown</td>
    </tr>
  )
}

// ------------------------------------------------------------------ formatting

function describeUpstream(s: SearchSource): string {
  if (s.upstreamCacheSource === 'miss') return 'Live scrape at request time'
  if (!s.upstreamCacheSource) return 'Unknown'
  const age = s.upstreamCacheAgeSeconds
  return `Served from the price feed's own cache (${s.upstreamCacheSource}${age != null ? `, ${formatWait(Math.round(age))} old` : ''}); not a new scrape`
}
