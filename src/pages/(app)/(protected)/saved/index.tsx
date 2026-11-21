/**
 * Saved products: the signed-in user's own list.
 *
 * Data comes from `useQuery('saved_products')`. The record Durable Object only
 * sends rows the caller owns, so this page cannot show anyone else's list even
 * if it wanted to. Opening one navigates to /saved/<id>.
 *
 * Each card shows the last price DealProof has *stored* for that product. That
 * uses `getSavedComparison`, which only reads the cache the server already has:
 * it can never start a paid search (refreshing is a separate, explicit action
 * on the detail page).
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bookmark, TriangleAlert } from 'lucide-react'
import { useMutations, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { Notice, Page, Skeleton } from '@/components/dp/ui'
import { ProductIcon } from '@/components/dp/ProductIcon'
import { formatPrice } from '@/components/comparison/ComparisonView'
import { getSavedComparison } from '@/lib/api'
import { formatAge, formatDate } from '@/lib/format'
import { buildComparison } from '@/lib/matching'
import { parseSaved, savedOffers, SAVED_COLLECTION, type SavedProduct, type SavedRow } from '@/lib/saved'
import { usePageTitle } from '@/lib/use-page-title'
import { cn } from '@/lib/utils'

export default function SavedPage() {
  usePageTitle('Saved')
  const { records, status, error } = useQuery<SavedRow>(SAVED_COLLECTION, { orderBy: 'createdAt', orderDir: 'desc' })
  // Disable every remove control until the record room can accept writes (the list itself is gated by `status`).
  const { ready, removeConfirmed } = useMutations<Omit<SavedRow, 'userId'>>(SAVED_COLLECTION)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function remove(id: string) {
    try {
      await removeConfirmed(id)
      setNotice('Removed from your saved products.')
    } catch {
      setNotice('Could not remove it. Please try again.')
    } finally {
      setPendingRemove(null)
    }
  }

  const items = records.map((r) => ({ rec: r, parsed: parseSaved(r) }))

  return (
    <Page>
      <h1 className="text-3xl font-semibold text-foreground">Saved products</h1>
      <p className="mt-2 max-w-2xl text-base text-muted-foreground">
        Bookmarks for the exact product and variant you chose. Saving does <strong className="font-medium text-foreground">not</strong> monitor prices: each product reopens with the prices DealProof last stored, and you refresh them when you want to.
      </p>

      <p role="status" aria-live="polite" data-testid="saved-notice" className={cn('mt-4 text-sm', notice && 'rounded-xl bg-ok-soft px-3.5 py-2.5 text-foreground')}>
        {notice}
      </p>

      {status === 'loading' && (
        <div className="mt-6 space-y-3" data-testid="saved-loading" role="status">
          <span className="sr-only">Loading your saved products…</span>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {status === 'error' && (
        <Notice testId="saved-error" role="alert" tone="error" icon={TriangleAlert} className="mt-6" title="Could not load your saved products">
          {error ? `${error}. ` : ''}Reload the page to try again.
        </Notice>
      )}

      {status === 'ready' && items.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-input bg-card p-10 text-center" data-testid="saved-empty">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Bookmark className="size-6" aria-hidden />
          </span>
          <p className="mt-4 text-base font-semibold text-foreground">Nothing saved yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Check live prices for a product, pick the exact variant, and choose “Save for later” to keep it here.
          </p>
          <Link to="/search" className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
            Compare prices <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      )}

      {status === 'ready' && items.length > 0 && (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2" data-testid="saved-list">
          {items.map(({ rec, parsed }) => (
            <li key={rec.recordId} className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(18,23,34,0.05)] sm:p-5" data-testid="saved-item">
              {parsed ? (
                <SavedCard
                  saved={parsed}
                  ready={ready}
                  confirming={pendingRemove === rec.recordId}
                  onAskRemove={() => setPendingRemove(rec.recordId)}
                  onCancel={() => setPendingRemove(null)}
                  onConfirm={() => remove(rec.recordId)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">This saved item is not a recognised product and cannot be opened.</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => remove(rec.recordId)} disabled={!ready} data-testid="saved-remove-invalid">Remove</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

function SavedCard({
  saved,
  ready,
  confirming,
  onAskRemove,
  onCancel,
  onConfirm,
}: {
  saved: SavedProduct
  ready: boolean
  confirming: boolean
  onAskRemove: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3">
        <ProductIcon family={saved.target.family} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground" data-testid="saved-name">{saved.displayName}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Saved {formatDate(saved.savedAt) ?? 'at an unknown time'}</p>
        </div>
      </div>

      <LastPrice id={saved.recordId} saved={saved} />

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Link
          to={`/saved/${saved.recordId}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          data-testid="saved-open"
        >
          Open <ArrowRight className="size-4" aria-hidden />
        </Link>
        <span className="flex-1" />
        {confirming ? (
          <>
            <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={!ready} data-testid="saved-remove-confirm">
              Confirm remove
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onAskRemove} disabled={!ready} data-testid="saved-remove">
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

type Last =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ok'; price: string; seller: string | null; observed: string | null; storedAgo: string | null; stale: boolean; flagged: boolean }

/** The lowest reported matching offer in the data already stored for this product. Read-only; never a paid search. */
function LastPrice({ id, saved }: { id: string; saved: SavedProduct }) {
  const [last, setLast] = useState<Last>({ status: 'loading' })
  // `target` is rebuilt on every parent render; read it through a ref so only a different record re-fetches.
  const savedRef = useRef(saved)
  savedRef.current = saved
  useEffect(() => {
    const c = new AbortController()
    getSavedComparison(id, c.signal)
      .then((r) => {
        if (!r.success || !r.data.result) return setLast({ status: 'none' })
        const { result, stale } = r.data
        // same scoping as the detail page, so the list never shows another product group's price
        const { offers } = savedOffers(savedRef.current, result.candidates)
        const cheapest = offers.length ? buildComparison(savedRef.current.target, offers, result.source.scrapedAt).cheapest : null
        if (!cheapest) return setLast({ status: 'none' })
        const o = cheapest.offer
        setLast({
          status: 'ok',
          price: formatPrice(o.offer.price, o.offer.currency),
          seller: o.seller.raw,
          observed: formatDate(result.source.scrapedAt),
          storedAgo: formatAge(result.cachedAt),
          stale,
          flagged: cheapest.flagged,
        })
      })
      .catch(() => {
        /* aborted */
      })
    return () => c.abort()
  }, [id])

  return (
    <div className="mt-4 rounded-xl bg-muted/60 px-4 py-3" data-testid="saved-last-price">
      {last.status === 'loading' && <Skeleton className="h-10 w-2/3" />}
      {last.status === 'none' && <p className="text-sm text-muted-foreground">No stored prices yet. Open it to get fresh prices.</p>}
      {last.status === 'ok' && (
        <>
          <p className="text-xs text-muted-foreground">Last stored lowest reported price</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-foreground">
            <span className="text-2xl font-semibold tabular-nums">{last.price}</span>
            {last.seller && <span className="text-sm text-muted-foreground">at {last.seller}</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Observed {last.observed ?? 'at an unknown time'}
            {last.storedAgo ? ` · stored ${last.storedAgo}` : ''}
            {last.stale ? ' · out of date' : ''}
          </p>
          {last.flagged && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-caution">
              <TriangleAlert className="size-3.5" aria-hidden /> Flagged as unusually low. Open it to review.
            </p>
          )}
        </>
      )}
    </div>
  )
}
