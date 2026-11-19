/**
 * The Item Design family (#57 criteria 3–6, 14–15): the fields every Placed Item of one
 * design shares, the Item Origin rule that keeps the world still when the Origin moves, and
 * the fork that gives one Placed Item a design of its own.
 *
 * The numbers are the issue's worked example — `Base 600` #1 at (2000, 1700) unturned and
 * #2 at (5150, 4500) turned 37°, both 600 × 400 with the Origin at the centre — because the
 * rule under test is arithmetic the user can check by eye.
 */
import { describe, expect, it } from 'vitest'
import type { GenericItemDesign, ItemDesign, PlacedItem, Project } from '../../domain'
import { footprintPath, placementContext, worldPoint } from '../../derive'
import { canonicalJson } from '../../lib'
import { applyPatches } from '../apply'
import {
  basicProject,
  deepFreeze,
  expectApplied,
  expectRejection,
  expectRoundTrip,
  idSource,
  intent,
  newProject,
} from '../testing'

function design(project: Project, itemDesignId: string): ItemDesign {
  const found = project.itemDesigns.find((candidate) => candidate.id === itemDesignId)
  if (found === undefined) throw new Error(`no Item Design ${itemDesignId} in this test Project`)
  return found
}

function generic(project: Project, itemDesignId: string): GenericItemDesign {
  const found = design(project, itemDesignId)
  if (found.kind !== 'generic') throw new Error(`Item Design ${itemDesignId} is not generic in this test Project`)
  return found
}

function placement(project: Project, placedItemId: string): PlacedItem {
  const found = project.existingModel.placedItems.find((candidate) => candidate.id === placedItemId)
  if (found === undefined) throw new Error(`no Placed Item ${placedItemId} in this test Project`)
  return found
}

/**
 * The issue's example: `Base 600` (600 × 400, Origin at the centre) placed twice on the
 * Project's only Floor, #1 unturned at (2000, 1700) and #2 turned 37° at (5150, 4500).
 */
function twoBases(): { project: Project; itemDesignId: string; first: string; second: string } {
  const project = newProject()
  const floorId = project.floors[0]!.id
  const [itemDesignId, first, second] = idSource('base')(3)
  let current = expectApplied(project, intent('plan.addTemplate', { label: 'Base 600', w: 600, h: 400, color: '#3b82f6' }, [itemDesignId])).project
  for (const placedItemId of [first, second]) {
    current = expectApplied(current, intent('plan.placeDesign', { floorId, itemDesignId }, [placedItemId])).project
  }
  current = expectApplied(current, intent('plan.movePlacement', { placedItemId: first, translation: { x: 2000, y: 1700 } })).project
  current = expectApplied(current, intent('plan.movePlacement', { placedItemId: second, translation: { x: 5150, y: 4500 } })).project
  return { project: expectApplied(current, intent('plan.rotatePlacement', { placedItemId: second, rotationDeg: 37 })).project, itemDesignId, first, second }
}

/** The four footprint corners of one placement, in world millimetres. */
function worldCorners(project: Project, placedItemId: string): { x: number; y: number }[] {
  const placed = placement(project, placedItemId)
  const itemDesign = design(project, placed.itemDesignId)
  return footprintPath(itemDesign).segments.map((segment) => worldPoint(itemDesign, placed, segment.to))
}

