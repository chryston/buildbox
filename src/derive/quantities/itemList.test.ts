/**
 * The Item List rows (#62 §6, criteria 5 and 9).
 *
 * The list answers one question — how many of each thing, where — and the two ways it could be
 * got wrong are the two things pinned here. A row's extents come from the Item Design, never from
 * the placement, so a cabinet turned 90° on plan is still 900 wide to the person cutting the
 * shelf; and a design with nothing placed is not in the list at all, because a zero the reader
 * has to read past is not information.
 */
import { describe, expect, test } from 'vitest'
import { basicProject } from '../testing'
import { itemListRowsForFloor } from './itemList'
import { designFootprintSize, designHeight } from '../../domain'
import type { EntityId, PlacedItem, Project } from '../../domain'

const project = basicProject()
const floorMain = 'floor-main'
const floorMezz = 'floor-mezz'
const chest = 'design-custom-chest'
const cabinet = 'design-base-cabinet'
const EXISTING = { designOptionId: '', designOption: '' }

/** The same Project with more Placed Items on it, for a count that is not the fixture's. */
function placed(target: Project, extra: readonly Omit<PlacedItem, 'id'>[]): Project {
  return {
    ...target,
    existingModel: {
      ...target.existingModel,
      placedItems: [
        ...target.existingModel.placedItems,
        ...extra.map((each, index): PlacedItem => ({ id: `place-extra-${String(index)}`, ...each })),
      ],
    },
  }
}

const onFloor = (itemDesignId: EntityId, floorId: EntityId, rotationDeg = 0): Omit<PlacedItem, 'id'> => ({
  floorId,
  itemDesignId,
  rotationDeg,
  translation: { x: 0, y: 0 },
  baseElevation: 0,
  // A row is per Item Design, renovation state and Drawing Layer (#71), so an added Item joins the
  // fixture's row only when it is filed on the same layer the fixture's are.
  drawingLayerId: project.existingModel.placedItems.find((item) => item.itemDesignId === itemDesignId)?.drawingLayerId ?? null,
})

describe('itemListRowsForFloor', () => {
  test('counts the Placed Items of one Floor under one Item Design (#62 criterion 9)', () => {
    // The fixture has two of this cabinet on the first Floor and none on the second; one more of
    // each makes three and one, which is the shape the criterion asks the list to show.
    const three = placed(project, [onFloor(cabinet, floorMain), onFloor(cabinet, floorMezz)])
    const rows = [
      ...itemListRowsForFloor(three, floorMain, EXISTING),
      ...itemListRowsForFloor(three, floorMezz, EXISTING),
    ].filter((row) => row.itemDesignId === cabinet)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => [row.floor, row.count])).toEqual([
      ['Floor 1', 3],
      ['Mezzanine', 1],
    ])
  })

  test('keeps the design’s local extents when the placement is turned 90° (#62 criterion 9)', () => {
    const turned = placed(project, [onFloor(chest, floorMain, 90), onFloor(chest, floorMain, 270)])
    const [row] = itemListRowsForFloor(turned, floorMain, EXISTING).filter((each) => each.itemDesignId === chest)
    const design = project.itemDesigns.find((each) => each.id === chest)!
    // The footprint is 900 × 450; a bounding box of a 90° placement would have swapped them.
    expect([row?.widthMm, row?.depthMm]).toEqual([900, 450])
    expect([row?.widthMm, row?.depthMm, row?.heightMm]).toEqual([
      designFootprintSize(design).width,
      designFootprintSize(design).depth,
      designHeight(design),
    ])
  })

  test('writes no row for a design nothing placed', () => {
    const rows = itemListRowsForFloor(project, floorMain, EXISTING)
    expect(rows.map((row) => row.itemDesignId)).not.toContain('design-legacy-wardrobe')
    expect(itemListRowsForFloor(project, 'floor-nowhere', EXISTING)).toEqual([])
  })

  test('carries the Floor, the Renovation State and the empty Design Option columns', () => {
    const rows = itemListRowsForFloor(project, floorMain, EXISTING)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.floorId).toBe(floorMain)
      expect(row.floor).toBe('Floor 1')
      expect(row.renovationState).toBe('existing')
      expect(row.designOptionId).toBe('')
      expect(row.designOption).toBe('')
      expect(row.count).toBeGreaterThan(0)
    }
  })

  test('names the Design Option it was asked for', () => {
    const option = { designOptionId: 'option-1', designOption: '' }
    const rows = itemListRowsForFloor(placed(project, [onFloor(cabinet, floorMain)]), floorMain, option)
    expect(rows.every((row) => row.designOptionId === 'option-1')).toBe(true)
  })

  test('counts a placement on a Floor the design is not on for nobody', () => {
    const rows = itemListRowsForFloor(project, floorMezz, EXISTING)
    expect(rows.map((row) => row.itemDesignId).sort()).toEqual(['design-bed-king', 'design-custom-chest'])
  })
})
