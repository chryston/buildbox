/**
 * The effective model of one Floor and of one Item Design (#60 criteria 3, 4 and 5).
 *
 * Two fixture sources, because the two things under test come from different places. The
 * issue's worked numbers — `Base 600`, 600 × 400, turned 37° with its Origin at (5150, 4500)
 * — are built from `domain`'s own `rectangleFootprint` in the same shape
 * `placement.test.ts` already uses, so a reader can check them with a calculator. Everything
 * that needs a real Project, cabinet construction included, is read from a committed
 * `fixtures/domain` file and migrated the way the app reads one. `edit`'s test helpers would
 * be the shorter route, and are not available here: `derive` may not import `edit` (#20 §2).
 *
 * Criterion 5's parity is stated as it is meant to hold: the Item Detail's layout is the
 * layout `cabinet`'s engine gives the same `cabinetSceneUnits`, with the shown design the
 * active unit — the scene the cabinet canvas draws today, not a hand-copied projection of it.
 * The same comparison against the legacy fixtures is in
 * `src/test/deriveCabinetItemDetail.test.ts`, the one place allowed to hold the legacy
 * converter and `derive` in a single scope.
 */
import { describe, expect, it } from 'vitest'
import { computeSceneLayout } from '../cabinet'
import { designOrigin, rectangleFootprint } from '../domain'
import type { Floor, GenericItemDesign, ItemDesign, ItemFootprint, PlacedItem, Project } from '../domain'
import { pt } from '../geometry'
import type { ClosedPath, Pt } from '../geometry'
import { canonicalJson } from '../lib'
import {
  AFFINE_IDENTITY,
  affineApply,
  cabinetSceneUnits,
  designOutline,
  effectiveFloor,
  effectiveItemDetail,
  worldPoint,
} from './index'
import { basicProject, referenceProject } from './testing'

const BASIC = basicProject()
const REFERENCE = referenceProject()

/** Two points the same to a nanometre: enough for arithmetic done in a different order. */
const samePoint = (actual: Pt, expected: Pt): void => {
  expect(actual.x).toBeCloseTo(expected.x, 9)
  expect(actual.y).toBeCloseTo(expected.y, 9)
}

// --- The hand-built fixture: the issue's own numbers --------------------------

const FLOOR: Floor = { id: 'floor-1', name: 'Floor 1', planImage: null }

const base600 = (overrides: Partial<GenericItemDesign> = {}): GenericItemDesign => ({
  id: 'design-base',
  kind: 'generic',
  name: 'Base 600',
  footprint: rectangleFootprint(600, 400),
  origin: { x: 300, y: 200 },
  height: 900,
  heightIsTypical: true,
  color: '#3b82f6',
  ...overrides,
})

/** A 600 mm Circle: four quarter arcs, never a polyline (#54 D1, #16). */
const circleFootprint = (): ItemFootprint => ({
  kind: 'preset',
  preset: { kind: 'circle', diameter: 600 },
  centre: { x: 300, y: 300 },
  orientationDeg: 0,
})

const onFloor = (overrides: Partial<PlacedItem> = {}): PlacedItem => ({
  id: 'place-1',
  itemDesignId: 'design-base',
  floorId: 'floor-1',
  translation: { x: 2000, y: 1700 },
  rotationDeg: 0,
  baseElevation: 0,
  ...overrides,
})

/** The issue's #2: `Base 600` turned 37° with its Item Origin at (5150, 4500). */
const turned = onFloor({ id: 'place-2', translation: { x: 5150, y: 4500 }, rotationDeg: 37 })

