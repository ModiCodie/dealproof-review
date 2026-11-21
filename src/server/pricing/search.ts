/**
 * The search flow, independent of HTTP: validate -> cache -> lock -> quota ->
 * upstream -> normalize -> store.
 *
 * Everything it needs is injected (`tools`, `fetchImpl`, `now`), so the unit
 * tests run it against an in-memory fake without network or credits.
 *
 * Ordering matters for cost control:
 *   1. cache hit            -> free, no quota, no key needed
 *   2. API key configured?  -> else stop before consuming anything
 *   3. in-flight lock       -> identical concurrent searches share one upstream call
 *   4. per-user slot, then global slot (atomic claims)
 *   5. ONE upstream request, never retried
 *   6. refund the slots only when the upstream definitely did not charge
 */

import type { ActionTools } from 'deepspace/worker'
import type {
  Market,
  SearchActionResult,
  SearchErrorCode,
  SearchFailure,
  SearchQuota,
  SearchResult,
  SearchSource,
  ProductCandidate,
} from '../../lib/pricing-types'
import { loadConfig, type PricingConfig } from './config'
import { cacheKey, hasOffers, legacyCacheKey, validateQuery } from './normalize'
import { searchPricesApi } from './pricesapi'
import {
  acquireLock,
  claimSlot,
  countUserClaims,
  release,
  secondsUntilNextUtcDay,
  StorageError,
  utcDay,
} from './quota'

export const MARKET: Market = 'us'
const CACHE = 'search_cache'

interface CachePayload {
  candidates: ProductCandidate[]
  source: SearchSource
}

export interface CacheRow {
  key: string
  query: string
  payload: CachePayload
  cachedAtMs: number
  expiresAtMs: number
}

export interface SearchDeps {
  tools: ActionTools
  userId: string
  /** `env.PRICESAPI_KEY`. Server-side only; undefined when the secret is not set. */
  apiKey: string | undefined
  /** Non-secret config overrides from wrangler [vars]. */
  configEnv?: Parameters<typeof loadConfig>[0]
  fetchImpl?: typeof fetch
  now?: () => number
}

const fail = (code: SearchErrorCode, error: string, retryAfterSeconds?: number): SearchFailure => ({
  success: false,
  code,
  error,
  ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
})

export function toResult(query: string, row: { payload: CachePayload; cachedAtMs: number; expiresAtMs: number }): SearchResult {
  return {
    query,
    market: MARKET,
    candidates: row.payload.candidates,
    source: row.payload.source,
    cachedAt: new Date(row.cachedAtMs).toISOString(),
    expiresAt: new Date(row.expiresAtMs).toISOString(),
  }
}

export async function readCache(tools: ActionTools, key: string): Promise<{ recordId: string; row: CacheRow } | null> {
  const res = await tools.query<CacheRow & Record<string, unknown>>(CACHE, { where: { key }, limit: 1 })
  if (!res.success) throw new StorageError(`cache read failed: ${res.error}`)
  const rec = res.data.records[0]
  return rec ? { recordId: rec.recordId, row: rec.data as CacheRow } : null
}

/** The cached entry for a query: its current key, else the key older versions used. */
export async function readCacheForQuery(tools: ActionTools, query: string): Promise<{ recordId: string; row: CacheRow } | null> {
  const current = await readCache(tools, cacheKey(MARKET, query))
  if (current) return current
  const legacy = legacyCacheKey(MARKET, query)
  return legacy === cacheKey(MARKET, query) ? null : readCache(tools, legacy)
}

async function writeCache(
  tools: ActionTools,
  existingId: string | null,
  row: Omit<CacheRow, never> & { market: string },
): Promise<void> {
  const res = existingId
    ? await tools.update(CACHE, existingId, row)
    : await tools.create(CACHE, row)
  // A failed cache write must not hide a result we already paid for.
  if (!res.success) console.warn(`[pricing] cache write failed: ${res.error}`)
}

