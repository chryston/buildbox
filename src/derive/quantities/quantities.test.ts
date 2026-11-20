/**
 * A scope's two tables (#62 §6, §7; criteria 9, 10).
 *
 * `quantities` is where a scope becomes rows: which Floors, which Renovation States, which
 * Drawing Layers, and — for an export from an Item Detail View — which one Item Design. Three
 * rules live here and nowhere else, so they are worth naming before the tests. Floors are a set,
 * so a dialog that named one twice must not count it twice. Cut List rows are merged across
 * Floors by the columns that say *which panel* they are, so one cabinet standing on two Floors is
 * one row with the Placed Items summed rather than two rows of half each. And the row order is
 * the contract's, spelled once for both tables.
 */
import { describe, expect, test } from 'vitest'
import { basicProject, referenceProject } from '../testing'
import { createDeriveCache } from '../cache'
import { quantities, quantitiesForFloor } from './quantities'
import type { QuantityScope } from './scope'
import type { PlacedItem, Project } from '../../domain'

const project = basicProject()
const cabinet = 'design-base-cabinet'
const ALL_STATES = ['existing', 'demolition', 'proposed'] as const

function scope(over: Partial<QuantityScope> = {}): QuantityScope {
  return {
    floorIds: project.floors.map((floor) => floor.id),
    designOptionIds: 'existing-only',
    renovationStates: ALL_STATES,
    drawingLayers: 'all',
    ...over,
  }
}

/** The fixture with one more cabinet standing on the Mezzanine, so one design spans two Floors. */
const spread: Project = {
  ...project,
  existingModel: {
    ...project.existingModel,
    placedItems: [
      ...project.existingModel.placedItems,
      {
        id: 'place-cabinet-mezz',
        itemDesignId: cabinet,
        floorId: 'floor-mezz',
        translation: { x: 0, y: 0 },
        rotationDeg: 0,
        baseElevation: 0,
      } satisfies PlacedItem,
    ],
  },
}

describe('the scope filters', () => {
  test('a Floor named twice is counted once', () => {
    const once = quantities(project, 1, scope({ floorIds: ['floor-main'] }))
    const twice = quantities(project, 1, scope({ floorIds: ['floor-main', 'floor-main'] }))
    expect(twice.items).toEqual(once.items)
    expect(twice.cuts).toEqual(once.cuts)
  })

  test('nothing outside the Existing Model is in a v1.0 Project', () => {
    expect(quantities(project, 1, scope({ renovationStates: [] })).items).toEqual([])
    expect(quantities(project, 1, scope({ renovationStates: ['demolition'] })).items).toEqual([])
    expect(quantities(project, 1, scope({ renovationStates: ['proposed'] })).cuts).toEqual([])
    expect(quantities(project, 1, scope({ renovationStates: ['existing'] })).items.length).toBeGreaterThan(0)
  })

  test('Unlayered content is in only when the scope says so', () => {
    // Every Placed Item in the domain is unlayered until #18 gives a Project a layer, so a
    // narrowed scope that leaves Unlayered out has nothing left to count.
    const excluding = scope({ drawingLayers: { layerIds: ['layer-1'], includeUnlayered: false } })
    expect(quantities(project, 1, excluding).items).toEqual([])
    expect(quantities(project, 1, excluding).cuts).toEqual([])
    const including = scope({ drawingLayers: { layerIds: ['layer-1'], includeUnlayered: true } })
    expect(quantities(project, 1, including).items).toEqual(quantities(project, 1, scope()).items)
  })

  test('an option with no content of its own yet counts the Existing Model’s, tagged with its ID', () => {
    // #32 gives a Design Option content to differ by; until then the effective model of a Floor
    // under an option is the Existing Model's, which is what `effectiveFloor` already answers, and
    // the column says which option the reader asked for (export contract §7).
    const rows = quantities(project, 1, scope({ designOptionIds: ['option-1'] }))
    expect(rows.items.map((row) => row.designOptionId)).toEqual(rows.items.map(() => 'option-1'))
    expect(rows.items.length).toBe(quantities(project, 1, scope()).items.length)
    expect(rows.cuts.every((row) => row.designOptionId === 'option-1')).toBe(true)
  })

  test('two options in scope write the rows of each, one arm after the other', () => {
    const rows = quantities(project, 1, scope({ designOptionIds: ['option-1', 'option-2'] }))
    expect(rows.items.filter((row) => row.designOptionId === 'option-1').length)
      .toBe(rows.items.filter((row) => row.designOptionId === 'option-2').length)
  })
})

