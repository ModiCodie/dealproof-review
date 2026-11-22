/**
 * Which product group a generic saved comparison belongs to.
 *
 * A search returns several product groups (candidates). Saving a comparison must
 * remember WHICH one the user picked, or reopening it pools unrelated groups.
 *
 * Identity recorded at save time (see `CandidateRef`):
 *   - the provider ids PricesAPI returns for the group (`pid`, `catalogId`, `clusterId`)
 *   - the group's cleaned title
 * The group's position in the result list is never used: ordering can change.
 *
 * Matching is deliberately conservative. A group is "the same" only when its
 * cleaned title is identical AND at least one provider id is equal. We have seen
 * only one real response, so we do not know that provider ids stay stable across
 * fresh searches; a changed id with the same title is therefore NOT trusted, and a
 * similar-but-different title is never trusted. When the saved group cannot be
 * identified, the caller shows a limitation and compares nothing.
 *
 * Records saved before this feature have the title but no ids. They are matched by
 * exact cleaned title only (and flagged as such); if no group has it they are
 * unresolved.
 */

import { cleanTitle } from './candidates'
import type { ProductCandidate } from './pricing-types'

export interface CandidateRef {
  pid: string | null
  catalogId: string | null
  clusterId: string | null
  /** The group's cleaned title as saved. */
  title: string
}

export const titleKey = (title: string | null): string => cleanTitle(title).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const idStr = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v).slice(0, 64))

/** What to remember about a picked group. */
export function candidateRef(c: ProductCandidate): CandidateRef {
  return { pid: idStr(c.pid), catalogId: idStr(c.catalogId), clusterId: idStr(c.clusterId), title: cleanTitle(c.title) }
}

export const hasProviderIds = (r: CandidateRef) => !!(r.pid || r.catalogId || r.clusterId)

export type Unresolved = 'missing' | 'ids_changed' | 'legacy'

export type Resolution =
  | { status: 'matched'; indices: number[]; basis: 'ids_and_title' | 'title_only'; title: string }
  | { status: 'unresolved'; reason: Unresolved }

function sameIds(a: CandidateRef, c: ProductCandidate): boolean {
  const b = candidateRef(c)
  return (!!a.pid && a.pid === b.pid) || (!!a.catalogId && a.catalogId === b.catalogId) || (!!a.clusterId && a.clusterId === b.clusterId)
}

/** Find the saved group among a result's candidates. Only groups that carry offers can be compared. */
export function resolveCandidate(ref: CandidateRef, candidates: ProductCandidate[]): Resolution {
  const key = titleKey(ref.title)
  const sameTitle = candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.offers.length > 0 && titleKey(c.title) === key)
  if (hasProviderIds(ref)) {
    const hit = sameTitle.filter(({ c }) => sameIds(ref, c))
    if (hit.length) return { status: 'matched', indices: hit.map((h) => h.i), basis: 'ids_and_title', title: cleanTitle(hit[0].c.title) }
    return { status: 'unresolved', reason: sameTitle.length ? 'ids_changed' : 'missing' }
  }
  if (sameTitle.length) return { status: 'matched', indices: sameTitle.map((h) => h.i), basis: 'title_only', title: cleanTitle(sameTitle[0].c.title) }
  return { status: 'unresolved', reason: 'legacy' }
}

export const UNRESOLVED_TEXT: Record<Unresolved, string> = {
  missing: 'No product group with this title is in the stored data any more.',
  ids_changed: 'A group with the same title is there, but its provider identifiers changed, so it cannot be confirmed as the same product.',
  legacy: 'This product was saved before DealProof recorded which product group was chosen, and no stored group has its exact title.',
}
