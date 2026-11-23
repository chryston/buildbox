/**
 * The Vertical Extent Intents (#74 §5) and the Plan View Range (#74 §4).
 *
 * The numbers are the issue's own, because they are the criteria: a Top of 2 200 on a 700-high item
 * leaves a base of 1 460, a Wall Top of 2 400 leaves the Base at 0 and the Height at 2 400, a sill
 * lifted from 900 to 1 050 lifts the head to 2 250 and leaves the Wall it stands in exactly as it was.
 *
 * Every refusal is asserted by its sentence as well as its code — `Lower needs to be below Upper.` and
 * `The top has to be above the base.` are the acceptance criteria, not a detail under them.
 */
import { describe, expect, it } from 'vitest'
import type { Opening, PlanView, Project, Wall, WallRefLine } from '../../domain'
import { pt } from '../../geometry'
import {
  designId,
  expectApplied,
  expectRejection,
  expectRoundTrip,
  firstPlacement,
  idSource,
  intent,
  newProject,
} from '../testing'

const line = (x1: number, y1: number, x2: number, y2: number): WallRefLine => ({
  kind: 'line',
  start: pt(x1, y1),
  end: pt(x2, y2),
})

const source = idSource('extent')
const floorIdOf = (project: Project): string => project.floors[0]!.id
const viewOf = (project: Project): PlanView => project.views[0]!

/** A 4 000 × 100 free-ended Wall standing on the Floor Datum at the storey height, drawn by the tool. */
function wallOn(baseElevation: number, height: number): { project: Project; wall: Wall } {
  const project = newProject()
  const applied = expectApplied(
    project,
    intent(
      'wall.createChain',
      {
        floorId: floorIdOf(project),
        walls: [{ line: line(0, 0, 4000, 0), thickness: 100, justification: 'centre', baseElevation, height }],
        starts: [{ kind: 'free' }],
        ends: [{ kind: 'free' }],
      },
      source(1),
    ),
  )
  return { project: applied.project, wall: applied.project.existingModel.walls[0]! }
}

/** A 1 200 wide window from 900 to 2 100 — the fixture's `WND-1`, cut by the Opening tool. */
function windowIn(project: Project, wall: Wall): { project: Project; opening: Opening } {
  const applied = expectApplied(
    project,
    intent(
      'opening.create',
      { floorId: wall.floorId, hostWallId: wall.id, kind: 'window', label: 'Window 1', start: 600, width: 1200, sill: 900, head: 2100 },
      source(1),
    ),
  )
  return { project: applied.project, opening: applied.project.existingModel.openings[0]! }
}

/** The Project's one cabinet design, restated to the 700 mm `Wall cabinet` of #74 §5. */
function designHeight700(): Project {
  const project = newProject()
  return expectApplied(project, intent('cabinet.updateSettings', { itemDesignId: designId(project), patch: { height: 700 } })).project
}

