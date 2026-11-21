/**
 * Product search page (Day 2 vertical slice).
 *
 * Flow: form submit -> searchProducts() -> POST /api/actions/searchProducts ->
 * Worker action -> cache / PricesAPI -> normalized result -> rendered below.
 * Day 3: for supported products the offers are matched and compared by the
 * deterministic module in src/lib/matching; other searches show raw offers.
 * A clearly labelled saved sample (real Day 1 data) can be loaded for demos; it
 * never replaces a live result and is never used when a live search fails.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Button, Input } from '@/components/ui'
import { searchProducts } from '@/lib/api'
import { ComparisonView, formatPrice } from '@/components/comparison/ComparisonView'
import { SaveControl } from '@/components/saved/SaveControl'
import { ErrorPanel } from '@/components/SearchPanels'
import { formatTime, formatWait } from '@/lib/format'
import { detectTarget } from '@/lib/matching'
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
  label: string
  query: string
  candidates: ProductCandidate[]
  source: SearchSource
}

const SAMPLES: { key: string; label: string; query: string; load: () => Promise<{ default: { candidates: ProductCandidate[]; source: SearchSource } }> }[] = [
  { key: 'sony', label: 'Sony WH-1000XM5', query: 'Sony WH-1000XM5', load: () => import('../../../../tests/fixtures/real-sony.normalized.json') as never },
  { key: 'logitech', label: 'Logitech MX Master 3S', query: 'Logitech MX Master 3S', load: () => import('../../../../tests/fixtures/real-logitech.normalized.json') as never },
  { key: 'samsung', label: 'Samsung 990 PRO 2TB', query: 'Samsung 990 PRO 2TB', load: () => import('../../../../tests/fixtures/real-samsung.normalized.json') as never },
]

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)

  // Cancel any in-flight request if the page unmounts.
  useEffect(() => () => controller.current?.abort(), [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (state.status === 'loading') return
    const q = query.trim()
    if (q.length < 2) {
      setState({ status: 'error', failure: { success: false, code: 'invalid_query', error: 'Enter at least 2 characters.' } })
      return
    }
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    setState({ status: 'loading', query: q })
    try {
      const r = await searchProducts(q, c.signal)
      setState(r.success ? { status: 'done', response: r.data } : { status: 'error', failure: r })
    } catch {
      /* aborted: ignore */
    }
  }

  const loading = state.status === 'loading'

  async function loadSample(key: string) {
    const def = SAMPLES.find((x) => x.key === key)
    if (!def || loading) return
    const mod = await def.load()
    const fx = mod.default
    setState({ status: 'sample', sample: { label: def.label, query: def.query, candidates: fx.candidates, source: fx.source } })
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">DealProof</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Compare prices without comparing the wrong products. Supported products (Sony WH-1000XM5,
        Logitech MX Master 3S, Samsung 990 PRO) are matched by model and variant before prices are compared.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex gap-2" role="search">
        <Input
          data-testid="search-input"
          aria-label="Product name"
          placeholder="e.g. Sony WH-1000XM5"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <Button type="submit" data-testid="search-submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {state.status === 'loading' && <LoadingPanel query={state.query} />}
      {state.status === 'error' && <ErrorPanel failure={state.failure} />}
      {state.status === 'done' && <Results response={state.response} />}
      {state.status === 'sample' && <SampleResults sample={state.sample} />}
      {state.status === 'idle' && (
        <p className="mt-8 text-sm text-muted-foreground">
          Try a specific product name. Fresh searches are limited per user per day; repeated
          searches are served from a 12-hour cache.
        </p>
      )}
      {(state.status === 'idle' || state.status === 'error' || state.status === 'sample') && (
        <div className="mt-6 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground" data-testid="sample-picker">
          <p>
            No search credits left or just exploring? Load a <strong>saved sample</strong> (real search results
            captured on 19 Nov 2026, not live prices):
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SAMPLES.map((x) => (
              <Button key={x.key} type="button" variant="outline" onClick={() => loadSample(x.key)} data-testid={`sample-${x.key}`}>
                {x.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LoadingPanel({ query }: { query: string }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div data-testid="search-loading" role="status" aria-live="polite" className="mt-8 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden />
        <p className="text-sm font-medium text-foreground">Searching retailers for “{query}”… {seconds}s</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        A fresh live search usually takes 20–40 seconds. Please keep this page open.
      </p>
    </div>
  )
}

function Results({ response }: { response: SearchResponse }) {
  const { result, fromCache, quota } = response
  const hasAny = result.candidates.some((c) => c.offers.length > 0)
  return (
    <section className="mt-8" data-testid="search-results">
      <div className="rounded-lg border border-border bg-card p-3 text-sm" data-testid="result-meta">
        <p className="font-medium text-foreground">
          {fromCache ? 'Stored result' : 'New result'} for “{result.query}” (US market)
        </p>
        <p className="mt-1 text-muted-foreground">
          Prices observed by the source: <span className="text-foreground" data-testid="scraped-at">{formatTime(result.source.scrapedAt) ?? 'Unknown'}</span>
          {' · '}stored by DealProof: <span className="text-foreground">{formatTime(result.cachedAt)}</span>
          {' · '}fresh searches left today: <span className="text-foreground">{quota.userRemainingToday} of {quota.userDailyLimit}</span>
        </p>
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">About this data</summary>
          <p className="mt-1" data-testid="upstream-source">Price feed: {describeUpstream(result.source)}</p>
          {fromCache && <p>The DealProof cache entry expires {formatTime(result.expiresAt)}.</p>}
          <p className="mt-1">
            Prices come from a retailer data feed and are <strong>not independently verified</strong>.
            Condition is unknown unless a listing says otherwise, and shipping is often missing.
          </p>
        </details>
      </div>

      {hasAny && <Compared query={result.query} candidates={result.candidates} scrapedAt={result.source.scrapedAt} />}

      {!hasAny ? (
        <div data-testid="search-empty" className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium text-foreground">No retailer offers found</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a more specific name or model number. This search did not use any of your daily allowance.</p>
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
      <p data-testid="unsupported" className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        DealProof can only match Sony WH-1000XM5, Logitech MX Master 3S and Samsung 990 PRO so far. For
        “{query}” the raw retailer offers are shown below, unmatched.
      </p>
    )
  }
  return (
    <div className="mt-6">
      {/* keyed so a new result or another sample starts from its own product and variant */}
      <ComparisonView
        key={`${query}|${scrapedAt ?? ''}`}
        offers={offers}
        scrapedAt={scrapedAt}
        initialTarget={target}
        renderActions={(t) =>
          isSample ? (
            <p className="max-w-xs text-xs text-muted-foreground sm:text-right" data-testid="save-unavailable">
              Saving needs a live comparison. This is a bundled demo sample, which is not stored on the server, so it cannot be reopened later.
            </p>
          ) : (
            <SaveControl target={t} query={query} />
          )
        }
      />
    </div>
  )
}

function RawOffers({ candidates }: { candidates: ProductCandidate[] }) {
  return (
    <details className="mt-6 rounded-lg border border-border bg-card" data-testid="raw-offers">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Raw feed groupings (unmatched, as received)</summary>
      <div className="space-y-6 p-2">
        {candidates.map((c, i) => (
          <Candidate key={`${c.pid ?? 'x'}-${i}`} candidate={c} index={i} />
        ))}
      </div>
    </details>
  )
}

function SampleResults({ sample }: { sample: Sample }) {
  return (
    <section className="mt-8" data-testid="sample-results">
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm" role="note">
        <p className="font-medium text-foreground">Saved sample, not a live search: {sample.label}</p>
        <p className="mt-1 text-muted-foreground">
          These are real offers captured on {formatTime(sample.source.scrapedAt) ?? 'an unknown date'}. Prices
          and stock have almost certainly changed. This did not use a search credit.
        </p>
      </div>
      <Compared query={sample.query} candidates={sample.candidates} scrapedAt={sample.source.scrapedAt} isSample />
      <RawOffers candidates={sample.candidates} />
    </section>
  )
}

function Candidate({ candidate: c, index }: { candidate: ProductCandidate; index: number }) {
  return (
    <article className="rounded-lg border border-border bg-card" data-testid="candidate">
      <header className="border-b border-border p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Candidate {index + 1} (unverified grouping)</p>
        <h2 className="mt-1 text-base font-medium text-foreground">{c.title ?? 'Untitled product'}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {c.offerCount} offer{c.offerCount === 1 ? '' : 's'} reported
          {c.offers.length < c.offerCount ? `, ${c.offers.length} shown` : ''}
          {c.productRef ? ` · id ${c.productRef.id}` : ''}
          {c.conditionLabel ? ` · feed condition label: ${c.conditionLabel}` : ''}
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
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
