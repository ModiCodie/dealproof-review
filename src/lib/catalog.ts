/**
 * The products DealProof can compare, as the UI presents them.
 *
 * This is a display catalog only. What is *matched* (and which variants exist)
 * is decided by the deterministic engine in src/lib/matching; each entry names
 * its engine family. `query` is the exact search the live check runs. It is the
 * same text the previous free-text box was used with for these products, so it
 * hits the same 12-hour cache entry and saved records keep reopening the same
 * stored data. Nothing here widens or changes what the server accepts.
 */

import { FAMILIES } from './matching'
import type { FamilyId } from './matching'

export type CatalogKey = 'sony' | 'logitech' | 'samsung'

export interface CatalogProduct {
  key: CatalogKey
  family: FamilyId
  brand: string
  /** Model name without the brand. */
  model: string
  category: string
  query: string
}

export const CATALOG: readonly CatalogProduct[] = [
  { key: 'sony', family: 'sony-wh-1000xm5', brand: 'Sony', model: 'WH-1000XM5', category: 'Noise-cancelling headphones', query: 'Sony WH-1000XM5' },
  { key: 'logitech', family: 'logitech-mx-master-3s', brand: 'Logitech', model: 'MX Master 3S', category: 'Wireless mouse', query: 'Logitech MX Master 3S' },
  { key: 'samsung', family: 'samsung-990-pro', brand: 'Samsung', model: '990 PRO', category: 'NVMe SSD', query: 'Samsung 990 PRO 2TB' },
]

export const SUPPORTED_COUNT = CATALOG.length

export function catalogProduct(key: string | null | undefined): CatalogProduct | null {
  return CATALOG.find((p) => p.key === key) ?? null
}

export function catalogForFamily(family: FamilyId): CatalogProduct | null {
  return CATALOG.find((p) => p.family === family) ?? null
}

/** One short line saying what is compared for this product (derived from the engine's own variant dimensions). */
export function variantSummary(family: FamilyId): string {
  const dims = FAMILIES[family].dimensions
  if (dims.length === 0) return 'One model; colour is ignored'
  const names = dims.map((d) => d.label.toLowerCase())
  return `Matched by ${names.join(' and ')}`
}
