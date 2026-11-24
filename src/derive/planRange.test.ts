/**
 * The Plan View Range classification (#74 §3).
 *
 * Two things are easy to get wrong in opposite directions, and the file is built around them. The
 * first is a boundary: a cabinet whose sole sits exactly on the upper limit must be Above range and
 * not In range, because a drawing that shows a sliver of it is lying about the model — so every
 * boundary case is asserted at the exact value and at a hundredth of a millimetre either side of it.
 * The second is a range that reaches further than drawing: the classification must say nothing about
 * whether a thing exists, so it is checked to answer for every entity of the Floor, including the
 * ones a Design Option only proposes and the ones a demolition is about to remove.
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import layersFixture from '../../fixtures/domain/v9/layers.json?raw'
import type { ItemDesign, PlanViewRange, Project, Wall } from '../domain'
import { designHeight } from '../domain'
import { effectiveModel } from './index'
import { RANGE_RANK, openingExtent, placementExtent, rangeClass, rangeClasses, wallExtent } from './index'

const base = (JSON.parse(layersFixture) as { project: Project }).project
const FLOOR = 'seed-001'

const RANGE: PlanViewRange = { lowerMm: 0, upperMm: 1200 }

/** One generic Item Design of a given height: enough for a Placed Item to stand on. */
const box = (height: number, id = 'design-box'): ItemDesign => ({
  id,
  kind: 'generic',
  name: 'Box',
  footprint: {
    kind: 'preset',
    preset: { kind: 'rectangle', width: 600, depth: 600 },
    centre: { x: 300, y: 300 },
    orientationDeg: 0,
  },
  origin: { x: 300, y: 300 },
  height,
  heightIsTypical: false,
  color: '#b9b9c2',
})

/** The fixture's content with the Vertical Extents this file reasons about, in the issue's own numbers. */
const scene: Project = {
  ...base,
  // The two Designs the issue names, so the extents below are the issue's own and not the fixture's.
  itemDesigns: [...base.itemDesigns, box(700, 'design-wall-cabinet'), box(100, 'design-sump')],
  existingModel: {
    ...base.existingModel,
    // W-1 to W-4: a full-height Wall from the Floor structural level to the soffit.
    walls: base.existingModel.walls.map((wall) => ({ ...wall, baseElevation: 0, height: 2600 })),
    // WND-1: a window from 900 to 2100. The doors keep their sill at the floor.
    openings: base.existingModel.openings.map((opening, index) =>
      index === 0 ? { ...opening, kind: 'window' as const, sill: 900, head: 2100 } : opening,
    ),
    // A wall cabinet at 1500, a sump box below the Floor Datum, everything else on the Floor.
    placedItems: base.existingModel.placedItems.map((placed, index) => ({
      ...placed,
      itemDesignId: index === 0 ? 'design-wall-cabinet' : index === 1 ? 'design-sump' : placed.itemDesignId,
      baseElevation: index === 0 ? 1500 : index === 1 ? -150 : 0,
    })),
  },
}

const model = effectiveModel(scene, FLOOR, null)
const designs = (): ItemDesign[] => scene.itemDesigns
const placedOf = (index: number): string => model.placedItems[index]!.entity.id

describe('the Vertical Extent of each kind (#74 §1)', () => {
  it('is the two elevations a Wall occupies', () => {
    expect(wallExtent({ ...model.walls[0]!.entity, baseElevation: 0, height: 2600 })).toEqual({ lo: 0, hi: 2600 })
    // A Wall built on a mezzanine starts where it is built, not at the Datum.
    expect(wallExtent({ ...model.walls[0]!.entity, baseElevation: 2600, height: 2400 })).toEqual({ lo: 2600, hi: 5000 })
  })

  it('is the sill and the head of an Opening, which are already absolute', () => {
    expect(openingExtent({ ...model.openings[0]!.entity, sill: 900, head: 2100 })).toEqual({ lo: 900, hi: 2100 })
  })

  it('is the standing height of a Placed Item read through its Item Design', () => {
    const placed = scene.existingModel.placedItems[0]!
    // The record stores no height of its own — that belongs to the Design — so this is the only place
    // the two are ever multiplied out (#74 §1).
    expect(placed).not.toHaveProperty('height')
    expect(placementExtent(box(860), { ...placed, baseElevation: 0 })).toEqual({ lo: 0, hi: 860 })
    expect(placementExtent(box(700), { ...placed, baseElevation: 1500 })).toEqual({ lo: 1500, hi: 2200 })
    // A cabinet Design carries its height in its construction settings, which is what `designHeight`
    // reads; the extent does not care which of the two kinds it is.
    const cabinet = base.itemDesigns.find((each) => each.kind === 'cabinet')!
    const standing = base.existingModel.placedItems.find((each) => each.itemDesignId === cabinet.id)
    if (standing === undefined) throw new Error('the fixture must place a cabinet')
    expect(placementExtent(cabinet, standing)).toEqual({
      lo: standing.baseElevation,
      hi: standing.baseElevation + designHeight(cabinet),
    })
  })
})

