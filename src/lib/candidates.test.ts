import { describe, expect, it } from 'vitest'
import ssd from '../../tests/fixtures/synthetic/ssd.json'
import airpods from '../../tests/fixtures/synthetic/airpods.json'
import vague from '../../tests/fixtures/synthetic/vague.json'
import empty from '../../tests/fixtures/synthetic/empty.json'
import type { ProductCandidate } from './pricing-types'
import { cleanTitle, initialPick, noneConfirmed, offersForView, targetForCandidate, viewCandidates } from './candidates'
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
  it('treats a capacity written in the search as part of what a group must match', () => {
    const views = viewCandidates('WD Black SN850X 2TB', cands(ssd))
    expect(views.map((v) => v.fit)).toEqual(['fits', 'different'])
    expect(initialPick(views)).toBe(0)
    expect(viewCandidates('WD Black SN850X', cands(ssd)).map((v) => v.fit)).toEqual(['fits', 'fits']) // no capacity asked: the user chooses
  })
  it('pre-selects nothing when two groups fit equally or the search is general', () => {
    expect(initialPick(viewCandidates('WD Black SN850X', cands(ssd)))).toBeNull() // two groups fit equally
    const v = viewCandidates('Dyson cordless vacuum', cands(vague))
    expect(v.every((x) => x.fit === 'unclear')).toBe(true)
    expect(initialPick(v)).toBeNull()
  })
  it('merges groups only when their cleaned titles are identical, never similar ones', () => {
    const one = cands(airpods)[0]
    const dup = viewCandidates('Apple AirPods Pro 2', [one, { ...one, pid: 1 }])
    expect(dup).toHaveLength(1)
    expect(dup[0].indices).toEqual([0, 1])
    // "AirPods Pro" vs "AirPods Pro with MagSafe Case": similar, but may be different generations: stay separate
    const a = { ...one, title: 'Apple AirPods Pro' }
    const b = { ...one, title: 'Apple AirPods Pro with MagSafe Case' }
    expect(viewCandidates('Apple AirPods Pro 2', [a, b])).toHaveLength(2)
  })
  it('scopes a choice to its own group: different groups give different offers', () => {
    const c = cands(airpods)
    const views = viewCandidates('Apple AirPods Pro 2', c)
    expect(offersForView(views[0], c).length).toBe(c[0].offers.length)
    expect(offersForView(views[1], c)).not.toEqual(offersForView(views[0], c))
  })
  it('says so when no group title confirms the search', () => {
    const vagueTitles = ['Apple AirPods Pro', 'Apple AirPods Pro with MagSafe Case'].map((title) => ({ ...cands(airpods)[0], title }))
    expect(noneConfirmed(viewCandidates('Apple AirPods Pro 2', vagueTitles))).toBe(true)
    expect(noneConfirmed(viewCandidates('Apple AirPods Pro 2', cands(airpods)))).toBe(false)
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
