/**
 * Release guard for schema changes. The SDK lints every registered schema when the worker boots
 * (`[schema-lint]` console warnings that never block a deploy); this runs the same lint in CI.
 * It also pins the shape of the collections that already exist in production, so an accidental
 * rename / retype / removal (which the SDK does NOT migrate) fails here, while ADDING a collection
 * or column (migrated automatically on the Durable Object's next start) stays allowed.
 */
import { describe, expect, it } from 'vitest'
import { lintSchemaSet } from 'deepspace/worker'
import { schemas } from './schemas'

describe('schemas', () => {
  it('have no schema-lint findings', () => {
    expect(lintSchemaSet(schemas)).toEqual([])
  })

  it('keep every column of the collections that already exist in production (additive changes only)', () => {
    const cols = (name: string) => schemas.find((s) => s.name === name)!.columns.map((c) => `${c.name}:${c.storage}:${typeof c.interpretation === 'string' ? c.interpretation : c.interpretation.kind}`)
    // as shipped before the snapshot collection existed
    expect(cols('saved_products')).toEqual(['userId:text:plain', 'productKey:text:plain', 'family:text:plain', 'variant:text:json', 'displayName:text:plain', 'query:text:plain', 'market:text:plain'])
    expect(cols('search_cache')).toEqual(['key:text:plain', 'market:text:plain', 'query:text:plain', 'payload:text:json', 'cachedAtMs:number:plain', 'expiresAtMs:number:plain'])
    expect(cols('usage_claims')).toEqual(['claimKey:text:plain', 'kind:text:plain', 'userId:text:plain', 'day:text:plain', 'createdAtMs:number:plain'])
  })

  it('adds saved_snapshots as a new, server-only collection', () => {
    const s = schemas.find((x) => x.name === 'saved_snapshots')!
    expect(s).toBeTruthy()
    expect(s.uniqueOn).toEqual(['savedId'])
    for (const role of ['*', 'viewer', 'member', 'admin']) expect(s.permissions?.[role]).toEqual({ read: false, create: false, update: false, delete: false })
  })
})
