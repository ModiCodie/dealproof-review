/**
 * Tunable limits. Defaults match the Day-2 requirements; each can be overridden
 * with a plain (non-secret) variable in wrangler.toml `[vars]`.
 */

export interface PricingConfig {
  /** How long a normalized search result is served from the DealProof cache. */
  cacheTtlMs: number
  /** Uncached (upstream) searches per user per UTC day. */
  userDailyLimit: number
  /** Uncached searches across all users per UTC day (protects the free credits). */
  globalDailyBudget: number
  /** How long an in-flight lock is honoured before it is considered abandoned. */
  lockTtlMs: number
  /** Upstream request timeout. PricesAPI cold searches took 20-42 s in the experiment. */
  upstreamTimeoutMs: number
}

export const DEFAULTS: PricingConfig = {
  cacheTtlMs: 12 * 60 * 60 * 1000,
  userDailyLimit: 3,
  globalDailyBudget: 15,
  lockTtlMs: 120 * 1000,
  upstreamTimeoutMs: 90 * 1000,
}

type ConfigEnv = {
  CACHE_TTL_HOURS?: string
  USER_DAILY_SEARCH_LIMIT?: string
  GLOBAL_DAILY_SEARCH_BUDGET?: string
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadConfig(env: ConfigEnv): PricingConfig {
  return {
    ...DEFAULTS,
    cacheTtlMs: positiveNumber(env.CACHE_TTL_HOURS, 12) * 60 * 60 * 1000,
    userDailyLimit: Math.floor(positiveNumber(env.USER_DAILY_SEARCH_LIMIT, DEFAULTS.userDailyLimit)),
    globalDailyBudget: Math.floor(
      positiveNumber(env.GLOBAL_DAILY_SEARCH_BUDGET, DEFAULTS.globalDailyBudget),
    ),
  }
}
