/**
 * Compare page (route /search).
 *
 * Flow: search text -> product candidates -> pick the intended product -> compare.
 *   - A typed search is an explicit action (Enter or "Find product"): nothing is
 *     requested while typing, choosing a featured product, switching variants or
 *     navigating. It calls the PricesAPI-backed server action (per-user daily
 *     limit, 12-hour cache, in-flight de-duplication).
 *   - Text that names one of the featured products with hand-written rules
 *     (src/lib/catalog.ts) goes straight to that product's comparison.
 *   - Anything else shows the product groupings the API returned; the user picks
 *     one, and the generic matcher (src/lib/matching/generic.ts) compares every
 *     listing against it. DealProof never picks a grouping for the user unless
 *     exactly one clearly fits the search, and even then it can be changed.
 *   - Featured products keep their free "Explore demo" (bundled sample, never
 *     saved) next to "Check live prices".
 * The server still validates every query.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, Clock, FlaskConical, Info, Lock, Package, Search as SearchIcon, SearchX, Zap } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { searchProducts } from '@/lib/api'
import { ComparisonView, formatPrice } from '@/components/comparison/ComparisonView'
import { SaveControl } from '@/components/saved/SaveControl'
import { ErrorPanel } from '@/components/SearchPanels'
import { Disclosure, More, Notice, Page, Pill, Skeleton } from '@/components/dp/ui'
import { ProductIcon } from '@/components/dp/ProductIcon'
import { CATALOG, catalogProduct, variantSummary, type CatalogKey, type CatalogProduct } from '@/lib/catalog'
import { formatDate, formatTime, formatWait } from '@/lib/format'
import { detectTarget } from '@/lib/matching'
import { initialPick, noneConfirmed, offersForView, targetForCandidate, viewCandidates, type CandidateView } from '@/lib/candidates'
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
  // No featured product is pre-selected: the search box is the main way in.
  const [productKey, setProductKey] = useState<CatalogKey | null>(() => catalogProduct(params.get('product'))?.key ?? null)
  const [queryText, setQueryText] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [state, setState] = useState<State>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const product = productKey ? catalogProduct(productKey) : null
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
    setHint(null)
    setProductKey(key)
    setParams({ product: key }, { replace: true })
    // Switching products while looking at the (free) demo shows that product's demo.
    // Anything else resets to the picker: a paid search is never started by choosing a product.
    if (state.status === 'sample') void loadDemo(key)
    else setState({ status: 'idle' })
  }

  /** The one place a paid search starts. Always called from an explicit button press or form submit. */
  async function runLive(query: string) {
    if (loading) return
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    setState({ status: 'loading', query })
    try {
      const r = await searchProducts(query, c.signal)
      setState(r.success ? { status: 'done', response: r.data } : { status: 'error', failure: r })
    } catch {
      /* aborted: ignore */
    }
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = queryText.replace(/\s+/g, ' ').trim()
    if (q.length < 2) {
      setHint('Enter at least 2 characters: a brand and model, such as “Dyson V15 Detect”.')
      return
    }
    setHint(null)
    setProductKey(null)
    setParams({}, { replace: true })
    void runLive(q)
  }

  return (
    <Page>
      <header className="max-w-2xl">
        <p className="text-sm font-medium text-primary">Price comparison</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground sm:text-4xl">Compare the right listings, not just the cheapest</h1>
        <p className="mt-3 text-base text-muted-foreground">
          Search for a product, pick the exact model, and compare offers from different retailers. Listings for a different model, size or generation are kept out of your comparison.
        </p>
      </header>

      <section className="mt-8" aria-labelledby="search-heading" data-testid="product-search">
        <form onSubmit={submitSearch} className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(18,23,34,0.05)] sm:p-5">
          <label htmlFor="product-search-input" id="search-heading" className="text-sm font-semibold text-foreground">Search for a product</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="product-search-input"
                data-testid="product-search-input"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                maxLength={100}
                autoComplete="off"
                placeholder="Brand and model, e.g. Apple AirPods Pro 2"
                aria-describedby="search-help"
                className="h-11 pl-9 text-base"
                disabled={loading}
              />
            </div>
            <Button type="submit" size="lg" disabled={loading} data-testid="product-search-submit">
              {loading ? 'Searching…' : 'Find product'}
            </Button>
          </div>
          <p id="search-help" className="mt-2 text-xs text-muted-foreground">
            Nothing is searched until you press Find product. A new search uses one of your daily fresh searches; a result stored in the last 12 hours is free. Searching covers US retailers in the price feed, not the whole web.
          </p>
          {hint && <p role="alert" data-testid="product-search-hint" className="mt-2 text-sm text-destructive">{hint}</p>}
        </form>
      </section>

      <ProductPicker products={CATALOG} value={productKey} onChange={choose} disabled={loading} />

      {product && productKey && (
      <section className="mt-6" aria-labelledby="how-heading" data-testid="sample-picker">
        <h2 id="how-heading" className="text-sm font-semibold text-foreground">
          Choose how to compare {product.brand} {product.model}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ActionCard
            icon={<FlaskConical className="size-5" aria-hidden />}
            title="Explore demo"
            badge={<Pill tone="neutral">Free</Pill>}
            body={`Saved real offers from ${formatDate(SAMPLE_CAPTURED)}. No search credit used. Demo results can’t be saved.`}
          >
            <Button type="button" variant="outline" onClick={() => void loadDemo(productKey as CatalogKey)} disabled={loading} data-testid={`sample-${productKey}`}>
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
            <Button type="button" onClick={() => void runLive(product.query)} disabled={loading} data-testid="search-submit">
              {loading ? 'Checking…' : 'Check live prices'}
            </Button>
          </ActionCard>
        </div>
      </section>
      )}

      {state.status === 'loading' && <LoadingPanel query={state.query} />}
      {state.status === 'error' && <ErrorPanel failure={state.failure} />}
      {state.status === 'done' && <Results response={state.response} />}
      {state.status === 'sample' && <SampleResults sample={state.sample} />}
      {state.status === 'idle' && <Legend />}
    </Page>
  )
}

