/**
 * The one reading of Item Origin, rotation and Item Footprint (#57 criteria 3, 5, 7 and
 * behaviours 31–33), plus the property that makes the Item Origin rule more than a fixture:
 * moving the Origin rewrites every translation so that nothing the user can see moves.
 *
 * The numbers are the issue's worked example — `Base 600`, 600 × 400, #1 unturned at
 * (2000, 1700) and #2 turned 37° at (5150, 4500) — because a reader should be able to check
 * them against the issue with a calculator.
 */
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { rectangleFootprint } from '../domain'
import type { GenericItemDesign, PlacedItem } from '../domain'
import type { ClosedPath, Pt, SnapKind } from '../geometry'
import { pt } from '../geometry'
import {
  designDefaultOrigin,
  floorBoundsSize,
  designOutline,
  localPointOf,
  normaliseRotation,
  originCandidates,
  originMoveTranslations,
  originSnapCandidates,
  pathOrigin,
  placementContext,
  resolveSnap,
  worldPoint,
} from './index'

const RUNS = { numRuns: 1000 }

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

const onFloor = (overrides: Partial<PlacedItem> = {}): PlacedItem => ({
  id: 'place-1',
  itemDesignId: 'design-base',
  floorId: 'floor-1',
  translation: { x: 2000, y: 1700 },
  rotationDeg: 0,
  baseElevation: 0,
  ...overrides,
})

/** The issue's #2: the same design turned 37° with its Origin at (5150, 4500). */
const turned = onFloor({ id: 'place-2', translation: { x: 5150, y: 4500 }, rotationDeg: 37 })

/** The four footprint corners, in footprint-local millimetres. */
const localCorners = (design: GenericItemDesign): Pt[] =>
  designOutline(design).segments.map((segment) => segment.to)

describe('designOutline and pathOrigin', () => {
  it('is a closed rectangle from the design size, starting at the local origin', () => {
    const path = designOutline(base600())
    expect(path.segments.map((segment) => segment.to)).toEqual([
      pt(600, 0),
      pt(600, 400),
      pt(0, 400),
      pt(0, 0),
    ])
  })

  it('takes a non-rectangular footprint\'s origin from its local bounds centre (#57 D4)', () => {
    // An L: 600 × 400 with the top-right 300 × 200 taken out. Its centre of bounds is
    // (300, 200); its centre of area is not, and the difference is the point of D4.
    const lShape: ClosedPath = {
      start: pt(0, 0),
      segments: [
        { kind: 'line', to: pt(300, 0) },
        { kind: 'line', to: pt(300, 200) },
        { kind: 'line', to: pt(600, 200) },
        { kind: 'line', to: pt(600, 400) },
        { kind: 'line', to: pt(0, 400) },
        { kind: 'line', to: pt(0, 0) },
      ],
    }
    expect(pathOrigin(lShape)).toEqual({ x: 300, y: 200 })
    expect(designDefaultOrigin(base600())).toEqual({ x: 300, y: 200 })
  })
})

describe('placementTransform and worldPoint', () => {
  it('puts the Item Origin on the placement position, whatever the turn (#57 criterion 7)', () => {
    const design = base600()
    for (const rotationDeg of [0, 37, 90, 180, 270, 359.9]) {
      const placed = onFloor({ rotationDeg })
      expect(worldPoint(design, placed, design.origin).x).toBeCloseTo(placed.translation.x, 6)
      expect(worldPoint(design, placed, design.origin).y).toBeCloseTo(placed.translation.y, 6)
    }
  })

  it('turns clockwise with +Y down', () => {
    // The footprint's top-left corner, a quarter turn clockwise about the centre, lands on
    // the top-right: (0,0) → (600,0) in world offsets from the Origin.
    const design = base600()
    const quarter = worldPoint(design, onFloor({ rotationDeg: 90 }), pt(0, 0))
    expect(quarter.x).toBeCloseTo(2000 + 200, 6)
    expect(quarter.y).toBeCloseTo(1700 - 300, 6)
  })

  it('round-trips a Floor point back to footprint-local coordinates', () => {
    const design = base600()
    const placed = turned
    const context = placementContext(design, placed)
    for (const corner of localCorners(design)) {
      const back = localPointOf(context, worldPoint(design, placed, corner))
      expect(back.x).toBeCloseTo(corner.x, 6)
      expect(back.y).toBeCloseTo(corner.y, 6)
    }
  })
})

