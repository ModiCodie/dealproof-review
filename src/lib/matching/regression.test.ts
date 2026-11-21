/**
 * Regression cases for defects found by running the matcher over one real PricesAPI
 * response. The titles below are SYNTHETIC, written in the style of real listings
 * (the real response is gitignored and not redistributed). Existing tests are unchanged.
 */
import { describe, expect, it } from 'vitest'
import { buildGenericSpec, makeGenericTarget, classifyGeneric, looksTruncated, attributesOf } from './generic'
import { detectCondition } from './condition'
import { buildComparison } from './compare'
import type { NormalizedOffer } from '../pricing-types'

const spec = buildGenericSpec('Apple AirPods Pro 2', null)
const target = makeGenericTarget(spec, [])
const cls = (title: string) => classifyGeneric(target, title).class

describe('charging case: complete product vs standalone part (Task 1A)', () => {
  it('keeps a complete product that includes its charging case', () => {
    for (const t of [
      'Apple AirPods Pro 2 - White - MagSafe Charging Case (Lightning)',
      'Apple AirPods Pro 2nd Generation with MagSafe Charging Case',
      'Apple AirPods Pro 2 Wireless Earbuds w/ Wireless Charging Case',
    ]) expect(['LIKELY', 'EXACT']).toContain(cls(t))
  })
  it('rejects standalone / replacement cases and accessories', () => {
    for (const t of [
      'Replacement Charging Case for Apple AirPods Pro 2',
      'Charging Case Only for AirPods Pro 2nd Generation',
      'Silicone Case Cover for Apple AirPods Pro 2 Protective Skin',
      'Replacement Ear Tips for Apple AirPods Pro 2',
      'Compatible with AirPods Pro 2 Charging Case Cable',
    ]) expect(cls(t)).toBe('REJECTED')
  })
  it('does not guess when a title is cut off: it names the case but not the earbuds', () => {
    const r = classifyGeneric(target, 'Apple AirPods Pro 2 MagSafe Charging Case')
    expect(r.class).not.toBe('REJECTED')
  })
})

describe('"Customizable Fit" is not compatibility wording (Task 1B)', () => {
  it('does not reject or flag a product because it says "Fit"', () => {
    const r = classifyGeneric(target, 'Apple AirPods Pro 2 Wireless Earbuds, Customizable Fit,')
    expect(r.class).toBe('LIKELY')
    expect(r.evidence.some((e) => e.attribute === 'accessory wording')).toBe(false)
  })
  it('still excludes genuine compatibility listings', () => {
    expect(['REJECTED', 'AMBIGUOUS']).toContain(cls('Ear Hooks Fits for Apple AirPods Pro 2 Anti-Slip')) // never a comparable match
    expect(cls('Case compatible with AirPods Pro 2')).toBe('REJECTED')
  })
})

describe('condition and completeness (Task 1C)', () => {
  const v = (t: string) => detectCondition(t).value
  it('separates new / used / refurbished / defective / incomplete / unknown', () => {
    expect(v('Apple AirPods Pro 2 - New')).toBe('new')
    expect(v('Apple AirPods Pro 2 Pre-owned')).toBe('used')
    expect(v('Apple AirPods Pro 2 Certified Refurbished')).toBe('refurbished')
    expect(v('Apple AirPods Pro 2 For Parts')).toBe('defective')
    expect(v('Apple AirPods Pro 2 Does Not Work')).toBe('defective')
    expect(v('Apple AirPods Pro 2 Earbuds Only')).toBe('incomplete')
    expect(v('Apple AirPods Pro 2 Left Airpod Only')).toBe('incomplete')
    expect(v('Apple AirPods Pro 2')).toBe('unknown')
  })
  it('resolves "Certified Used Refurbished" as second-hand (refurbished), never new or unknown', () => {
    expect(v('Apple AirPods Pro 2 Certified Used Refurbished')).toBe('refurbished')
  })
  it('keeps New + Used contradictions unknown, with the reason', () => {
    const r = detectCondition('New Other, Used Apple AirPods Pro 2 new')
    expect(r.value).not.toBe('new')
  })
  it('marks a cut-off "Not Working With" as possibly defective, not a stated fault', () => {
    const r = detectCondition('Apple AirPods Pro 2 Not Working With')
    expect(r.value).toBe('defective')
    expect(r.uncertain).toBe(true)
    expect(r.evidence).toMatch(/cut off/)
    expect(detectCondition('Apple AirPods Pro 2 Not Working').uncertain).toBe(false)
  })
  it('detects truncation', () => {
    expect(looksTruncated('Apple AirPods Pro 2 Not Working With')).toBe(true)
    expect(looksTruncated('Apple AirPods Pro 2 Wireless Earbuds,')).toBe(true)
    expect(looksTruncated('Apple AirPods Pro 2 Wireless Earbuds')).toBe(false)
  })
})