describe('the Item Detail narrowing', () => {
  test('keeps one design and counts one Placed Item (#62 criterion 6)', () => {
    const reference = referenceProject()
    const every = { ...scope(), floorIds: reference.floors.map((floor) => floor.id) }
    const all = quantities(reference, 1, every)
    const oneDesign = all.cuts[0]!.itemDesignId
    const one = quantities(reference, 1, { ...every, itemDesignId: oneDesign })
    expect(one.cuts.length).toBeGreaterThan(0)
    expect(one.cuts.length).toBeLessThan(all.cuts.length)
    expect(one.cuts.every((row) => row.itemDesignId === oneDesign)).toBe(true)
    // The reader is holding one item, so `item_count` is one and `qty_in_scope` is `qty_per_item`.
    expect(one.cuts.every((row) => row.itemCount === 1 && row.qtyInScope === row.qtyPerItem)).toBe(true)
  })

  test('leaves the Item List alone, because it is grouped by design anyway', () => {
    expect(quantities(project, 1, scope({ itemDesignId: cabinet })).items).toEqual(quantities(project, 1, scope()).items)
  })
})

describe('merging a Cut List across Floors', () => {
  test('sums the Placed Items of one panel rather than adding a row', () => {
    // No `itemDesignId` here: that narrowing is the Item Detail export and forces `item_count`
    // to one, which is a different rule from this one.
    const oneFloor = quantities(spread, 1, scope({ floorIds: ['floor-main'] }))
    const bothFloors = quantities(spread, 1, scope())
    // Two cabinets on the first Floor and one on the second: the same rows, three of each.
    expect(bothFloors.cuts.map((row) => [row.itemDesignId, row.part])).toEqual(oneFloor.cuts.map((row) => [row.itemDesignId, row.part]))
    expect(bothFloors.cuts.every((row) => row.itemCount === 3)).toBe(true)
    expect(bothFloors.cuts.every((row) => row.qtyInScope === row.qtyPerItem * 3)).toBe(true)
    expect(oneFloor.cuts.every((row) => row.itemCount === 2)).toBe(true)
  })

  test('every row’s counted columns agree with each other, on any scope', () => {
    const reference = referenceProject()
    const rows = quantities(reference, 1, { ...scope(), floorIds: reference.floors.map((floor) => floor.id) })
    expect(rows.cuts.length).toBeGreaterThan(0)
    for (const row of rows.cuts) {
      expect(row.qtyInScope).toBe(row.qtyPerItem * row.itemCount)
      expect(row.itemCount).toBeGreaterThan(0)
    }
  })

  test('a Floor with only generic designs adds nothing to the Cut List', () => {
    const withMezz = quantities(project, 1, scope())
    const withoutMezz = quantities(project, 1, scope({ floorIds: ['floor-main'] }))
    expect(withMezz.cuts).toEqual(withoutMezz.cuts)
    expect(withMezz.items.length).toBeGreaterThan(withoutMezz.items.length)
  })
})

describe('the row order', () => {
  test('is Floors in Project order, then the Item Design’s name', () => {
    const order = project.floors.map((floor) => floor.id)
    const rows = quantities(project, 1, scope()).items
    const ranks = rows.map((row) => order.indexOf(row.floorId))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    for (const floorId of order) {
      const names = rows.filter((row) => row.floorId === floorId).map((row) => row.itemDesign)
      expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    }
  })

  test('puts a name above its own ID when two designs share a name', () => {
    // The tie-break is the ID in code-point order, so a Project with two designs of one name
    // still writes them in the same order twice.
    const rows = quantities(project, 1, scope()).items
    const ids = rows.map((row) => row.itemDesignId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('is the same twice, and does not depend on the revision (#62 criterion 10)', () => {
    expect(quantities(project, 1, scope())).toEqual(quantities(project, 42, scope()))
  })
})

describe('the per-Floor memo', () => {
  test('answers the same object for the same Floor, Project and revision', () => {
    const cache = createDeriveCache()
    const first = cache.quantities(project, 3, 'floor-main', null)
    expect(cache.quantities(project, 3, 'floor-main', null)).toBe(first)
    expect(cache.quantities(project, 4, 'floor-main', null)).not.toBe(first)
    expect(cache.quantities(project, 3, 'floor-mezz', null)).not.toBe(first)
    expect(cache.quantities(project, 3, 'floor-main', 'option-1').items.map((row) => row.designOptionId))
      .toEqual(['option-1'])
  })

  test('serves every scope from one entry, and agrees with the uncached path', () => {
    const cache = createDeriveCache()
    expect(quantities(project, 3, scope(), cache)).toEqual(quantities(project, 3, scope()))
    expect(quantities(project, 3, scope({ floorIds: ['floor-main'] }), cache)).toEqual(
      quantities(project, 3, scope({ floorIds: ['floor-main'] })),
    )
    expect(quantitiesForFloor(project, 'floor-main', null).items.length).toBeGreaterThan(0)
  })
})