describe('the classification of one extent (#74 §3)', () => {
  it('calls an extent that intersects the range In range', () => {
    expect(rangeClass({ lo: 0, hi: 860 }, RANGE)).toBe('in')
    expect(rangeClass({ lo: -150, hi: 2600 }, RANGE)).toBe('in')
    expect(rangeClass({ lo: 900, hi: 2100 }, RANGE)).toBe('in')
  })

  it('calls an extent that starts at or over the upper limit Above range', () => {
    expect(rangeClass({ lo: 1200, hi: 2000 }, RANGE)).toBe('above')
    expect(rangeClass({ lo: 1500, hi: 2200 }, RANGE)).toBe('above')
    expect(rangeClass({ lo: 3000, hi: 4000 }, RANGE)).toBe('above')
  })

  it('calls an extent that ends at or under the lower limit Below range', () => {
    expect(rangeClass({ lo: -150, hi: 0 }, RANGE)).toBe('below')
    expect(rangeClass({ lo: -150, hi: -50 }, RANGE)).toBe('below')
    expect(rangeClass({ lo: -5000, hi: -4100 }, { lowerMm: -4000, upperMm: 0 })).toBe('below')
  })

  it('never calls a kind with no extent anything but In range', () => {
    // A Room is a floor area and an Annotation is a mark on the sheet: there is nothing to compare,
    // and a range that dropped one would be a range hiding an entity.
    expect(rangeClass(null, RANGE)).toBe('in')
    expect(rangeClass(null, { lowerMm: 10000, upperMm: 10100 })).toBe('in')
  })

  // Criterion 2, and the sentence under it: touching is not an intersection.
  it('moves at the boundary the way the issue’s own cabinet does', () => {
    const cabinet = { lo: 1500, hi: 2200 }
    expect(rangeClass(cabinet, { lowerMm: 0, upperMm: 1500 })).toBe('above')
    expect(rangeClass(cabinet, { lowerMm: 0, upperMm: 1510 })).toBe('in')
    // The hundredth of a millimetre the geometry module measures with: within it a value counts as
    // touching, and so is still not In range.
    expect(rangeClass(cabinet, { lowerMm: 0, upperMm: 1500.005 })).toBe('above')
    expect(rangeClass(cabinet, { lowerMm: 0, upperMm: 1500.02 })).toBe('in')
    // The same at the lower limit, where the entity is the sump box and the limit is the Floor.
    const sump = { lo: -150, hi: 0 }
    expect(rangeClass(sump, { lowerMm: 0, upperMm: 1200 })).toBe('below')
    expect(rangeClass(sump, { lowerMm: -0.005, upperMm: 1200 })).toBe('below')
    expect(rangeClass(sump, { lowerMm: -0.02, upperMm: 1200 })).toBe('in')
    // Only the top of an extent is ever compared with the lower limit, so a thing that starts a hair
    // above the Floor is In range like anything else standing on it.
    expect(rangeClass({ lo: 0.005, hi: 500 }, RANGE)).toBe('in')
  })

  it('answers exactly one class, whatever the extent and whatever the range', () => {
    const extent = fc.record({ lo: fc.integer({ min: -4000, max: 6000 }), hi: fc.integer({ min: -4000, max: 6000 }) })
    const range = fc.record({
      lowerMm: fc.integer({ min: -4000, max: 6000 }),
      upperMm: fc.integer({ min: -4000, max: 6000 }),
    })
    fc.assert(
      fc.property(extent, range, (each, viewRange) => {
        const bottom = Math.min(each.lo, each.hi)
        const top = Math.max(each.lo, each.hi)
        const lower = Math.min(viewRange.lowerMm, viewRange.upperMm)
        const upper = Math.max(viewRange.lowerMm, viewRange.upperMm)
        // One answer, and it is the pair of comparisons the issue states — never both, and never a
        // fourth thing.
        expect(rangeClass({ lo: bottom, hi: top }, { lowerMm: lower, upperMm: upper })).toBe(
          bottom >= upper - 0.01 ? 'above' : top <= lower + 0.01 ? 'below' : 'in',
        )
        expect(RANGE_RANK[rangeClass({ lo: bottom, hi: top }, { lowerMm: lower, upperMm: upper })]).toBeTypeOf('number')
      }),
      { numRuns: 500 },
    )
  })

  it('never says Above or Below for an extent that runs through the range', () => {
    fc.assert(
      fc.property(fc.integer({ min: -4000, max: 4000 }), fc.integer({ min: 200, max: 4000 }), (bottom, up) => {
        // An extent that covers the range from under its lower limit to over its upper one is the Wall
        // in every Plan View there is.
        expect(rangeClass({ lo: bottom - 100, hi: bottom + up }, { lowerMm: bottom + 1, upperMm: bottom + up - 1 })).toBe(
          'in',
        )
      }),
      { numRuns: 500 },
    )
  })
})

