/**
 * Minimal PricesAPI client: exactly one endpoint, `GET /products/search`.
 *
 * Security notes:
 * - The API key is passed in by the caller (it comes from `env.PRICESAPI_KEY` on
 *   the server) and only ever goes into the `Authorization` header. It is never
 *   put in a URL, a log line, a returned error, or the result object.
 * - The base URL is a constant. No user-supplied URL is ever requested.
 * - No retries: a Search can cost 10 credits, so a failure is reported, not repeated.
 */

import { normalizeSearchResponse, type NormalizedSearch } from './normalize'
import type { Market, SearchErrorCode } from '../../lib/pricing-types'

const BASE_URL = 'https://api.pricesapi.io/api/v1'

export type UpstreamResult =
  | { ok: true; search: NormalizedSearch }
  | {
      ok: false
      code: SearchErrorCode
      message: string
      /** true when we know the upstream did not charge credits (4xx/5xx response). */
      free: boolean
      retryAfterSeconds?: number
    }

export interface UpstreamOptions {
  apiKey: string
  query: string
  market: Market
  timeoutMs: number
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export async function searchPricesApi(opts: UpstreamOptions): Promise<UpstreamResult> {
  const doFetch = opts.fetchImpl ?? fetch
  const url = new URL(`${BASE_URL}/products/search`)
  url.searchParams.set('q', opts.query)
  url.searchParams.set('market', opts.market)
  url.searchParams.set('limit', '3') // Personal plan maximum
  url.searchParams.set('offers_limit', '60')

  let res: Response
  try {
    res = await doFetch(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    // A timeout means we cannot know whether credits were spent: not marked free.
    return timedOut
      ? {
          ok: false,
          code: 'upstream_timeout',
          message: 'The price service took too long to respond. Try again in a minute.',
          free: false,
        }
      : {
          ok: false,
          code: 'upstream_error',
          message: 'Could not reach the price service. Try again later.',
          free: false,
        }
  }

  if (res.status === 429) {
    const ra = parseInt(res.headers.get('retry-after') ?? '', 10)
    return {
      ok: false,
      code: 'upstream_rate_limited',
      message: 'The price service is rate limiting us. Try again shortly.',
      free: true,
      retryAfterSeconds: Number.isFinite(ra) ? ra : undefined,
    }
  }
  if (res.status === 401) {
    return {
      ok: false,
      code: 'upstream_auth',
      message: 'The price service rejected our credentials. The owner needs to check the API key.',
      free: true,
    }
  }
  if (res.status === 403) {
    return {
      ok: false,
      code: 'upstream_credits',
      message: 'The price service quota is exhausted or the plan is inactive.',
      free: true,
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      code: 'upstream_error',
      message: `The price service returned an error (HTTP ${res.status}). Try again later.`,
      free: true,
    }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return {
      ok: false,
      code: 'upstream_error',
      message: 'The price service returned an unreadable response.',
      free: false,
    }
  }
  const search = normalizeSearchResponse(body)
  if (!search) {
    return {
      ok: false,
      code: 'upstream_error',
      message: 'The price service returned an unexpected response shape.',
      free: false,
    }
  }
  return { ok: true, search }
}