const projectWith = (
  designs: ItemDesign[],
  placements: PlacedItem[],
  floors: Floor[] = [FLOOR],
): Project => ({
  id: 'project-1',
  meta: { name: 'Derive' },
  preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
  floors,
  views: [{ id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Floor 1', isDefault: true, showPlanImage: true }],
  itemDesigns: designs,
  existingModel: { placedItems: placements, walls: [], wallJunctions: [], openings: [], rooms: [] },
  warningAcknowledgements: [],
})

/** The corners of a closed path, the start included: the points a renderer draws through. */
const corners = (path: ClosedPath): Pt[] => [path.start, ...path.segments.map((segment) => segment.to)]

// --- Criterion 4: the transform, to the issue's own numbers -------------------

describe('effectiveFloor: the Item Footprint in Floor coordinates (#60 criterion 4)', () => {
  const project = projectWith([base600()], [turned])
  const placement = effectiveFloor(project, 1, 'floor-1', null).placements[0]

  it('puts the corner for local (−300, +200) at (4790.05, 4479.18)', () => {
    // The corner is the footprint's own (0, 400): the Origin sits at (300, 200), so that
    // corner is (−300, +200) from it. Pinning the local end is what makes the world number
    // mean what the issue says it means.
    expect(corners(designOutline(base600())).filter((p) => p.x === 0 && p.y === 400)).toHaveLength(1)
    const world = corners(placement.worldPath).filter(
      (p) => Math.abs(p.x - 4790.05) <= 0.01 && Math.abs(p.y - 4479.18) <= 0.01,
    )
    expect(world).toHaveLength(1)
  })

  it('bounds the turned footprint at 719.91 × 680.54', () => {
    expect(placement.worldBounds.w).toBeCloseTo(719.91, 2)
    expect(placement.worldBounds.h).toBeCloseTo(680.54, 2)
    // The local box is the unturned one: the design did not change, only its placement.
    expect(placement.localBounds).toEqual({ x: 0, y: 0, w: 600, h: 400 })
  })

  it('carries the placement itself, not only its shape', () => {
    expect(placement.id).toBe('place-2')
    expect(placement.designId).toBe('design-base')
    expect(placement.kind).toBe('generic')
    expect(placement.label).toBe('Base 600')
    expect(placement.color).toBe('#3b82f6')
    expect(placement.translation).toEqual(pt(5150, 4500))
    expect(placement.rotationDeg).toBe(37)
  })

  it('hands the renderer the same matrix it drew the path with', () => {
    const design = base600()
    const local = designOutline(design)
    const vertices = [local.start, ...local.segments.map((segment) => segment.to)]
    const drawn = [placement.worldPath.start, ...placement.worldPath.segments.map((segment) => segment.to)]
    vertices.forEach((at, index) => samePoint(affineApply(placement.worldTransform, at), drawn[index]))
    // The Item Origin is the one point the placement was built to land on `translation`.
    samePoint(affineApply(placement.worldTransform, designOrigin(design)), pt(5150, 4500))
    // And the points *off* the footprint — 22 mm below it, 22 mm to its left, one outside the
    // box entirely — go through the same matrix, which is what keeps `worldPointOf` and the
    // Item Origin it needs out of the renderer (#60 criterion 6).
    for (const at of [pt(300, 422), pt(-22, 200), pt(700, -50)]) {
      samePoint(affineApply(placement.worldTransform, at), worldPoint(design, turned, at))
    }
  })

  it('keeps a Circle footprint analytic: arcs, never lines (#16)', () => {
    const round = base600({ id: 'design-round', name: 'Round Table', footprint: circleFootprint() })
    const placed = onFloor({ id: 'place-round', itemDesignId: 'design-round', rotationDeg: 37 })
    const [circlePlacement] = effectiveFloor(projectWith([round], [placed]), 1, 'floor-1', null).placements
    const kinds = circlePlacement.worldPath.segments.map((segment) => segment.kind)
    expect(kinds).toEqual(['arc', 'arc', 'arc', 'arc'])
    expect(kinds).not.toContain('line')
  })
})

// --- The Floor: order, colour, the Plan Image, the union box ------------------

describe('effectiveFloor: one Floor of a real Project', () => {
  it('lists its Placed Items in Existing-Model order, and only its own', () => {
    const main = effectiveFloor(BASIC, 1, 'floor-main', null)
    const mezz = effectiveFloor(BASIC, 1, 'floor-mezz', null)
    expect(main.placements.map((p) => p.id)).toEqual(['place-base-left', 'place-base-right'])
    expect(mezz.placements.map((p) => p.id)).toEqual(['place-bed', 'place-chest'])
    expect(main.revision).toBe(1)
    expect(main.floorId).toBe('floor-main')
    expect(main.optionId).toBeNull()
  })

  it('draws a cabinet in the one slate the Plan View uses, and a generic in its own colour', () => {
    const [cabinet] = effectiveFloor(BASIC, 1, 'floor-main', null).placements
    const [bed] = effectiveFloor(BASIC, 1, 'floor-mezz', null).placements
    const bedDesign = BASIC.itemDesigns.find((design) => design.id === 'design-bed-king')
    if (bedDesign === undefined || bedDesign.kind !== 'generic') throw new Error('the fixture lost its bed')
    expect(cabinet.kind).toBe('cabinet')
    expect(cabinet.color).toBe('#475569')
    expect(cabinet.label).toBe('Base Cabinet')
    expect(bed.kind).toBe('generic')
    expect(bed.color).toBe(bedDesign.color)
    expect(bed.label).toBe('King Bed')
  })

  it('turns a calibration into a scale matrix (#56)', () => {
    expect(effectiveFloor(BASIC, 1, 'floor-main', null).planImage).toEqual({
      assetHash: '3f7a9c2e6b1d48f0a5c7e9b2d4f6018c9e3b5a7d1f2c4e6a8b0d9f1c3e5a7b9d',
      widthPx: 2400,
      heightPx: 1600,
      pxToFloor: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 },
      opacity: 1,
    })
  })

  it('keeps an uncalibrated Plan Image, drawn raw (#55)', () => {
    const image = effectiveFloor(BASIC, 1, 'floor-mezz', null).planImage
    expect(image).not.toBeNull()
    expect(image?.assetHash).toBe('9d8c7b6a5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b')
    expect(image?.pxToFloor).toEqual(AFFINE_IDENTITY)
    expect(image?.opacity).toBe(1)
  })

  it('unions every footprint with the Plan Image', () => {
    // One 600 × 400 footprint, unturned, Origin at (2000, 1700): x 1700–2300, y 1500–1900.
    // A 1000 × 500 px image at 0.5 px/mm: x 0–2000, y 0–1000 from the Floor origin.
    const withImage = { ...FLOOR, planImage: { assetHash: 'a'.repeat(64), mediaType: 'image/png' as const, widthPx: 1000, heightPx: 500, pixelsPerMm: 0.5 } }
    const derived = effectiveFloor(projectWith([base600()], [onFloor()], [withImage]), 1, 'floor-1', null)
    expect(derived.bounds).toEqual({ x: 0, y: 0, w: 2300, h: 1900 })
  })

  it('has no bounds at all for a Floor with neither', () => {
    const empty = effectiveFloor(projectWith([base600()], []), 1, 'floor-1', null)
    expect(empty.placements).toEqual([])
    expect(empty.planImage).toBeNull()
    expect(empty.bounds).toBeNull()
    // A Floor that is not in the Project derives an empty one rather than throwing.
    expect(effectiveFloor(BASIC, 1, 'floor-gone', null).bounds).toBeNull()
  })

  it('is a pure function of its arguments, and writes nothing back', () => {
    const before = canonicalJson(BASIC)
    const first = effectiveFloor(BASIC, 7, 'floor-main', null)
    const second = effectiveFloor(BASIC, 7, 'floor-main', null)
    expect(second).toEqual(first)
    // No hidden memoisation: the cache is the only thing that remembers (#60 criterion 2).
    expect(second).not.toBe(first)
    expect(canonicalJson(BASIC)).toBe(before)
  })
})

// --- Criterion 5: the cabinet Item Detail is `cabinet`'s own layout -----------

/**
 * Every cabinet in the fixture Projects, with the Floor it is drawn on: the scene the Item
 * Detail has to reproduce is the one `cabinetSceneUnits` projects for that Floor.
 */
const cabinetCases = [BASIC, REFERENCE].flatMap((project, index) =>
  project.floors.flatMap((floor) => {
    const designIds = [...new Set(cabinetSceneUnits(project, floor.id).map((unit) => unit.id))]
    return designIds.map((designId) => ({
      label: `fixture ${index} · ${floor.name} · ${designId}`,
      project,
      floorId: floor.id,
      designId,
    }))
  }),
)

describe.each(cabinetCases)('effectiveItemDetail: cabinet $label (#60 criterion 5)', ({ project, floorId, designId }) => {
  it('is the very layout computeSceneLayout gives the same cabinetSceneUnits', () => {
    const detail = effectiveItemDetail(project, 1, designId, floorId)
    if (detail.kind !== 'cabinet') throw new Error(`${designId}: expected a cabinet Item Detail`)
    const units = cabinetSceneUnits(project, floorId)
    expect(detail.designId).toBe(designId)
    expect(detail.layout).toEqual(computeSceneLayout(units, designId))
    expect(detail.layout.units).toHaveLength(units.length)
    const shown = detail.layout.units.filter((unit) => unit.isActive)
    expect(shown).toHaveLength(units.filter((unit) => unit.id === designId).length)
    // Not a vacuous comparison: the engine really did lay the cabinet out.
    expect(shown[0].voids.length).toBeGreaterThan(0)
    // The scene box is what the canvas fits itself to, so it has to hold every unit.
    for (const unit of detail.layout.units) {
      expect(detail.layout.boundingBox.x).toBeLessThanOrEqual(unit.x)
      expect(detail.layout.boundingBox.y).toBeLessThanOrEqual(unit.y)
      expect(detail.layout.boundingBox.x + detail.layout.boundingBox.w).toBeGreaterThanOrEqual(unit.x + unit.w)
      expect(detail.layout.boundingBox.y + detail.layout.boundingBox.h).toBeGreaterThanOrEqual(unit.y + unit.h)
    }
  })
})

describe('effectiveItemDetail: whose scene a cabinet is drawn in', () => {
  const designId = 'design-base-cabinet'

  it('draws the whole Floor, as the cabinet canvas does today', () => {
    const detail = effectiveItemDetail(BASIC, 1, designId, 'floor-main')
    if (detail.kind !== 'cabinet') throw new Error('expected a cabinet Item Detail')
    expect(detail.layout.units.map((unit) => unit.unitId)).toEqual([designId, designId])
    // Both placements are this design, so both are the shown one — as they are today.
    expect(detail.layout.units.every((unit) => unit.isActive)).toBe(true)
  })

  it('defaults to Floor 1, the route projectUnits takes (#49)', () => {
    expect(effectiveItemDetail(BASIC, 1, designId)).toEqual(effectiveItemDetail(BASIC, 1, designId, 'floor-main'))
  })

  it('draws the named Floor when the design lives on another', () => {
    const project = structuredClone(BASIC)
    const placed = project.existingModel.placedItems.find((candidate) => candidate.id === 'place-base-left')
    if (placed === undefined) throw new Error('the fixture lost its cabinet')
    placed.floorId = 'floor-mezz'
    const mezz = effectiveItemDetail(project, 1, designId, 'floor-mezz')
    if (mezz.kind !== 'cabinet') throw new Error('expected a cabinet Item Detail')
    expect(mezz.layout.units).toHaveLength(1)
    expect(mezz.layout.units[0].isActive).toBe(true)
    // Floor 1 keeps the other placement, and the default route still reads Floor 1.
    const defaulted = effectiveItemDetail(project, 1, designId)
    if (defaulted.kind !== 'cabinet') throw new Error('expected a cabinet Item Detail')
    expect(defaulted.layout.units).toHaveLength(1)
    expect(defaulted.layout).not.toEqual(mezz.layout)
  })

  it('has an empty scene for a Floor with no cabinets', () => {
    const detail = effectiveItemDetail(BASIC, 1, designId, 'floor-mezz')
    if (detail.kind !== 'cabinet') throw new Error('expected a cabinet Item Detail')
    expect(detail.layout).toEqual({ units: [], boundingBox: { x: 0, y: 0, w: 0, h: 0 } })
  })
})

// --- The generic Item Detail, and the design that is not there ----------------

describe('effectiveItemDetail: a generic design', () => {
  it('is the design as it is stored', () => {
    const design = base600()
    const detail = effectiveItemDetail(projectWith([design], [onFloor()]), 1, 'design-base')
    expect(detail).toEqual({
      kind: 'generic',
      designId: 'design-base',
      footprint: designOutline(design),
      origin: pt(300, 200),
      bounds: { x: 0, y: 0, w: 600, h: 400 },
      label: 'Base 600',
      color: '#3b82f6',
    })
  })

  it('refuses a design that is not in the Project', () => {
    expect(() => effectiveItemDetail(BASIC, 1, 'design-nope')).toThrow('design-nope')
  })
})
