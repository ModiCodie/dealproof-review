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
import { ArrowLeft, Bookmark, Info, RefreshCw, TriangleAlert } from 'lucide-react'
import { useMutations, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { ComparisonView } from '@/components/comparison/ComparisonView'
import { ErrorPanel } from '@/components/SearchPanels'
import { Notice, Page, Skeleton } from '@/components/dp/ui'
import { usePageTitle } from '@/lib/use-page-title'
import { captureSavedSnapshot, discardSavedSnapshot, getSavedComparison, searchProducts } from '@/lib/api'
import { formatAge, formatTime } from '@/lib/format'
import type { SearchFailure, SearchQuota, SearchResult } from '@/lib/pricing-types'
import { parseSaved, savedOffers, SAVED_COLLECTION, type SavedRow, type SavedSnapshot } from '@/lib/saved'
import { UNRESOLVED_TEXT } from '@/lib/saved-candidate'

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: SearchResult | null; stale: boolean; quota: SearchQuota; snapshot: SavedSnapshot | null }

export default function SavedProductPage() {
  const { id = '' } = useParams()
  usePageTitle('Saved product')
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
  // Why the last refresh did not update the prices: the search failed, or the saved product could not be confirmed in the result.
  const [refreshProblem, setRefreshProblem] = useState<{ kind: 'unconfirmed' | 'not_stored'; detail: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const owned = status === 'ready' && !!rec
  useEffect(() => {
    if (!owned) return
    const c = new AbortController()
    setLoad({ status: 'loading' })
    getSavedComparison(id, c.signal)
      .then((r) => {
        setLoad(r.success ? { status: 'ready', result: r.data.result, stale: r.data.stale, quota: r.data.quota, snapshot: r.data.snapshot ?? null } : { status: 'error', message: r.error })
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
    setRefreshProblem(null)
    try {
      const r = await searchProducts(saved.query)
      if (!r.success) {
        setRefreshFailure(r) // nothing was changed: the last saved prices stay as they were
        return
      }
      const fromCacheNote = r.data.fromCache
        ? 'The stored data was still inside the 12-hour window, so no new search was run and no search was used.'
        : 'Fetched new prices. This used one of your fresh searches today.'
      if (!saved.candidate) {
        setLoad({ status: 'ready', result: r.data.result, stale: false, quota: r.data.quota, snapshot: null })
        setRefreshNote(fromCacheNote)
        return
      }
      // General products: the server copies this product group's prices into the saved snapshot, or changes nothing.
      const cap = await captureSavedSnapshot(id)
      if (cap.success && cap.data.captured) {
        setLoad({ status: 'ready', result: r.data.result, stale: false, quota: r.data.quota, snapshot: cap.data.snapshot })
        setRefreshNote(fromCacheNote)
      } else {
        // never switch to another product group, never overwrite what was saved
        setLoad((l) => (l.status === 'ready' ? { ...l, quota: r.data.quota } : l))
        setRefreshProblem(
          cap.success && !cap.data.captured
            ? { kind: cap.data.reason === 'identity_unconfirmed' ? 'unconfirmed' : 'not_stored', detail: cap.data.detail }
            : { kind: 'not_stored', detail: 'The new prices could not be saved. Your saved prices were not changed.' },
        )
      }
    } catch {
      /* aborted */
    } finally {
      setRefreshing(false)
    }
  }, [saved, refreshing, id])

  async function remove() {
    try {
      await removeConfirmed(id)
      void discardSavedSnapshot(id)
      navigate('/saved')
    } catch {
      setRemoveError('Could not remove it. Please try again.')
    }
  }

  if (status === 'loading') {
    return (
      <Shell>
        <div className="space-y-3" data-testid="saved-loading" role="status">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Shell>
    )
  }
  if (!rec || !saved) {
    return (
      <Shell>
        <div className="rounded-2xl border border-dashed border-input bg-card p-10 text-center" data-testid="saved-not-found">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Bookmark className="size-6" aria-hidden />
          </span>
          <p className="mt-4 text-base font-semibold text-foreground">Saved product not found</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">It may have been removed, or it is not in your saved list.</p>
          <Link to="/saved" className="mt-5 inline-flex h-10 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground hover:bg-muted">Back to saved products</Link>
        </div>
      </Shell>
    )
  }

  const result = load.status === 'ready' ? load.result : null
  const snapshot = load.status === 'ready' ? load.snapshot : null
  const hasOffers = (!!result && result.candidates.some((c) => c.offers.length > 0)) || !!snapshot
  // Generic products compare only the saved product group; see savedOffers.
  // A saved snapshot (the last captured prices) is what a general product shows; the shared cache is only a fallback for
  // records that have none yet, and for the specialised families.
  const { offers, resolution } = snapshot ? { offers: snapshot.offers, resolution: null } : result ? savedOffers(saved, result.candidates) : { offers: [], resolution: null }
  const unresolved = !snapshot && hasOffers && resolution?.status === 'unresolved' ? resolution : null
  const snapshotAgeMs = snapshot ? Date.now() - new Date(snapshot.capturedAt).getTime() : 0
  const snapshotOld = snapshotAgeMs > 12 * 3_600_000
  const quota = load.status === 'ready' ? load.quota : null
  const stale = load.status === 'ready' && !snapshot && load.stale
  const missing = load.status === 'ready' && !hasOffers
  const needsSearch = stale || missing || snapshotOld

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl" data-testid="saved-title">{saved.displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Saved {formatTime(saved.savedAt) ?? 'at an unknown time'}</p>
        </div>
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={!ready} data-testid="saved-remove-confirm">Confirm remove</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmRemove(true)} disabled={!ready} data-testid="saved-remove">Remove from saved</Button>
        )}
      </div>
      {removeError && <p role="alert" className="mt-2 text-sm text-destructive">{removeError}</p>}

      <Notice testId="not-monitoring" tone="neutral" icon={Info} className="mt-4">
        Saving is a bookmark, not monitoring. DealProof does not check prices in the background, and these are
        the prices as last stored, not today’s.
      </Notice>

      {load.status === 'loading' && (
        <div className="mt-6 space-y-3" role="status" data-testid="saved-loading">
          <span className="sr-only">Loading the stored comparison…</span>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
      {load.status === 'error' && (
        <Notice testId="saved-load-error" role="alert" tone="error" icon={TriangleAlert} className="mt-6" title="Could not load the stored comparison">
          {load.message}
        </Notice>
      )}

      {load.status === 'ready' && (
        <section className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(18,23,34,0.05)] sm:p-5" data-testid="data-status">
          <h2 className="text-base font-semibold text-foreground">Price data</h2>
          {hasOffers && (snapshot || result) ? (() => {
            const observed = snapshot ? snapshot.source.scrapedAt : result!.source.scrapedAt
            const storedAt = snapshot ? snapshot.capturedAt : result!.cachedAt
            return (
              <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Prices observed by source</dt>
                  <dd className="mt-0.5 text-foreground" data-testid="observed-at">
                    {formatTime(observed) ?? 'Unknown'}
                    {observed ? ` (${formatAge(observed)})` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{snapshot ? 'Last captured by DealProof' : 'Stored by DealProof'}</dt>
                  <dd className="mt-0.5 text-foreground" data-testid="cached-at">{formatTime(storedAt)} ({formatAge(storedAt)})</dd>
                </div>
              </dl>
            )
          })() : null}

          {snapshot && (
            <Notice testId="snapshot-status" role="note" tone={snapshotOld ? 'caution' : 'neutral'} icon={snapshotOld ? TriangleAlert : Info} className="mt-4" title="Last saved prices">
              These are the prices DealProof last captured for this product ({formatTime(snapshot.capturedAt) ?? 'at an unknown time'}), not today’s prices.
              {snapshotOld ? ' They are more than 12 hours old.' : ''} They change only when you refresh and the product is confirmed.
              {snapshot.truncated ? ' Only part of a very long listing set was kept.' : ''}
            </Notice>
          )}

          {stale && (
            <Notice testId="stale-banner" role="note" tone="caution" icon={TriangleAlert} className="mt-4" title="These prices are out of date">
              DealProof stored them more than 12 hours ago and has not refreshed them.
              Treat them as a record of the past, not a current price.
            </Notice>
          )}
          {missing && (
            <Notice testId="missing-banner" role="note" tone="neutral" icon={Info} className="mt-4" title="No stored prices for this search">
              DealProof has no stored prices for this search (they were never stored, or are no longer available).
              Nothing was fetched automatically.
            </Notice>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="button" onClick={refresh} disabled={refreshing} data-testid="refresh-button">
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} aria-hidden />
              {refreshing ? 'Refreshing… (can take 20–40 s)' : needsSearch ? 'Get fresh prices' : 'Refresh prices'}
            </Button>
            <p className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="refresh-hint">
              {needsSearch
                ? `This runs a new search and uses one of your fresh searches today${quota ? ` (${quota.userRemainingToday} of ${quota.userDailyLimit} left)` : ''}.`
                : `Stored data is less than 12 hours old, so this reloads it without using a search${quota ? ` (${quota.userRemainingToday} of ${quota.userDailyLimit} fresh searches left today)` : ''}.`}
            </p>
          </div>
          {refreshNote && <p role="status" className="mt-3 text-sm text-foreground" data-testid="refresh-note"><span className="font-medium">Newly refreshed prices.</span> {refreshNote}</p>}
          {refreshFailure && (
            <>
              <Notice testId="refresh-failed" role="note" tone="caution" icon={TriangleAlert} className="mt-3" title="Refresh unsuccessful">
                {snapshot ? `Your last saved prices (captured ${formatTime(snapshot.capturedAt) ?? 'at an unknown time'}) were not changed.` : 'Nothing was changed.'}
              </Notice>
              <ErrorPanel failure={refreshFailure} />
            </>
          )}
          {refreshProblem && (
            <Notice testId="identity-unconfirmed" role="note" tone="caution" icon={TriangleAlert} className="mt-3" title={refreshProblem.kind === 'unconfirmed' ? 'Refresh could not confirm the product' : 'Refresh could not be saved'}>
              {refreshProblem.detail}{' '}
              {refreshProblem.kind === 'unconfirmed'
                ? `DealProof did not switch to another product and did not change your saved prices${snapshot ? ` (captured ${formatTime(snapshot.capturedAt) ?? 'at an unknown time'})` : ''}.`
                : ''}
            </Notice>
          )}
        </section>
      )}

      {unresolved && (
        <Notice testId="candidate-unresolved" role="note" tone="caution" icon={TriangleAlert} className="mt-6" title="The product you saved can’t be identified in the stored data">
          {UNRESOLVED_TEXT[unresolved.reason]} To avoid showing another product’s offers, nothing is compared. Use “{needsSearch ? 'Get fresh prices' : 'Refresh prices'}” to look again, or search for the product and save it afresh.
        </Notice>
      )}
      {snapshot && (
        <p className="mt-6 text-sm text-muted-foreground" data-testid="saved-candidate">
          Product group: <span className="text-foreground">“{snapshot.candidate.title}”</span>
        </p>
      )}
      {resolution?.status === 'matched' && (
        <p className="mt-6 text-sm text-muted-foreground" data-testid="saved-candidate">
          Product group: <span className="text-foreground">“{resolution.title}”</span>
          {resolution.basis === 'ids_and_title' ? ' (matched by the feed’s product id and title)' : ''}
        </p>
      )}
      {resolution?.status === 'matched' && resolution.basis === 'title_only' && (
        <Notice testId="candidate-legacy" role="note" tone="neutral" icon={Info} className="mt-3">
          This product was saved before DealProof recorded which product group was chosen. It was matched to the group with the same title; check it is the one you meant.
        </Notice>
      )}
      {hasOffers && (snapshot || result) && offers.length > 0 && (
        <div className="mt-6">
          <ComparisonView
            key={`${saved.productKey}|${snapshot ? `${snapshot.source.scrapedAt ?? ''}|${snapshot.capturedAt}` : `${result?.source.scrapedAt ?? ''}|${result?.cachedAt}`}`}
            offers={offers}
            scrapedAt={snapshot ? snapshot.source.scrapedAt : (result?.source.scrapedAt ?? null)}
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
    <Page>
      <Link to="/saved" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Saved products
      </Link>
      <div className="mt-4">{children}</div>
    </Page>
  )
}
