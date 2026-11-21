/**
 * Product families DealProof can compare, and the deterministic rules that
 * decide whether a listing title matches the requested product + variant.
 *
 * Every rule is a fixed regular expression over normalized text. Nothing is
 * scored or guessed: each decision lists the evidence it used.
 *
 * MANUFACTURER PART NUMBERS: only codes read from an official manufacturer page
 * (see VERIFIED_PART_NUMBERS) are used as evidence. Codes seen in listing titles
 * but not verified are reported as information and never change a decision.
 */

import type { Dimension, Evidence, FamilyId, FamilyInfo, FamilyTarget, MatchDecision, ProductTarget } from './types'
import { capacities, has, normalizeText } from './text'
import { classifyGeneric, discoverDimensions, optionLabel } from './generic'

// ---------------------------------------------------------------------------
// Verified manufacturer part numbers (read from official pages on 2026-11-19)
// ---------------------------------------------------------------------------

export interface VerifiedPartNumber {
  /** Regex (on normalized text) that matches this code in a listing. */
  pattern: RegExp
  code: string
  family: FamilyId
  /** Attributes the manufacturer's page ties to this code. */
  attributes: { capacity?: string; heatsink?: 'with' | 'without' }
  source: string
}

export const VERIFIED_PART_NUMBERS: VerifiedPartNumber[] = [
  {
    code: 'MZ-V9P2T0B/AM',
    pattern: /\bmz-?v9p2t0b\/am\b/,
    family: 'samsung-990-pro',
    attributes: { capacity: '2TB', heatsink: 'without' },
    // Page lists "990 PRO ... 2TB" (no heatsink wording) with this code.
    source: 'https://www.samsung.com/us/computing/memory-storage/solid-state-drives/990-pro-pcie-4-0-nvme-ssd-2tb-mz-v9p2t0b-am/',
  },
  {
    code: 'MZ-V9P2T0GW',
    pattern: /\bmz-?v9p2t0gw(?:\/am)?\b/,
    family: 'samsung-990-pro',
    attributes: { capacity: '2TB', heatsink: 'with' },
    // Page title: "990 PRO w/ Heatsink PCIe 4.0 NVMe SSD 2TB ... MZ-V9P2T0GW".
    source: 'https://www.samsung.com/us/memory-storage/nvme-ssd/990-pro-w-heatsink-pcie-4-0-nvme-ssd-2tb-sku-mz-v9p2t0gw/',
  },
]

/** Both Samsung pages show the bare family code "MZ-V9P2T0" for the 2TB size. It does not say whether there is a heatsink. */
const SAMSUNG_2TB_FAMILY_CODE = /\bmz-?v9p2t0\b(?![/a-z0-9])/

// ---------------------------------------------------------------------------
// Family catalog (what the UI offers)
// ---------------------------------------------------------------------------

export const FAMILIES: Record<FamilyId, FamilyInfo> = {
  'sony-wh-1000xm5': {
    id: 'sony-wh-1000xm5',
    brand: 'Sony',
    name: 'WH-1000XM5 headphones',
    dimensions: [], // colour is cosmetic and not part of the comparison
  },
  'logitech-mx-master-3s': {
    id: 'logitech-mx-master-3s',
    brand: 'Logitech',
    name: 'MX Master 3S mouse',
    dimensions: [
      {
        key: 'edition',
        label: 'Edition',
        default: 'standard',
        options: [
          { value: 'standard', label: 'Standard (Bluetooth Edition)' },
          { value: 'mac', label: 'For Mac' },
          { value: 'business', label: 'For Business' },
        ],
      },
    ],
  },
  'samsung-990-pro': {
    id: 'samsung-990-pro',
    brand: 'Samsung',
    name: '990 PRO SSD',
    dimensions: [
      {
        key: 'capacity',
        label: 'Storage',
        default: '2TB',
        options: [
          { value: '1TB', label: '1TB' },
          { value: '2TB', label: '2TB' },
          { value: '4TB', label: '4TB' },
        ],
      },
      {
        key: 'heatsink',
        label: 'Heatsink',
        default: 'without',
        options: [
          { value: 'without', label: 'Without heatsink' },
          { value: 'with', label: 'With heatsink' },
        ],
      },
    ],
  },
}

