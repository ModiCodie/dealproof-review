/**
 * "Which product did you mean?" - turning the product groupings PricesAPI
 * returns into choices, and a user's choice into a comparison target.
 *
 * A grouping is the API's own clustering; it is not a verified identity (the
 * Samsung sample's top-ranked grouping was a different SSD). So DealProof never
 * picks one for the user unless exactly one clearly fits what they searched, and
 * even then it is shown and can be changed.
 */

import type { ProductCandidate } from './pricing-types'
import { buildGenericSpec, classifyGeneric, identityLevel, makeGenericTarget, refineFromTitle } from './matching'
import type { GenericTarget } from './matching'

/** Feed titles sometimes carry page text, e.g. "An interactive autorotating 360 image ... Low price". */
export function cleanTitle(raw: string | null): string {
  const t = (raw ?? '')
    .replace(/An interactive autorotating 360 image showing the item from different angles\.?\s*(?:Use Alt or Option \+ right or left arrow key to rotate\s*)?/gi, '')
    .replace(/\.?\s*Low price\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const out = t || 'Untitled product'
  return out.length > 110 ? `${out.slice(0, 107).trimEnd()}...` : out
}

const sameTitleKey = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export type Fit = 'fits' | 'unclear' | 'different'

export interface CandidateView {
  /** Position in the original candidate list (stable id). For merged groups, the first of them. */
  index: number
  /** Every original group this choice stands for (more than one only when their cleaned titles are identical). */
  indices: number[]
  title: string
  offers: number
  fit: Fit
  /** Plain-language reason for the fit, when it is not a clean fit. */
  note: string | null
  /** The feed's own condition label, if any (e.g. "Pre-owned"). */
  feedLabel: string | null
}

/** Candidates that carry at least one offer, each described against what the user searched. */
export function viewCandidates(query: string, candidates: ProductCandidate[]): CandidateView[] {
  const spec = buildGenericSpec(query, null)
  // anything the search itself states (e.g. "2TB") is part of what a group must match
  const probe: GenericTarget = { family: 'generic', variant: { ...spec.pins }, spec }
  const vague = identityLevel(probe.spec) === 'insufficient'
  const out: CandidateView[] = []
  const byTitle = new Map<string, CandidateView>()
  candidates.forEach((c, index) => {
    if (c.offers.length === 0) return
    const title = cleanTitle(c.title)
    // Two groups are one choice only when their titles are the same after cleaning. Similar titles are NOT merged:
    // "AirPods Pro" and "AirPods Pro with MagSafe Case" can be different generations or configurations.
    const same = byTitle.get(sameTitleKey(title))
    if (same) {
      same.indices.push(index)
      same.offers += c.offerCount || c.offers.length
      return
    }
    const d = classifyGeneric(probe, title)
    const fit: Fit = vague ? 'unclear' : d.class === 'EXACT' || d.class === 'LIKELY' ? 'fits' : d.class === 'AMBIGUOUS' ? 'unclear' : 'different'
    const view: CandidateView = {
      index,
      indices: [index],
      title,
      offers: c.offerCount || c.offers.length,
      fit,
      note: vague ? 'Your search is general, so nothing can be confirmed until you pick one.' : fit === 'fits' ? null : d.summary,
      feedLabel: c.conditionLabel,
    }
    byTitle.set(sameTitleKey(title), view)
    out.push(view)
  })
  return out
}

/** The candidate to pre-select: only when exactly one clearly fits the search. */
export function initialPick(views: CandidateView[]): number | null {
  const fits = views.filter((v) => v.fit === 'fits')
  return fits.length === 1 ? fits[0].index : null
}

/**
 * The comparison target for a picked candidate. When the search text names no
 * model, the picked product's own title supplies it (see `refineFromTitle`).
 */
export function targetForCandidate(query: string, candidate: ProductCandidate, offerTitles: (string | null)[]): { target: GenericTarget; refined: boolean } {
  const title = cleanTitle(candidate.title)
  let spec = buildGenericSpec(query, title)
  let refined = false
  if (identityLevel(spec) === 'insufficient') {
    const better = refineFromTitle(spec, title)
    if (better) {
      spec = buildGenericSpec(better.identity, title)
      refined = identityLevel(spec) === 'sufficient'
    }
  }
  return { target: makeGenericTarget(spec, offerTitles), refined }
}

/** The listings that belong to a choice: its own group's offers, each of which is still judged by its own title. */
export function offersForView(view: CandidateView, candidates: ProductCandidate[]): ProductCandidate['offers'] {
  return view.indices.flatMap((i) => candidates[i]?.offers ?? [])
}

/** True when the search names a specific product but no group's own title confirms it. */
export function noneConfirmed(views: CandidateView[]): boolean {
  return views.length > 0 && views.every((v) => v.fit !== 'fits')
}
