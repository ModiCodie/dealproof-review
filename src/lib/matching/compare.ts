/**
 * Builds a Comparison: classify -> de-duplicate -> flag low prices -> place each
 * offer in exactly one section -> pick the lowest reported matching offer.
 *
 * "Comparable" is an explicit rule, not a feeling:
 *   match is EXACT or LIKELY, AND condition is new or unknown (not used /
 *   refurbished / open-box), AND the price is not flagged as unusually low.
 * The lowest-reported pick additionally needs availability "in stock" and a price.
 * A price-anomaly flag does not remove an offer from that pick; it adds a warning.
 */

import type { NormalizedOffer } from '../pricing-types'
import { assessPrices, type PricePoint } from './anomalies'
import { detectCondition } from './condition'
import { classifyTitle, targetLabel } from './families'
import { identityLevel, INSUFFICIENT_MESSAGE } from './generic'
import { identifySeller, sellerKey } from './seller'
import type {
  CheapestPick,
  Comparison,
  MissingField,
  OfferAnalysis,
  ProductTarget,
  VariantGroup,
} from './types'

/** Identity of a listing for de-duplication: same seller, same page, same price, same title. */
function dedupKey(o: NormalizedOffer): string {
  let page = ''
  if (o.listingUrl) {
    try {
      const u = new URL(o.listingUrl)
      // Tracking parameters differ between feeds; the path and the seller id identify the page.
      page = `${u.hostname.replace(/^www\./, '')}${u.pathname}|${u.searchParams.get('selectedSellerId') ?? ''}`
    } catch {
      page = o.listingUrl
    }
  }
  return [(o.seller ?? '').toLowerCase(), o.price ?? '', page, (o.title ?? '').toLowerCase()].join('\u0001')
}

export function analyzeOffer(target: ProductTarget, offer: NormalizedOffer, id: string, sourceScrapedAt: string | null): OfferAnalysis {
  const match = classifyTitle(target, offer.title)
  const condition = detectCondition(offer.title)
  const seller = identifySeller(offer)
  const missing: MissingField[] = []
  if (condition.value === 'unknown') missing.push('condition')
  if (offer.deliveryInfo === null) missing.push('shipping')
  if (!seller.raw || (seller.firstParty !== 'yes' && !seller.sellerName && seller.platformKind !== 'unknown' && seller.platformKind !== 'retailer')) missing.push('seller')
  if (!sourceScrapedAt) missing.push('source_time')
  if (offer.availability === 'unknown') missing.push('availability')
  return {
    id,
    offer,
    match,
    condition,
    availability: offer.availability,
    seller,
    priceVerification: 'api_reported_not_verified',
    priceSignal: { status: 'not_assessed', explanation: 'Not part of a price baseline (only matching, new-or-unknown-condition listings are assessed).' },
    shipping: offer.deliveryInfo,
    missing,
    duplicateCount: 0,
  }
}

const SECOND_HAND = new Set(['used', 'refurbished', 'open_box'])