export function targetLabel(t: ProductTarget): string {
  if (t.family === 'generic') {
    const parts = [t.spec.title.length > 70 ? `${t.spec.title.slice(0, 67)}...` : t.spec.title]
    for (const [k, v] of Object.entries(t.variant)) parts.push(optionLabel(k, v))
    return parts.join(' · ')
  }
  const f = FAMILIES[t.family]
  const parts = [`${f.brand} ${f.name}`]
  for (const d of f.dimensions) {
    const opt = d.options.find((o) => o.value === t.variant[d.key])
    if (opt) parts.push(opt.label)
  }
  return parts.join(' · ')
}

/** The variant controls for a target: fixed for the specialised products, discovered from the listings for any other. */
export function dimensionsFor(target: ProductTarget, titles: (string | null)[]): Dimension[] {
  return target.family === 'generic' ? discoverDimensions(target.spec, titles) : FAMILIES[target.family].dimensions
}

export function defaultVariant(family: FamilyId): Record<string, string> {
  return Object.fromEntries(FAMILIES[family].dimensions.map((d: Dimension) => [d.key, d.default]))
}

/**
 * Works out which supported product the user's search text is about, and which
 * variant choices the text already states. Returns null for unsupported products.
 */
export function detectTarget(query: string): ProductTarget | null {
  const t = normalizeText(query)
  if (/\bwh[- ]?1000 ?xm5\b/.test(t) || (/\bxm5\b/.test(t) && /\bsony\b/.test(t))) {
    return { family: 'sony-wh-1000xm5', variant: {} }
  }
  if (/\bmx[ -]?master[ -]?3s\b/.test(t)) {
    const edition = /\bfor mac\b|\bmac\b/.test(t) ? 'mac' : /\bbusiness\b/.test(t) ? 'business' : 'standard'
    return { family: 'logitech-mx-master-3s', variant: { edition } }
  }
  if (/\b990 ?pro\b/.test(t)) {
    const caps = capacities(t)
    const capacity = caps.length === 1 && ['1TB', '2TB', '4TB'].includes(caps[0]) ? caps[0] : '2TB'
    const heatsink = /\b(w\/o|without|no) heat ?sink\b/.test(t) ? 'without' : /\bheat ?sink\b/.test(t) ? 'with' : 'without'
    return { family: 'samsung-990-pro', variant: { capacity, heatsink } }
  }
  return null
}

// ---------------------------------------------------------------------------
// Decision helpers
// ---------------------------------------------------------------------------

function decide(
  cls: MatchDecision['class'],
  summary: string,
  reasons: string[],
  evidence: Evidence[],
  variantLabel: string | null = null,
): MatchDecision {
  return { class: cls, summary, reasons, evidence, variantLabel }
}

const ACCESSORY_WORDS = /\b(ear ?pads?|ear ?cushions?|cushions?|replacement|spare|cover|skin|decal|sticker|grips?|mouse ?pads?|wrist rest|cable only|stand|holder|carrying case only|case only|screws?|enclosure|adapter|dongle|cooler|heat ?sink only)\b/
const COMPAT_PHRASE = /\b(for|fits?|compatible with|replacement for|designed for)\b/
const BUNDLE_PHRASE = /\b(with|w\/|plus|\+|includes?)\b/

function mentionsOthers(count: number): boolean {
  return count > 1
}

// ---------------------------------------------------------------------------
// Sony WH-1000XM5
// ---------------------------------------------------------------------------