describe('design.update', () => {
  it('renames and recolours the design every placement shares (#57 criterion 4)', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('design.update', {
      itemDesignId: 'design-base-cabinet',
      patch: { name: 'Base run' },
    }))
    expect(design(applied.project, 'design-base-cabinet').name).toBe('Base run')
    // Both placements still reference the one design; nothing about either placement moved.
    expect(applied.project.existingModel.placedItems.map((item) => item.itemDesignId))
      .toEqual(project.existingModel.placedItems.map((item) => item.itemDesignId))
    expect(applied.affected).toEqual({
      floorId: 'floor-main',
      viewId: null,
      view: 'cabinet',
      itemDesignIds: ['design-base-cabinet'],
      placedItemIds: ['place-base-left', 'place-base-right'],
    })
  })

  it('resizes a generic design, taking a centred Origin along with the new centre', () => {
    const project = basicProject()
    const applied = expectRoundTrip(project, intent('design.update', {
      itemDesignId: 'design-bed-king',
      patch: { width: 2000, depth: 1980 },
    }))
    expect(generic(applied.project, 'design-bed-king').footprint).toEqual({ kind: 'rectangle', width: 2000, depth: 1980 })
    expect(generic(applied.project, 'design-bed-king').origin).toEqual({ x: 1000, y: 990 })
    // The Placed Items did not move: the Origin did the work.
    expect(applied.project.existingModel.placedItems.map((item) => item.translation))
      .toEqual(project.existingModel.placedItems.map((item) => item.translation))
  })

  it('leaves a hand-placed Origin where the user put it', () => {
    const project = basicProject()
    const moved = expectApplied(project, intent('design.setOrigin', { itemDesignId: 'design-bed-king', origin: { x: 0, y: 1980 } })).project
    const applied = expectRoundTrip(moved, intent('design.update', { itemDesignId: 'design-bed-king', patch: { width: 1500 } }))
    expect(generic(applied.project, 'design-bed-king').origin).toEqual({ x: 0, y: 1980 })
  })

  it('refuses a footprint below the legacy 10 mm floor, rather than clamping it', () => {
    const project = deepFreeze(basicProject())
    expectRejection(project, intent('design.update', { itemDesignId: 'design-bed-king', patch: { width: 5 } }), 'invalid-size')
    expectRejection(project, intent('design.update', { itemDesignId: 'design-bed-king', patch: { depth: 9.99 } }), 'invalid-size')
  })

  it('refuses a size or colour on a cabinet, whose size is its construction', () => {
    const project = deepFreeze(basicProject())
    expectRejection(project, intent('design.update', { itemDesignId: 'design-base-cabinet', patch: { width: 800 } }), 'unknown-target')
    expectRejection(project, intent('design.update', { itemDesignId: 'design-base-cabinet', patch: { color: '#ff0000' } }), 'unknown-target')
    // The name is shared by both kinds, and is the one field a cabinet design takes here.
    expect(expectApplied(project, intent('design.update', { itemDesignId: 'design-base-cabinet', patch: { name: 'Rename me' } })).project
      .itemDesigns.find((item) => item.id === 'design-base-cabinet')!.name).toBe('Rename me')
  })

  it('refuses a patch that changes nothing, and one that names nothing', () => {
    const project = deepFreeze(basicProject())
    expectRejection(project, intent('design.update', { itemDesignId: 'design-bed-king', patch: { width: 1820, depth: 1980 } }), 'no-change')
    expectRejection(project, intent('design.update', { itemDesignId: 'nope', patch: { name: 'Ghost' } }), 'unknown-target')
  })
})

describe('design.setOrigin', () => {
  it('moves every placement so the world stays exactly where it was (#57 criterion 5)', () => {
    const { project, itemDesignId, first, second } = twoBases()
    const before = [worldCorners(project, first), worldCorners(project, second)]

    const applied = expectRoundTrip(project, intent('design.setOrigin', { itemDesignId, origin: { x: 0, y: 400 } }))

    expect(placement(applied.project, first).translation.x).toBeCloseTo(1700, 10)
    expect(placement(applied.project, first).translation.y).toBeCloseTo(1900, 10)
    expect(placement(applied.project, second).translation.x).toBeCloseTo(4790.05, 1)
    expect(placement(applied.project, second).translation.y).toBeCloseTo(4479.18, 1)
    for (const [index, placedItemId] of [first, second].entries()) {
      const after = worldCorners(applied.project, placedItemId)
      for (const corner of after.keys()) {
        expect(after[corner]!.x - before[index]![corner]!.x, `placement ${index} corner ${corner} x`).toBeCloseTo(0, 1)
        expect(after[corner]!.y - before[index]![corner]!.y, `placement ${index} corner ${corner} y`).toBeCloseTo(0, 1)
      }
    }
    // The turn is untouched: only the Origin and the translations moved.
    expect(placement(applied.project, second).rotationDeg).toBe(37)
    expect(generic(applied.project, itemDesignId).origin).toEqual({ x: 0, y: 400 })
  })

  it('is one Edit Transaction, so one undo restores every placement at once', () => {
    const { project, itemDesignId, first, second } = twoBases()
    const before = { first: placement(project, first).translation, second: placement(project, second).translation }
    const applied = expectApplied(project, intent('design.setOrigin', { itemDesignId, origin: { x: 600, y: 400 } }))
    expect(applied.patches.length, 'one transaction, however many placements it touched').toBeGreaterThan(1)
    const undone = applyPatches(applied.project, applied.inversePatches)
    expect(canonicalJson(undone)).toBe(canonicalJson(project))
    expect(placement(undone, first).translation).toEqual(before.first)
    expect(placement(undone, second).translation).toEqual(before.second)
  })

  it('refuses an Origin outside the footprint, and one that is already there', () => {
    const { project, itemDesignId } = twoBases()
    const frozen = deepFreeze(project)
    expectRejection(frozen, intent('design.setOrigin', { itemDesignId, origin: { x: -1, y: 200 } }), 'invalid-origin')
    expectRejection(frozen, intent('design.setOrigin', { itemDesignId, origin: { x: 300, y: 200 } }), 'no-change')
    expectRejection(frozen, intent('design.setOrigin', { itemDesignId: 'design-base-cabinet', origin: { x: 0, y: 0 } }), 'unknown-target')
  })

  it('names the Floor of the placements it moved', () => {
    const { project, itemDesignId } = twoBases()
    const applied = expectApplied(project, intent('design.setOrigin', { itemDesignId, origin: { x: 0, y: 0 } }))
    expect(applied.affected.floorId).toBe(project.floors[0]!.id)
    expect(applied.affected.view).toBe('plan')
    expect(applied.affected.placedItemIds).toEqual([expect.any(String), expect.any(String)])
  })
})

