/**
 * Unusually-low-price flag.
 *
 * It flags a price that is unusually low COMPARED WITH OTHER LISTINGS. It is not a fraud finding, not a
 * statistically calibrated score, and flagged offers are never hidden.
 *
 * Baseline (all deterministic):
 *   1. Only offers for the same product and variant (EXACT matches; LIKELY
 *      matches are added only if EXACT alone is too few) in new or unknown
 *      condition. Used/refurbished/open-box and other variants never enter.
 *   2. ONE observation per independent seller: repeated listings from one seller
 *      are collapsed (their median), so a seller cannot move the baseline just by
 *      listing many times. Sellers we cannot identify (e.g. a marketplace listing
 *      with no seller name) are not counted as independent.
 *   3. At least MIN_INDEPENDENT_SELLERS observations are required. Otherwise the
 *      answer is "insufficient evidence", never "normal".
 *   4. A price is flagged when it is below 60% of the baseline median.
 *
 * Known limits: the offer being tested contributes to its own baseline (small
 * effect at n >= 6); title-based matching can put a different variant into the
 * "likely" tier; 60% is a tuned heuristic, not a statistic.
 */

import type { PriceBaseline, PriceSignal } from './types'

export const ANOMALY_RATIO = 0.6
export const MIN_INDEPENDENT_SELLERS = 6

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface PricePoint {
  id: string
  price: number
  /** EXACT match (true) or LIKELY match (false). */
  confirmed: boolean
  /** Stable seller identity, or null when the seller cannot be identified. */
  sellerKey: string | null
}

/** One price per identifiable seller (that seller's median); unidentified sellers are skipped. */
function observations(points: PricePoint[]): number[] {
  const bySeller = new Map<string, number[]>()
  for (const p of points) {
    if (!p.sellerKey) continue
    bySeller.set(p.sellerKey, [...(bySeller.get(p.sellerKey) ?? []), p.price])
  }
  return [...bySeller.values()].map(median)
}

export function fmtMoney(n: number, currency: string | null): string {
  const code = currency ?? 'USD'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(n)
  } catch {
    return `${n.toFixed(2)} ${code}`
  }
}

export function buildBaseline(points: PricePoint[]): PriceBaseline | null {
  const strict = observations(points.filter((p) => p.confirmed))
  if (strict.length >= MIN_INDEPENDENT_SELLERS) {
    return { median: median(strict), independentSellers: strict.length, basis: 'confirmed_only' }
  }
  const all = observations(points)
  if (all.length >= MIN_INDEPENDENT_SELLERS) {
    return { median: median(all), independentSellers: all.length, basis: 'includes_likely' }
  }
  return null
}

/** Assess every point against the shared baseline. */
export function assessPrices(points: PricePoint[], currency: string | null): Map<string, PriceSignal> {
  const out = new Map<string, PriceSignal>()
  const baseline = buildBaseline(points)
  if (!baseline) {
    const n = Math.max(observations(points.filter((p) => p.confirmed)).length, observations(points).length)
    for (const p of points) {
      out.set(p.id, {
        status: 'insufficient_evidence',
        independentSellers: n,
        explanation: `Insufficient evidence to judge whether this price is unusual: only ${n} independent seller${n === 1 ? '' : 's'} with matching listings (at least ${MIN_INDEPENDENT_SELLERS} are needed).`,
      })
    }
    return out
  }
  const basisNote = baseline.basis === 'includes_likely' ? ' (includes listings whose variant is likely, not confirmed)' : ''
  for (const p of points) {
    const ratio = p.price / baseline.median
    if (ratio < ANOMALY_RATIO) {
      const percentBelow = Math.round((1 - ratio) * 100)
      out.set(p.id, {
        status: 'unusually_low',
        ratio,
        percentBelow,
        baseline,
        explanation: `Unusually low compared with other listings — ${percentBelow}% below the median of ${baseline.independentSellers} independent sellers (${fmtMoney(baseline.median, currency)}${basisNote}). This is a rule-of-thumb comparison (flagged below 60% of the median), not evidence of a problem with the listing and not a guarantee of a good deal. Check the listing details before buying.`,
      })
    } else {
      out.set(p.id, {
        status: 'not_unusually_low',
        ratio,
        baseline,
        explanation: `Not unusually low: ${Math.round(ratio * 100)}% of the comparable-offer median (${fmtMoney(baseline.median, currency)}, ${baseline.independentSellers} independent sellers${basisNote}).`,
      })
    }
  }
  return out
}