function classifySony(title: string | null): MatchDecision {
  const t = normalizeText(title)
  const ev: Evidence[] = []
  if (!t) return decide('AMBIGUOUS', "The listing has no title, so we can't tell what it is.", ['No title text.'], ev)

  // WF-1000XM5 are earbuds: a different product that looks similar in text.
  if (/\bwf-?1000 ?xm5\b/.test(t) && !/\bwh[- ]?1000 ?xm5\b/.test(t)) {
    return decide('REJECTED', 'Different product: WF-1000XM5 earbuds, not WH-1000XM5 headphones.', ['Title names WF-1000XM5 (in-ear earbuds).'], [
      { attribute: 'model', value: 'WF-1000XM5', effect: 'conflicts', from: 'title' },
    ])
  }

  const hasXm5 = /\bwh[- ]?1000 ?xm5\b/.test(t) || (/\bxm5\b/.test(t) && /\bsony\b/.test(t))
  const others = [...t.matchAll(/\b(?:wh[- ]?1000 ?)?xm([2346])\b/g)].map((m) => `XM${m[1]}`)
  const unique = [...new Set(others)]

  if (!hasXm5 && unique.length > 0) {
    return decide('REJECTED', `Different generation: ${unique.join(', ')}.`, [`Title names ${unique.join(', ')} and not WH-1000XM5.`], [
      { attribute: 'model', value: unique.join(', '), effect: 'conflicts', from: 'title' },
    ])
  }
  if (hasXm5 && unique.length > 0) {
    return decide('AMBIGUOUS', `The title mentions several models (XM5 and ${unique.join(', ')}).`, ['Titles that list several models are often compatibility lists or keyword stuffing.'], [
      { attribute: 'model', value: `WH-1000XM5 + ${unique.join(', ')}`, effect: 'conflicts', from: 'title' },
    ])
  }

  if (!hasXm5) {
    const sonyHeadphones = /\bsony\b/.test(t) && /\bheadphones?\b|\bnoise (cancel|canc)/.test(t)
    return sonyHeadphones
      ? decide('AMBIGUOUS', "The title doesn't say which Sony model this is.", ['Sony headphones, but the WH-1000XM5 model name is missing.'], [
          { attribute: 'model', value: 'not stated', effect: 'info', from: 'title' },
        ])
      : decide('REJECTED', "The title doesn't mention the WH-1000XM5.", ['No WH-1000XM5 model name found.'], [
          { attribute: 'model', value: 'not found', effect: 'conflicts', from: 'title' },
        ])
  }

  ev.push({ attribute: 'model', value: 'WH-1000XM5', effect: 'supports', from: 'title' })
  const hasHeadphoneWord = /\bheadphones?\b|\bheadset\b/.test(t)
  const accessory = t.match(ACCESSORY_WORDS)
  if (accessory) {
    const compat = COMPAT_PHRASE.test(t) && new RegExp(`${COMPAT_PHRASE.source}[^,;]{0,30}xm5`).test(t)
    const bundle = hasHeadphoneWord && BUNDLE_PHRASE.test(t) && !compat
    if (!bundle) {
      return decide('REJECTED', `This looks like an accessory ("${accessory[0]}"), not the headphones.`, ['Accessory wording without a headphones-plus-extras pattern.'], [
        ...ev,
        { attribute: 'accessory wording', value: accessory[0], effect: 'conflicts', from: 'title' },
      ])
    }
    return decide(
      'LIKELY',
      `Probably the headphones, sold with extras ("${accessory[0]}"). Check what is included.`,
      ['Title names the model and mentions extras, which may change what is included in the price.'],
      [...ev, { attribute: 'bundle', value: accessory[0], effect: 'info', from: 'title' }],
    )
  }
  const extras = t.match(/\b(?:with|w\/|incl(?:udes|uding)?)\s+[^,;]{0,25}?\b(cable|case|pouch|bag|charger|adapter|box)\b/)
  if (extras) {
    return decide(
      'LIKELY',
      `Probably the headphones, sold with extras ("${extras[1]}"). Check what is included.`,
      ['Title names the model and mentions extras, which may change what is included in the price.'],
      [...ev, { attribute: 'bundle', value: extras[1], effect: 'info', from: 'title' }],
    )
  }
  return decide('EXACT', 'Same model: Sony WH-1000XM5.', ['Title names WH-1000XM5. Colour is not part of the comparison.'], ev)
}

