/**
 * Condition from listing text. The default is 'unknown': a title that says
 * nothing about condition is NOT evidence the item is new.
 *
 * Beyond new / used / refurbished / open-box this separates two things that must
 * never pass as a normal full-product price:
 *   defective  - for parts, not working, broken ...
 *   incomplete - sold without part of the product (earbuds only, no case, one bud ...)
 * When the wording is cut off ("... Not Working With") the result is still
 * treated as defective/incomplete (the safe side) but marked `uncertain`, and the
 * evidence says so instead of claiming to know what is wrong.
 */

import type { Condition } from './types'
import { normalizeText } from './text'
import { looksTruncated } from './generic'

const NEW_RE = /\b(brand new|factory sealed|sealed|new in box|new sealed|nib|new)\b/
const LIKE_NEW_RE = /\b(like new|almost new|new other|new without box|new \(other\))\b/
const USED_RE = /\b(used|pre-?owned|preowned|second ?hand|as is|scratched|worn|no box|no receiver|no dongle)\b/
const REFURB_RE = /\b(refurbished|refurb|recertified|certified refurbished|reconditioned|renewed|restored|b-?stock|grade [abc])\b/
const OPEN_BOX_RE = /\b(open[\s-]?box|opened box|display model|demo unit|demo)\b/
const DEFECTIVE_RE = /\b(for parts|parts only|parts or repair|for repair|not working|(?:does|do) ?(?:not|n'?t) work|doesnt work|non[- ]?working|not functional|defective|faulty|broken|damaged|cracked|(?:won'?t|will not) (?:turn on|power on|charge))\b/
const INCOMPLETE_RE = /\b(earbuds? only|buds? only|headphones? only|unit only|device only|(?:left|right) (?:ear ?)?(?:bud|earbud|airpod)s?|(?:left|right) only|left or right|single (?:ear ?)?bud|one (?:ear ?)?bud|(?:without|no|w\/o) (?:the )?(?:charging )?case|(?:charging )?case (?:not included|missing)|missing (?:the )?(?:charging )?(?:case|charger|cable|remote|stylus)|(?:no|without) (?:charger|cable|remote|stylus))\b/

export type ConditionResult = { value: Condition; evidence: string | null; uncertain?: boolean }

export function detectCondition(title: string | null): ConditionResult {
  const t = normalizeText(title)
  const cut = looksTruncated(title)

  const defective = t.match(DEFECTIVE_RE)
  if (defective) {
    const uncertain = cut && t.length - (defective.index ?? 0) - defective[0].length < 12
    return {
      value: 'defective',
      uncertain,
      evidence: uncertain
        ? `Title says "${defective[0]}" but is cut off, so what is wrong is unclear; treated as possibly defective`
        : `Title says "${defective[0]}"`,
    }
  }
  const incomplete = t.match(INCOMPLETE_RE)
  if (incomplete) return { value: 'incomplete', evidence: `Title says "${incomplete[0]}": the product may not be complete` }

  const found: { value: Condition; word: string }[] = []
  const open = t.match(OPEN_BOX_RE)
  if (open) found.push({ value: 'open_box', word: open[0] })
  const refurb = t.match(REFURB_RE)
  if (refurb) found.push({ value: 'refurbished', word: refurb[0] })
  const likeNew = t.match(LIKE_NEW_RE)
  if (likeNew) found.push({ value: 'used', word: likeNew[0] })
  const used = t.match(USED_RE)
  if (used) found.push({ value: 'used', word: used[0] })
  // Plain "new" only counts if no like-new wording matched (it would double count).
  if (!likeNew) {
    const n = t.match(NEW_RE)
    if (n) found.push({ value: 'new', word: n[0] })
  }

  const kinds = new Set(found.map((f) => f.value))
  if (kinds.size === 0) return { value: 'unknown', evidence: null }
  // Several kinds of second-hand wording ("certified used refurbished") all mean "not new":
  // take the most specific. New mixed with anything else is a contradiction: unknown.
  if (!kinds.has('new') && kinds.size > 1) {
    const value: Condition = kinds.has('refurbished') ? 'refurbished' : kinds.has('open_box') ? 'open_box' : 'used'
    return { value, evidence: `Title says ${found.map((f) => `"${f.word}"`).join(' and ')}` }
  }
  if (kinds.size > 1) {
    return {
      value: 'unknown',
      evidence: `Title mixes condition words (${found.map((f) => `"${f.word}"`).join(', ')}); treated as unknown`,
    }
  }
  const f = found[0]
  return { value: f.value, evidence: `Title says "${f.word}"` }
}