// ------------------------------------------------------------------ picker

function ProductPicker({ products, value, onChange, disabled }: { products: readonly CatalogProduct[]; value: CatalogKey | null; onChange: (k: CatalogKey) => void; disabled: boolean }) {
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = products[(i + step + products.length) % products.length]
    onChange(next.key)
    ;(e.currentTarget.parentElement?.querySelector(`[data-key="${next.key}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <section className="mt-8" aria-labelledby="pick-heading" data-testid="featured">
      <h2 id="pick-heading" className="text-sm font-semibold text-foreground">Or start with a featured product</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">These have hand-written matching rules and a free demo. They are examples, not the only products you can search.</p>
      <div role="radiogroup" aria-labelledby="pick-heading" data-testid="product-picker" className="mt-3 grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {products.map((p, i) => {
          const selected = p.key === value
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (value === null && i === 0) ? 0 : -1}
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
    { tone: 'ok', label: 'Title match', text: 'The listing title names your model and every variant detail you chose. Based on the title only, not verified.' },
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
          <p className="mt-3 text-sm font-medium text-foreground">No retailer offers found for “{result.query}”</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">The price feed returned nothing for this search. Try the brand and model name (for example “Sony WH-1000XM5”), or check the spelling. This search did not use any of your daily allowance, and the price feed does not cover every product.</p>
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
  if (!target) return <GeneralCompared key={`${query}|${scrapedAt ?? ''}`} query={query} candidates={candidates} offers={offers} scrapedAt={scrapedAt} />
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

/** Any product without hand-written rules: choose the intended product group, then compare against it. */
function GeneralCompared({ query, candidates, offers, scrapedAt }: { query: string; candidates: ProductCandidate[]; offers: NormalizedOffer[]; scrapedAt: string | null }) {
  const views = useMemo(() => viewCandidates(query, candidates), [query, candidates])
  const [pick, setPick] = useState<number | null>(() => initialPick(views))
  const chosenView = views.find((v) => v.index === pick) ?? null
  // A group the search text itself rules out is never compared: the search defines the product, so comparing
  // it would show one product's name above another product's offers.
  const mismatch = chosenView?.fit === 'different' ? chosenView : null
  const chosen = pick === null || mismatch ? null : candidates[pick]
  // The comparison uses the chosen group's own listings. Groups are the feed's separate products and share almost no
  // listings, so pooling them let one product's offers appear under another product's name.
  const scoped = useMemo(() => (chosenView ? offersForView(chosenView, candidates) : []), [chosenView, candidates])
  const built = useMemo(() => (chosen ? targetForCandidate(query, chosen, scoped.map((o) => o.title)) : null), [query, chosen, scoped])
  return (
    <div className="space-y-6" data-testid="general-compare">
      <CandidatePicker views={views} value={pick} onChange={setPick} unconfirmed={noneConfirmed(views)} />
      {mismatch && (
        <Notice testId="pick-mismatch" tone="caution" icon={Info} role="note" title="This isn’t the product you searched for">
          “{mismatch.title}” differs from “{query}”{mismatch.note ? `: ${mismatch.note.replace(/\.$/, '')}` : ''}. Nothing is compared for it, so its offers can’t be mistaken for your product’s. To compare it, search for it by name.
        </Notice>
      )}
      {built && chosen && (
        <>
          {built.refined && (
            <Notice testId="refined-note" tone="neutral" role="note">
              Your search did not name a specific model, so DealProof used the model in the product you picked (“{built.target.spec.identity}”) to decide which listings match.
            </Notice>
          )}
          <ComparisonView
            key={`${query}|${scrapedAt ?? ''}|${pick}`}
            offers={scoped}
            scrapedAt={scrapedAt}
            initialTarget={built.target}
            renderActions={(t) => <SaveControl target={t} query={query} />}
          />
        </>
      )}
    </div>
  )
}

function CandidatePicker({ views, value, onChange, unconfirmed }: { views: CandidateView[]; value: number | null; onChange: (i: number) => void; unconfirmed?: boolean }) {
  const move = (e: KeyboardEvent, pos: number) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = views[(pos + step + views.length) % views.length]
    onChange(next.index)
    ;(e.currentTarget.parentElement?.querySelector(`[data-index="${next.index}"]`) as HTMLElement | null)?.focus()
  }
  const many = views.length > 1
  return (
    <section aria-labelledby="cand-heading" data-testid="candidate-picker" className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(18,23,34,0.05)] sm:p-5">
      <h2 id="cand-heading" className="text-base font-semibold text-foreground">{many ? 'Which product did you mean?' : 'Is this the product you meant?'}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {many
          ? 'The price feed found several different products for your search. Pick the one you want; DealProof then compares that group’s listings, judging each one by its own title.'
          : 'The price feed found one product. Check it is the one you want; DealProof compares listings against it using their titles.'}
      </p>
      {unconfirmed && (
        <p data-testid="candidates-unconfirmed" className="mt-2 text-sm text-foreground">
          None of these groups’ titles confirms exactly the product you searched for (a name or number is missing). Choosing one does not confirm it: each listing is still judged by its own title, and listings that don’t state the details stay uncertain.
        </p>
      )}
      <div role="radiogroup" aria-labelledby="cand-heading" className="mt-3 grid gap-2.5">
        {views.map((v, pos) => {
          const selected = v.index === value
          return (
            <button
              key={v.index}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (value === null && pos === 0) ? 0 : -1}
              data-index={v.index}
              data-testid={`candidate-${v.index}`}
              onClick={() => onChange(v.index)}
              onKeyDown={(e) => move(e, pos)}
              className={cn(
                'relative flex items-start gap-3 rounded-xl border bg-background p-3.5 text-left transition hover:border-input',
                selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden><Package className="size-[18px]" /></span>
              <span className="min-w-0 flex-1 pr-6">
                <span className="block text-sm font-semibold text-foreground">{v.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{v.offers} offer{v.offers === 1 ? '' : 's'}</span>
                  {v.feedLabel && <span>· feed label: {v.feedLabel}</span>}
                  {v.fit === 'fits' && <Pill tone="ok">Matches your search</Pill>}
                  {v.fit === 'unclear' && <Pill tone="neutral">Not confirmed</Pill>}
                  {v.fit === 'different' && <Pill tone="variant">Doesn’t match your search</Pill>}
                </span>
                {v.note && <span className="mt-1 block text-xs text-muted-foreground">{v.note}</span>}
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
      {value === null && <p className="mt-3 text-sm text-muted-foreground" data-testid="candidate-prompt">Pick a product above to see the comparison. Nothing is compared until you do.</p>}
    </section>
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
