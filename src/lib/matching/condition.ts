/**
 * Condition from listing text. The default is 'unknown': a title that says
 * nothing about condition is NOT evidence the item is new.
 */

import type { Condition } from './types'
import { normalizeText } from './text'

const NEW_RE = /\b(brand new|factory sealed|sealed|new in box|new sealed|nib|new)\b/
const LIKE_NEW_RE = /\b(like new|almost new|new other|new without box|new \(other\))\b/
const USED_RE = /\b(used|pre-?owned|preowned|second ?hand|for parts|as is|damaged|broken|scratched|worn|no box|no receiver|no dongle|missing)\b/
const REFURB_RE = /\b(refurbished|refurb|recertified|certified refurbished|reconditioned|renewed|b-?stock|grade [abc])\b/
const OPEN_BOX_RE = /\b(open[\s-]?box|opened box|display model|demo unit|demo)\b/

export function detectCondition(title: string | null): { value: Condition; evidence: string | null } {
  const t = normalizeText(title)
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
  if (kinds.size > 1) {
    return {
      value: 'unknown',
      evidence: `Title mixes condition words (${found.map((f) => `"${f.word}"`).join(', ')}); treated as unknown`,
    }
  }
  const f = found[0]
  return { value: f.value, evidence: `Title says "${f.word}"` }
}
