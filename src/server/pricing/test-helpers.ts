/**
 * Test doubles for the pricing tests: an in-memory `ActionTools` that mimics the
 * record Durable Object's behavior that matters here (unique constraints,
 * equality `where`, upsert-by-id), and a scripted `fetch`.
 */
import type { ActionResult, ActionTools } from 'deepspace/worker'
import { searchCacheSchema, usageClaimsSchema } from '../../schemas/pricing-schema'
import { savedProductsSchema } from '../../schemas/saved-schema'

type Row = { recordId: string; data: Record<string, unknown> }

export function makeFakeTools(): ActionTools & { dump(c: string): Row[] } {
  const tables = new Map<string, Row[]>()
  const unique: Record<string, string[]> = {
    [searchCacheSchema.name]: searchCacheSchema.uniqueOn ?? [],
    [usageClaimsSchema.name]: usageClaimsSchema.uniqueOn ?? [],
    [savedProductsSchema.name]: savedProductsSchema.uniqueOn ?? [],
  }
  let seq = 0
  const rows = (c: string) => tables.get(c) ?? (tables.set(c, []), tables.get(c)!)
  const ok = <T,>(data: T): ActionResult<T> => ({ success: true, data })

  const tools = {
    async create(collection: string, data: Record<string, unknown>, recordId?: string) {
      const t = rows(collection)
      const u = unique[collection] ?? []
      if (u.length && t.some((r) => u.every((f) => r.data[f] === data[f]))) {
        return { success: false, error: `Duplicate: a record with ${u.join(', ')} already exists in ${collection}` } as ActionResult<{ recordId: string }>
      }
      const id = recordId ?? `rec-${++seq}`
      t.push({ recordId: id, data: { ...data } })
      return ok({ recordId: id })
    },
    async update(collection: string, recordId: string, data: Record<string, unknown>) {
      const r = rows(collection).find((x) => x.recordId === recordId)
      if (!r) return { success: false, error: 'not found' } as ActionResult<{ recordId: string }>
      Object.assign(r.data, data)
      return ok({ recordId })
    },
    async remove(collection: string, recordId: string) {
      const t = rows(collection)
      const i = t.findIndex((x) => x.recordId === recordId)
      if (i >= 0) t.splice(i, 1)
      return ok({ recordId })
    },
    async deleteWhere() {
      return ok({ deleted: 0 })
    },
    async get(collection: string, recordId: string) {
      const r = rows(collection).find((x) => x.recordId === recordId)
      return (r ? ok({ record: r }) : { success: false, error: 'not found' }) as never
    },
    async query(collection: string, options?: { where?: Record<string, unknown>; limit?: number }) {
      const where = options?.where ?? {}
      const found = rows(collection).filter((r) => Object.entries(where).every(([k, v]) => r.data[k] === v))
      const limited = found.slice(0, options?.limit ?? 100)
      return ok({ records: limited.map((r) => ({ ...r, data: { ...r.data } })), count: found.length }) as never
    },
    async integration() {
      return { success: false, error: 'not used' } as never
    },
    async registerUser() {
      return { success: false, error: 'not used' } as never
    },
    dump: (c: string) => rows(c),
  }
  return tools as unknown as ActionTools & { dump(c: string): Row[] }
}

/** A fetch that returns the given body/status and records every call. */
export function scriptedFetch(
  respond: () => Response | Promise<Response>,
): typeof fetch & { calls: { url: string; headers: Headers }[] } {
  const calls: { url: string; headers: Headers }[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) })
    return respond()
  }) as typeof fetch & { calls: { url: string; headers: Headers }[] }
  f.calls = calls
  return f
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
