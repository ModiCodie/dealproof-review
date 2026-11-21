/**
 * Browser -> server-action client.
 *
 * Server actions are plain HTTP: `POST /api/actions/<name>` with the caller's
 * JWT as a Bearer token. The Worker verifies the token and passes the verified
 * user id to the action, so the browser never says who it is, only proves it.
 */

import { getAuthToken } from 'deepspace'
import type { SearchActionResult } from './pricing-types'
import type { SavedComparisonResult } from './saved'

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