describe('design.fork', () => {
  it('gives one Placed Item its own copy and leaves the others alone (#57 criterion 15)', () => {
    const project = basicProject()
    const [itemDesignId] = idSource('fork')(1)
    const applied = expectRoundTrip(project, intent('design.fork', { placedItemId: 'place-base-left', name: 'Base run — left' }, [itemDesignId]))

    expect(placement(applied.project, 'place-base-left').itemDesignId).toBe(itemDesignId)
    expect(placement(applied.project, 'place-base-right').itemDesignId).toBe('design-base-cabinet')
    expect(canonicalJson(design(applied.project, 'design-base-cabinet'))).toBe(canonicalJson(design(project, 'design-base-cabinet')))
    // The Locator names the design the user was looking at when they asked, which is the
    // one the fork took away from them — and, after an undo, the one they get back.
    expect(applied.affected).toEqual({
      floorId: 'floor-main',
      viewId: null,
      view: 'cabinet',
      itemDesignIds: ['design-base-cabinet'],
      placedItemIds: ['place-base-left'],
    })
  })

  it('copies the design deeply, and drops what the copy is not', () => {
    const project = basicProject()
    const [itemDesignId] = idSource('fork')(1)
    const applied = expectApplied(project, intent('design.fork', { placedItemId: 'place-chest', name: 'Chest, moved' }, [itemDesignId]))
    const original = generic(project, 'design-custom-chest')
    const copy = generic(applied.project, itemDesignId)
    expect(copy).toEqual({ ...original, id: itemDesignId, name: 'Chest, moved', isCustom: undefined })
    expect(copy.isCustom, 'a fork is a design, not a legacy custom shape').toBeUndefined()
    // Deep: the copy's footprint is its own object, so editing it cannot reach the original.
    expect(copy.footprint).not.toBe(original.footprint)
    const edited = expectApplied(applied.project, intent('design.update', { itemDesignId, patch: { width: 1200 } })).project
    expect(generic(edited, itemDesignId).footprint.width).toBe(1200)
    expect(generic(edited, 'design-custom-chest').footprint.width).toBe(900)
  })

  it('refuses a placement that is not in the Project and a name that is empty', () => {
    const project = deepFreeze(basicProject())
    expectRejection(project, intent('design.fork', { placedItemId: 'gone', name: 'Nothing' }, ['d']), 'unknown-target')
    expectRejection(project, intent('design.fork', { placedItemId: 'place-chest', name: 'Nothing' }, []), 'missing-ids')
  })
})

describe('the placement maths behind the Item Origin (#57 criterion 3)', () => {
  it('turns the footprint about the Origin, not about the local origin', () => {
    const { project, first } = twoBases()
    const placed = placement(project, first)
    const itemDesign = design(project, placed.itemDesignId)
    const context = placementContext(itemDesign, placed)
    expect(context.origin).toEqual({ x: 300, y: 200 })
    // The Origin itself lands on the placement's position, whatever the turn.
    expect(worldPoint(itemDesign, placed, context.origin)).toEqual({ x: 2000, y: 1700 })
  })
})
