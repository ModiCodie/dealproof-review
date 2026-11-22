/**
 * Types for the deterministic matching/comparison engine.
 *
 * Two ideas are kept strictly separate:
 *   1. MATCH: does this listing appear to be the product (and variant) the user
 *      asked for?  -> `MatchClass`
 *   2. PRICE CHECK: has anyone independently confirmed this price?  -> `PriceCheck`
 * An EXACT match never implies a verified price.
 */

import type { Availability, NormalizedOffer } from '../pricing-types'

export type { Availability }

export type MatchClass =
  | 'EXACT' // requested model and every relevant variant attribute are stated and agree
  | 'LIKELY' // strong evidence, but at least one relevant attribute is not stated
  | 'AMBIGUOUS' // not enough, or conflicting, information
  | 'DIFFERENT_VARIANT' // same product family, different configuration
  | 'REJECTED' // a different product, or not the product itself (accessory etc.)

export type Condition = 'new' | 'used' | 'refurbished' | 'open_box' | 'defective' | 'incomplete' | 'unknown'

export type FamilyId = 'sony-wh-1000xm5' | 'logitech-mx-master-3s' | 'samsung-990-pro'

/** A product with hand-written rules (see families.ts). `variant` holds one value per family dimension. */
export interface FamilyTarget {
  family: FamilyId
  variant: Record<string, string>
}

/**
 * Any other product. What identifies it comes from the user's search text plus
 * the product they picked from the candidates. Nothing here is a verified
 * product identifier: PricesAPI Search returns no GTIN/UPC/MPN/brand fields.
 */
export interface GenericSpec {
  /** Title of the candidate the user picked. Display only. */
  title: string
  /** Normalized identity words/codes/numbers from the search text, e.g. "airpods pro 2". */
  identity: string
  /** First identity word when the search had two or more. Missing from a listing: weaker evidence, not a conflict. */
  brand: string | null
  /** Words that follow the model name in the picked title (e.g. "absolute"). A listing without them is only a likely match. */
  trim: string[]
  /** Attribute values pinned by the search text or the picked title (storage, memory, generation, size). */
  pins: Record<string, string>
}

export interface GenericTarget {
  family: 'generic'
  /** The chosen value for each variant dimension found in the listings. */
  variant: Record<string, string>
  spec: GenericSpec
}

/** What the user wants to compare. */
export type ProductTarget = FamilyTarget | GenericTarget

export interface DimensionOption {
  value: string
  label: string
}

/** A choice the user makes to say which variant they mean (e.g. storage size). */
export interface Dimension {
  key: string
  label: string
  options: DimensionOption[]
  default: string
  /** Why `default` was pre-selected, when that is not obvious (generic products). */
  note?: string
}

export interface FamilyInfo {
  id: FamilyId
  brand: string
  name: string
  dimensions: Dimension[]
}

/** One piece of evidence behind a decision. */
export interface Evidence {
  attribute: string // e.g. 'model', 'capacity', 'heatsink', 'edition', 'part number'
  value: string // what we found, e.g. '4TB'
  /** 'supports' = agrees with the target, 'conflicts' = disagrees, 'info' = neutral. */
  effect: 'supports' | 'conflicts' | 'info'
  /** Where it came from. */
  from: 'title' | 'part_number' | 'target'
}

export interface MatchDecision {
  class: MatchClass
  /** One plain-language line, safe to show to shoppers. */
  summary: string
  /** Fuller explanation, one sentence per item. */
  reasons: string[]
  evidence: Evidence[]
  /**
   * Human-readable variant detected in the listing (e.g. '4TB', '2TB with
   * heatsink', 'for Mac'). Used to group DIFFERENT_VARIANT offers. null if unknown.
   */
  variantLabel: string | null
}

export type PlatformKind = 'retailer' | 'hybrid' | 'marketplace' | 'delivery' | 'unknown'

export interface SellerIdentity {
  /** Seller string exactly as the feed gave it. */
  raw: string | null
  /** Website hostname of the listing (no 'www.'). */
  domain: string | null
  /** Platform/retailer name, e.g. 'Walmart', 'eBay'. */
  platform: string | null
  platformKind: PlatformKind
  /** Named seller on a marketplace, if the feed provided one. */
  sellerName: string | null
  /**
   * 'yes' only with evidence; 'no' when the evidence says a third party sells it;
   * 'unknown' otherwise. Never inferred from the retailer's name alone for
   * marketplace-capable retailers.
   */
  firstParty: 'yes' | 'no' | 'unknown'
  /** Why we said so. Shown in the UI. */
  evidence: string
}