describe('configuration differences are explicit, not guessed (Task 4)', () => {
  it('reads an explicitly stated connector and nothing from a title that is silent', () => {
    expect(attributesOf('AirPods Pro 2 USB-C').connector).toEqual(['USB-C'])
    expect(attributesOf('AirPods Pro 2 Lightning Case').connector).toEqual(['Lightning'])
    expect(attributesOf('AirPods Pro 2').connector).toEqual([])
    expect(attributesOf('AirPods Pro 2 Wireless Earbuds Two Pairs').packs).toEqual([2])
  })
  it('a connector chosen in the search is a variant pin: the other connector is a different variant', () => {
    const t = makeGenericTarget(buildGenericSpec('Apple AirPods Pro 2 USB-C', null), [])
    expect(t.variant.connector).toBe('USB-C')
    expect(classifyGeneric(t, 'Apple AirPods Pro 2 with Lightning Charging Case').class).toBe('DIFFERENT_VARIANT')
  })
})

const offer = (i: number, title: string, price: number): NormalizedOffer => ({
  seller: `Seller ${i}`, sellerUrl: `https://s${i}.example/`, price, currency: 'USD', title, listingUrl: `https://s${i}.example/p/${i}`,
  stockText: 'In stock', availability: 'in_stock', deliveryInfo: 'Free delivery', condition: 'unknown', observedAt: null,
} as unknown as NormalizedOffer)

describe('price summary only over comparable listings (Task 3)', () => {
  const run = (titles: [string, number][], t = target) => buildComparison(t, titles.map(([x, p], i) => offer(i, x, p)), '2026-11-21T00:00:00Z')

  it('does not headline a lowest price when condition is unknown, and does not treat unknown as new', () => {
    const c = run([['Apple AirPods Pro 2nd Generation', 150], ['Apple AirPods Pro 2 Wireless Earbuds', 160], ['AirPods Pro 2 Apple', 170], ['Apple AirPods Pro (2nd Gen)', 180]])
    expect(c.priceSummary.reliable).toBe(false)
    expect(c.priceSummary.reason).toMatch(/Not enough comparable offers to determine a reliable lowest price/)
    expect(c.cheapest).toBeNull()
    expect(c.comparable).toHaveLength(0)
    expect(c.unknownCondition).toHaveLength(4)
  })
  it('never lets a defective, incomplete or cut-off "not working" listing be the cheapest', () => {
    const base: [string, number][] = [1, 2, 3, 4].map((i) => [`Apple AirPods Pro 2nd Generation - New ${i}`, 190 + i] as [string, number])
    const c = run([...base, ['Apple AirPods Pro 2 For Parts', 20], ['Apple AirPods Pro 2 Earbuds Only', 30], ['Apple AirPods Pro 2 Not Working With', 19.99]])
    expect(c.defective).toHaveLength(3)
    expect(c.priceSummary.reliable).toBe(true)
    expect(c.cheapest!.offer.offer.price).toBe(191)
  })
  it('keeps used / refurbished out of the new-condition headline', () => {
    const c = run([1, 2, 3].map((i) => [`Apple AirPods Pro 2nd Generation New ${i}`, 200 + i] as [string, number]).concat([['Apple AirPods Pro 2nd Generation Certified Used Refurbished', 99]]))
    expect(c.secondHand).toHaveLength(1)
    expect(c.cheapest!.offer.offer.price).toBe(201)
  })
  it('flags an unusually low price only inside a homogeneous new group, and keeps it visible', () => {
    const c = run([...[1, 2, 3, 4, 5, 6, 7].map((i) => [`Apple AirPods Pro 2nd Generation New ${i}`, 200 + i] as [string, number]), ['Apple AirPods Pro 2nd Generation New 8', 59]])
    expect(c.priceCheck.map((a) => a.offer.price)).toEqual([59])
    expect(c.lowestUnflagged!.offer.offer.price).toBe(201)
  })
  it('requires independent sellers: three listings from one seller are one voice', () => {
    const same = (i: number) => ({ ...offer(0, `Apple AirPods Pro 2nd Generation New ${i}`, 200 + i), listingUrl: `https://s0.example/p/${i}` })
    const c = buildComparison(target, [1, 2, 3].map(same), '2026-11-21T00:00:00Z')
    expect(c.priceSummary.reliable).toBe(false)
  })
})