export async function runSearch(rawQuery: unknown, deps: SearchDeps): Promise<SearchActionResult> {
  const { tools, userId } = deps
  const now = deps.now ?? Date.now
  const cfg: PricingConfig = loadConfig(deps.configEnv ?? {})

  const v = validateQuery(rawQuery)
  if (!v.ok) return fail('invalid_query', v.message)
  const query = v.query
  const key = cacheKey(MARKET, query)
  const t0 = now()
  const day = utcDay(t0)

  try {
    const quotaNow = async (): Promise<SearchQuota> => ({
      userDailyLimit: cfg.userDailyLimit,
      userRemainingToday: Math.max(0, cfg.userDailyLimit - (await countUserClaims(tools, userId, day))),
    })

    // 1. Cache (a hit needs no key and consumes nothing).
    const cached = await readCacheForQuery(tools, query)
    if (cached && cached.row.expiresAtMs > t0) {
      return { success: true, data: { result: toResult(query, cached.row), fromCache: true, quota: await quotaNow() } }
    }

    // 2. Without a key we can never answer an uncached query. Stop before touching quota.
    if (!deps.apiKey) {
      return fail('not_configured', 'Live price search is not configured on this server yet.')
    }

    // 3. In-flight lock: only one upstream call per identical query at a time.
    const lockId = await acquireLock(tools, { key, userId, day, now: t0, ttlMs: cfg.lockTtlMs })
    if (!lockId) {
      return fail('search_in_progress', 'This search is already running. Try again in about 30 seconds.', 30)
    }

    let userSlot: string | null = null
    let globalSlot: string | null = null
    try {
      // Someone may have finished while we waited for the lock.
      const again = await readCacheForQuery(tools, query)
      if (again && again.row.expiresAtMs > now()) {
        return { success: true, data: { result: toResult(query, again.row), fromCache: true, quota: await quotaNow() } }
      }

      // 4. Atomic quota claims: per-user first, then global.
      userSlot = await claimSlot(tools, { prefix: `u:${userId}:${day}`, max: cfg.userDailyLimit, kind: 'user', userId, day, now: t0 })
      if (!userSlot) {
        return fail(
          'user_limit_reached',
          `You have used your ${cfg.userDailyLimit} fresh searches for today. Cached results still work; limits reset at 00:00 UTC.`,
          secondsUntilNextUtcDay(t0),
        )
      }
      globalSlot = await claimSlot(tools, { prefix: `g:${day}`, max: cfg.globalDailyBudget, kind: 'global', userId, day, now: t0 })
      if (!globalSlot) {
        await release(tools, userSlot)
        userSlot = null
        return fail(
          'global_budget_reached',
          'DealProof has reached its daily limit of fresh searches. Cached results still work; try again tomorrow (00:00 UTC).',
          secondsUntilNextUtcDay(t0),
        )
      }

      // 5. The single upstream request (no retries).
      const up = await searchPricesApi({
        apiKey: deps.apiKey,
        query,
        market: MARKET,
        timeoutMs: cfg.upstreamTimeoutMs,
        fetchImpl: deps.fetchImpl,
      })

      const refund = async () => {
        if (userSlot) await release(tools, userSlot)
        if (globalSlot) await release(tools, globalSlot)
        userSlot = globalSlot = null
      }

      if (!up.ok) {
        if (up.free) await refund() // definitely not charged
        console.warn(`[pricing] upstream failure code=${up.code} free=${up.free}`)
        return fail(up.code, up.message, up.retryAfterSeconds)
      }

      const cachedAtMs = now()
      const expiresAtMs = cachedAtMs + cfg.cacheTtlMs
      const payload: CachePayload = { candidates: up.search.candidates, source: up.search.source }

      if (!hasOffers(up.search)) {
        // Empty results are not billed by PricesAPI and not cached: refund and say so.
        await refund()
        return {
          success: true,
          data: {
            result: toResult(query, { payload, cachedAtMs, expiresAtMs: cachedAtMs }),
            fromCache: false,
            quota: await quotaNow(),
          },
        }
      }

      const row = { key, market: MARKET, query, payload, cachedAtMs, expiresAtMs }
      await writeCache(tools, cached?.recordId ?? null, row)
      return {
        success: true,
        data: { result: toResult(query, row), fromCache: false, quota: await quotaNow() },
      }
    } finally {
      await release(tools, lockId)
    }
  } catch (e) {
    // Storage failures: never leak internals to the client.
    console.error(`[pricing] ${e instanceof Error ? e.message : 'unknown error'}`)
    return fail('internal_error', 'Something went wrong on our side. Please try again.')
  }
}
