/**
 * The memoisation in front of the effective model (#60 criteria 1, 2 and 3).
 *
 * Every assertion is by object identity, because that is the property the Plan View depends
 * on: a hit has to be the same object, not merely an equal one, or a `useSyncExternalStore`
 * selector rebuilds its view-model on every render (#49). Identity also proves a recompute
 * without reaching for a spy — a fresh object that deep-equals the old one can only have come
 * from `effective`.
 */
import { describe, expect, it } from 'vitest'
import type { Project } from '../domain'
import { DERIVE_CACHE_MAX_ENTRIES, createDeriveCache } from './index'
import { basicProject } from './testing'

const BASIC = basicProject()

/** Three Floors to exercise eviction against: the basic Project plus one with nothing on it. */
const THREE: Project = {
  ...BASIC,
  floors: [...BASIC.floors, { ...BASIC.floors[0], id: 'floor-third', name: 'Floor 3', planImage: null }],
}

/** The same Project with one placement moved: what a revision looks like from the cache's side. */
function moved(project: Project, placedItemId: string, x: number): Project {
  const next = structuredClone(project)
  const placed = next.existingModel.placedItems.find((candidate) => candidate.id === placedItemId)
  if (placed === undefined) throw new Error(`the fixture lost ${placedItemId}`)
  placed.translation.x = x
  return next
}

const MOVED_BED = moved(BASIC, 'place-bed', 1200)

describe('createDeriveCache', () => {
  it('answers the same object for the same key (#60 criterion 3)', () => {
    const cache = createDeriveCache()
    const floor = cache.floor(BASIC, 7, 'floor-main', null)
    expect(cache.floor(BASIC, 7, 'floor-main', null)).toBe(floor)
    const detail = cache.itemDetail(BASIC, 7, 'design-base-cabinet', 'floor-main')
    expect(cache.itemDetail(BASIC, 7, 'design-base-cabinet', 'floor-main')).toBe(detail)
  })

  it('never shares an entry between two caches (#60 criterion 2)', () => {
    const one = createDeriveCache()
    const two = createDeriveCache()
    const fromOne = one.floor(BASIC, 7, 'floor-main', null)
    expect(two.floor(BASIC, 7, 'floor-main', null)).not.toBe(fromOne)
    expect(two.floor(BASIC, 7, 'floor-main', null)).toEqual(fromOne)
    // A cache is an argument, not a global: nothing here can leak between them.
    const third = createDeriveCache({ maxEntries: 1 })
    expect(third.floor(BASIC, 7, 'floor-main', null)).not.toBe(fromOne)
  })

  it('recomputes a Floor whose revision moved, keeping what did not move', () => {
    const cache = createDeriveCache()
    const before = cache.floor(BASIC, 7, 'floor-mezz', null)
    const after = cache.floor(MOVED_BED, 8, 'floor-mezz', null)
    const bed = (floor: typeof before) => floor.placements.find((placement) => placement.id === 'place-bed')
    expect(after).not.toBe(before)
    expect(after.revision).toBe(8)
    expect(bed(after)?.worldPath).not.toEqual(bed(before)?.worldPath)
    expect(after.placements.filter((placement) => placement.id !== 'place-bed')).toEqual(
      before.placements.filter((placement) => placement.id !== 'place-bed'),
    )
  })

  it('never answers an older revision from a newer entry (#60 criterion 3)', () => {
    const cache = createDeriveCache()
    const seven = cache.floor(BASIC, 7, 'floor-main', null)
    const eight = cache.floor(BASIC, 8, 'floor-main', null)
    // A new revision replaces the Floor's entry rather than joining it, so revision 7 is
    // computed again — a new object, the same picture. Both halves matter: `not.toBe` says
    // nothing stale was handed back, `toEqual` says nothing was lost either.
    expect(cache.floor(BASIC, 7, 'floor-main', null)).not.toBe(seven)
    expect(cache.floor(BASIC, 7, 'floor-main', null)).toEqual(seven)
    expect(eight).not.toBe(seven)
  })

  it('replaces a design’s entry the same way', () => {
    const cache = createDeriveCache()
    const seven = cache.itemDetail(BASIC, 7, 'design-base-cabinet', 'floor-main')
    cache.itemDetail(BASIC, 8, 'design-base-cabinet', 'floor-main')
    expect(cache.itemDetail(BASIC, 7, 'design-base-cabinet', 'floor-main')).not.toBe(seven)
    expect(cache.itemDetail(BASIC, 7, 'design-base-cabinet', 'floor-main')).toEqual(seven)
  })

  it('keys on the Renovation Option, so two options never share a picture (#69)', () => {
    const cache = createDeriveCache()
    const none = cache.floor(BASIC, 7, 'floor-main', null)
    const option = cache.floor(BASIC, 7, 'floor-main', 'option-a')
    expect(option).not.toBe(none)
    expect(cache.floor(BASIC, 7, 'floor-main', null)).toBe(none)
  })

  it('evicts the least-recently-used entry, and a hit counts as use', () => {
    const cache = createDeriveCache({ maxEntries: 2 })
    const main = cache.floor(THREE, 1, 'floor-main', null)
    const mezz = cache.floor(THREE, 1, 'floor-mezz', null)
    expect(cache.floor(THREE, 1, 'floor-main', null)).toBe(main)
    // Floor 1 was asked for again before Floor 3 arrived, so the Mezzanine is the stale one.
    cache.floor(THREE, 1, 'floor-third', null)
    expect(cache.floor(THREE, 1, 'floor-main', null)).toBe(main)
    expect(cache.floor(THREE, 1, 'floor-mezz', null)).not.toBe(mezz)
  })

  it('holds eight entries by default', () => {
    expect(DERIVE_CACHE_MAX_ENTRIES).toBe(8)
    const cache = createDeriveCache()
    const oldest = cache.floor(THREE, 1, 'floor-main', 'option-a')
    const second = cache.floor(THREE, 1, 'floor-main', 'option-b')
    // Six more distinct slots: eight held, nothing dropped yet.
    for (const [floorId, optionId] of [
      ['floor-main', 'option-c'],
      ['floor-mezz', 'option-a'],
      ['floor-mezz', 'option-b'],
      ['floor-mezz', 'option-c'],
      ['floor-third', 'option-a'],
      ['floor-third', 'option-b'],
    ] as const) {
      cache.floor(THREE, 1, floorId, optionId)
    }
    cache.floor(THREE, 1, 'floor-third', 'option-c')
    // The ninth slot pushes the eighth out of eight, and only the oldest.
    expect(cache.floor(THREE, 1, 'floor-main', 'option-b')).toBe(second)
    expect(cache.floor(THREE, 1, 'floor-main', 'option-a')).not.toBe(oldest)
  })

  it('reads a maxEntries below one as one', () => {
    const cache = createDeriveCache({ maxEntries: 0 })
    const main = cache.floor(THREE, 1, 'floor-main', null)
    cache.floor(THREE, 1, 'floor-mezz', null)
    expect(cache.floor(THREE, 1, 'floor-main', null)).not.toBe(main)
    expect(cache.floor(THREE, 1, 'floor-main', null)).toEqual(main)
  })
})