// ---------------------------------------------------------------------------
// Logitech MX Master 3S
// ---------------------------------------------------------------------------

type Edition = 'standard' | 'mac' | 'business'
const EDITION_LABEL: Record<Edition, string> = {
  standard: 'standard edition',
  mac: 'for Mac',
  business: 'for Business',
}

function classifyLogitech(title: string | null, target: FamilyTarget): MatchDecision {
  const t = normalizeText(title)
  const ev: Evidence[] = []
  if (!t) return decide('AMBIGUOUS', "The listing has no title, so we can't tell what it is.", ['No title text.'], ev)

  const has3s = /\bmx[ -]?master[ -]?3s\b/.test(t)
  if (!has3s && /\bmx[ -]?master[ -]?3[ /,&+-]{1,3}(?:and )?3s\b/.test(t)) {
    return decide('AMBIGUOUS', 'The title lists both MX Master 3 and 3S.', ['Titles naming both generations do not say which one is sold.'], [
      { attribute: 'model', value: 'MX Master 3 + 3S', effect: 'conflicts', from: 'title' },
    ])
  }
  const hasOther = /\bmx[ -]?master[ -]?(?:3(?![s0-9])|2s|2|4)\b/.test(t) || /\banywhere\b|\bmx ?vertical\b|\bmx ?ergo\b/.test(t)

  if (!has3s && hasOther) {
    return decide('REJECTED', 'Different model (not the MX Master 3S).', ['Title names another MX Master / MX model.'], [
      { attribute: 'model', value: 'other MX model', effect: 'conflicts', from: 'title' },
    ])
  }
  if (has3s && hasOther) {
    return decide('AMBIGUOUS', 'The title mentions more than one model.', ['MX Master 3S appears together with another model, which is typical of compatibility lists.'], [
      { attribute: 'model', value: 'multiple', effect: 'conflicts', from: 'title' },
    ])
  }
  if (!has3s) {
    const looksLikeMouse = /\blogitech\b/.test(t) && /\bmouse|mice\b/.test(t)
    return looksLikeMouse
      ? decide('AMBIGUOUS', "The title doesn't say which Logitech mouse this is.", ['Logitech mouse without the MX Master 3S model name. Part numbers seen in titles are not verified, so they are not used.'], [
          { attribute: 'model', value: 'not stated', effect: 'info', from: 'title' },
        ])
      : decide('REJECTED', "The title doesn't mention the MX Master 3S.", ['No MX Master 3S model name found.'], [
          { attribute: 'model', value: 'not found', effect: 'conflicts', from: 'title' },
        ])
  }

  ev.push({ attribute: 'model', value: 'MX Master 3S', effect: 'supports', from: 'title' })
  // Unverified part numbers: information only.
  const pn = t.match(/\b910-\d{6}\b/)
  if (pn) ev.push({ attribute: 'part number (not verified)', value: pn[0].toUpperCase(), effect: 'info', from: 'title' })

  const accessory = t.match(ACCESSORY_WORDS)
  if (accessory && !/\bmouse\b/.test(t.replace(/mouse ?pads?/g, ''))) {
    return decide('REJECTED', `This looks like an accessory ("${accessory[0]}"), not the mouse.`, ['Accessory wording and no standalone "mouse".'], [
      ...ev,
      { attribute: 'accessory wording', value: accessory[0], effect: 'conflicts', from: 'title' },
    ])
  }

  const isMac = /\bfor mac\b|\bmac edition\b|\bfor macos\b/.test(t)
  const isBusiness = /\bfor business\b|\bbusiness edition\b|\bbusiness\b/.test(t)
  if (isMac && isBusiness) {
    return decide('AMBIGUOUS', 'The title mentions both Mac and Business editions.', ['Conflicting edition wording.'], [
      ...ev,
      { attribute: 'edition', value: 'Mac and Business', effect: 'conflicts', from: 'title' },
    ])
  }
  const detected: Edition | null = isMac ? 'mac' : isBusiness ? 'business' : null
  const want = (target.variant.edition ?? 'standard') as Edition
  const stdWording = /\bbluetooth edition\b/.test(t)

  if (detected) {
    ev.push({ attribute: 'edition', value: EDITION_LABEL[detected], effect: detected === want ? 'supports' : 'conflicts', from: 'title' })
    return detected === want
      ? decide('EXACT', `Same model and edition: MX Master 3S ${EDITION_LABEL[detected]}.`, ['Title states the model and the edition.'], ev, EDITION_LABEL[detected])
      : decide('DIFFERENT_VARIANT', `Different edition: ${EDITION_LABEL[detected]} (you chose ${EDITION_LABEL[want]}).`, ['Same mouse family, but a different edition.'], ev, `MX Master 3S ${EDITION_LABEL[detected]}`)
  }

  // No Mac/Business wording.
  if (stdWording) {
    ev.push({ attribute: 'edition', value: 'Bluetooth Edition (standard)', effect: want === 'standard' ? 'supports' : 'conflicts', from: 'title' })
    return want === 'standard'
      ? decide('EXACT', 'Same model and edition: MX Master 3S Bluetooth Edition.', ['Title states "Bluetooth Edition", the name Logitech uses for the standard model.'], ev, 'standard edition')
      : decide('DIFFERENT_VARIANT', `Standard edition, not the ${EDITION_LABEL[want]} edition you chose.`, ['Title says "Bluetooth Edition" (standard) and no Mac/Business wording.'], ev, 'MX Master 3S standard edition')
  }
  ev.push({ attribute: 'edition', value: 'not stated', effect: 'info', from: 'title' })
  return decide(
    'LIKELY',
    want === 'standard' ? "Probably the standard edition, but the listing doesn't say." : `The listing doesn't say whether it is the ${EDITION_LABEL[want]} edition.`,
    ['Model matches, but Mac and Business editions are also sold, and this title names no edition.'],
    ev,
  )
}

