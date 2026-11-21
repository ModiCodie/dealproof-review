/**
 * Authentication enforcement for server actions, tested at the route level:
 * the real `registerActionRoutes` with a stubbed identity resolver.
 */
import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { registerActionRoutes } from './action-routes'

function appWith(resolveAuth: Parameters<typeof registerActionRoutes>[1]) {
  const app = new Hono()
  registerActionRoutes(app as never, resolveAuth)
  return app
}
const post = (app: Hono, headers: Record<string, string> = {}) =>
  app.request(
    '/api/actions/searchProducts',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ query: 'Sony WH-1000XM5' }) },
    {} as never,
  )

describe('searchProducts requires authentication', () => {
  it('rejects a request with no credentials (401) and never reaches the action', async () => {
    const resolve = vi.fn(async () => null)
    const res = await post(appWith(resolve))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('rejects a cookie-style session that has no bearer token (401)', async () => {
    const res = await post(appWith(async () => ({ userId: 'u1', claims: {} }) as never))
    expect(res.status).toBe(401)
  })
})