describe('plan.setPlacementVerticalExtent', () => {
  it('stands the item so the height its Item Design owns lands under the entered top (#74 §5 criterion 13)', () => {
    // The item stood at 1 500 – 2 200; the Top box says 2 160 and the whole item comes down 40 with it.
    const project = designHeight700()
    const applied = expectApplied(
      project,
      intent('plan.setPlacementVerticalExtent', { placedItemId: firstPlacement(project).id, field: 'top', value: 2160 }),
    )
    expect(firstPlacement(applied.project).baseElevation).toBe(1460)
  })

  it('moves the item when the base is entered, and the top follows the design height (#74 §5 criterion 13)', () => {
    const project = designHeight700()
    const placedItemId = firstPlacement(project).id
    const raised = expectApplied(project, intent('plan.setPlacementVerticalExtent', { placedItemId, field: 'base', value: 1500 }))
    expect(firstPlacement(raised.project).baseElevation).toBe(1500)
    const lowered = expectApplied(
      raised.project,
      intent('plan.setPlacementVerticalExtent', { placedItemId, field: 'base', value: 1400 }),
    )
    expect(firstPlacement(lowered.project).baseElevation).toBe(1400)
    // 1 400 + the 700 the design owns is the 2 100 the inspector reads back in the same breath.
    expect(firstPlacement(lowered.project).baseElevation + 700).toBe(2100)
  })

  it('stores the number that was typed, exactly, at any unit (#74 §5 criterion 16)', () => {
    const project = designHeight700()
    // 2.16 m is what the field holds; `parseMmInput` is what turns it into 2160 and is tested where it
    // lives. What this asserts is that nothing downstream drifts: 2160 − 700 is 1460, not 1459.999999.
    const applied = expectApplied(
      project,
      intent('plan.setPlacementVerticalExtent', { placedItemId: firstPlacement(project).id, field: 'top', value: 2160 }),
    )
    expect(Object.is(firstPlacement(applied.project).baseElevation, 1460)).toBe(true)
  })

  it('never writes a height onto the Placed Item, whichever field was used (#74 §5 criterion 17)', () => {
    const project = designHeight700()
    const placedItemId = firstPlacement(project).id
    for (const field of ['base', 'top'] as const) {
      const applied = expectApplied(
        project,
        intent('plan.setPlacementVerticalExtent', { placedItemId, field, value: field === 'base' ? 1500 : 2200 }),
      )
      const written = applied.project.existingModel.placedItems.find((item) => item.id === placedItemId)!
      expect(Object.keys(written)).not.toContain('height')
      expect(JSON.stringify(written)).not.toContain('"height"')
      // The Design is untouched too: the Height line is read from it, and stays true for every
      // other placement of it.
      expect(applied.project.itemDesigns).toEqual(project.itemDesigns)
    }
  })

  it('leaves every other placement of the same Item Design where it stood (#74 §7)', () => {
    const project = designHeight700()
    const [secondId] = source(1)
    const placed = expectApplied(
      project,
      intent('plan.placeDesign', { floorId: floorIdOf(project), itemDesignId: designId(project) }, [secondId!]),
    ).project
    const first = placed.existingModel.placedItems.find((item) => item.id !== secondId)!
    const other = placed.existingModel.placedItems.find((item) => item.id === secondId)!
    const applied = expectApplied(
      placed,
      intent('plan.setPlacementVerticalExtent', { placedItemId: first.id, field: 'base', value: 1500 }),
    )
    const after = applied.project.existingModel.placedItems.find((item) => item.id === secondId)!
    expect(after.baseElevation).toBe(other.baseElevation)
    expect(applied.patches.length).toBe(1)
  })

  it('refuses a top at or below the base and a value that is not a number (#74 §5 criterion 5)', () => {
    const project = designHeight700()
    const placedItemId = firstPlacement(project).id
    const raised = expectApplied(
      project,
      intent('plan.setPlacementVerticalExtent', { placedItemId, field: 'base', value: 1500 }),
    ).project
    const low = expectRejection(
      raised,
      intent('plan.setPlacementVerticalExtent', { placedItemId, field: 'top', value: 1500 }),
      'invalid-extent',
    )
    expect(low.problems[0]!.message).toBe('The top has to be above the base.')
    const blank = expectRejection(
      raised,
      intent('plan.setPlacementVerticalExtent', { placedItemId, field: 'base', value: Number.NaN }),
      'invalid-extent',
    )
    expect(blank.problems[0]!.message).toBe('Enter a number.')
  })

  it('undoes to the Project it started from (#74 §4 criterion 3)', () => {
    const project = designHeight700()
    expectRoundTrip(project, intent('plan.setPlacementVerticalExtent', { placedItemId: firstPlacement(project).id, field: 'top', value: 2200 }))
  })
})

