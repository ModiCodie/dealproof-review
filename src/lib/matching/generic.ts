/**
 * Conservative, deterministic matching for products that have no hand-written
 * rules (everything except Sony WH-1000XM5, Logitech MX Master 3S and Samsung
 * 990 PRO, which keep their specialised rules in families.ts).
 *
 * WHAT THE EVIDENCE IS. PricesAPI Search returns, per offer, only a seller, a
 * price, a free-text title, stock text, delivery text and a URL. It returns no
 * GTIN/UPC/EAN/MPN, no brand or model field and no specs. So the only evidence
 * is the listing title, and this module reads it with fixed regular expressions.
 * It never scores or guesses, never calls a model, and every decision lists the
 * evidence it used.
 *
 * HOW IT STAYS SAFE.
 *   - The product is identified by the user's own words plus the candidate they
 *     picked, not by "the API's first result".
 *   - If that identity has no model code or number, nothing is compared at all
 *     (`identityLevel` = 'insufficient').
 *   - A name-only identity ("AirPods Pro 2") can reach LIKELY but never EXACT:
 *     only a model code (letters and digits, e.g. WH-1000XM5, V15) can confirm.
 *   - A missing model code, a different model number, an extra model-line word
 *     (Pro/Max/Plus...), a different storage size, generation, screen size,
 *     multipack, special edition, accessory or compatibility wording each keep a
 *     listing out of the comparable group, with the reason shown.
 *   - Colour never counts as a variant.
 *
 * KNOWN LIMITS (also in docs/general-search.md): titles can omit or misstate
 * anything; trim levels without a modifier word (e.g. "Absolute") are only
 * caught when they sit right after the model name; model codes are not checked
 * against any manufacturer list.
 */

import type { Dimension, Evidence, GenericSpec, GenericTarget, MatchDecision } from './types'
import { normalizeText } from './text'