/** What the price baseline says about one offer's price. */
export interface PriceBaseline {
  /** Median of one price per independent seller. */
  median: number
  /** Distinct identifiable sellers behind the median. */
  independentSellers: number
  /**
   * 'confirmed_only': built from EXACT matches only.
   * 'includes_likely': too few EXACT matches, so LIKELY matches (variant not
   * stated in the listing) were added.
   */
  basis: 'confirmed_only' | 'includes_likely'
}

export type PriceSignal =
  | {
      status: 'unusually_low'
      ratio: number
      /** Whole percent below the baseline median. */
      percentBelow: number
      baseline: PriceBaseline
      explanation: string
    }
  | { status: 'not_unusually_low'; ratio: number; baseline: PriceBaseline; explanation: string }
  | { status: 'insufficient_evidence'; independentSellers: number; explanation: string }
  | { status: 'not_assessed'; explanation: string }

/**
 * Has this price been independently checked against the retailer's page?
 * DealProof has no mechanism that ties checking evidence to an offer, so the
 * only possible value today is the API-reported one. Future values (checked /
 * unable to verify) must be added only together with real evidence.
 */
export type PriceVerification = 'api_reported_not_verified'

export type MissingField = 'condition' | 'shipping' | 'seller' | 'source_time' | 'availability'

export interface OfferAnalysis {
  /** Stable id within one comparison. */
  id: string
  offer: NormalizedOffer
  match: MatchDecision
  condition: { value: Condition; evidence: string | null; uncertain?: boolean }
  /** Material configuration attributes (storage, connector ...) that other listings state but this title does not. */
  unresolved: string[]
  availability: Availability
  seller: SellerIdentity
  priceVerification: PriceVerification
  priceSignal: PriceSignal
  /** Shipping text from the feed. null = not provided (does NOT mean free). */
  shipping: string | null
  missing: MissingField[]
  /** How many identical listings were collapsed into this one. */
  duplicateCount: number
}

export interface VariantGroup {
  label: string
  offers: OfferAnalysis[]
}

export interface CheapestPick {
  offer: OfferAnalysis
  /** true unless every caveat is absent (so almost always true today). */
  provisional: boolean
  /** true when this offer carries the "unusually low compared with other listings" flag. */
  flagged: boolean
  caveats: string[]
}

export interface PriceSummary {
  /** 'strict' (general products): the headline needs enough new-condition listings from independent sellers. */
  policy: 'strict' | 'standard'
  reliable: boolean
  /** Plain-language reason when not reliable. */
  reason: string | null
  /** Independent sellers with a qualifying listing, and how many are needed. */
  sellers: number
  needed: number
}

export interface Comparison {
  target: ProductTarget
  targetLabel: string
  /** Same product + variant, new or condition unknown, price not flagged. */
  comparable: OfferAnalysis[]
  /** Same product + variant, but the price is far below the group; check before trusting. */
  priceCheck: OfferAnalysis[]
  /** Can't tell from the listing. */
  ambiguous: OfferAnalysis[]
  /** Same family, other configuration, grouped by detected variant. */
  differentVariants: VariantGroup[]
  /** Same product + variant but used / refurbished / open-box. */
  secondHand: OfferAnalysis[]
  /** Defective, for parts, or sold incomplete: never a normal full-product price. */
  defective: OfferAnalysis[]
  /** General products only: same product, condition not stated. Shown, but never priced as if new. */
  unknownCondition: OfferAnalysis[]
  /** General products only: the title does not state a configuration (e.g. connector, capacity) that other listings show differs. */
  needsConfig: OfferAnalysis[]
  /** Whether the offers support a lowest-price headline, and if not, why. */
  priceSummary: PriceSummary
  /** Different product or accessory. */
  rejected: OfferAnalysis[]
  /** Lowest reported matching in-stock offer. May be flagged; it is then shown with a warning. */
  cheapest: CheapestPick | null
  /** Only set when `cheapest` is flagged: the lowest matching in-stock offer that is not. */
  lowestUnflagged: CheapestPick | null
  /** Plain-language notes about the whole comparison. */
  notes: string[]
  stats: {
    total: number
    afterDedup: number
    duplicatesRemoved: number
    /** comparable + priceCheck: same product and variant, new or condition unknown. */
    matching: number
  }
  /** Plain-language account of how many listings entered the comparison and why others did not. */
  filterSummary: string
  /** Feed observation time for these offers (Search has no per-offer time). */
  sourceScrapedAt: string | null
  /**
   * Set when the product could not be identified well enough to compare safely
   * (generic products only). Nothing is then called a match, and no lowest price is shown.
   */
  limitation: string | null
}
