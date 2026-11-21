/**
 * `getSavedComparison`: reopen a saved product with whatever the server already
 * stored for it.
 *
 * Guarantees (each covered by tests in comparison.test.ts):
 *   - The owner is the verified `userId` from the session, never a parameter.
 *     Another user's record, a missing record and a malformed id all answer the
 *     same `not_found`, so ids cannot be probed.
 *   - It NEVER calls PricesAPI and never takes a quota slot. It only reads
 *     `search_cache`, including entries past their expiry (those come back
 *     labelled `stale`). Fresh data is fetched only when the user explicitly
 *     refreshes, through the ordinary `searchProducts` action and its limits.
 *   - The cache key is derived here from the saved query, not read from the row.
 */

import type { ActionTools } from 'deepspace/worker'
import type { SavedComparisonResult, SavedRow } from '../../lib/saved'
import { SAVED_COLLECTION } from '../../lib/saved'
import { validateQuery } from '../pricing/normalize'
import { countUserClaims, StorageError, utcDay } from '../pricing/quota'
import { loadConfig } from '../pricing/config'
import { readCacheForQuery, toResult } from '../pricing/search'

export interface SavedDeps {
  tools: ActionTools
  /** Verified caller id from the session JWT. */
  userId: string
  configEnv?: Parameters<typeof loadConfig>[0]
  now?: () => number
}

const NOT_FOUND: SavedComparisonResult = { success: false, code: 'not_found', error: 'Saved product not found.' }

export async function getSavedComparison(rawId: unknown, deps: SavedDeps): Promise<SavedComparisonResult> {
  const { tools, userId } = deps
  const now = deps.now ?? Date.now
  if (typeof rawId !== 'string' || rawId.length === 0 || rawId.length > 128) return NOT_FOUND
  if (!userId) return NOT_FOUND
  try {
    const got = await tools.get<SavedRow & Record<string, unknown>>(SAVED_COLLECTION, rawId)
    if (!got.success) return NOT_FOUND
    const row = (got.data as { record?: { data?: SavedRow } }).record?.data
    // Ownership: the row's stamped owner must be the verified caller.
    if (!row || row.userId !== userId) return NOT_FOUND

    const v = validateQuery(row.query)
    if (!v.ok) return { success: false, code: 'invalid_saved_product', error: 'This saved product has an invalid search and cannot be reopened.' }

    const cfg = loadConfig(deps.configEnv ?? {})
    const t = now()
    const cached = await readCacheForQuery(tools, v.query)
    const used = await countUserClaims(tools, userId, utcDay(t))
    return {
      success: true,
      data: {
        saved: { recordId: rawId, query: v.query, family: row.family, variant: row.variant ?? {} },
        result: cached ? toResult(v.query, cached.row) : null,
        stale: cached ? cached.row.expiresAtMs <= t : false,
        quota: { userDailyLimit: cfg.userDailyLimit, userRemainingToday: Math.max(0, cfg.userDailyLimit - used) },
      },
    }
  } catch (e) {
    console.error(`[saved] ${e instanceof StorageError ? e.message : 'unexpected error'}`)
    return { success: false, code: 'internal_error', error: 'Something went wrong on our side. Please try again.' }
  }
}