describe('floorBoundsSize', () => {
  it('reads the design size unturned, and the turned box once the item is on its side', () => {
    const design = base600()
    expect(floorBoundsSize(design, onFloor())).toEqual({ width: 600, depth: 400 })
    expect(floorBoundsSize(design, onFloor({ rotationDeg: 90 }))).toEqual({ width: 400, depth: 600 })
    expect(floorBoundsSize(design, onFloor({ rotationDeg: 180 }))).toEqual({ width: 600, depth: 400 })
  })

  it('gives the 720 × 681 the inspector shows for the 37° example', () => {
    const box = floorBoundsSize(base600(), turned)
    expect(box.width).toBeCloseTo(719.91, 1)
    expect(box.depth).toBeCloseTo(680.54, 1)
  })
})

describe('originMoveTranslations', () => {
  it('moves each placement by the turned Origin delta (#57 criterion 5)', () => {
    const design = base600()
    const moves = originMoveTranslations([onFloor(), turned], design.origin, { x: 0, y: 400 })
    expect(moves).toHaveLength(2)
    const [first, second] = moves
    expect(first!.translation.x).toBeCloseTo(1700, 6)
    expect(first!.translation.y).toBeCloseTo(1900, 6)
    expect(second!.translation.x).toBeCloseTo(4790.05, 1)
    expect(second!.translation.y).toBeCloseTo(4479.18, 1)
  })

  it('leaves the world exactly where it was, for any footprint, Origin and turn', () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.double({ min: 10, max: 4000, noNaN: true }),
          depth: fc.double({ min: 10, max: 4000, noNaN: true }),
          originX: fc.double({ min: 0, max: 1, noNaN: true }),
          originY: fc.double({ min: 0, max: 1, noNaN: true }),
          nextX: fc.double({ min: 0, max: 1, noNaN: true }),
          nextY: fc.double({ min: 0, max: 1, noNaN: true }),
          rotationDeg: fc.double({ min: -720, max: 720, noNaN: true }),
          x: fc.double({ min: -5000, max: 20000, noNaN: true }),
          y: fc.double({ min: -5000, max: 20000, noNaN: true }),
        }),
        (spec) => {
          const design = base600({
            footprint: rectangleFootprint(spec.width, spec.depth),
            origin: { x: spec.originX * spec.width, y: spec.originY * spec.depth },
          })
          const placed = onFloor({ rotationDeg: spec.rotationDeg, translation: { x: spec.x, y: spec.y } })
          const to = { x: spec.nextX * spec.width, y: spec.nextY * spec.depth }
          const [move] = originMoveTranslations([placed], design.origin, to)
          const moved = { ...design, origin: to }
          const movedPlacement = { ...placed, translation: move!.translation }
          for (const corner of localCorners(design)) {
            const before = worldPoint(design, placed, corner)
            const after = worldPoint(moved, movedPlacement, corner)
            expect(Math.abs(after.x - before.x)).toBeLessThan(0.01)
            expect(Math.abs(after.y - before.y)).toBeLessThan(0.01)
          }
        },
      ),
      RUNS,
    )
  })
})

describe('originCandidates', () => {
  it('offers the corners and edge midpoints, and picks the nearest within tolerance', () => {
    const candidates = originCandidates(base600())
    expect(candidates).toEqual(
      expect.arrayContaining([
        pt(0, 0), pt(600, 0), pt(600, 400), pt(0, 400),
        pt(300, 0), pt(600, 200), pt(300, 400), pt(0, 200),
        pt(300, 200),
      ]),
    )
    // 12 CSS px at 2 mm per pixel is 24 mm of reach; the bottom-left corner is 10 mm away.
    // #59 routes the pick through the same resolver every tool uses, so the reach is spelled
    // in pixels and the candidates carry the kinds the resolver ranks them by.
    const picks = originSnapCandidates(base600())
    const kinds = new Set<SnapKind>(['endpoint', 'midpoint', 'centre'])
    expect(resolveSnap(picks, pt(0, 410), 0.5, kinds)?.point).toEqual(pt(0, 400))
    expect(resolveSnap(picks, pt(120, 410), 0.5, kinds)).toBeNull()
  })
})

describe('normaliseRotation', () => {
  it('keeps one turn, in the direction the validator asks for', () => {
    expect(normaliseRotation(350 + 90)).toBe(80)
    expect(normaliseRotation(10 - 90)).toBe(280)
    expect(normaliseRotation(37.5)).toBe(37.5)
    expect(normaliseRotation(360)).toBe(0)
    expect(normaliseRotation(-360)).toBe(0)
  })
})