// ---------------------------------------------------------------- vocabulary

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'w', 'by', 'in', 'of', 'to', 'new', 'free', 'shipping', 'fast', 'sale', 'from'])
const COLORS = new Set(['black', 'white', 'silver', 'gray', 'grey', 'blue', 'red', 'green', 'gold', 'pink', 'purple', 'yellow', 'orange', 'beige', 'brown', 'midnight', 'starlight', 'graphite', 'titanium', 'bronze', 'rose', 'navy', 'teal', 'copper'])
/** Words that name what kind of thing it is, not which model it is. */
const FILLER = new Set([
  'cordless', 'wireless', 'wired', 'bluetooth', 'vacuum', 'cleaner', 'headphones', 'headphone', 'earbuds', 'earphones', 'earbud', 'headset',
  'ssd', 'nvme', 'internal', 'external', 'drive', 'solid', 'state', 'gaming', 'mouse', 'keyboard', 'laptop', 'notebook', 'tv', 'television',
  'smart', 'portable', 'stick', 'handheld', 'upright', 'robot', 'speaker', 'camera', 'phone', 'smartphone', 'tablet', 'watch', 'unlocked',
  'brand', 'original', 'genuine', 'official', 'authentic', 'sealed', 'factory', 'us', 'usa', 'version', 'model', 'noise', 'cancelling', 'canceling',
  'active', 'over', 'ear', 'on', 'in-ear', 'true', 'pcie', 'gen', 'generation', 'cleaning', 'machine', 'device', 'system', 'console',
])
/** Words that change which model it is when they follow a model name. */
const MODIFIERS = new Set(['pro', 'max', 'plus', 'ultra', 'mini', 'lite', 'se', 'air', 'xl', 'fe', 'edge', 'neo', 'evo', 'slim', 'turbo', 'prime', 'elite', 'gt'])
/** Accessories and parts. */
const ACCESSORY = /\b(ear ?pads?|ear ?cushions?|ear ?tips?|cases?|covers?|skins?|decals?|stickers?|protectors?|screen guards?|tempered glass|sleeves?|straps?|bands?|filters?|brush(?:es)?(?: heads?)?|batter(?:y|ies)|chargers?|charging (?:cable|dock|stand|pad)|cables?|adapters?|docks?|mounts?|stands?|holders?|replacement|spare|parts?|accessor(?:y|ies)|enclosures?|heat ?sinks? only|cooler|bag|pouch)\b/
const COMPAT = /\b(for|fits?|compatible with|replacement for|designed for|works with|made for)\b/
const BUNDLE = /\b(bundle|combo|kit|with free|plus free|\+)\b/
const EDITION = /\b(limited|special|collector'?s?|anniversary|founders?|signature|deluxe|exclusive|holiday) edition\b/
const UNIT_TOKEN = /^(?:\d+(?:\.\d+)?(?:hz|mah|wh|w|mm|cm|in|inch|k|p|gb|tb|mb|fps|ghz|mhz|nm|kg|lb|lbs|oz|ft|v|a|x|ms|db|rpm|mp)|usb\d*|wifi\d*|wi-?fi\d*|bt\d+|gen\d+|pcie\d*|ddr\d+x?|m2|2280|hdmi\d*|ps\d|\d+g|4k|8k|1080p|720p|hd|uhd|hdr\d*|qled|oled|led|lcd)$/

// ------------------------------------------------------------------ helpers

function tokens(t: string): string[] {
  return t.split(/[^a-z0-9]+/).filter(Boolean)
}

const isCode = (w: string) => /[a-z]/.test(w) && /\d/.test(w) && !UNIT_TOKEN.test(w)
const compact = (w: string) => w.replace(/[^a-z0-9]/g, '')

function ordinal(n: number): string {
  const m100 = n % 100
  if (m100 >= 11 && m100 <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

function hasWord(toks: string[], w: string): number {
  const alt = w.endsWith('s') ? w.slice(0, -1) : `${w}s`
  const i = toks.findIndex((x) => x === w || x === alt)
  return i
}

/** Index of the last token of a model code written with or without separators ("WH-1000XM5", "wh1000xm5", "WH 1000XM5"). */
function hasCode(toks: string[], code: string): number {
  for (let i = 0; i < toks.length; i++) {
    let acc = ''
    for (let j = i; j < Math.min(toks.length, i + 3); j++) {
      acc += toks[j]
      if (acc === code) return j
      if (acc.length >= code.length) break
    }
  }
  return -1
}

// -------------------------------------------------------------- attributes

export interface Attributes {
  storage: string[]
  memory: string[]
  generation: string[]
  size: string[]
  /** 'with' / 'without' when the title says so; empty when it says nothing. */
  heatsink: string[]
  packs: number[]
}

function capLabel(n: number, unit: string): string {
  const gb = unit === 'tb' ? n * 1000 : n
  return gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000}TB` : `${gb}GB`
}

export function attributesOf(raw: string | null): Attributes {
  const t = normalizeText(raw)
  const out: Attributes = { storage: [], memory: [], generation: [], size: [], heatsink: [], packs: [] }
  const add = (list: string[], v: string) => {
    if (!list.includes(v)) list.push(v)
  }
  for (const m of t.matchAll(/(\d{1,4}(?:\.\d{1,2})?)\s?(tb|gb)\b(?!\/s)(\s?(?:ram|memory|ddr\d?x?|lpddr\d?x?|unified memory))?/g)) {
    const n = parseFloat(m[1])
    if (!Number.isFinite(n) || n <= 0) continue
    const before = t.slice(Math.max(0, (m.index ?? 0) - 7), m.index ?? 0)
    const afterOther = /\d\s?(?:gb|tb) (?:ram|memory) $/.test(t.slice(Math.max(0, (m.index ?? 0) - 16), m.index ?? 0))
    const isMemory = !!m[3] || (!afterOther && (/\bram $/.test(before) || /\bmemory $/.test(before)))
    add(isMemory ? out.memory : out.storage, capLabel(n, m[2]))
  }
  for (const m of t.matchAll(/(\d{2,3}(?:\.\d)?)\s?(?:-?inch(?:es)?|"|″|'')/g)) add(out.size, `${parseFloat(m[1])}"`)
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)[ -]?gen(?:eration)?\b|\bgen(?:eration)?[ -]?(\d{1,2})\b|\b(\d{1,2})[ -]?gen\b/g)) {
    add(out.generation, String(parseInt(m[1] ?? m[2] ?? m[3], 10)))
  }
  if (/\b(?:w\/o|without|no) heat ?sink\b/.test(t)) add(out.heatsink, 'without')
  else if (/\bheat ?sinks?\b/.test(t) && !/\bheat ?sinks? only\b/.test(t)) add(out.heatsink, 'with')
  for (const m of t.matchAll(/\b(\d{1,3})[ -]?(?:pack|pk|ct|count|pcs|pieces)\b|\b(?:pack|set|lot) of (\d{1,3})\b|\b(\d{1,2})x\b/g)) {
    const n = parseInt(m[1] ?? m[2] ?? m[3], 10)
    if (n > 1) out.packs.push(n)
  }
  return out
}

