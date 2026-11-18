/**
 * Reordering Floors changes no geometry (#56 criterion 2, and criterion 4's elevation half).
 *
 * #25 makes the Floor order a display order and nothing more, which is easy to say and easy
 * to break: the tempting implementation sorts Items by Floor index, or re-derives an
 * elevation from "which Floor am I on". So the assertion here is deliberately the harshest
 * one available — the canonical JSON of every Floor and every Placed Item, byte for byte,
 * before and after the reorder, with only the array order allowed to differ. Canonical JSON
 * is what the package is hashed from (#13), so byte-identity here is the same equality the
 * backup round trip is judged by.
 */
import { describe, expect, it } from 'vitest'
import type { Floor, PlacedItem, Project } from '../domain'
import { canonicalJson } from '../lib'
import { basicProject, expectApplied, expectRejection, expectRoundTrip, idSource, intent, newProject } from './testing'

/** The same records, in an order that does not depend on the Floor array's order. */
const byId = <T extends { id: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

const geometry = (project: Project): string[] =>
  byId(project.existingModel.placedItems).map((item) =>
    canonicalJson({
      translation: item.translation,
      rotationDeg: item.rotationDeg,
      baseElevation: item.baseElevation,
    }),
  )

/** Every Floor with its Plan Image and limits, keyed by nothing: order-independent content. */
const floorContents = (project: Project): string[] =>
  byId(project.floors).map((floor) => canonicalJson(floor))

const placedOn = (project: Project, floorId: string): PlacedItem[] =>
  project.existingModel.placedItems.filter((item) => item.floorId === floorId)

/** The Project's Placed Items, spread over both Floors, each standing on its own Floor Datum. */
function itemsOnEveryFloor(): Project {
  const project = basicProject()
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      placedItems: project.existingModel.placedItems.map((item, index) => ({
        ...item,
        floorId: project.floors[index % project.floors.length]!.id,
        translation: { x: 1000, y: 1000 },
        baseElevation: 0,
      })),
    },
  }
}

describe('reordering Floors (#56 criterion 2)', () => {
  it('changes the Floor order and nothing else', () => {
    const project = itemsOnEveryFloor()
    const before = project.floors.map((floor) => floor.id)
    expect(before).toHaveLength(2)

    const result = expectRoundTrip(project, intent('floor.reorder', { floorId: before[0]!, toIndex: 1 }))
    const after = result.project.floors.map((floor) => floor.id)

    expect(after).toEqual([before[1]!, before[0]!])
    expect(floorContents(result.project)).toEqual(floorContents(project))
    expect(geometry(result.project)).toEqual(geometry(project))
  })

  it('leaves every Placed Item byte-identical, including the ones on the moved Floor', () => {
    const project = itemsOnEveryFloor()
    const moved = project.floors[0]!
    const itemsOnMovedFloor = byId(placedOn(project, moved.id)).map(canonicalJson)

    const result = expectApplied(project, intent('floor.reorder', { floorId: moved.id, toIndex: 1 }))

    expect(byId(placedOn(result.project, moved.id)).map(canonicalJson)).toEqual(itemsOnMovedFloor)
    expect(canonicalJson(byId(result.project.existingModel.placedItems)))
      .toBe(canonicalJson(byId(project.existingModel.placedItems)))
  })

  it('is the only difference: the same Project with the Floors sorted is unchanged', () => {
    const project = itemsOnEveryFloor()
    const sorted = (candidate: Project): Project => ({ ...candidate, floors: byId(candidate.floors) })
    const result = expectApplied(project, intent('floor.reorder', { floorId: project.floors[0]!.id, toIndex: 1 }))

    expect(canonicalJson(sorted(result.project))).toBe(canonicalJson(sorted(project)))
    // And the order really did change, or the test above would pass on a no-op handler.
    expect(canonicalJson(result.project)).not.toBe(canonicalJson(project))
  })

  it('clamps a position past the end to the end, and refuses one already held', () => {
    const project = itemsOnEveryFloor()
    // Handlers are total (#47): the UI never offers an impossible position, so an absurd
    // one is read as "as far that way as it goes" rather than throwing mid-gesture.
    const far = expectApplied(project, intent('floor.reorder', { floorId: project.floors[0]!.id, toIndex: 9 }))
    expect(far.project.floors.map((floor) => floor.id)).toEqual([project.floors[1]!.id, project.floors[0]!.id])
    expect(geometry(far.project)).toEqual(geometry(project))
    // Clamped back to where the Floor already stands: no Edit Transaction at all.
    expectRejection(project, intent('floor.reorder', { floorId: project.floors[0]!.id, toIndex: -4 }), 'no-change')
  })
})

describe('the Floor Datum on every Floor (#56 criterion 4)', () => {
  it('keeps a base elevation of 0 at 0 through a reorder', () => {
    const project = itemsOnEveryFloor()
    const result = expectApplied(project, intent('floor.reorder', { floorId: project.floors[0]!.id, toIndex: 1 }))
    expect(result.project.existingModel.placedItems.map((item) => item.baseElevation))
      .toEqual(project.existingModel.placedItems.map(() => 0))
  })

  it('keeps a base elevation of 0 at 0 through a duplication, on new IDs', () => {
    const project = itemsOnEveryFloor()
    const source = project.floors[1]!
    const items = placedOn(project, source.id)
    expect(items.length).toBeGreaterThan(0)
    const ids = idSource('dup')(2 + items.length)

    const result = expectApplied(
      project,
      intent(
        'floor.duplicate',
        { floorId: source.id, name: 'Level 2 copy', toIndex: 2, placedItemIds: items.map((item) => item.id), includePlanImage: false },
        ids,
      ),
    )

    const copy = result.project.floors.find((floor: Floor) => floor.name === 'Level 2 copy')
    expect(copy).toBeDefined()
    const copied = placedOn(result.project, copy!.id)
    expect(copied.map((item) => item.baseElevation)).toEqual(items.map(() => 0))
    // New IDs for the copies, the same Item Design references (#56 criterion 10).
    expect(copied.map((item) => item.id).sort()).toEqual(ids.slice(2).sort())
    expect(copied.map((item) => item.itemDesignId).sort())
      .toEqual(items.map((item) => item.itemDesignId).sort())
    // The source Floor still has its own items, untouched.
    expect(byId(placedOn(result.project, source.id)).map(canonicalJson))
      .toEqual(byId(items).map(canonicalJson))
  })

  it('accepts a negative lower limit', () => {
    const project = newProject()
    const result = expectApplied(
      project,
      intent('floor.setLimits', { floorId: project.floors[0]!.id, lowerMm: -300, upperMm: null }),
    )
    expect(result.project.floors[0]!.limits).toEqual({ lowerMm: -300 })
  })
})
