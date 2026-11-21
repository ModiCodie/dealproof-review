/**
 * Write controls must stay disabled until `useMutations().ready` (the DeepSpace
 * rule: "Disable write controls until useMutations().ready"), in addition to the
 * query-loading and busy checks they already had.
 *
 * `deepspace`'s hooks are replaced so each test chooses the query status and the
 * mutation readiness independently. Rendering is server-side (no DOM library is
 * installed), so these tests check the rendered `disabled` state. Clicking through
 * a working save/remove, and the owner-only permission rules, are covered by the
 * Playwright suite (tests/saved-products.spec.ts) against the real record storage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { detectTarget } from '@/lib/matching'
import { toSavedRow } from '@/lib/saved'

const hooks = vi.hoisted(() => ({
  status: 'ready' as 'loading' | 'ready' | 'error',
  ready: true,
  records: [] as unknown[],
}))

vi.mock('deepspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('deepspace')>()),
  useQuery: () => ({ records: hooks.records, status: hooks.status, error: null }),
  useMutations: () => ({
    ready: hooks.ready,
    create: async () => 'x',
    put: async () => undefined,
    remove: async () => undefined,
    createConfirmed: async () => 'x',
    putConfirmed: async () => undefined,
    removeConfirmed: async () => undefined,
  }),
}))

import { SaveControl } from './SaveControl'
import SavedPage from '../../pages/(app)/(protected)/saved/index'
import SavedProductPage from '../../pages/(app)/(protected)/saved/[id]'

const target = detectTarget('Sony WH-1000XM5')!
const saved = {
  recordId: 'r1',
  createdAt: '2026-11-20T10:00:00.000Z',
  data: { userId: 'u1', ...toSavedRow(target, 'Sony WH-1000XM5') },
}

/** The opening tag of the button with this test id, or null if it is not rendered. */
function button(html: string, testId: string): string | null {
  const tags = html.match(/<button\b[^>]*>/g) ?? []
  return tags.find((t) => t.includes(`data-testid="${testId}"`)) ?? null
}
const disabled = (html: string, testId: string) => /\bdisabled(=|\s|>)/.test(button(html, testId) ?? '')

const control = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <SaveControl target={target} query="Sony WH-1000XM5" />
    </MemoryRouter>,
  )
const list = () => renderToStaticMarkup(<MemoryRouter><SavedPage /></MemoryRouter>)
const detail = () =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/saved/r1']}>
      <Routes>
        <Route path="/saved/:id" element={<SavedProductPage />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  hooks.status = 'ready'
  hooks.ready = true
  hooks.records = []
})

describe('Save (search page)', () => {
  it('is disabled while the mutation system is not ready, even though the query is ready', () => {
    hooks.status = 'ready'
    hooks.ready = false
    expect(button(control(), 'save-button')).not.toBeNull()
    expect(disabled(control(), 'save-button')).toBe(true)
  })

  it('is enabled once both the query and the mutations are ready', () => {
    expect(disabled(control(), 'save-button')).toBe(false)
  })

  it('still waits for the query when the mutations are ready', () => {
    hooks.status = 'loading'
    hooks.ready = true
    expect(disabled(control(), 'save-button')).toBe(true)
  })
})

describe('Remove on the search page (already saved)', () => {
  beforeEach(() => {
    hooks.records = [saved]
  })
  it('is disabled until the mutations are ready', () => {
    hooks.ready = false
    expect(control()).toContain('data-testid="save-state"')
    expect(disabled(control(), 'unsave-button')).toBe(true)
  })
  it('is enabled once ready', () => {
    expect(disabled(control(), 'unsave-button')).toBe(false)
  })
})

describe('Remove on the Saved list', () => {
  beforeEach(() => {
    hooks.records = [saved]
  })
  it('is disabled until the mutations are ready, even with the list loaded', () => {
    hooks.ready = false
    expect(list()).toContain('data-testid="saved-list"')
    expect(disabled(list(), 'saved-remove')).toBe(true)
  })
  it('is enabled once ready', () => {
    expect(disabled(list(), 'saved-remove')).toBe(false)
  })
  it('the remove button for an unrecognised row is gated the same way', () => {
    hooks.records = [{ recordId: 'bad', createdAt: '2026-11-20T10:00:00.000Z', data: { userId: 'u1' } }]
    hooks.ready = false
    expect(disabled(list(), 'saved-remove-invalid')).toBe(true)
    hooks.ready = true
    expect(disabled(list(), 'saved-remove-invalid')).toBe(false)
  })
  it('does not show the list at all while the query is loading', () => {
    hooks.status = 'loading'
    expect(list()).not.toContain('data-testid="saved-list"')
  })
})

describe('Remove on the saved product page', () => {
  beforeEach(() => {
    hooks.records = [saved]
  })
  it('is disabled until the mutations are ready', () => {
    hooks.ready = false
    expect(detail()).toContain('data-testid="saved-title"')
    expect(disabled(detail(), 'saved-remove')).toBe(true)
  })
  it('is enabled once ready', () => {
    expect(disabled(detail(), 'saved-remove')).toBe(false)
  })
  it('shows "not found" rather than a remove control when the record is not in the user\'s list', () => {
    hooks.records = []
    hooks.ready = true
    expect(detail()).toContain('data-testid="saved-not-found"')
    expect(button(detail(), 'saved-remove')).toBeNull()
  })
})