const sortNum = (a: string, b: string) => parseFloat(a) * (/tb/i.test(a) ? 1000 : 1) - parseFloat(b) * (/tb/i.test(b) ? 1000 : 1)

// -------------------------------------------------------------- the target

interface Token {
  text: string
  kind: 'word' | 'code' | 'number'
}

/** Identity words/codes/numbers of a spec, in order. Unit-like tokens never count as identity. */
export function identityTokens(spec: GenericSpec): Token[] {
  const out: Token[] = []
  for (const raw of normalizeText(spec.identity).split(' ')) {
    const w = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    if (!w) continue
    if (/^\d{1,2}$/.test(w)) out.push({ text: w, kind: 'number' })
    else if (/^\d{3,}$/.test(w)) out.push({ text: w, kind: 'code' })
    else if (isCode(w)) out.push({ text: compact(w), kind: 'code' })
    else for (const part of w.split(/[^a-z]+/).filter(Boolean)) out.push({ text: part, kind: 'word' })
  }
  return out
}

/**
 * 'sufficient': a model code, or a model number together with a name, is present.
 * 'insufficient': nothing separates one product from another, so nothing can be compared safely.
 */
export function identityLevel(spec: GenericSpec): 'sufficient' | 'insufficient' {
  const t = identityTokens(spec)
  const codes = t.filter((x) => x.kind === 'code').length
  const numbers = t.filter((x) => x.kind === 'number').length
  const words = t.filter((x) => x.kind === 'word' && !(x.text === spec.brand)).length
  return codes > 0 || (numbers > 0 && words > 0) ? 'sufficient' : 'insufficient'
}

/** Only a model code can confirm a match. A name-only identity is capped at LIKELY. */
export function hasModelCode(spec: GenericSpec): boolean {
  // A bare number ("737") is shared by unrelated products of one brand (a charger and a power bank), so it cannot confirm a model.
  return identityTokens(spec).some((x) => x.kind === 'code' && /[a-z]/.test(x.text))
}

/**
 * Builds the spec for "this search text, and the candidate the user picked".
 * Capacity / size / generation words in the search text are not identity: they
 * become pins (a pre-selected variant). Colours and filler words are dropped.
 */
