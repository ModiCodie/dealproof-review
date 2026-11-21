/**
 * Pure functions: validate the user's query and turn a PricesAPI Search response
 * into DealProof's normalized types. No network, no storage: easy to unit test.
 *
 * Everything coming back from the API is untrusted external data: strings are
 * length-capped, URLs must be http(s), numbers must be finite, and unknown
 * fields are dropped.
 */

import type {
  Availability,
  NormalizedOffer,
  ProductCandidate,
  SearchSource,
} from '../../lib/pricing-types'

export const MIN_QUERY_LENGTH = 2
export const MAX_QUERY_LENGTH = 100
const MAX_CANDIDATES = 3
const MAX_OFFERS_PER_CANDIDATE = 60

export type QueryValidation = { ok: true; query: string } | { ok: false; message: string }

/**
 * Normalizes and validates a product search string.
 * URLs are rejected on purpose: PricesAPI can search by URL, but DealProof
 * does not accept URLs yet (and never fetches user-supplied URLs itself).
 */
export function validateQuery(raw: unknown): QueryValidation {
  if (typeof raw !== 'string') return { ok: false, message: 'Enter a product name to search.' }
  const query = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (query.length < MIN_QUERY_LENGTH) {
    return { ok: false, message: `Search must be at least ${MIN_QUERY_LENGTH} characters.` }
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return { ok: false, message: `Search must be at most ${MAX_QUERY_LENGTH} characters.` }
  }
  if (/[\u0000-\u001f\u007f]/.test(query)) {
    return { ok: false, message: 'Search contains unsupported characters.' }
  }
  if (!/[\p{L}\p{N}]/u.test(query)) {
    return { ok: false, message: 'Enter a product name or model, not just symbols.' }
  }
  if (/:\/\//.test(query) || /^www\./i.test(query)) {
    return { ok: false, message: 'Searching by URL is not supported yet. Enter a product name.' }
  }
  return { ok: true, query }
}

/**
 * What makes two queries "the same search": letters and digits only, lower case.
 * "Sony WH-1000XM5", "sony wh1000xm5" and "SONY  WH 1000 XM5" all share one cache
 * entry (and one paid search), so punctuation and spacing cannot be used to
 * buy a fresh search of the same product. Different words stay different.
 */
export function canonicalQuery(query: string): string {
  return query.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Cache key: the same canonical query + market share one entry. */
export function cacheKey(market: string, query: string): string {
  return `${market}|${canonicalQuery(query)}`
}

/**
 * The key older versions wrote (lower-cased query, punctuation kept). Still read,
 * so results cached before this change keep serving and saved products reopen
 * their stored data; new writes always use `cacheKey`.
 */
export function legacyCacheKey(market: string, query: string): string {
  return `${market}|${query.toLowerCase()}`
}

// ---------------------------------------------------------------- field helpers

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function positiveNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function nonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

function httpUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

function currency(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function availabilityOf(text: string | null): Availability {
  if (!text) return 'unknown'
  const t = text.trim().toLowerCase()
  if (t === 'in stock' || t === 'in_stock') return 'in_stock'
  if (t === 'out of stock' || t === 'out_of_stock') return 'out_of_stock'
  if (t === 'backordered' || t === 'back order' || t === 'backorder') return 'backorder'
  return 'unknown' // e.g. "See merchant for availability"
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export function normalizeOffer(raw: unknown): NormalizedOffer | null {
  if (!isObj(raw)) return null
  const stockText = str(raw.stock_status, 80)
  return {
    seller: str(raw.seller, 120),
    sellerUrl: httpUrl(raw.seller_url),
    price: positiveNumber(raw.price),
    currency: currency(raw.currency),
    title: str(raw.product_title, 300),
    listingUrl: httpUrl(raw.url),
    stockText,
    availability: availabilityOf(stockText),
    deliveryInfo: str(raw.delivery_info, 200),
    condition: 'unknown',
    observedAt: null,
  }
}

export function normalizeCandidate(raw: unknown): ProductCandidate | null {
  if (!isObj(raw)) return null
  const ref = isObj(raw.product_ref) ? raw.product_ref : null
  const rawOffers = Array.isArray(raw.offers) ? raw.offers : []
  const offers = rawOffers
    .slice(0, MAX_OFFERS_PER_CANDIDATE)
    .map(normalizeOffer)
    .filter((o): o is NormalizedOffer => o !== null)
  return {
    pid: typeof raw.pid === 'number' && Number.isFinite(raw.pid) ? raw.pid : null,
    productRef:
      ref && str(ref.id, 64)
        ? {
            id: str(ref.id, 64) as string,
            idType: str(ref.id_type, 20) ?? 'pricesapi',
            market: str(ref.market, 5) ?? 'us',
          }
        : null,
    catalogId: str(raw.catalog_id, 64),
    clusterId: str(raw.cluster_id, 64),
    title: str(raw.title, 300),
    headlinePrice: positiveNumber(raw.headline_price),
    headlineCurrency: currency(raw.headline_currency),
    conditionLabel: str(raw.condition_label, 40),
    offerCount: nonNegInt(raw.offerCount) || offers.length,
    offers,
  }
}

export interface NormalizedSearch {
  candidates: ProductCandidate[]
  source: SearchSource
}

/**
 * Normalizes the body of `GET /products/search`. Returns null when the body does
 * not have the documented `{ success, data: { products: [...] }, meta }` shape.
 * An empty `products` array is a valid (empty) result.
 */
export function normalizeSearchResponse(body: unknown): NormalizedSearch | null {
  if (!isObj(body) || body.success !== true || !isObj(body.data)) return null
  const products = body.data.products
  if (!Array.isArray(products)) return null
  const meta = isObj(body.meta) ? body.meta : {}
  const candidates = products
    .slice(0, MAX_CANDIDATES)
    .map(normalizeCandidate)
    .filter((c): c is ProductCandidate => c !== null)
  return {
    candidates,
    source: {
      scrapedAt: isoDate(meta.scraped_at),
      upstreamCacheSource: str(meta.cache_source, 30),
      upstreamCacheAgeSeconds:
        typeof meta.cache_age_s === 'number' && Number.isFinite(meta.cache_age_s)
          ? meta.cache_age_s
          : null,
      servedStale: typeof meta.served_stale === 'boolean' ? meta.served_stale : null,
      degraded: typeof meta.degraded === 'boolean' ? meta.degraded : null,
      upstreamLatencyMs:
        typeof meta.latency_ms === 'number' && Number.isFinite(meta.latency_ms)
          ? meta.latency_ms
          : null,
    },
  }
}

/** True when at least one candidate has at least one offer (PricesAPI bills only then). */
export function hasOffers(n: NormalizedSearch): boolean {
  return n.candidates.some((c) => c.offers.length > 0)
}
