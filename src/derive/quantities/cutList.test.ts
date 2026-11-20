/**
 * The Cut List rows, and the mapping from the legacy panel they are made of (#62 §6, criterion 6).
 *
 * `cutListParts` is a rename, not a recalculation: it builds the one `CabinetUnit` an Item Design
 * describes, asks `cabinet` for its parts and puts the contract's column names on them. The
 * mapping is the whole of what can be got wrong here, so it is asserted against the legacy output
 * entry by entry — the longer of `width` and `height` becomes `length_mm` because a cutting list
 * is read length-then-width, and `depth` becomes `thickness_mm` even where the legacy note says
 * the depth of a drawer box, because the contract froze that spelling rather than fix it.
 */
import { describe, expect, test } from 'vitest'
import { computeCutListForUnits } from '../../cabinet'
import type { CabinetUnit } from '../../cabinet'
import { basicProject } from '../testing'
import { cutListParts, isCutListCapable } from './cutList'
import { quantitiesForFloor } from './quantities'
import type { CabinetItemDesign } from '../../domain'

const project = basicProject()
const cabinet = project.itemDesigns.find((design) => design.id === 'design-base-cabinet') as CabinetItemDesign

/** The unit `cutListParts` builds, spelled out so the comparison is against `cabinet` and not itself. */
const unit = (): CabinetUnit => ({
  type: 'cabinet',
  id: cabinet.id,
  label: cabinet.name,
  x: 0,
  y: 0,
  settings: cabinet.construction.settings,
  root: cabinet.construction.root,
})

describe('isCutListCapable', () => {
  test('is a cabinet, and nothing else', () => {
    expect(isCutListCapable(cabinet)).toBe(true)
    for (const design of project.itemDesigns.filter((each) => each.kind !== 'cabinet')) {
      expect(isCutListCapable(design)).toBe(false)
    }
  })
})

describe('cutListParts', () => {
  test('maps every legacy entry onto the contract’s columns', () => {
    const entries = computeCutListForUnits([unit()])
    const parts = cutListParts(cabinet, 1)
    expect(entries.length).toBeGreaterThan(0)
    expect(parts).toHaveLength(entries.length)
    entries.forEach((entry, index) => {
      const row = parts[index]!
      expect(row.part).toBe(entry.label)
      expect(row.lengthMm).toBe(Math.max(entry.width, entry.height))
      expect(row.widthMm).toBe(Math.min(entry.width, entry.height))
      expect(row.thicknessMm).toBe(entry.depth)
      expect(row.material).toBe(entry.material)
      expect(row.qtyPerItem).toBe(entry.qty)
      expect(row.notes).toBe(entry.notes ?? '')
      expect(row.itemDesignId).toBe(cabinet.id)
      expect(row.itemDesign).toBe(cabinet.name)
    })
  })

  test('reads length before width, so a panel is never turned on its side', () => {
    for (const row of cutListParts(cabinet, 1)) {
      expect(row.lengthMm).toBeGreaterThanOrEqual(row.widthMm)
      expect(row.thicknessMm).toBeGreaterThan(0)
    }
  })

  test('multiplies the count of Placed Items through, and nothing else', () => {
    const one = cutListParts(cabinet, 1)
    const three = cutListParts(cabinet, 3)
    expect(three.map((row) => row.qtyPerItem)).toEqual(one.map((row) => row.qtyPerItem))
    expect(three.map((row) => row.qtyInScope)).toEqual(one.map((row) => row.qtyPerItem * 3))
    expect(three.every((row) => row.itemCount === 3)).toBe(true)
  })

  test('is the same list for every placement of one design', () => {
    // A cut list is a statement about the Item Design, so where a Placed Item stands cannot move
    // a panel: the unit is built at the origin with the design's own name.
    expect(cutListParts(cabinet, 2)).toEqual(cutListParts(cabinet, 2))
    expect(cutListParts(cabinet, 1).map((row) => row.part)).toEqual(computeCutListForUnits([unit()]).map((each) => each.label))
  })
})

describe('quantitiesForFloor', () => {
  test('asks for a cut list only where one exists', () => {
    // The Mezzanine holds a bed and a chest: both generic, so the Cut List is empty.
    expect(quantitiesForFloor(project, 'floor-mezz', null).items.length).toBe(2)
    expect(quantitiesForFloor(project, 'floor-mezz', null).cuts).toEqual([])
  })

  test('puts the scope’s three columns on every cut row', () => {
    const { cuts } = quantitiesForFloor(project, 'floor-main', null)
    expect(cuts.length).toBeGreaterThan(0)
    for (const row of cuts) {
      expect(row.designOptionId).toBe('')
      expect(row.designOption).toBe('')
      expect(row.renovationState).toBe('existing')
      expect(row.qtyInScope).toBe(row.qtyPerItem * row.itemCount)
    }
  })

  test('counts a Floor’s placements once per design, not once per placement', () => {
    const { cuts } = quantitiesForFloor(project, 'floor-main', null)
    // Two cabinets of one design are one row with `item_count` 2.
    expect(new Set(cuts.map((row) => row.itemCount))).toEqual(new Set([2]))
  })
})
