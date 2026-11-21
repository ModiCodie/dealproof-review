import { describe, expect, it } from 'vitest'
import { buildGenericSpec, FAMILIES, makeGenericTarget } from './matching'
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

describe('saved general (non-featured) products', () => {
  const generic = (query: string, title: string | null, chosen: Record<string, string> = {}, titles: (string | null)[] = []): ProductTarget =>
    makeGenericTarget(buildGenericSpec(query, title), titles, chosen)
  const rec = (data: object) => ({ recordId: 'r', createdAt: '2026-11-20T10:00:00Z', data: data as never })

  it('round-trips the identity, picked product and variant, with no price data and no owner', () => {
    const t = generic('WD Black SN850X 2TB', 'WD_BLACK SN850X NVMe SSD 2TB', { storage: '2TB' }, ['SN850X 1TB', 'SN850X 2TB', 'SN850X 4TB'])
    const row = toSavedRow(t, 'WD Black SN850X 2TB')
    expect(row.family).toBe('generic')
    expect(Object.keys(row).sort()).toEqual(['displayName', 'family', 'market', 'productKey', 'query', 'variant'])
    expect(JSON.stringify(row)).not.toMatch(/userId|price|offers/)
    const parsed = parseSaved(rec({ ...row, userId: 'u' }))
    expect(parsed?.target).toEqual(t)
    expect(parsed?.productKey).toBe(row.productKey)
  })

  it('gives different products and different variants different keys, and the same choice the same key', () => {
    const a = productKey(generic('Dyson V15 Detect', 'Dyson V15 Detect Cordless Vacuum'))
    expect(productKey(generic('Dyson V15 Detect', 'Dyson V15 Detect Cordless Vacuum'))).toBe(a)
    expect(productKey(generic('Dyson V15 Detect', 'Dyson V15 Detect Absolute Cordless Vacuum'))).not.toBe(a) // another picked product
    expect(productKey(generic('Dyson V12 Detect Slim', 'Dyson V12 Detect Slim'))).not.toBe(a)
    const ssd = (cap: string) => productKey(generic('WD Black SN850X', 'WD_BLACK SN850X', { storage: cap }, ['WD_BLACK SN850X 1TB SSD', 'WD_BLACK SN850X 2TB SSD']))
    expect(ssd('1TB')).not.toBe(ssd('2TB'))
    expect(a.length).toBeLessThanOrEqual(200)
  })

  it('never collides with a featured product key', () => {
    expect(productKey(generic('Samsung 990 PRO 2TB', null))).not.toBe(productKey(samsung('2TB', 'without')))
    expect(productKey(generic('Samsung 990 PRO 2TB', null)).startsWith('generic|')).toBe(true)
  })

  it('rejects forged generic rows (bad variant, oversize or missing identity) instead of guessing', () => {
    const base = { ...toSavedRow(generic('Dyson V15 Detect', 'Dyson V15 Detect'), 'Dyson V15 Detect'), userId: 'u' }
    const v = (patch: object) => ({ ...base, variant: { ...(base.variant as object), ...patch } })
    expect(parseSaved(rec(base))).not.toBeNull()
    expect(parseSaved(rec(v({ dim_storage: 'x'.repeat(500) })))).toBeNull()
    expect(parseSaved(rec(v({ dim_bogus: '1' })))?.target).toBeDefined() // unknown keys are ignored, not trusted
    expect(parseSaved(rec({ ...base, variant: {} }))).toBeNull()
    expect(parseSaved(rec({ ...base, variant: { t: 'x' } }))).toBeNull()
    expect(parseSaved(rec({ ...base, variant: 'not json' }))).toBeNull()
  })

  it('still reads rows saved by the previous version (featured families, unchanged shape)', () => {
    const legacy = { family: 'sony-wh-1000xm5', variant: '{}', query: 'Sony WH-1000XM5', market: 'us', productKey: 'sony-wh-1000xm5', displayName: 'Sony WH-1000XM5', userId: 'u' }
    expect(parseSaved(rec(legacy))?.target.family).toBe('sony-wh-1000xm5')
  })
})
