/**
 * "Save for later" / "Saved" control for one exact product + variant.
 *
 * Reads and writes the owner-only `saved_products` collection through the
 * DeepSpace record hooks. The browser never sends an owner id: the record
 * Durable Object stamps it from the session, and also refuses a duplicate
 * (same user + same product key), so double-clicking or two open tabs cannot
 * create two rows. Saving is a bookmark, not monitoring: no prices are copied
 * and nothing is checked in the background.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { useMutations, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { Pill } from '@/components/dp/ui'
import type { ProductTarget } from '@/lib/matching'
import { captureSavedSnapshot, discardSavedSnapshot } from '@/lib/api'
import type { ProductCandidate } from '@/lib/pricing-types'
import { productKey, SAVED_COLLECTION, toSavedRow, type SavedRow } from '@/lib/saved'

type NewSaved = Omit<SavedRow, 'userId'>

export function SaveControl({ target, query, candidate }: { target: ProductTarget; query: string; candidate?: ProductCandidate | null }) {
  const { records, status } = useQuery<SavedRow>(SAVED_COLLECTION)
  // `ready` = the record room can accept writes. It is separate from the query's `status`:
  // both must hold before a write control is enabled.
  const { ready, createConfirmed, removeConfirmed } = useMutations<NewSaved>(SAVED_COLLECTION)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const key = productKey(target)
  const existing = records.find((r) => r.data?.productKey === key)

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const id = await createConfirmed(toSavedRow(target, query, candidate))
      let note = 'Saved. DealProof does not monitor prices; reopen it from Saved and refresh when you want new data.'
      if (target.family === 'generic') {
        // keep the prices you just compared, so reopening never depends on the shared cache
        const r = await captureSavedSnapshot(id)
        note = r.success && r.data.captured
          ? 'Saved with these prices. DealProof does not monitor prices; reopen it from Saved and refresh when you want new data.'
          : 'Saved, but its prices could not be stored. Open it from Saved and use “Get fresh prices”. DealProof does not monitor prices.'
      }
      setMessage(note)
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      setMessage(/duplicate|already exists/i.test(text) ? 'Already saved.' : 'Could not save. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!existing) return
    setBusy(true)
    setMessage(null)
    try {
      await removeConfirmed(existing.recordId)
      void discardSavedSnapshot(existing.recordId)
      setMessage('Removed from your saved products.')
    } catch {
      setMessage('Could not remove. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end" data-testid="save-control">
      {existing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="ok" icon={BookmarkCheck} testId="save-state">Saved</Pill>
          <Link to={`/saved/${existing.recordId}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">View saved</Link>
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy || !ready} data-testid="unsave-button">
            Remove
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" onClick={save} disabled={busy || status !== 'ready' || !ready} data-testid="save-button">
          <Bookmark aria-hidden />
          {busy ? 'Saving…' : 'Save for later'}
        </Button>
      )}
      <p role="status" aria-live="polite" className="max-w-xs text-xs text-muted-foreground sm:text-right" data-testid="save-message">
        {message}
      </p>
    </div>
  )
}
