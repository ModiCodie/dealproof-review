/**
 * Saved products: the pure, shared (browser + Worker) part.
 *
 * A saved product is a small record, NOT a copy of any price data:
 *   - `productKey`  stable identity of the exact product + variant
 *   - `family`, `variant`  what to compare (validated against the matching engine)
 *   - `displayName` human label captured at save time
 *   - `query` + `market`  which search this was compared from. The server derives
 *     the cache key from them, so the saved record never holds a cache pointer
 *     that could disagree with the cache itself.
 * The owner id (`userId`) is stamped by the Durable Object from the verified
 * session and never supplied by the client.
 */

import { FAMILIES, targetLabel } from './matching'
import type { FamilyId, ProductTarget } from './matching'
import type { SearchQuota, SearchResult } from './pricing-types'

export const SAVED_COLLECTION = 'saved_products'
export const SAVED_MARKET = 'us'

/** Shape of `saved_products` row data as stored (see src/schemas/saved-schema.ts). */
export interface SavedRow {
  userId: string
  productKey: string
  family: string
  variant: Record<string, string>
  displayName: string
  query: string
  market: string
}

/** A saved row after validation against the matching engine, safe to render. */
export interface SavedProduct {
  recordId: string
  /** ISO time the record was created (record envelope `createdAt`). */
  savedAt: string
  productKey: string
  target: ProductTarget
  displayName: string
  query: string
}

/**
 * Stable identity: family id plus one `dimension=value` per family dimension,
 * in the family's own order. Missing choices use the dimension default so two
 * ways of saying "the standard edition" produce the same key.
 */
export function productKey(target: ProductTarget): string {
  const f = FAMILIES[target.family]
  const dims = f.dimensions.map((d) => `${d.key}=${target.variant[d.key] ?? d.default}`)
  return [target.family, ...dims].join('|')
}

/** Row data for a new save. No owner field: the server stamps it. */
export function toSavedRow(target: ProductTarget, query: string): Omit<SavedRow, 'userId'> {
  const f = FAMILIES[target.family]
  const variant = Object.fromEntries(f.dimensions.map((d) => [d.key, target.variant[d.key] ?? d.default]))
  return {
    productKey: productKey(target),
    family: target.family,
    variant,
    displayName: targetLabel({ family: target.family, variant }),
    query,
    market: SAVED_MARKET,
  }
}

/**
 * Validate a stored row. A row we cannot make sense of (unknown family, a
 * variant value the family does not offer) is rejected rather than guessed at,
 * so a hand-forged record can only ever hide itself from its own owner.
 */
export function parseSaved(rec: { recordId: string; createdAt: string; data: Partial<SavedRow> | undefined }): SavedProduct | null {
  const d = rec.data
  if (!d || typeof d.family !== 'string' || !(d.family in FAMILIES)) return null
  const family = FAMILIES[d.family as FamilyId]
  const raw = d.variant && typeof d.variant === 'object' ? d.variant : {}
  const variant: Record<string, string> = {}
  for (const dim of family.dimensions) {
    const v = raw[dim.key] ?? dim.default
    if (!dim.options.some((o) => o.value === v)) return null
    variant[dim.key] = v
  }
  if (typeof d.query !== 'string' || d.query.length < 2) return null
  const target: ProductTarget = { family: family.id, variant }
  return {
    recordId: rec.recordId,
    savedAt: rec.createdAt,
    productKey: productKey(target),
    target,
    displayName: targetLabel(target),
    query: d.query,
  }
}

// ----------------------------------------------------- server action response

export type SavedComparisonErrorCode = 'not_found' | 'invalid_saved_product' | 'internal_error'

export interface SavedComparisonFailure {
  success: false
  code: SavedComparisonErrorCode
  error: string
}

/**
 * What the server has for a saved product. `result` is null when nothing is
 * stored (never cached, or the cache row was replaced/removed). `stale` is true
 * when the stored data is older than the cache window: it is still returned,
 * labelled, and never refreshed automatically.
 */
export interface SavedComparisonData {
  saved: { recordId: string; query: string; family: string; variant: Record<string, string> }
  result: SearchResult | null
  stale: boolean
  quota: SearchQuota
}

export type SavedComparisonResult = { success: true; data: SavedComparisonData } | SavedComparisonFailure