describe('wall.setVerticalExtent', () => {
  it('holds the base when the top is restated, and the base when the height is (#74 §5 criterion 14)', () => {
    const { project, wall } = wallOn(0, 2600)
    const lowered = expectApplied(project, intent('wall.setVerticalExtent', { wallId: wall.id, field: 'top', value: 2400 }))
    const afterTop = lowered.project.existingModel.walls[0]!
    expect(afterTop.baseElevation).toBe(0)
    expect(afterTop.height).toBe(2400)
    const grown = expectApplied(lowered.project, intent('wall.setVerticalExtent', { wallId: wall.id, field: 'height', value: 2500 }))
    const afterHeight = grown.project.existingModel.walls[0]!
    expect(afterHeight.baseElevation).toBe(0)
    expect(afterHeight.height).toBe(2500)
  })

  it('carries the height with the base, so the soffit moves and the height is kept', () => {
    const { project, wall } = wallOn(0, 2600)
    const applied = expectApplied(project, intent('wall.setVerticalExtent', { wallId: wall.id, field: 'base', value: 100 }))
    const after = applied.project.existingModel.walls[0]!
    expect(after.baseElevation).toBe(100)
    expect(after.height).toBe(2600)
  })

  it('moves no reference-line point and leaves a hosted Opening alone (#74 §5)', () => {
    const wall0 = wallOn(0, 2600)
    const { project, opening } = windowIn(wall0.project, wall0.wall)
    const wallBefore = project.existingModel.walls[0]!
    const applied = expectApplied(project, intent('wall.setVerticalExtent', { wallId: wallBefore.id, field: 'top', value: 2400 }))
    expect(applied.project.existingModel.openings[0]).toEqual(opening)
    const after = applied.project.existingModel.walls[0]!
    expect(after.line).toEqual(wallBefore.line)
    expect(after.thickness).toBe(wallBefore.thickness)
  })

  it('refuses a height of 0, a top at or below the base, and a value that is not a number (#74 §5 criterion 5)', () => {
    const { project, wall } = wallOn(0, 2600)
    const flat = expectRejection(project, intent('wall.setVerticalExtent', { wallId: wall.id, field: 'height', value: 0 }), 'invalid-extent')
    expect(flat.problems[0]!.message).toBe('A height has to be more than 0 mm.')
    const under = expectRejection(project, intent('wall.setVerticalExtent', { wallId: wall.id, field: 'top', value: 0 }), 'invalid-extent')
    expect(under.problems[0]!.message).toBe('The top has to be above the base.')
    const blank = expectRejection(project, intent('wall.setVerticalExtent', { wallId: wall.id, field: 'base', value: Number.NaN }), 'invalid-extent')
    expect(blank.problems[0]!.message).toBe('Enter a number.')
  })

  it('undoes to the Project it started from', () => {
    const { project, wall } = wallOn(0, 2600)
    expectRoundTrip(project, intent('wall.setVerticalExtent', { wallId: wall.id, field: 'top', value: 2400 }))
  })
})

describe('opening.setVerticalExtent', () => {
  it('lifts the whole opening when the base moves and leaves its host alone (#74 §5 criterion 15)', () => {
    const wall0 = wallOn(0, 2600)
    const { project, opening } = windowIn(wall0.project, wall0.wall)
    const hostBefore = project.existingModel.walls[0]!
    const applied = expectApplied(project, intent('opening.setVerticalExtent', { openingId: opening.id, field: 'base', value: 1050 }))
    const after = applied.project.existingModel.openings[0]!
    expect(after.sill).toBe(1050)
    expect(after.head).toBe(2250)
    expect(after.head - after.sill).toBe(1200)
    expect(after.hostWallId).toBe(opening.hostWallId)
    expect(after.start).toBe(opening.start)
    expect(after.width).toBe(opening.width)
    expect(applied.project.existingModel.walls[0]).toEqual(hostBefore)
  })

  it('grows the head off the sill it keeps, and restates the head from the top (#74 §5)', () => {
    const wall0 = wallOn(0, 2600)
    const { project, opening } = windowIn(wall0.project, wall0.wall)
    const grown = expectApplied(project, intent('opening.setVerticalExtent', { openingId: opening.id, field: 'height', value: 1000 }))
    expect(grown.project.existingModel.openings[0]!.sill).toBe(900)
    expect(grown.project.existingModel.openings[0]!.head).toBe(1900)
    const lowered = expectApplied(project, intent('opening.setVerticalExtent', { openingId: opening.id, field: 'top', value: 2200 }))
    expect(lowered.project.existingModel.openings[0]!.head).toBe(2200)
    expect(lowered.project.existingModel.openings[0]!.sill).toBe(900)
  })

  it('refuses a top at or below the sill and a height of 0 (#74 §5 criterion 5)', () => {
    const wall0 = wallOn(0, 2600)
    const { project, opening } = windowIn(wall0.project, wall0.wall)
    const under = expectRejection(project, intent('opening.setVerticalExtent', { openingId: opening.id, field: 'top', value: 900 }), 'invalid-extent')
    expect(under.problems[0]!.message).toBe('The top has to be above the base.')
    const flat = expectRejection(project, intent('opening.setVerticalExtent', { openingId: opening.id, field: 'height', value: 0 }), 'invalid-extent')
    expect(flat.problems[0]!.message).toBe('A height has to be more than 0 mm.')
  })

  it('undoes to the Project it started from', () => {
    const wall0 = wallOn(0, 2600)
    const { project, opening } = windowIn(wall0.project, wall0.wall)
    expectRoundTrip(project, intent('opening.setVerticalExtent', { openingId: opening.id, field: 'base', value: 1050 }))
  })
})

