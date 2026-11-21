/**
 * Reopen one saved product.
 *
 * Opening never triggers a paid request: `getSavedComparison` only reads what
 * the server already stored. If that data is old or missing, the page says so
 * and offers an explicit "Refresh prices" button, which goes through the same
 * `searchProducts` action (12-hour cache, per-user and global limits) as a
 * normal search. Two times are shown separately: when the price feed observed
 * the prices, and when DealProof stored them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutations, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { ComparisonView } from '@/components/comparison/ComparisonView'
import { ErrorPanel } from '@/components/SearchPanels'
import { getSavedComparison, searchProducts } from '@/lib/api'
import { formatAge, formatTime } from '@/lib/format'
import type { SearchFailure, SearchQuota, SearchResult } from '@/lib/pricing-types'
import { parseSaved, SAVED_COLLECTION, type SavedRow } from '@/lib/saved'

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: SearchResult | null; stale: boolean; quota: SearchQuota }

export default function SavedProductPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { records, status } = useQuery<SavedRow>(SAVED_COLLECTION)
  // Remove stays disabled until the record room can accept writes (`status` only says the list has loaded).
  const { ready, removeConfirmed } = useMutations<Omit<SavedRow, 'userId'>>(SAVED_COLLECTION)

  // The record list only ever contains this user's rows (enforced by the record DO).
  const rec = records.find((r) => r.recordId === id)
  const saved = useMemo(() => (rec ? parseSaved(rec) : null), [rec])

  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailure, setRefreshFailure] = useState<SearchFailure | null>(null)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const owned = status === 'ready' && !!rec
  useEffect(() => {
    if (!owned) return
    const c = new AbortController()
    setLoad({ status: 'loading' })
    getSavedComparison(id, c.signal)
      .then((r) => {
        setLoad(r.success ? { status: 'ready', result: r.data.result, stale: r.data.stale, quota: r.data.quota } : { status: 'error', message: r.error })
      })
      .catch(() => {
        /* aborted */
      })
    return () => c.abort()
  }, [id, owned])

  const refresh = useCallback(async () => {
    if (!saved || refreshing) return
    setRefreshing(true)
    setRefreshFailure(null)
    setRefreshNote(null)
    try {
      const r = await searchProducts(saved.query)
      if (r.success) {
        setLoad({ status: 'ready', result: r.data.result, stale: false, quota: r.data.quota })
        setRefreshNote(
          r.data.fromCache
            ? 'The stored data was still inside the 12-hour window, so no new search was run and no search was used.'
            : 'Fetched new prices. This used one of your fresh searches today.',
        )
      } else {
        setRefreshFailure(r)
      }
    } catch {
      /* aborted */
    } finally {
      setRefreshing(false)
    }
  }, [saved, refreshing])

  async function remove() {
    try {
      await removeConfirmed(id)
      navigate('/saved')
    } catch {
      setRemoveError('Could not remove it. Please try again.')
    }
  }

  if (status === 'loading') return <Shell><p className="text-sm text-muted-foreground" data-testid="saved-loading">Loading…</p></Shell>
  if (!rec || !saved) {
    return (
      <Shell>
        <div className="rounded-lg border border-dashed border-border p-8 text-center" data-testid="saved-not-found">
          <p className="text-sm font-medium text-foreground">Saved product not found</p>
          <p className="mt-1 text-sm text-muted-foreground">It may have been removed, or it is not in your saved list.</p>
          <Link to="/saved" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">Back to saved products</Link>
        </div>
      </Shell>
    )
  }

  const result = load.status === 'ready' ? load.result : null
  const hasOffers = !!result && result.candidates.some((c) => c.offers.length > 0)
  const offers = result ? result.candidates.flatMap((c) => c.offers) : []
  const quota = load.status === 'ready' ? load.quota : null
  const stale = load.status === 'ready' && load.stale
  const missing = load.status === 'ready' && !hasOffers
  const needsSearch = stale || missing

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="saved-title">{saved.displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Saved {formatTime(saved.savedAt) ?? 'at an unknown time'} · from the search “{saved.query}”</p>
        </div>
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={!ready} data-testid="saved-remove-confirm">Confirm remove</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRemove(true)} disabled={!ready} data-testid="saved-remove">Remove from saved</Button>
        )}
      </div>
      {removeError && <p role="alert" className="mt-2 text-sm text-foreground">{removeError}</p>}

      <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground" data-testid="not-monitoring">
        Saving is a bookmark, not monitoring. DealProof does not check prices in the background, and these are
        the prices as last stored, not today’s.
      </p>

      {load.status === 'loading' && (
        <p role="status" className="mt-6 text-sm text-muted-foreground" data-testid="saved-loading">Loading the stored comparison…</p>
      )}
      {load.status === 'error' && (
        <p role="alert" className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-foreground" data-testid="saved-load-error">
          Could not load the stored comparison: {load.message}
        </p>
      )}

      {load.status === 'ready' && (
        <section className="mt-6 rounded-lg border border-border bg-card p-4" data-testid="data-status">
          <h2 className="text-sm font-semibold text-foreground">Price data</h2>
          {hasOffers && result ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Prices observed by source</dt>
              <dd className="text-foreground" data-testid="observed-at">
                {formatTime(result.source.scrapedAt) ?? 'Unknown'}
                {result.source.scrapedAt ? ` (${formatAge(result.source.scrapedAt)})` : ''}
              </dd>
              <dt className="text-muted-foreground">Stored by DealProof</dt>
              <dd className="text-foreground" data-testid="cached-at">{formatTime(result.cachedAt)} ({formatAge(result.cachedAt)})</dd>
            </dl>
          ) : null}

          {stale && (
            <p className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm text-foreground" role="note" data-testid="stale-banner">
              These prices are out of date: DealProof stored them more than 12 hours ago and has not refreshed them.
              Treat them as a record of the past, not a current price.
            </p>
          )}
          {missing && (
            <p className="mt-3 rounded-md border border-border bg-muted/40 p-2 text-sm text-foreground" role="note" data-testid="missing-banner">
              DealProof has no stored prices for this search (they were never stored, or are no longer available).
              Nothing was fetched automatically.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={refresh} disabled={refreshing} data-testid="refresh-button">
              {refreshing ? 'Refreshing… (can take 20–40 s)' : needsSearch ? 'Get fresh prices' : 'Refresh prices'}
            </Button>
            <p className="text-xs text-muted-foreground" data-testid="refresh-hint">
              {needsSearch
                ? `This runs a new search and uses one of your fresh searches today${quota ? ` (${quota.userRemainingToday} of ${quota.userDailyLimit} left)` : ''}.`
                : `Stored data is less than 12 hours old, so this reloads it without using a search${quota ? ` (${quota.userRemainingToday} of ${quota.userDailyLimit} fresh searches left today)` : ''}.`}
            </p>
          </div>
          {refreshNote && <p role="status" className="mt-2 text-sm text-foreground" data-testid="refresh-note">{refreshNote}</p>}
          {refreshFailure && <ErrorPanel failure={refreshFailure} />}
        </section>
      )}

      {hasOffers && result && (
        <div className="mt-6">
          <ComparisonView
            key={`${saved.productKey}|${result.source.scrapedAt ?? ''}|${result.cachedAt}`}
            offers={offers}
            scrapedAt={result.source.scrapedAt}
            initialTarget={saved.target}
            lockVariant
          />
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link to="/saved" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">← Saved products</Link>
      <div className="mt-3">{children}</div>
    </div>
  )
}