export function buildComparison(target: ProductTarget, offers: NormalizedOffer[], sourceScrapedAt: string | null): Comparison {
  // 1-2. analyze + de-duplicate
  const seen = new Map<string, OfferAnalysis>()
  const analyses: OfferAnalysis[] = []
  for (const o of offers) {
    const key = dedupKey(o)
    const prior = seen.get(key)
    if (prior) {
      prior.duplicateCount += 1
      continue
    }
    const a = analyzeOffer(target, o, `o${analyses.length}`, sourceScrapedAt)
    seen.set(key, a)
    analyses.push(a)
  }

  // 3. price baseline: same product + variant, new or unknown condition, one price
  //    per independent seller, at least 6 of them (see anomalies.ts)
  const pool = analyses.filter(
    (a) => (a.match.class === 'EXACT' || a.match.class === 'LIKELY') && !SECOND_HAND.has(a.condition.value) && a.offer.price !== null,
  )
  // Prices in different currencies are never mixed: assess only the most common one.
  const byCurrency = new Map<string, number>()
  for (const a of pool) byCurrency.set(a.offer.currency ?? '?', (byCurrency.get(a.offer.currency ?? '?') ?? 0) + 1)
  const mainCurrency = [...byCurrency.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null
  const points: PricePoint[] = pool
    .filter((a) => (a.offer.currency ?? '?') === mainCurrency)
    .map((a) => ({ id: a.id, price: a.offer.price as number, confirmed: a.match.class === 'EXACT', sellerKey: sellerKey(a.seller) }))
  const signals = assessPrices(points, mainCurrency === '?' ? null : mainCurrency)
  for (const a of pool) {
    const sig = signals.get(a.id)
    if (sig) a.priceSignal = sig
  }

  // 4. sections (each offer lands in exactly one)
  const comparable: OfferAnalysis[] = []
  const priceCheck: OfferAnalysis[] = []
  const ambiguous: OfferAnalysis[] = []
  const secondHand: OfferAnalysis[] = []
  const rejected: OfferAnalysis[] = []
  const variantMap = new Map<string, OfferAnalysis[]>()

  for (const a of analyses) {
    switch (a.match.class) {
      case 'REJECTED':
        rejected.push(a)
        break
      case 'DIFFERENT_VARIANT': {
        const label = a.match.variantLabel ?? 'Other configuration'
        variantMap.set(label, [...(variantMap.get(label) ?? []), a])
        break
      }
      case 'AMBIGUOUS':
        ambiguous.push(a)
        break
      default:
        if (SECOND_HAND.has(a.condition.value)) secondHand.push(a)
        else if (a.priceSignal.status === 'unusually_low') priceCheck.push(a)
        else comparable.push(a)
    }
  }

  const byPrice = (x: OfferAnalysis, y: OfferAnalysis) => (x.offer.price ?? Infinity) - (y.offer.price ?? Infinity)
  for (const list of [comparable, priceCheck, ambiguous, secondHand, rejected]) list.sort(byPrice)
  const differentVariants: VariantGroup[] = [...variantMap.entries()]
    .map(([label, list]) => ({ label, offers: list.sort(byPrice) }))
    .sort((a, b) => b.offers.length - a.offers.length || a.label.localeCompare(b.label))

  // 5. Lowest reported matching offer. A price-anomaly flag does NOT make an offer
  //    ineligible: it is shown as a warning next to the price. Still excluded:
  //    other variants/products, ambiguous matches, used/refurbished/open-box, and
  //    anything not in stock or without a price (those are never in these lists).
  const caveatsFor = (pick: OfferAnalysis): string[] => {
    const caveats: string[] = []
    if (pick.priceSignal.status === 'unusually_low') caveats.push('Unusually low compared with other listings (see the warning on this offer).')
    if (pick.condition.value === 'unknown') caveats.push("Condition isn't stated in the listing.")
    if (pick.match.class === 'LIKELY') caveats.push(pick.match.summary)
    if (pick.seller.firstParty !== 'yes') caveats.push(pick.seller.evidence + '.')
    if (pick.shipping === null) caveats.push('Shipping cost not provided.')
    if (!sourceScrapedAt) caveats.push('The time of this price is unknown.')
    caveats.push('Price is API-reported and not independently verified. Final checkout cost may differ.')
    if (pick.priceSignal.status === 'insufficient_evidence') caveats.push('Too few independent sellers to judge whether this price is unusual.')
    return caveats
  }
  const buyable = [...comparable, ...priceCheck]
    .filter((a) => a.availability === 'in_stock' && a.offer.price !== null)
    .sort(byPrice)
  let cheapest: CheapestPick | null = null
  let lowestUnflagged: CheapestPick | null = null
  if (buyable.length) {
    const pick = buyable[0]
    cheapest = {
      offer: pick,
      provisional: pick.condition.value === 'unknown' || pick.match.class === 'LIKELY',
      flagged: pick.priceSignal.status === 'unusually_low',
      caveats: caveatsFor(pick),
    }
    if (cheapest.flagged) {
      const alt = buyable.find((a) => a.priceSignal.status !== 'unusually_low')
      if (alt) lowestUnflagged = { offer: alt, provisional: alt.condition.value === 'unknown' || alt.match.class === 'LIKELY', flagged: false, caveats: caveatsFor(alt) }
    }
  }

  // 6. notes
  const notes: string[] = []
  if (comparable.length) {
    const unknownCond = comparable.filter((a) => a.condition.value === 'unknown').length
    if (unknownCond) notes.push(`Condition is not stated for ${unknownCond} of ${comparable.length} comparable offers, so this comparison is provisional.`)
  } else {
    notes.push('No offers could be confidently matched to the product and variant you chose.')
  }
  if (analyses.length - offers.length < 0) notes.push(`${offers.length - analyses.length} identical listing${offers.length - analyses.length === 1 ? '' : 's'} merged.`)

  return {
    target,
    targetLabel: targetLabel(target),
    comparable,
    priceCheck,
    ambiguous,
    differentVariants,
    secondHand,
    rejected,
    cheapest,
    lowestUnflagged,
    notes,
    stats: {
      total: offers.length,
      afterDedup: analyses.length,
      duplicatesRemoved: offers.length - analyses.length,
      matching: comparable.length + priceCheck.length,
    },
    filterSummary: summarizeFiltering({
      total: offers.length,
      duplicates: offers.length - analyses.length,
      comparable: comparable.length,
      priceCheck: priceCheck.length,
      variants: differentVariants.reduce((n, v) => n + v.offers.length, 0),
      rejected: rejected.length,
      ambiguous: ambiguous.length,
      secondHand: secondHand.length,
    }),
    sourceScrapedAt,
    limitation: target.family === 'generic' && identityLevel(target.spec) === 'insufficient' ? INSUFFICIENT_MESSAGE : null,
  }
}

interface FilterCounts {
  total: number
  duplicates: number
  comparable: number
  priceCheck: number
  variants: number
  rejected: number
  ambiguous: number
  secondHand: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Built only from the real classification counts; nothing here is hardcoded data. */
export function summarizeFiltering(c: FilterCounts): string {
  const matching = c.comparable + c.priceCheck
  const head = `We found ${plural(c.total, 'listing', 'listings')}${c.duplicates ? ` (${plural(c.duplicates, 'identical duplicate', 'identical duplicates')} merged)` : ''}, and ${matching} entered this comparison as matching the product and variant you chose${c.priceCheck ? `, ${c.priceCheck} of them flagged for an unusually low price` : ''}.`
  const rest: string[] = []
  if (c.variants) rest.push(`${c.variants} ${c.variants === 1 ? 'is a different variant' : 'are different variants'}`)
  if (c.rejected) rest.push(`${c.rejected} ${c.rejected === 1 ? 'is a different product or accessory' : 'are different products or accessories'}`)
  if (c.ambiguous) rest.push(`${c.ambiguous} ${c.ambiguous === 1 ? 'has' : 'have'} too little information to tell`)
  if (c.secondHand) rest.push(`${c.secondHand} ${c.secondHand === 1 ? 'is' : 'are'} used, refurbished or open-box`)
  const tail = rest.length ? ` The rest were set aside: ${rest.join('; ')}.` : ''
  return `${head}${tail} Listings are matched by known product attributes (model, edition, size). That does not guarantee that condition, seller or checkout cost are equivalent.`
}
