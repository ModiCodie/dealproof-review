/**
 * Opt-in INTEGRATION test of the real snapshot lifecycle: real local record storage, real server actions,
 * real signed-in test users. Nothing is mocked except in the one explicit failure test at the end.
 * No PricesAPI request is possible: the shared cache is seeded with SYNTHETIC data (tests/fixtures/synthetic/ssd.json)
 * so `searchProducts` answers from cache. The test fails if the browser ever sees a PricesAPI URL or a non-cached search.
 *
 * Seeding the server-side cache needs the dev server stopped, so this runs in two phases:
 *
 *   python3 -I tests/integration/local-cache.py seed
 *   DP_INTEGRATION=1 DP_PHASE=1 npx deepspace test run e2e --port 5199 --grep "integration phase 1"
 *   python3 -I tests/integration/local-cache.py status        # snapshot row exists
 *   python3 -I tests/integration/local-cache.py replace       # shared cache replaced: the saved group is gone, a look-alike appears
 *   DP_INTEGRATION=1 DP_PHASE=2 npx deepspace test run e2e --port 5199 --grep "integration phase 2"
 *   python3 -I tests/integration/local-cache.py status        # snapshot row deleted
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

const PHASE = process.env.DP_PHASE
test.skip(!process.env.DP_INTEGRATION, 'opt-in: DP_INTEGRATION=1 (needs the seeded local cache, see header)')
test.skip(loadAllTestAccounts().length < 2, 'needs two test accounts')
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const STATE = 'experiments/price-api/out/lifecycle-state.json'
const FX = JSON.parse(fs.readFileSync('tests/fixtures/synthetic/ssd.json', 'utf8'))
const QUERY = 'WD Black SN850X'
const GROUP_A = FX.candidates[0] // the 2TB group that is saved
const TITLES_A: string[] = GROUP_A.offers.map((o: { title: string }) => o.title).sort()

type R = Record<string, any>
function actionAs(page: Page, name: string, params: Record<string, unknown>): Promise<R> {
  return page.evaluate(
    async ({ name, params }) => {
      const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      const { token } = (await t.json()) as { token: string }
      const r = await fetch(`/api/actions/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(params) })
      return (await r.json()) as R
    },
    { name, params },
  )
}

/** Watch the page: any PricesAPI URL, and every searchProducts answer (must come from the cache). */
function watch(page: Page) {
  const w = { pricesapi: [] as string[], searches: [] as { fromCache: boolean | undefined }[] }
  page.on('request', (r) => { if (/pricesapi\.io/i.test(r.url())) w.pricesapi.push(r.url()) })
  page.on('response', async (res) => {
    if (res.url().includes('/api/actions/searchProducts')) w.searches.push({ fromCache: ((await res.json().catch(() => ({}))) as R).data?.fromCache })
  })
  return w
}

