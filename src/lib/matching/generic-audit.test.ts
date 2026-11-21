/**
 * Audit of the generic matcher against realistic edge cases. Titles here are
 * invented but shaped like real marketplace titles. The rule being checked:
 * when in doubt, never EXACT, and never a different product in the comparison.
 */
import { describe, expect, it } from 'vitest'
import { buildGenericSpec, classifyGeneric, identityLevel, makeGenericTarget } from './index'

const target = (query: string, pick: string | null = null, titles: string[] = []) => makeGenericTarget(buildGenericSpec(query, pick), titles)
const cls = (t: ReturnType<typeof target>, title: string) => classifyGeneric(t, title).class
const exactOrLikely = (c: string) => c === 'EXACT' || c === 'LIKELY'

describe('similar model numbers and codes', () => {
  const t = target('Crucial MX500 1TB')
  it('another capacity is a variant; another model code is a different product', () => {
    expect(cls(t, 'Crucial MX500 2TB 3D NAND SATA SSD')).toBe('DIFFERENT_VARIANT')
    expect(cls(t, 'Crucial BX500 1TB 3D NAND SATA SSD')).toBe('REJECTED')
    expect(cls(t, 'Crucial MX500 1TB 3D NAND SATA 2.5 Inch Internal SSD')).toBe('EXACT') // code + capacity stated
  })
  it('a code that merely contains the searched one is not the same code', () => {
    const x = target('Samsung 870 EVO 1TB')
    expect(cls(x, 'Samsung 870 EVO Plus 1TB')).toBe('REJECTED')
    expect(cls(x, 'Samsung 8700 EVO 1TB')).not.toBe('EXACT')
    const w = target('Sennheiser HD 450BT')
    expect(cls(w, 'Sennheiser HD 450BT Wireless Headphones')).toBe('EXACT')
    expect(cls(w, 'Sennheiser HD 4500BT Wireless Headphones')).not.toBe('EXACT')
    expect(cls(w, 'Sennheiser HD 350BT Wireless Headphones')).not.toBe('EXACT')
  })
})

describe('generations and memory', () => {
  const t = target('Lenovo ThinkPad X1 Carbon Gen 11 16GB 512GB')
  it('another generation is never compared', () => {
    expect(exactOrLikely(cls(t, 'Lenovo ThinkPad X1 Carbon Gen 10 16GB 512GB'))).toBe(false)
  })
  it('another memory or storage size is a different variant', () => {
    const titles = ['Lenovo ThinkPad X1 Carbon Gen 11 16GB RAM 512GB SSD', 'Lenovo ThinkPad X1 Carbon Gen 11 32GB RAM 512GB SSD', 'Lenovo ThinkPad X1 Carbon Gen 11 16GB RAM 1TB SSD']
    const g = target('Lenovo ThinkPad X1 Carbon Gen 11', titles[0], titles)
    expect(g.variant).toMatchObject({ memory: '16GB', storage: '512GB' })
    expect(cls(g, titles[0])).not.toBe('DIFFERENT_VARIANT')
    expect(cls(g, titles[1])).toBe('DIFFERENT_VARIANT')
    expect(cls(g, titles[2])).toBe('DIFFERENT_VARIANT')
  })
})

describe('bundles, accessories and conflicting titles', () => {
  const t = target('Dyson V15 Detect')
  it('accessories that name the product are rejected', () => {
    for (const title of ['Dyson V15 Detect Replacement Battery', 'Filter for Dyson V15 Detect Vacuum', 'Charging Dock Compatible with Dyson V15 Detect', 'Silicone Case for Sony WH-1000XM5 Headphones']) {
      expect(['REJECTED', 'AMBIGUOUS']).toContain(cls(t, title))
    }
    expect(cls(target('Sony WH-1000XM5'), 'Protective Hard Case for Sony WH-1000XM5')).toBe('REJECTED')
  })
  it('a title naming two models is never exact', () => {
    expect(cls(t, 'Dyson V15 Detect / V11 Cordless Vacuum')).not.toBe('EXACT')
    expect(cls(t, 'Dyson V12 V15 V11 Cordless Vacuum Cleaner')).not.toBe('EXACT')
  })
  it('a bundle is never exact', () => {
    expect(cls(t, 'Dyson V15 Detect Cordless Vacuum + Free Accessory Kit Bundle')).not.toBe('EXACT')
  })
})

describe('a code shared by different products', () => {
  // "737" is a bare number: Anker sells a 737 charger AND a 737 power bank.
  const bank = target('Anker 737 Power Bank', 'Anker 737 Power Bank (PowerCore 24K)')
  it('a number-only code cannot give an exact match', () => {
    expect(cls(bank, 'Anker 737 Power Bank PowerCore 24K')).not.toBe('EXACT')
  })
  it('a listing whose title lacks the product type the user picked is not a confirmed match', () => {
    expect(cls(bank, 'Anker 737 Charger GaNPrime 120W')).not.toBe('EXACT')
    expect(cls(bank, 'Anker 737 Charger GaNPrime 120W')).not.toBe('LIKELY')
  })
})

describe('the picked product disagrees with the search text', () => {
  it('the search text decides identity: listings of the picked (different) product are not matched', () => {
    const t = target('Dyson V15 Detect', 'Dyson V8 Cordless Vacuum Cleaner')
    expect(cls(t, 'Dyson V8 Cordless Vacuum Cleaner')).toBe('REJECTED')
    expect(exactOrLikely(cls(t, 'Dyson V15 Detect Cordless Vacuum'))).toBe(true)
  })
})

describe('a generation written in words counts as the model number', () => {
  it('"Pro 1st generation" is specific enough; "Pro" alone is not', () => {
    expect(identityLevel(buildGenericSpec('Apple AirPods Pro 1st generation', null))).toBe('sufficient')
    expect(identityLevel(buildGenericSpec('Apple AirPods Pro', null))).toBe('insufficient')
    const t = makeGenericTarget(buildGenericSpec('Apple AirPods Pro 2nd generation', null), [])
    expect(cls(t, 'Apple AirPods Pro 2nd Generation Wireless Earbuds')).toBe('LIKELY')
    expect(cls(t, 'Apple AirPods Pro 1st Generation Wireless Earbuds')).not.toBe('LIKELY')
  })
})
