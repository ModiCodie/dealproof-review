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
import { normalizeText } from './matching/text'
import type { FamilyId, GenericSpec, GenericTarget, ProductTarget } from './matching'
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

/** Short stable hash (djb2, base 36) so two different picked candidates of one search stay different saves. */
function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const GENERIC = 'generic'

/**
 * Stable identity: family id plus one `dimension=value` per dimension. For the
 * specialised families the dimensions are the family's own (missing choices use
 * the default, so two ways of saying "the standard edition" give the same key).
 * For a generic product the key is the search identity, a hash of the picked
 * product's title, and the chosen variant values.
 */
export function productKey(target: ProductTarget): string {
  if (target.family === GENERIC) {
    const dims = Object.keys(target.variant).sort().map((k) => `${k}=${target.variant[k]}`)
    return [GENERIC, target.spec.identity.replace(/\s+/g, '-').slice(0, 80), hash(normalizeText(target.spec.title)), ...dims].join('|').slice(0, 200)
  }
  const f = FAMILIES[target.family]
  const dims = f.dimensions.map((d) => `${d.key}=${target.variant[d.key] ?? d.default}`)
  return [target.family, ...dims].join('|')
}

/** Row data for a new save. No owner field: the server stamps it. */
export function toSavedRow(target: ProductTarget, query: string): Omit<SavedRow, 'userId'> {
  if (target.family === GENERIC) {
    const s = target.spec
    const variant: Record<string, string> = { t: s.title, i: s.identity, b: s.brand ?? '', r: s.trim.join(' ') }
    for (const [k, v] of Object.entries(s.pins)) variant[`pin_${k}`] = v
    for (const [k, v] of Object.entries(target.variant)) variant[`dim_${k}`] = v
    return { productKey: productKey(target), family: GENERIC, variant, displayName: targetLabel(target).slice(0, 200), query, market: SAVED_MARKET }
  }
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

const shortText = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)

function parseGeneric(raw: Record<string, unknown>): GenericTarget | null {
  const title = shortText(raw.t, 120)
  const identity = shortText(raw.i, 120)
  const brand = shortText(raw.b, 40)
  const trim = shortText(raw.r, 60)
  if (!title || !identity || brand === null || trim === null) return null
  const pins: Record<string, string> = {}
  const variant: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const val = shortText(v, 24)
    const dimKey = k.startsWith('pin_') || k.startsWith('dim_') ? k.slice(4) : null
    if (dimKey && DIM_KEYS.includes(dimKey) && val === null && v !== undefined && v !== '') return null // a malformed choice: reject the row, don't guess
    if (k.startsWith('pin_') && val && DIM_KEYS.includes(k.slice(4))) pins[k.slice(4)] = val
    else if (k.startsWith('dim_') && val && DIM_KEYS.includes(k.slice(4))) variant[k.slice(4)] = val
  }
  const spec: GenericSpec = { title, identity, brand: brand || null, trim: trim ? trim.split(' ').slice(0, 2) : [], pins }
  return { family: GENERIC, variant, spec }
}
const DIM_KEYS = ['storage', 'memory', 'generation', 'size', 'heatsink']

/**
 * Validate a stored row. A row we cannot make sense of (unknown family, a
 * variant value the family does not offer) is rejected rather than guessed at,
 * so a hand-forged record can only ever hide itself from its own owner.
 */
export function parseSaved(rec: { recordId: string; createdAt: string; data: Partial<SavedRow> | undefined }): SavedProduct | null {
  const d = rec.data
  if (!d || typeof d.family !== 'string') return null
  if (typeof d.query !== 'string' || d.query.length < 2) return null
  const raw = d.variant && typeof d.variant === 'object' ? (d.variant as Record<string, unknown>) : {}
  let target: ProductTarget
  if (d.family === GENERIC) {
    const g = parseGeneric(raw)
    if (!g) return null
    target = g
  } else {
    if (!(d.family in FAMILIES)) return null
    const family = FAMILIES[d.family as FamilyId]
    const variant: Record<string, string> = {}
    for (const dim of family.dimensions) {
      const v = raw[dim.key] ?? dim.default
      if (typeof v !== 'string' || !dim.options.some((o) => o.value === v)) return null
      variant[dim.key] = v
    }
    target = { family: family.id, variant }
  }
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
