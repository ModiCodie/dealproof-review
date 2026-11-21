/**
 * Browser -> server-action client.
 *
 * Server actions are plain HTTP: `POST /api/actions/<name>` with the caller's
 * JWT as a Bearer token. The Worker verifies the token and passes the verified
 * user id to the action, so the browser never says who it is, only proves it.
 */

import { getAuthToken } from 'deepspace'
import type { SearchActionResult } from './pricing-types'
import type { CaptureResult, SavedComparisonResult } from './saved'

/** Longer than the server's upstream timeout (90 s) so the server answers first. */
const CLIENT_TIMEOUT_MS = 110_000

export async function searchProducts(query: string, signal?: AbortSignal): Promise<SearchActionResult> {
  const token = await getAuthToken()
  if (!token) {
    return { success: false, code: 'internal_error', error: 'You are signed out. Please sign in again.' }
  }
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS)
  try {
    const res = await fetch('/api/actions/searchProducts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (res.status === 401) {
      return { success: false, code: 'internal_error', error: 'Your session expired. Please sign in again.' }
    }
    const body = (await res.json()) as SearchActionResult
    if (typeof body !== 'object' || body === null || typeof body.success !== 'boolean') {
      return { success: false, code: 'internal_error', error: 'Unexpected response from the server.' }
    }
    return body
  } catch (e) {
    if (signal?.aborted) throw e // caller cancelled; let it handle that
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return {
      success: false,
      code: 'upstream_timeout',
      error: timedOut
        ? 'The search took too long. It may still finish on the server; try again in a minute (it will then be served from cache).'
        : 'Could not reach the server. Check your connection and try again.',
    }
  }
}

/**
 * Reopen a saved product with the data the server already has. This action can
 * never trigger a paid search; refreshing is a separate, explicit searchProducts call.
 */
export async function getSavedComparison(savedId: string, signal?: AbortSignal): Promise<SavedComparisonResult> {
  const token = await getAuthToken()
  if (!token) return { success: false, code: 'internal_error', error: 'You are signed out. Please sign in again.' }
  try {
    const res = await fetch('/api/actions/getSavedComparison', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ savedId }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    })
    if (res.status === 401) return { success: false, code: 'internal_error', error: 'Your session expired. Please sign in again.' }
    const body = (await res.json()) as SavedComparisonResult
    if (typeof body !== 'object' || body === null || typeof body.success !== 'boolean') {
      return { success: false, code: 'internal_error', error: 'Unexpected response from the server.' }
    }
    return body
  } catch (e) {
    if (signal?.aborted) throw e
    return { success: false, code: 'internal_error', error: 'Could not reach the server. Check your connection and try again.' }
  }
}

async function callSavedAction<T>(name: string, savedId: string, signal?: AbortSignal): Promise<T | { success: false; code: 'internal_error'; error: string }> {
  const fail = (error: string) => ({ success: false as const, code: 'internal_error' as const, error })
  const token = await getAuthToken()
  if (!token) return fail('You are signed out. Please sign in again.')
  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ savedId }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    })
    if (res.status === 401) return fail('Your session expired. Please sign in again.')
    const body = (await res.json()) as { success?: unknown }
    return typeof body === 'object' && body !== null && typeof body.success === 'boolean' ? (body as T) : fail('Unexpected response from the server.')
  } catch (e) {
    if (signal?.aborted) throw e
    return fail('Could not reach the server. Check your connection and try again.')
  }
}

/**
 * Ask the server to store the last captured prices for a saved general product, copied from its own cache.
 * Never calls PricesAPI, never uses quota, and changes nothing if the saved product cannot be confirmed.
 */
export const captureSavedSnapshot = (savedId: string, signal?: AbortSignal) => callSavedAction<CaptureResult>('captureSavedSnapshot', savedId, signal)

/** Best-effort cleanup after a saved product was removed. A failure only leaves data the next capture sweeps. */
export const discardSavedSnapshot = (savedId: string) => callSavedAction<{ success: true; data: { discarded: boolean } }>('discardSavedSnapshot', savedId).catch(() => undefined)
