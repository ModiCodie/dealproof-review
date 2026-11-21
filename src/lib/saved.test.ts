import { describe, expect, it } from 'vitest'
import { FAMILIES } from './matching'
import type { ProductTarget } from './matching'
import { parseSaved, productKey, toSavedRow } from './saved'
import { savedProductsSchema } from '../schemas/saved-schema'

const samsung = (capacity: string, heatsink: string): ProductTarget => ({ family: 'samsung-990-pro', variant: { capacity, heatsink } })

describe('productKey: stable identity of product + variant', () => {
  it('is the same for the same product however the variant object is built', () => {
    const a = productKey({ family: 'samsung-990-pro', variant: { capacity: '2TB', heatsink: 'without' } })
    const b = productKey({ family: 'samsung-990-pro', variant: { heatsink: 'without', capacity: '2TB' } })
    expect(a).toBe(b)
  })

  it('differs for every different variant of the same family', () => {
    const dims = FAMILIES['samsung-990-pro'].dimensions
    const keys = new Set<string>()
    const [cap, heat] = dims
    for (const c of cap.options) for (const h of heat.options) keys.add(productKey(samsung(c.value, h.value)))
    expect(keys.size).toBe(cap.options.length * heat.options.length)
  })

  it('treats an omitted choice as the dimension default (no duplicate for "standard")', () => {
    const f = FAMILIES['logitech-mx-master-3s']
    const def = f.dimensions[0].default
    expect(productKey({ family: 'logitech-mx-master-3s', variant: {} })).toBe(
      productKey({ family: 'logitech-mx-master-3s', variant: { [f.dimensions[0].key]: def } }),
    )
  })

  it('differs across families, and a no-variant family still has a key', () => {
    expect(productKey({ family: 'sony-wh-1000xm5', variant: {} })).toBe('sony-wh-1000xm5')
    expect(productKey({ family: 'sony-wh-1000xm5', variant: {} })).not.toBe(productKey(samsung('2TB', 'without')))
  })
})

describe('toSavedRow / parseSaved round trip', () => {
  it('never contains an owner id or any price data', () => {
    const row = toSavedRow(samsung('2TB', 'with'), 'Samsung 990 PRO 2TB')
    expect(Object.keys(row).sort()).toEqual(['displayName', 'family', 'market', 'productKey', 'query', 'variant'])
    expect(JSON.stringify(row)).not.toMatch(/userId|price|offers/)
  })

  it('round-trips the exact variant', () => {
    const t = samsung('4TB', 'without')
    const row = toSavedRow(t, 'Samsung 990 PRO 4TB')
    const parsed = parseSaved({ recordId: 'r1', createdAt: '2026-11-20T10:00:00Z', data: { ...row, userId: 'u' } })
    expect(parsed?.target).toEqual(t)
    expect(parsed?.productKey).toBe(row.productKey)
    expect(parsed?.displayName).toContain('4TB')
  })

  it('rejects unknown families, impossible variants and bad queries instead of guessing', () => {
    const base = { ...toSavedRow(samsung('2TB', 'without'), 'Samsung 990 PRO 2TB'), userId: 'u' }
    const rec = (data: object) => ({ recordId: 'r', createdAt: '2026-11-20T10:00:00Z', data: data as never })
    expect(parseSaved(rec({ ...base, family: 'not-a-product' }))).toBeNull()
    expect(parseSaved(rec({ ...base, variant: { capacity: '999TB', heatsink: 'without' } }))).toBeNull()
    expect(parseSaved(rec({ ...base, query: '' }))).toBeNull()
    expect(parseSaved(rec(undefined as never))).toBeNull()
  })
})

describe('saved_products schema: security configuration', () => {
  const s = savedProductsSchema
  const col = (n: string) => s.columns.find((c) => c.name === n)!

  it('stamps the owner server-side and keys ownership on it', () => {
    expect(col('userId').userBound).toBe(true)
    expect(col('userId').immutable).toBe(true)
    expect(s.ownerField).toBe('userId')
  })

  it('refuses a second save of the same product and variant per user', () => {
    expect(s.uniqueOn).toEqual(['userId', 'productKey'])
  })

  it('lets a user see and delete only their own rows, and nobody else (admins included) read others', () => {
    for (const role of ['member', 'admin'] as const) {
      expect(s.permissions[role]).toMatchObject({ read: 'own', delete: 'own', update: false })
    }
    expect(s.permissions.viewer).toEqual({ read: false, create: false, update: false, delete: false })
    expect(s.permissions['*']).toEqual({ read: false, create: false, update: false, delete: false })
  })

  it('makes every stored column immutable', () => {
    expect(s.columns.every((c) => c.immutable)).toBe(true)
  })
})
