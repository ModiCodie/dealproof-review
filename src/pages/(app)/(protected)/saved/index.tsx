/**
 * Saved products: the signed-in user's own list.
 *
 * Data comes from `useQuery('saved_products')`. The record Durable Object only
 * sends rows the caller owns, so this page cannot show anyone else's list even
 * if it wanted to. Opening one navigates to /saved/<id>; nothing here calls the
 * price API.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutations, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { formatTime } from '@/lib/format'
import { parseSaved, SAVED_COLLECTION, type SavedRow } from '@/lib/saved'

export default function SavedPage() {
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
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Saved products</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A bookmark list for the exact product and variant you chose. Saving does <strong>not</strong> monitor prices:
        each product reopens with the prices DealProof last stored, and you refresh them yourself when you want to.
      </p>

      <p role="status" aria-live="polite" className="mt-3 text-sm text-foreground" data-testid="saved-notice">{notice}</p>

      {status === 'loading' && <p className="mt-6 text-sm text-muted-foreground" data-testid="saved-loading">Loading your saved products…</p>}
      {status === 'error' && (
        <p role="alert" className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-foreground" data-testid="saved-error">
          Could not load your saved products{error ? `: ${error}` : ''}. Reload the page to try again.
        </p>
      )}

      {status === 'ready' && items.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-border p-8 text-center" data-testid="saved-empty">
          <p className="text-sm font-medium text-foreground">Nothing saved yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Search for a product, pick the exact variant, and choose “Save for later” to keep it here.
          </p>
          <Link to="/search" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">Go to search</Link>
        </div>
      )}

      {status === 'ready' && items.length > 0 && (
        <ul className="mt-6 space-y-3" data-testid="saved-list">
          {items.map(({ rec, parsed }) => (
            <li key={rec.recordId} className="rounded-lg border border-border bg-card p-4" data-testid="saved-item">
              {parsed ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-foreground" data-testid="saved-name">{parsed.displayName}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Saved {formatTime(parsed.savedAt) ?? 'at an unknown time'} · from the search “{parsed.query}”
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/saved/${rec.recordId}`}
                        className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                        data-testid="saved-open"
                      >
                        Open
                      </Link>
                      {pendingRemove === rec.recordId ? (
                        <>
                          <Button type="button" variant="destructive" size="sm" onClick={() => remove(rec.recordId)} disabled={!ready} data-testid="saved-remove-confirm">
                            Confirm remove
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setPendingRemove(null)}>Cancel</Button>
                        </>
                      ) : (
                        <Button type="button" variant="outline" size="sm" onClick={() => setPendingRemove(rec.recordId)} disabled={!ready} data-testid="saved-remove">
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </>
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
    </div>
  )
}