describe('the classification of a whole Floor (#74 §3)', () => {
  it('answers for every Wall, Opening and Placed Item, and for nothing that lies flat', () => {
    const classes = rangeClasses(model, designs(), RANGE)
    for (const { entity } of model.walls) expect(classes.has(entity.id)).toBe(true)
    for (const { entity } of model.openings) expect(classes.has(entity.id)).toBe(true)
    for (const { entity } of model.placedItems) expect(classes.has(entity.id)).toBe(true)
    // A Room has no Vertical Extent, so it is absent from the map and its reader says In range.
    for (const { entity } of model.rooms) expect(classes.has(entity.id)).toBe(false)
    // The lookup the drawing performs: absent means In range, never a hole in the paint.
    expect(classes.get(model.rooms[0]!.entity.id) ?? 'in').toBe('in')
  })

  it('reads the issue’s own scene the way the issue says it reads', () => {
    const classes = rangeClasses(model, designs(), RANGE)
    // W-1 to W-4 and the window: In range.
    for (const { entity } of model.walls) expect(classes.get(entity.id)).toBe('in')
    expect(classes.get(model.openings[0]!.entity.id)).toBe('in')
    // The cabinet at 1500 is over a 1200 range, the sump box under the Floor is under it, and the
    // things standing on the Floor are in it.
    expect(classes.get(placedOf(0))).toBe('above')
    expect(classes.get(placedOf(1))).toBe('below')
    for (const { entity } of model.placedItems.slice(2)) expect(classes.get(entity.id)).toBe('in')
  })

  it('classifies what a Design Option proposes by the extent it will have', () => {
    const existing = scene.existingModel.walls[1]!
    const proposed: Wall = { ...scene.existingModel.walls[0]!, id: 'proposed-wall', ref: 'W-9', baseElevation: 2200, height: 400 }
    const withOption: Project = {
      ...scene,
      designOptions: [
        {
          id: 'option-1',
          name: 'A clerestory',
          demolishedIds: [existing.id],
          proposed: { walls: [proposed], wallJunctions: [], openings: [], rooms: [], beams: [], placedItems: [] },
        },
      ],
    }
    const classes = rangeClasses(effectiveModel(withOption, FLOOR, 'option-1'), scene.itemDesigns, RANGE)
    // The proposed clerestory is Above range on its own extent, and the demolished Wall is still
    // classified — the Renovation Display draws it, so the range has an opinion about it too.
    expect(classes.get('proposed-wall')).toBe('above')
    expect(classes.get(existing.id)).toBe('in')
  })

  it('leaves a Placed Item with no Item Design to the In range a Room gets', () => {
    const orphan = { ...scene.existingModel.placedItems[0]!, id: 'orphan', itemDesignId: 'no-such-design' }
    const broken: Project = { ...scene, existingModel: { ...scene.existingModel, placedItems: [orphan] } }
    expect(rangeClasses(effectiveModel(broken, FLOOR, null), scene.itemDesigns, RANGE).get('orphan')).toBe('in')
  })
})