export function buildGenericSpec(query: string, candidateTitle: string | null): GenericSpec {
  const q = normalizeText(query)
  const qa = attributesOf(q)
  const pins: Record<string, string> = {}
  const ta = attributesOf(candidateTitle)
  const pick = (key: Exclude<keyof Attributes, 'packs'>) => {
    const v = qa[key].length === 1 ? qa[key][0] : qa[key].length === 0 && ta[key].length === 1 ? ta[key][0] : null
    if (v) pins[key] = v
  }
  pick('storage')
  pick('memory')
  pick('size')
  pick('generation')
  pick('heatsink')

  // Identity words: the search text without capacity / size / generation phrases, colours, filler and stop words.
  const stripped = q
    .replace(/(\d{1,4}(?:\.\d{1,2})?)\s?(tb|gb)\b(\s?(?:ram|memory))?/g, ' ')
    .replace(/(\d{2,3}(?:\.\d)?)\s?(?:-?inch(?:es)?|"|″)/g, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)[ -]?gen(?:eration)?\b|\bgen(?:eration)?[ -]?\d{1,2}\b/g, ' ')
  const kept: string[] = []
  for (const raw of stripped.split(/\s+/)) {
    const w = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    if (!w) continue
    if (/^[a-z]+$/.test(w) && (STOP.has(w) || COLORS.has(w) || FILLER.has(w))) continue
    kept.push(w)
  }
  // "AirPods Pro 1st generation": a generation stated in the search IS the model number when nothing else numbers the model.
  if (qa.generation.length === 1 && !kept.some((w) => /\d/.test(w))) {
    kept.push(qa.generation[0])
    delete pins.generation
  }
  const identity = kept.join(' ')
  const words = kept.filter((w) => /^[a-z][a-z-]*$/.test(w))
  const hasCodeToken = kept.some((w) => isCode(w) || /^\d{3,}$/.test(w))
  const brand = words.length >= 2 || (words.length === 1 && hasCodeToken) ? words[0] : null

  // Words right after the model name in the picked title ("... v15 detect ABSOLUTE vacuum").
  const trim: string[] = []
  const spec0: GenericSpec = { title: '', identity, brand, trim: [], pins }
  if (candidateTitle) {
    const toks = tokens(normalizeText(candidateTitle))
    const ends = identityTokens(spec0)
      .filter((x) => x.kind !== 'word' || x.text !== brand)
      .map((x) => (x.kind === 'code' ? hasCode(toks, x.text) : hasWord(toks, x.text)))
    if (ends.length && ends.every((i) => i >= 0)) {
      const end = Math.max(...ends)
      for (const w of toks.slice(end + 1, end + 3)) {
        if (/^[a-z]{3,}$/.test(w) && !STOP.has(w) && !COLORS.has(w) && !FILLER.has(w) && !MODIFIERS.has(w) && !identity.split(' ').includes(w)) trim.push(w)
        else break
      }
    }
  }
  return { title: (candidateTitle ?? query).slice(0, 120), identity: identity.slice(0, 120), brand, trim: trim.slice(0, 2), pins }
}

/**
 * When the search text alone names no model ("Dyson cordless vacuum"), the
 * product the user explicitly picked can: take the brand, the first model code
 * and the words right after it from that title ("Dyson V15 Detect ..." ->
 * "dyson v15 detect"). Returns null when the title has no model code either.
 * The user's own pick is the evidence here, so the result is shown to them.
 */
export function refineFromTitle(spec: GenericSpec, title: string | null): GenericSpec | null {
  const toks = tokens(normalizeText(title))
  const i = toks.findIndex((w) => isCode(w))
  if (i < 0) return null
  const brandWord = spec.brand ?? identityTokens(spec).find((x) => x.kind === 'word')?.text ?? null
  const brand = brandWord && toks.includes(brandWord) ? brandWord : null
  const following: string[] = []
  for (const w of toks.slice(i + 1, i + 3)) {
    if (/^[a-z]{3,}$/.test(w) && !STOP.has(w) && !COLORS.has(w) && !FILLER.has(w)) following.push(w)
    else break
  }
  return { ...spec, identity: [brand, toks[i], ...following].filter(Boolean).join(' '), brand }
}

/** Do the title's words and codes cover this spec's identity? (Used to rank candidates and discover variants; not a match decision.) */
export function coversIdentity(spec: GenericSpec, title: string | null): boolean {
  const toks = tokens(normalizeText(title))
  return identityTokens(spec)
    .filter((x) => x.kind !== 'number' && !(x.kind === 'word' && x.text === spec.brand))
    .every((x) => (x.kind === 'code' ? hasCode(toks, x.text) >= 0 : hasWord(toks, x.text) >= 0))
}

/** Identity words from the spec that a title does not contain (for explaining a candidate). */
export function missingFromTitle(spec: GenericSpec, title: string | null): string[] {
  const toks = tokens(normalizeText(title))
  return identityTokens(spec)
    .filter((x) => (x.kind === 'code' ? hasCode(toks, x.text) < 0 : hasWord(toks, x.text) < 0))
    .map((x) => x.text)
}

// ---------------------------------------------------------- variant controls

const DIM_LABEL: Record<string, string> = { storage: 'Storage', memory: 'Memory', generation: 'Generation', size: 'Screen size', heatsink: 'Heatsink' }
export const optionLabel = (key: string, v: string) => (key === 'heatsink' ? (v === 'with' ? 'With heatsink' : 'Without heatsink') : key === 'generation' ? `${ordinal(parseInt(v, 10))} generation` : key === 'size' ? `${parseFloat(v)}-inch` : key === 'memory' ? `${v} memory` : v)

/**
 * The variant controls for a generic product: only attributes that really
 * differ between the listings (two or more distinct stated values) or that the
 * search or picked product pinned. Nothing is invented from a guess.
 */
export function discoverDimensions(spec: GenericSpec, titles: (string | null)[]): Dimension[] {
  const counts: Record<string, Map<string, number>> = { storage: new Map(), memory: new Map(), generation: new Map(), size: new Map(), heatsink: new Map() }
  for (const title of titles) {
    if (!coversIdentity(spec, title)) continue
    const a = attributesOf(title)
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      const vals = a[key as 'storage']
      if (vals.length === 1) counts[key].set(vals[0], (counts[key].get(vals[0]) ?? 0) + 1)
    }
  }
  const hasNumber = identityTokens(spec).some((x) => x.kind === 'number')
  const dims: Dimension[] = []
  for (const key of ['storage', 'memory', 'generation', 'size', 'heatsink']) {
    if (key === 'generation' && hasNumber) continue // the model number in the search already says which generation
    const seen = counts[key]
    const pin = spec.pins[key]
    if (key === 'heatsink') {
      if (!seen.size && !pin) continue
      const options = [{ value: 'with', label: optionLabel(key, 'with') }, { value: 'without', label: optionLabel(key, 'without') }]
      dims.push({
        key, label: DIM_LABEL[key], options, default: pin ?? 'without',
        note: pin ? 'taken from your search.' : 'set to the version without a heatsink. Listings that do not say are marked "likely".',
      })
      continue
    }
    if (seen.size < 2 && !pin) continue
    const values = new Set(seen.keys())
    if (pin) values.add(pin)
    const options = [...values].sort(sortNum).map((v) => ({ value: v, label: optionLabel(key, v) }))
    let def = pin ?? [...seen.entries()].sort((a, b) => b[1] - a[1] || sortNum(a[0], b[0]))[0][0]
    if (!values.has(def)) def = options[0].value
    dims.push({
      key,
      label: DIM_LABEL[key],
      options,
      default: def,
      note: pin
        ? `${spec.pins[key] && !normalizeText(spec.identity).includes(pin.toLowerCase()) ? 'taken from the product you chose' : 'taken from your search'}.`
        : `set to ${optionLabel(key, def)}, the most common in the listings. Check it is the one you mean.`,
    })
  }
  return dims
}

/** A comparison target with every discovered dimension set to its default. */
export function makeGenericTarget(spec: GenericSpec, titles: (string | null)[], chosen: Record<string, string> = {}): GenericTarget {
  const variant: Record<string, string> = {}
  for (const d of discoverDimensions(spec, titles)) variant[d.key] = d.options.some((o) => o.value === chosen[d.key]) ? chosen[d.key] : d.default
  return { family: 'generic', variant, spec }
}

// ---------------------------------------------------------------- the match

function decide(cls: MatchDecision['class'], summary: string, reasons: string[], evidence: Evidence[], variantLabel: string | null = null): MatchDecision {
  return { class: cls, summary, reasons, evidence, variantLabel }
}

export const INSUFFICIENT_MESSAGE =
  'Your search does not name a specific model (for example "Dyson V15 Detect" or "WD Black SN850X"), so DealProof cannot tell which listings are the same product. No prices are compared.'

/** Reads one listing title against a generic target and says whether it is the same product, with the evidence. */
export function classifyGeneric(target: GenericTarget, title: string | null): MatchDecision {
  const spec = target.spec
  const t = normalizeText(title)
  const ev: Evidence[] = []
  if (!t) return decide('AMBIGUOUS', "The listing has no title, so we can't tell what it is.", ['No title text.'], ev)
  if (identityLevel(spec) === 'insufficient') {
    return decide('AMBIGUOUS', "Your search doesn't name a specific model, so this listing can't be matched.", [INSUFFICIENT_MESSAGE], [
      { attribute: 'model', value: 'not specific enough', effect: 'info', from: 'target' },
    ])
  }

  const toks = tokens(t)
  const id = identityTokens(spec)
  const coreWords = id.filter((x) => x.kind === 'word' && x.text !== spec.brand)
  const codes = id.filter((x) => x.kind === 'code')
  const numbers = id.filter((x) => x.kind === 'number')
  const ends: number[] = []

  // --- model words and codes
  const missingWords = coreWords.filter((w) => {
    const i = hasWord(toks, w.text)
    if (i >= 0) ends.push(i)
    return i < 0
  })
  const missingCodes = codes.filter((c) => {
    const i = hasCode(toks, c.text)
    if (i >= 0) ends.push(i)
    return i < 0
  })
  const brandMissing = !!spec.brand && hasWord(toks, spec.brand) < 0
  const idTexts = new Set(id.map((x) => x.text))
  const otherCodes = toks.filter((w) => isCode(w) && !idTexts.has(w))

  if (ends.length) {
    // --- accessory / compatibility wording
    const firstId = ends.length ? Math.min(...ends) : 0
    const accessoryOnly = /\b(?:case|cover|skin|strap|band|stand|dock|charger|cable|filter|battery|tips?|pads?|mount|holder|sleeve|adapter)s? only\b/.test(t)
    const accessory = t.match(ACCESSORY)
    const compat = t.match(COMPAT)
    const accessoryPos = accessory ? toks.findIndex((w) => accessory[0].split(' ')[0] === w) : -1
    if (accessory) {
      const forPattern = new RegExp(`${COMPAT.source}[^,;]{0,40}`).test(t.slice(0, Math.max(0, t.indexOf(accessory[0]) + accessory[0].length + 40)))
      if (accessoryOnly || (compat && compat.index !== undefined && t.indexOf(accessory[0]) < compat.index) || forPattern || (accessoryPos >= 0 && accessoryPos < firstId)) {
        return decide('REJECTED', `This looks like an accessory ("${accessory[0]}"), not the product itself.`, ['Accessory wording appears before or together with compatibility wording.'], [
          { attribute: 'accessory wording', value: accessory[0], effect: 'conflicts', from: 'title' },
        ])
      }
    } else if (compat && compat.index !== undefined && compat.index < (t.indexOf(coreWords[0]?.text ?? codes[0]?.text ?? '') + 1 || 1) && /\b(compatible with|fits?|replacement for|works with)\b/.test(t)) {
      return decide('AMBIGUOUS', 'The title reads like a compatibility listing.', ['"Compatible with" wording often means the listing is for a part or accessory.'], [
        ...ev,
        { attribute: 'compatibility wording', value: compat[0], effect: 'conflicts', from: 'title' },
      ])
    }
  }
  if (ends.length) {
    // Part words right after the model ("... V15 Detect Replacement Battery", "... Wall Mount Dock") or ending the title,
    // unless introduced as an inclusion ("with ... case"): probably a part or accessory, so it is kept out of the comparison.
    const tail = toks.slice(Math.max(...ends) + 1)
    const isPart = (w: string) => ACCESSORY.test(w)
    const at = tail.findIndex((w, i) => isPart(w) && (i < 2 || i >= tail.length - 3))
    if (at >= 0) {
      const abs = Math.max(...ends) + 1 + at
      const included = toks.slice(Math.max(0, abs - 4), abs).some((w) => /^(with|w|includes?|including|plus|and|bundle|bundled|free)$/.test(w))
      if (!included) {
        return decide('AMBIGUOUS', `The title ends like a part or accessory ("${tail[at]}"), so it may not be the product itself.`, ['Part words next to the model name often mean a replacement part or accessory, not the product.'], [
          ...ev,
          { attribute: 'accessory wording', value: tail[at], effect: 'conflicts', from: 'title' },
        ])
      }
    }
  }
  if (missingCodes.length) {
    const c = missingCodes.map((x) => x.text.toUpperCase()).join(', ')
    if (otherCodes.length) {
      return decide('REJECTED', `Different model: the title names ${otherCodes[0].toUpperCase()}, not ${c}.`, [`The model code ${c} is missing and a different model code is present.`], [
        { attribute: 'model', value: otherCodes[0].toUpperCase(), effect: 'conflicts', from: 'title' },
      ])
    }
    const nothing = missingWords.length === coreWords.length
    if (nothing && !ends.length && !brandMissing && spec.brand) {
      return decide('AMBIGUOUS', `The title names ${spec.brand} but not the model (${c}).`, ['Only the brand matches, so it could be any of the brand\'s products.'], [{ attribute: 'model', value: 'not stated', effect: 'info', from: 'title' }])
    }
    return nothing
      ? decide('REJECTED', `Not the same product: the title doesn't mention ${c}.`, ['None of the model words or codes you searched for appear.'], [{ attribute: 'model', value: 'not found', effect: 'conflicts', from: 'title' }])
      : decide('AMBIGUOUS', `The title doesn't say the model code (${c}).`, ['Some of the words match, but the model code is missing, so it could be another model.'], [{ attribute: 'model', value: 'code not stated', effect: 'info', from: 'title' }])
  }
  if (missingWords.length) {
    const w = missingWords.map((x) => x.text).join(', ')
    const modifierMissing = missingWords.some((x) => MODIFIERS.has(x.text))
    if (!ends.length && !brandMissing && spec.brand && missingWords.length === coreWords.length) {
      return decide('AMBIGUOUS', `The title names ${spec.brand} but not the model.`, ['Only the brand matches, so it could be any of the brand\'s products.'], [{ attribute: 'model', value: 'not stated', effect: 'info', from: 'title' }])
    }
    if (modifierMissing || missingWords.length === coreWords.length) {
      return decide('REJECTED', `Different product: the title doesn't say "${w}".`, [modifierMissing ? `"${w}" is part of the model name; a listing without it is usually a different model.` : 'None of the model words you searched for appear.'], [
        { attribute: 'model', value: `missing ${w}`, effect: 'conflicts', from: 'title' },
      ])
    }
    return decide('AMBIGUOUS', `The title doesn't say "${w}".`, ['Part of the model name is missing, so it could be a different product.'], [{ attribute: 'model', value: `missing ${w}`, effect: 'info', from: 'title' }])
  }
  const sameShape = otherCodes.find((o) => codes.some((c) => c.text.replace(/\d.*$/, '') === o.replace(/\d.*$/, '')))
  if (sameShape) {
    return decide('AMBIGUOUS', `The title mentions more than one model (${codes[0].text.toUpperCase()} and ${sameShape.toUpperCase()}).`, ['Titles that list several models are often compatibility lists or keyword stuffing.'], [
      { attribute: 'model', value: `${codes[0].text.toUpperCase()} + ${sameShape.toUpperCase()}`, effect: 'conflicts', from: 'title' },
    ])
  }
  for (const c of codes) ev.push({ attribute: 'model code', value: c.text.toUpperCase(), effect: 'supports', from: 'title' })
  for (const w of coreWords) ev.push({ attribute: 'model name', value: w.text, effect: 'supports', from: 'title' })

  // --- model number / generation
  const attrs = attributesOf(t)
  for (const n of numbers) {
    const present = toks.includes(n.text) || attrs.generation.includes(n.text)
    if (present) {
      ev.push({ attribute: 'model number', value: n.text, effect: 'supports', from: 'title' })
      continue
    }
    const after = toks[Math.max(...ends, -1) + 1]
    if (attrs.generation.length === 1) {
      const g = ordinal(parseInt(attrs.generation[0], 10))
      return decide('DIFFERENT_VARIANT', `Different generation: ${g} (you chose ${ordinal(parseInt(n.text, 10))}).`, ['Same product name, but the title states another generation.'], [
        ...ev,
        { attribute: 'generation', value: g, effect: 'conflicts', from: 'title' },
      ], `${g} generation`)
    }
    if (after && /^\d{1,2}$/.test(after)) {
      return decide('REJECTED', `Different model number: ${after} (you searched for ${n.text}).`, ['The number after the model name is different.'], [...ev, { attribute: 'model number', value: after, effect: 'conflicts', from: 'title' }])
    }
    return decide('AMBIGUOUS', `The title doesn't say it is number ${n.text}.`, ['The model number you searched for is missing, so it could be another generation.'], [...ev, { attribute: 'model number', value: 'not stated', effect: 'info', from: 'title' }])
  }

  // --- model-line words that were not searched for (Pro, Max, Plus, ...)
  const lastId = Math.max(...ends, ...[...idTexts].map((x) => toks.lastIndexOf(x)), 0)
  const extraModifier = toks.slice(lastId + 1, lastId + 3).find((w) => MODIFIERS.has(w) && !idTexts.has(w))
  const modifierAnywhere = toks.find((w, i) => MODIFIERS.has(w) && !idTexts.has(w) && Math.abs(i - lastId) <= 2)
  const mod = extraModifier ?? modifierAnywhere
  if (mod && !spec.trim.includes(mod)) {
    return decide('REJECTED', `Different model: the title adds "${mod}" to the name.`, [`"${mod}" after the model name usually marks a different model (for example Pro, Max, Plus).`], [
      ...ev,
      { attribute: 'model name', value: `+ ${mod}`, effect: 'conflicts', from: 'title' },
    ])
  }

  // --- editions and multipacks
  const edition = t.match(EDITION)
  if (edition && !normalizeText(spec.identity + ' ' + spec.title).includes(edition[0])) {
    return decide('DIFFERENT_VARIANT', `Special edition: "${edition[0]}".`, ['The title states an edition that is not the standard version.'], [
      ...ev,
      { attribute: 'edition', value: edition[0], effect: 'conflicts', from: 'title' },
    ], edition[0])
  }
  if (attrs.packs.length) {
    const n = Math.max(...attrs.packs)
    return decide('DIFFERENT_VARIANT', `Multipack: ${n} units.`, ['The price is for more than one unit, so it cannot be compared with a single item.'], [...ev, { attribute: 'pack size', value: String(n), effect: 'conflicts', from: 'title' }], `${n}-pack`)
  }

  // --- variant dimensions (storage, memory, generation, size)
  const notes: string[] = []
  let unstated = false
  for (const key of ['storage', 'memory', 'generation', 'size', 'heatsink'] as const) {
    const want = target.variant[key]
    if (!want) continue
    const have = attrs[key]
    if (have.length > 1) {
      return decide('AMBIGUOUS', `The title lists several ${DIM_LABEL[key].toLowerCase()} values (${have.join(', ')}).`, ['Titles that list several values do not say which one is for sale.'], [
        ...ev,
        { attribute: DIM_LABEL[key].toLowerCase(), value: have.join(' / '), effect: 'conflicts', from: 'title' },
      ])
    }
    if (have.length === 0) {
      unstated = true
      notes.push(`${DIM_LABEL[key].toLowerCase()} not stated`)
      ev.push({ attribute: DIM_LABEL[key].toLowerCase(), value: 'not stated', effect: 'info', from: 'title' })
      continue
    }
    ev.push({ attribute: DIM_LABEL[key].toLowerCase(), value: optionLabel(key, have[0]), effect: have[0] === want ? 'supports' : 'conflicts', from: 'title' })
    if (have[0] !== want) {
      return decide('DIFFERENT_VARIANT', `Different ${DIM_LABEL[key].toLowerCase()}: ${optionLabel(key, have[0])} (you chose ${optionLabel(key, want)}).`, ['Same product name, but a different configuration.'], ev, `${optionLabel(key, have[0])}`)
    }
  }

  // --- bundles, unknown words after the model name, trim levels, missing brand
  const caveats: string[] = []
  const bundle = t.match(BUNDLE)
  if (bundle) caveats.push(`sold with extras ("${bundle[0]}")`)
  const end = Math.max(...ends, -1)
  const adj = toks[end + 1]
  const known = new Set([...identityTokens(spec).map((x) => x.text), ...spec.trim])
  const next = toks.slice(end + 1, end + 3)
  const missingTrim = spec.trim.filter((w) => !toks.includes(w))
  if (missingTrim.length) caveats.push(`the title doesn't say "${missingTrim.join(' ')}"`)
  else if (adj && /^[a-z]{3,}$/.test(adj) && !known.has(adj) && !STOP.has(adj) && !COLORS.has(adj) && !FILLER.has(adj) && !MODIFIERS.has(adj) && !spec.trim.length) {
    caveats.push(`the title adds "${adj}" after the model name, which may mark a different version`)
  }
  if (brandMissing) caveats.push(`the brand "${spec.brand}" is not stated`)
  if (unstated) caveats.push(notes.join(' and '))
  if (!hasModelCode(spec)) caveats.push('no model code is stated to confirm the exact model')

  if (caveats.length) {
    return decide('LIKELY', `Probably the same product, but ${caveats[0]}.`, caveats.map((c) => `Likely, not confirmed: ${c}.`), ev)
  }
  return decide('EXACT', `Title names the same model${Object.keys(target.variant).length ? ' and variant' : ''}: ${codes.map((c) => c.text.toUpperCase()).join(' ')}.`, ['The model code and every chosen variant attribute are stated in the listing title and agree. This is title text only, not a verified product identity.'], ev)
}