// ---------------------------------------------------------------------------
// Samsung 990 PRO
// ---------------------------------------------------------------------------

function classifySamsung(title: string | null, target: FamilyTarget): MatchDecision {
  const t = normalizeText(title)
  const ev: Evidence[] = []
  if (!t) return decide('AMBIGUOUS', "The listing has no title, so we can't tell what it is.", ['No title text.'], ev)

  const wantCap = target.variant.capacity ?? '2TB'
  const wantHs = (target.variant.heatsink ?? 'without') as 'with' | 'without'

  // Verified part numbers
  const pnHits = VERIFIED_PART_NUMBERS.filter((p) => p.family === 'samsung-990-pro' && p.pattern.test(t))
  const pn = pnHits.length === 1 ? pnHits[0] : null
  if (pnHits.length > 1) {
    return decide('AMBIGUOUS', 'The title lists several different part numbers.', ['More than one Samsung part number appears.'], [
      { attribute: 'part number', value: pnHits.map((p) => p.code).join(', '), effect: 'conflicts', from: 'title' },
    ])
  }

  const has990Pro = /\b990 ?pro\b/.test(t)
  const has990Evo = /\b990 ?evo\b/.test(t)
  const otherSeries = /\b(980|970|960|950|870|860|850|t[579]|pm9\w*|9100|8[0-9]0)\b ?(pro|evo|plus|qvo)?\b/.test(t) && !has990Pro

  if (has990Evo && !has990Pro && !pn) {
    return decide('REJECTED', 'Different product: Samsung 990 EVO, not 990 PRO.', ['The 990 EVO / EVO Plus is a different SSD line.'], [
      { attribute: 'model', value: '990 EVO', effect: 'conflicts', from: 'title' },
    ])
  }
  if (has990Evo && has990Pro) {
    return decide('AMBIGUOUS', 'The title mentions both 990 PRO and 990 EVO.', ['Both models appear, so we cannot tell which one is for sale.'], [
      { attribute: 'model', value: '990 PRO + 990 EVO', effect: 'conflicts', from: 'title' },
    ])
  }
  if (otherSeries && !pn) {
    return decide('REJECTED', 'Different Samsung model (not the 990 PRO).', ['Title names another Samsung SSD model.'], [
      { attribute: 'model', value: 'other Samsung SSD', effect: 'conflicts', from: 'title' },
    ])
  }

  const modelKnown = has990Pro || !!pn || SAMSUNG_2TB_FAMILY_CODE.test(t)
  if (!modelKnown) {
    const looksLikeSsd = /\bsamsung\b/.test(t) && /\bssd\b|\bnvme\b|\bm\.?2\b/.test(t)
    return looksLikeSsd
      ? decide('AMBIGUOUS', "The title doesn't say which Samsung SSD this is.", ['Samsung SSD, but no 990 PRO model name or verified part number.'], [
          { attribute: 'model', value: 'not stated', effect: 'info', from: 'title' },
        ])
      : decide('REJECTED', "The title doesn't mention the 990 PRO.", ['No 990 PRO model name or verified part number found.'], [
          { attribute: 'model', value: 'not found', effect: 'conflicts', from: 'title' },
        ])
  }

  const unverifiedCodes = [...new Set([...t.matchAll(/\bmz-?v9[a-z]\d[a-z]\d[a-z0-9]*(?:\/[a-z]{2})?\b/g)].map((m) => m[0].toUpperCase()))].filter(
    (c) => !VERIFIED_PART_NUMBERS.some((p) => p.pattern.test(c.toLowerCase())) && c !== 'MZ-V9P2T0',
  )
  for (const c of unverifiedCodes) ev.push({ attribute: 'part number (not verified)', value: c, effect: 'info', from: 'title' })
  const codeNote = unverifiedCodes.length ? [`Part number ${unverifiedCodes.join(', ')} appears, but DealProof has not verified what it means, so it is not used.`] : []
  if (has990Pro) ev.push({ attribute: 'model', value: '990 PRO', effect: 'supports', from: 'title' })
  if (pn) ev.push({ attribute: 'part number (verified)', value: pn.code, effect: 'info', from: 'part_number' })
  else if (SAMSUNG_2TB_FAMILY_CODE.test(t)) ev.push({ attribute: 'part number', value: 'MZ-V9P2T0 (2TB family code; heatsink not stated)', effect: 'info', from: 'part_number' })

  // Accessories for the SSD, e.g. a heatsink sold separately.
  const accessory = t.match(ACCESSORY_WORDS)
  if (accessory && (COMPAT_PHRASE.test(t) || !/\bssd\b|\bnvme\b/.test(t))) {
    return decide('REJECTED', `This looks like an accessory ("${accessory[0]}"), not the SSD.`, ['Accessory wording without SSD wording.'], [
      ...ev,
      { attribute: 'accessory wording', value: accessory[0], effect: 'conflicts', from: 'title' },
    ])
  }

  // Capacity (explicit, or implied by a verified part number)
  const caps = capacities(t)
  let capacity: string | null = null
  if (mentionsOthers(caps.length)) {
    return decide('AMBIGUOUS', `The title lists several sizes (${caps.join(', ')}).`, ['Multi-size titles do not say which size is for sale.'], [
      ...ev,
      { attribute: 'capacity', value: caps.join(' / '), effect: 'conflicts', from: 'title' },
    ])
  }
  if (caps.length === 1) capacity = caps[0]
  if (pn?.attributes.capacity) {
    if (capacity && capacity !== pn.attributes.capacity) {
      return decide('AMBIGUOUS', 'The stated size and the part number disagree.', [`Title says ${capacity} but part number ${pn.code} is ${pn.attributes.capacity}.`], [
        ...ev,
        { attribute: 'capacity', value: `${capacity} vs ${pn.attributes.capacity}`, effect: 'conflicts', from: 'title' },
      ])
    }
    capacity = pn.attributes.capacity
  } else if (!capacity && SAMSUNG_2TB_FAMILY_CODE.test(t)) {
    capacity = '2TB'
  }

  // Heatsink (explicit words, or implied by a verified part number)
  const hsWithout = /\b(w\/o|without|no) heat ?sink\b/.test(t)
  const hsWith = !hsWithout && /\bheat ?sink\b/.test(t)
  let heatsink: 'with' | 'without' | null = hsWithout ? 'without' : hsWith ? 'with' : null
  if (pn?.attributes.heatsink) {
    if (heatsink && heatsink !== pn.attributes.heatsink) {
      return decide('AMBIGUOUS', 'The heatsink wording and the part number disagree.', [`Part number ${pn.code} is the ${pn.attributes.heatsink}-heatsink version.`], [
        ...ev,
        { attribute: 'heatsink', value: `${heatsink} vs ${pn.attributes.heatsink}`, effect: 'conflicts', from: 'title' },
      ])
    }
    heatsink = pn.attributes.heatsink
  }

  const label = (cap: string | null, hs: 'with' | 'without' | null) =>
    [cap ?? 'size not stated', hs === 'with' ? 'with heatsink' : hs === 'without' ? 'without heatsink' : null].filter(Boolean).join(' ')

  if (capacity) ev.push({ attribute: 'capacity', value: capacity, effect: capacity === wantCap ? 'supports' : 'conflicts', from: pn?.attributes.capacity ? 'part_number' : 'title' })
  if (heatsink) ev.push({ attribute: 'heatsink', value: heatsink === 'with' ? 'with heatsink' : 'without heatsink', effect: heatsink === wantHs ? 'supports' : 'conflicts', from: pn?.attributes.heatsink ? 'part_number' : 'title' })

  if (capacity && capacity !== wantCap) {
    return decide('DIFFERENT_VARIANT', `Different storage size: ${capacity} (you chose ${wantCap}).`, ['Same SSD family, but a different capacity.'], ev, `990 PRO ${label(capacity, heatsink)}`)
  }
  if (heatsink && heatsink !== wantHs) {
    return decide(
      'DIFFERENT_VARIANT',
      heatsink === 'with' ? 'Comes with a heatsink (you chose without).' : 'No heatsink (you chose with a heatsink).',
      ['Same SSD and size, but the heatsink version has a different part number and price.'],
      ev,
      `990 PRO ${label(capacity, heatsink)}`,
    )
  }
  if (!capacity) {
    return decide('AMBIGUOUS', "The title doesn't say the storage size.", ['Model matches but the capacity is missing.'], ev)
  }
  if (!heatsink) {
    return decide('LIKELY', `Probably the ${wantCap} model, but the listing doesn't say whether it has a heatsink.`, ['Model and size match; the heatsink version is not stated.', ...codeNote], ev)
  }
  return decide('EXACT', `Same model and variant: 990 PRO ${wantCap}, ${wantHs === 'with' ? 'with' : 'without'} heatsink.`, ['Model, size and heatsink are stated and match.'], ev)
}

// ---------------------------------------------------------------------------

export function classifyTitle(target: ProductTarget, title: string | null): MatchDecision {
  if (target.family === 'generic') return classifyGeneric(target, title)
  switch (target.family) {
    case 'sony-wh-1000xm5':
      return classifySony(title)
    case 'logitech-mx-master-3s':
      return classifyLogitech(title, target)
    case 'samsung-990-pro':
      return classifySamsung(title, target)
  }
}

export { has }
