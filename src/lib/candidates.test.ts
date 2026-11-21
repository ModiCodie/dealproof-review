import { describe, expect, it } from 'vitest'
import airpods from '../../tests/fixtures/synthetic/airpods.json'
import vague from '../../tests/fixtures/synthetic/vague.json'
import empty from '../../tests/fixtures/synthetic/empty.json'
import type { ProductCandidate } from './pricing-types'
import { cleanTitle, initialPick, targetForCandidate, viewCandidates } from './candidates'
import { identityLevel } from './matching'

const cands = (f: unknown) => (f as { candidates: ProductCandidate[] }).candidates

describe('cleanTitle', () => {
  it('removes page text the feed leaves in titles, and caps the length', () => {
    expect(cleanTitle('Apple AirPods Pro An interactive autorotating 360 image showing the item from different angles. Use Alt or Option + right or left arrow key to rotate Low price')).toBe('Apple AirPods Pro')
    expect(cleanTitle(null)).toBe('Untitled product')
    expect(cleanTitle('x'.repeat(300)).length).toBeLessThanOrEqual(110)
  })
})

describe('viewCandidates / initialPick', () => {
  it('describes each product group against the search and pre-selects only a single clear fit', () => {
    const views = viewCandidates('Apple AirPods Pro 2', cands(airpods))
    expect(views.length).toBe(3)
    expect(views.filter((v) => v.fit === 'fits')).toHaveLength(1)
    expect(views.find((v) => /1st/i.test(v.title))!.fit).not.toBe('fits')
    expect(initialPick(views)).toBe(views.find((v) => v.fit === 'fits')!.index)
  })
  it('pre-selects nothing when two groups fit equally or the search is general', () => {
    const two = cands(airpods).slice(0, 1).concat(cands(airpods).slice(0, 1))
    expect(initialPick(viewCandidates('Apple AirPods Pro 2', two))).toBeNull()
    const v = viewCandidates('Dyson cordless vacuum', cands(vague))
    expect(v.every((x) => x.fit === 'unclear')).toBe(true)
    expect(initialPick(v)).toBeNull()
  })
  it('lists nothing for a search with no results and skips groups without offers', () => {
    expect(viewCandidates('Zorblax Quantum Teapot 9000', cands(empty))).toEqual([])
    expect(viewCandidates('x y 2', [{ ...cands(airpods)[0], offers: [] }])).toEqual([])
  })
})

describe('targetForCandidate', () => {
  it('uses the picked product to pin identity details', () => {
    const c = cands(airpods)[0]
    const { target, refined } = targetForCandidate('Apple AirPods Pro 2', c, c.offers.map((o) => o.title))
    expect(refined).toBe(false)
    expect(target.family).toBe('generic')
  })
  it('takes the model from the picked product when the search names none, and says so', () => {
    const c = cands(vague)[0]
    const { target, refined } = targetForCandidate('Dyson cordless vacuum', c, [])
    if (refined) expect(identityLevel(target.spec)).toBe('sufficient')
    else expect(identityLevel(target.spec)).toBe('insufficient')
  })
})