describe('view.setPlanViewRange', () => {
  /** The same Floor seen twice, so "this view only" has something to be false about. */
  function twoViews(): { project: Project; first: PlanView; second: PlanView } {
    const project = newProject()
    const [viewId] = source(1)
    const applied = expectApplied(project, intent('view.create', { floorId: floorIdOf(project), name: 'Ceiling' }, [viewId!]))
    return { project: applied.project, first: viewOf(project), second: applied.project.views.find((v) => v.id === viewId)! }
  }

  it('changes one view and no entity, and undoes byte-identically (#74 §4 criterion 3)', () => {
    const { project, first, second } = twoViews()
    const modelBefore = JSON.stringify(project.existingModel)
    const applied = expectRoundTrip(project, intent('view.setPlanViewRange', { viewId: first.id, lowerMm: 1200, upperMm: 2100 }))
    expect(applied.project.views.find((v) => v.id === first.id)!.planViewRange).toEqual({ lowerMm: 1200, upperMm: 2100 })
    expect(applied.project.views.find((v) => v.id === second.id)!.planViewRange).toEqual(second.planViewRange)
    expect(JSON.stringify(applied.project.existingModel)).toBe(modelBefore)
    expect(applied.patches.length).toBe(1)
  })

  it('refuses a Lower that is not below its Upper and a value that is not a number (#74 §4 criterion 5)', () => {
    const project = newProject()
    const view = viewOf(project)
    const equal = expectRejection(project, intent('view.setPlanViewRange', { viewId: view.id, lowerMm: 2000, upperMm: 2000 }), 'invalid-extent')
    expect(equal.problems[0]!.message).toBe('Lower needs to be below Upper.')
    const blank = expectRejection(project, intent('view.setPlanViewRange', { viewId: view.id, lowerMm: Number.NaN, upperMm: 2600 }), 'invalid-extent')
    expect(blank.problems[0]!.message).toBe('Enter a number.')
  })

  it('starts a new view at the Floor default and never rewrites a range afterwards (#74 §1 criterion 7)', () => {
    const project = newProject()
    const floorId = floorIdOf(project)
    expect(viewOf(project).planViewRange).toEqual({ lowerMm: 0, upperMm: 2600 })
    const limits = expectApplied(project, intent('floor.setLimits', { floorId, lowerMm: -200, upperMm: 2700 })).project
    const [viewId] = source(1)
    const created = expectApplied(limits, intent('view.create', { floorId, name: 'Evening' }, [viewId!])).project
    expect(created.views.find((v) => v.id === viewId)!.planViewRange).toEqual({ lowerMm: -200, upperMm: 2700 })
    // A later change to the Floor limits is a change to the Floor: the ranges people aimed stay aimed.
    const moved = expectApplied(created, intent('floor.setLimits', { floorId, lowerMm: 0, upperMm: 2600 })).project
    expect(moved.views.find((v) => v.id === viewId)!.planViewRange).toEqual({ lowerMm: -200, upperMm: 2700 })
    expect(moved.views.find((v) => v.id === viewOf(project).id)!.planViewRange).toEqual({ lowerMm: 0, upperMm: 2600 })
  })
})