/** Keep the record WebSocket reachable so raw protocol frames can be sent on the page's own authenticated socket. */
async function hookSockets(page: Page) {
  await page.addInitScript(() => {
    const W = window.WebSocket
    ;(window as unknown as { __ws: WebSocket[] }).__ws = []
    window.WebSocket = class extends W {
      constructor(...a: ConstructorParameters<typeof WebSocket>) {
        super(...a)
        ;(window as unknown as { __ws: WebSocket[] }).__ws.push(this)
      }
    }
  })
}
const sock = () => (window as unknown as { __ws: WebSocket[] }).__ws.filter((w) => /\/ws\/app:/.test(w.url) && w.readyState === 1).at(-1)
function forge(page: Page, type: string, payload: Record<string, unknown>): Promise<R> {
  return page.evaluate(
    async ({ type, payload, sockSrc }) => {
      const ws = new Function(`return (${sockSrc})()`)() as WebSocket | undefined
      if (!ws) return { timeout: true, error: 'no socket' }
      const requestId = 'forge-' + Math.random().toString(36).slice(2)
      return await new Promise<R>((resolve) => {
        const t = setTimeout(() => resolve({ timeout: true }), 8000)
        const h = (ev: MessageEvent) => {
          try {
            const m = JSON.parse(String(ev.data))
            if (m.type === 'records.ack' && m.payload?.requestId === requestId) { clearTimeout(t); ws.removeEventListener('message', h); resolve(m.payload) }
          } catch { /* not json */ }
        }
        ws.addEventListener('message', h)
        ws.send(JSON.stringify({ type, payload: { ...payload, requestId } }))
      })
    },
    { type, payload, sockSrc: sock.toString() },
  )
}
function forgeSubscribe(page: Page, collection: string): Promise<{ recordId: string }[] | null> {
  return page.evaluate(
    async ({ collection, sockSrc }) => {
      const ws = new Function(`return (${sockSrc})()`)() as WebSocket | undefined
      if (!ws) return null
      const subscriptionId = 'forge-sub-' + Math.random().toString(36).slice(2)
      return await new Promise<{ recordId: string }[] | null>((resolve) => {
        const t = setTimeout(() => resolve(null), 8000)
        const h = (ev: MessageEvent) => {
          try {
            const m = JSON.parse(String(ev.data))
            if (m.type === 'core.query_result' && m.payload?.subscriptionId === subscriptionId) { clearTimeout(t); ws.removeEventListener('message', h); resolve(m.payload.records) }
          } catch { /* not json */ }
        }
        ws.addEventListener('message', h)
        ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId, query: { collection } } }))
      })
    },
    { collection, sockSrc: sock.toString() },
  )
}
async function clearOwn(page: Page) {
  await page.goto('/saved')
  await expect(page.getByTestId('saved-list').or(page.getByTestId('saved-empty'))).toBeVisible({ timeout: 20_000 })
  while ((await page.getByTestId('saved-item').count()) > 0) {
    const before = await page.getByTestId('saved-item').count()
    await page.getByTestId('saved-remove').first().click()
    await page.getByTestId('saved-remove-confirm').click()
    await expect.poll(() => page.getByTestId('saved-item').count()).toBeLessThan(before)
  }
}
async function searchAndPick(page: Page, index: number) {
  await page.goto('/search')
  await page.getByTestId('product-search-input').fill(QUERY)
  await page.getByTestId('product-search-input').press('Enter')
  await expect(page.getByTestId('candidate-picker')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId(`candidate-${index}`).click()
  await expect(page.getByTestId('comparison')).toBeVisible()
}

test.describe('snapshot lifecycle (integration)', () => {
  test('integration phase 1: search from the real cache, save, capture, persist', async ({ users }) => {
    test.skip(PHASE !== '1', 'DP_PHASE=1')
    const [a] = await users(2)
    const p = a.page
    const w = watch(p)
    await clearOwn(p)

    await searchAndPick(p, 0)
    await expect(p.getByTestId('candidate-0')).toContainText('2TB')
    expect(w.searches.length).toBeGreaterThan(0)
    expect(w.searches.every((s) => s.fromCache === true)).toBe(true) // answered from the seeded cache, never upstream

    // normal UI save (confirmed mutation); the page then calls the real captureSavedSnapshot
    await expect(p.getByTestId('save-button')).toBeEnabled()
    await p.getByTestId('save-button').click()
    await expect(p.getByTestId('save-message')).toContainText('Saved with these prices', { timeout: 20_000 })

    await p.goto('/saved')
    await expect(p.getByTestId('saved-item')).toHaveCount(1)
    const id = (await p.getByTestId('saved-open').getAttribute('href'))!.split('/').pop()!

    // invoke the real server action directly as well, and read the stored snapshot back through the real reopen action
    const cap = await actionAs(p, 'captureSavedSnapshot', { savedId: id })
    expect(cap.success).toBe(true)
    expect(cap.data.captured).toBe(true)
    const got = await actionAs(p, 'getSavedComparison', { savedId: id })
    expect(got.success).toBe(true)
    const snap = got.data.snapshot
    expect(snap).toBeTruthy()
    expect(snap.candidate).toMatchObject({ pid: String(GROUP_A.pid) })
    expect(snap.offers.map((o: { title: string }) => o.title).sort()).toEqual(TITLES_A) // only group A's listings
    expect(Number.isNaN(Date.parse(snap.capturedAt))).toBe(false)

    await p.goto(`/saved/${id}`)
    await expect(p.getByTestId('snapshot-status')).toBeVisible({ timeout: 20_000 })
    const shown = { capturedAt: snap.capturedAt, cachedAtText: await p.getByTestId('cached-at').innerText(), label: await p.getByTestId('target-label').innerText() }
    expect(shown.label).toContain('2TB')
    fs.mkdirSync('experiments/price-api/out', { recursive: true })
    fs.writeFileSync(STATE, JSON.stringify({ id, ...shown }))
    expect(w.pricesapi).toEqual([])
  })

  test('integration phase 2: cache replaced -> reopen, ambiguous refresh, new session, user B, remove', async ({ users }) => {
    test.skip(PHASE !== '2', 'DP_PHASE=2')
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8')) as { id: string; capturedAt: string; cachedAtText: string; label: string }
    const [a, b] = await users(2) // a fresh sign-in for both users: a new session after phase 1
    const p = a.page
    const w = watch(p)

    await p.goto('/saved') // a loaded page, signed in, to call the actions from
    // the shared cache now holds a different result; the server still returns the snapshot, the page shows it
    const before = await actionAs(p, 'getSavedComparison', { savedId: state.id })
    expect(before.success).toBe(true)
    expect(before.data.result.candidates.some((c: { title: string }) => /Heatsink Edition/.test(c.title))).toBe(true) // the replaced cache
    expect(before.data.snapshot.capturedAt).toBe(state.capturedAt)
    expect(before.data.snapshot.offers.map((o: { title: string }) => o.title).sort()).toEqual(TITLES_A)

    await p.goto(`/saved/${state.id}`)
    await expect(p.getByTestId('snapshot-status')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('saved-candidate')).toContainText('2TB')
    await expect(p.getByTestId('target-label')).toHaveText(state.label)
    await expect(p.getByTestId('cached-at')).toHaveText(state.cachedAtText)
    await expect(p.getByTestId('comparison')).toContainText('WDS200T2X0E')
    await expect(p.getByTestId('comparison')).not.toContainText('LOOKALIKE')

    // ambiguous refresh: the cache is fresh, so the real searchProducts answers from it; the saved product is not in it
    await p.getByTestId('refresh-button').click()
    await expect(p.getByTestId('identity-unconfirmed')).toBeVisible({ timeout: 30_000 })
    expect(w.searches.length).toBe(1)
    expect(w.searches[0].fromCache).toBe(true)
    await expect(p.getByTestId('cached-at')).toHaveText(state.cachedAtText)
    await expect(p.getByTestId('comparison')).not.toContainText('LOOKALIKE')
    const after = await actionAs(p, 'getSavedComparison', { savedId: state.id })
    expect(after.data.snapshot).toEqual(before.data.snapshot) // byte-for-byte unchanged

    // sign-in again (a new page load of the same session) and reopen
    await p.reload()
    await expect(p.getByTestId('snapshot-status')).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('cached-at')).toHaveText(state.cachedAtText)

    // user B: UI and server actions
    await b.page.goto('/saved')
    await b.page.goto(`/saved/${state.id}`)
    await expect(b.page.getByTestId('saved-not-found')).toBeVisible({ timeout: 20_000 })
    await b.page.goto('/saved')
    await expect(b.page.getByTestId('saved-list').or(b.page.getByTestId('saved-empty'))).toBeVisible({ timeout: 20_000 })
    expect(await b.page.locator(`a[href*="${state.id}"]`).count()).toBe(0)
    for (const name of ['getSavedComparison', 'captureSavedSnapshot']) {
      const r = await actionAs(b.page, name, { savedId: state.id })
      expect(r).toMatchObject({ success: false, code: 'not_found' })
      expect(JSON.stringify(r)).not.toMatch(/SN850X|snapshot|offers/)
    }
    expect(await actionAs(b.page, 'discardSavedSnapshot', { savedId: state.id })).toEqual({ success: true, data: { discarded: false } })
    expect((await actionAs(p, 'getSavedComparison', { savedId: state.id })).data.snapshot).toBeTruthy() // B's attempts changed nothing

    // remove: the record and then its snapshot are deleted
    await p.goto(`/saved/${state.id}`)
    await expect(p.getByTestId('saved-remove')).toBeEnabled({ timeout: 20_000 })
    await p.getByTestId('saved-remove').click()
    const discard = p.waitForResponse((r) => r.url().includes('/api/actions/discardSavedSnapshot'))
    await p.getByTestId('saved-remove-confirm').click()
    expect(((await (await discard).json()) as R).data.discarded).toBe(true)
    expect(await actionAs(p, 'getSavedComparison', { savedId: state.id })).toMatchObject({ success: false, code: 'not_found' })
    expect(w.pricesapi).toEqual([])
    fs.rmSync(STATE, { force: true })
  })

  test('integration phase 1: no client, not even the owner, can read or write snapshots through the record socket', async ({ users }) => {
    test.skip(PHASE !== '1', 'DP_PHASE=1')
    const [a] = await users(2)
    const p = a.page
    await hookSockets(p)
    await p.goto('/saved') // the record socket connects once the page subscribes to a collection
    await expect(p.getByTestId('saved-list')).toBeVisible({ timeout: 20_000 })
    const rows = await forgeSubscribe(p, 'saved_snapshots')
    expect(rows ?? []).toEqual([]) // a snapshot of this very user exists (phase 1 test above), and is still not visible
    const created = await forge(p, 'core.put', { collection: 'saved_snapshots', recordId: 'forged-' + Date.now(), data: { savedId: 'x', userId: a.userId, query: 'q', payload: { offers: [] }, capturedAtMs: 1 } })
    expect(created.success).toBe(false)
    const deleted = await forge(p, 'core.delete', { collection: 'saved_snapshots', recordId: 'whatever' })
    expect(deleted.success).toBe(false)
  })

  test('integration phase 1: a save whose capture fails says so and does not claim the prices were kept', async ({ users }) => {
    test.skip(PHASE !== '1', 'DP_PHASE=1')
    const [a] = await users(2)
    const p = a.page
    await p.route('**/api/actions/captureSavedSnapshot', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'internal_error', error: 'boom' }) }))
    await searchAndPick(p, 1) // the 1TB group, so it does not collide with the saved 2TB row
    await expect(p.getByTestId('save-button')).toBeEnabled()
    await p.getByTestId('save-button').click()
    const msg = p.getByTestId('save-message')
    await expect(msg).toContainText('could not be stored', { timeout: 20_000 })
    await expect(msg).not.toContainText('Saved with these prices')
    // the record itself was created; remove only this one again
    await p.goto('/saved')
    await expect(p.getByTestId('saved-item')).toHaveCount(2)
    await p.getByTestId('saved-item').filter({ hasText: '1TB' }).getByTestId('saved-remove').click()
    await p.getByTestId('saved-remove-confirm').click()
    await expect(p.getByTestId('saved-item')).toHaveCount(1)
  })
})
