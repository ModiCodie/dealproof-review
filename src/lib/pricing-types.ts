/**
 * Types shared by the Worker (server action) and the React UI.
 *
 * These describe DealProof's *normalized* view of a PricesAPI Search response.
 * Nothing here claims an offer is verified, comparable, or identical to another:
 * a "candidate" is only what the API grouped together, and every uncertain
 * field stays explicit (`null` / `'unknown'`) rather than being guessed.
 */

export type Market = 'us'

/** Offer availability, derived only from the API's literal stock text. */
export type Availability = 'in_stock' | 'out_of_stock' | 'backorder' | 'unknown'

export interface NormalizedOffer {
  /** Seller name exactly as the API gave it (may include marketplace sub-seller). */
  seller: string | null
  /** Retailer home URL from the API (http/https only, else null). */
  sellerUrl: string | null
  /** Item price excluding delivery/tax. null when missing or not a positive number. */
  price: number | null
  /** ISO currency code from the API. Not verified against the merchant page. */
  currency: string | null
  /** Product title as shown by this merchant (untrusted text). */
  title: string | null
  /** Merchant listing URL (http/https only, else null). Untrusted. */
  listingUrl: string | null
  /** Raw stock text from the API, if any. */
  stockText: string | null
  availability: Availability
  /** Seller's delivery text (free text). null = not provided; it does NOT mean free. */
  deliveryInfo: string | null
  /**
   * The Search endpoint does not provide per-offer condition. Always 'unknown':
   * never assume "new".
   */
  condition: 'unknown'
  /** The Search endpoint has no per-offer timestamp; see `SearchSource.scrapedAt`. */
  observedAt: null
}

export interface ProductCandidate {
  /** API product id (`pid`). A candidate is the API's grouping, NOT a verified identical product. */
  pid: number | null
  productRef: { id: string; idType: string; market: string } | null
  catalogId: string | null
  clusterId: string | null
  title: string | null
  /** Card-level headline price. The API says it is not a minimum and not necessarily an offer. */
  headlinePrice: number | null
  headlineCurrency: string | null
  /** Card-level condition label from the API (often null). */
  conditionLabel: string | null
  /** Number of offers the API reports for the candidate (may exceed offers returned). */
  offerCount: number
  offers: NormalizedOffer[]
}

export interface SearchSource {
  /** When PricesAPI scraped this result (`meta.scraped_at`). The true observation time. */
  scrapedAt: string | null
  /** PricesAPI's own cache state: 'miss' (live scrape), 'redis', 'db', ... */
  upstreamCacheSource: string | null
  upstreamCacheAgeSeconds: number | null
  servedStale: boolean | null
  degraded: boolean | null
  upstreamLatencyMs: number | null
}

export interface SearchResult {
  /** Normalized query actually searched. */
  query: string
  market: Market
  candidates: ProductCandidate[]
  source: SearchSource
  /** When DealProof stored this result (cache time). Distinct from `source.scrapedAt`. */
  cachedAt: string
  /** When the DealProof cache entry expires. */
  expiresAt: string
}

export interface SearchQuota {
  /** Uncached searches this user may still run today (UTC). */
  userRemainingToday: number
  userDailyLimit: number
}

export interface SearchResponse {
  result: SearchResult
  /** true when served from the DealProof cache (no upstream call, no credits). */
  fromCache: boolean
  quota: SearchQuota
}

export type SearchErrorCode =
  | 'invalid_query'
  | 'not_configured'
  | 'user_limit_reached'
  | 'global_budget_reached'
  | 'search_in_progress'
  | 'upstream_rate_limited'
  | 'upstream_timeout'
  | 'upstream_error'
  | 'upstream_auth'
  | 'upstream_credits'
  | 'internal_error'

export interface SearchFailure {
  success: false
  error: string
  code: SearchErrorCode
  /** Seconds after which retrying may succeed, when known. */
  retryAfterSeconds?: number
}

export interface SearchSuccess {
  success: true
  data: SearchResponse
}

export type SearchActionResult = SearchSuccess | SearchFailure
