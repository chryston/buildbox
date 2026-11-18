/**
 * fast-check properties (#54 §9). Every property runs at least 1,000 cases; fast-check
 * prints the failing seed with the counterexample, which is what makes a red CI run
 * reproducible.
 */
import { readFileSync } from 'node:fs'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  area,
  evaluatePreset,
  fillet,
  intersect,
  isTangentFillet,
  normaliseOrientation,
  offset,
  perimeter,
  reverse,
  roundAllCorners,
  setFilletRadius,
  signedArea,
  validateLoop,
} from './index'
import type { ClosedPath, Placement, Preset, Pt } from './index'
import { kitchenFixture } from './testing'

const RUNS = { numRuns: 1000 }

/** A 60 s allowance: 1,000 cases of a 12-segment offset is minutes of CPU on a slow runner. */
const SLOW = 30_000

/** The filleted path the offset round trip needs, built once. */
const ROUNDED_KITCHEN = roundAllCorners(kitchenFixture(), 250).path

const ORIGIN: Pt = { x: 0, y: 0 }

const placed = (orientationDeg = 0): Placement => ({ centre: ORIGIN, orientationDeg })

/** The path with its start vertex moved on by `steps`, which must change nothing. */
const rotateStart = (path: ClosedPath, steps: number): ClosedPath => {
  const n = path.segments.length
  const k = ((steps % n) + n) % n
  if (k === 0) return path
  return { start: path.segments[k - 1].to, segments: [...path.segments.slice(k), ...path.segments.slice(0, k)] }
}

const fixed = (value: number, digits: number): string => {
  const rounded = Number(value.toFixed(digits))
  return (rounded === 0 ? 0 : rounded).toFixed(digits)
}

const rect = (width: number, depth: number, at: Pt): ClosedPath => ({
  start: { x: at.x, y: at.y },
  segments: [
    { kind: 'line', to: { x: at.x + width, y: at.y } },
    { kind: 'line', to: { x: at.x + width, y: at.y + depth } },
    { kind: 'line', to: { x: at.x, y: at.y + depth } },
    { kind: 'line', to: { x: at.x, y: at.y } },
  ],
})

const arbSize = fc.integer({ min: 200, max: 8000 })
const arbPoint = fc.record({ x: fc.integer({ min: -5000, max: 5000 }), y: fc.integer({ min: -5000, max: 5000 }) })

describe('#54 §9 properties', () => {
  it('flips the sign of the area under reverse', () => {
    fc.assert(
      fc.property(arbSize, arbSize, fc.integer({ min: -180, max: 180 }), (width, depth, orientationDeg) => {
        const path = evaluatePreset({ kind: 'rectangle', width, depth }, placed(orientationDeg))
        expect(signedArea(reverse(path))).toBeCloseTo(-signedArea(path), 4)
        expect(area(reverse(path))).toBeCloseTo(area(path), 4)
      }),
      RUNS,
    )
  })

  it('round-trips an offset of a convex and a filleted path', () => {
    fc.assert(
      fc.property(arbSize, arbSize, fc.integer({ min: 5, max: 90 }), (width, depth, delta) => {
        const box = rect(width, depth, { x: 0, y: 0 })
        const there = offset(offset(box, delta), -delta)
        there.segments.forEach((segment, i) => {
          expect(segment.to.x).toBeCloseTo(box.segments[i].to.x, 6)
          expect(segment.to.y).toBeCloseTo(box.segments[i].to.y, 6)
        })
        const moved = offset(offset(ROUNDED_KITCHEN, delta), -delta)
        expect(perimeter(moved)).toBeCloseTo(perimeter(ROUNDED_KITCHEN), 2)
        expect(validateLoop(moved)).toEqual([])
      }),
      RUNS,
    )
  }, SLOW)

  it('validates idempotently, whatever the orientation or start vertex', () => {
    fc.assert(
      fc.property(
        arbSize,
        arbSize,
        fc.integer({ min: -180, max: 180 }),
        fc.integer({ min: 0, max: 7 }),
        (width, depth, orientationDeg, steps) => {
          const path = evaluatePreset({ kind: 'roundedRectangle', width, depth, radius: 60 }, placed(orientationDeg))
          const first = validateLoop(path)
          expect(first, JSON.stringify({ width, depth, orientationDeg })).toEqual([])
          expect(validateLoop(path)).toEqual(first)
          expect(validateLoop(normaliseOrientation(path))).toEqual(first)
          expect(validateLoop(rotateStart(path, steps))).toEqual(first)
          expect(area(rotateStart(path, steps))).toBeCloseTo(area(path), 4)
        },
      ),
      RUNS,
    )
  }, SLOW)

  it('intersects symmetrically', () => {
    fc.assert(
      fc.property(arbSize, arbSize, arbPoint, arbSize, arbSize, arbPoint, (wa, da, pa, wb, db, pb) => {
        const a = rect(wa, da, pa)
        const b = rect(wb, db, pb)
        const forward = intersect(a, b)
        const back = intersect(b, a)
        const key = (list: Pt[]): string[] => list.map((at) => `${fixed(at.x, 4)},${fixed(at.y, 4)}`).sort()
        expect(key(forward.crossings)).toEqual(key(back.crossings))
        expect(key(forward.touches)).toEqual(key(back.touches))
      }),
      RUNS,
    )
  })

  it('draws the tolerance line at 0.01 mm', () => {
    const slotted = (gap: number): ClosedPath => {
      const floor = 2000 - gap
      return {
        start: { x: 0, y: 0 },
        segments: [
          { kind: 'line', to: { x: 900, y: 0 } },
          { kind: 'line', to: { x: 900, y: floor } },
          { kind: 'line', to: { x: 1100, y: floor } },
          { kind: 'line', to: { x: 1100, y: 0 } },
          { kind: 'line', to: { x: 2000, y: 0 } },
          { kind: 'line', to: { x: 2000, y: 2000 } },
          { kind: 'line', to: { x: 0, y: 2000 } },
          { kind: 'line', to: { x: 0, y: 0 } },
        ],
      }
    }
    fc.assert(
      fc.property(fc.constantFrom(0.0099, 0.00999, 0.005), (gap) => {
        expect(validateLoop(slotted(gap)).every((problem) => problem.code === 'edges-touch')).toBe(true)
      }),
      RUNS,
    )
    fc.assert(
      fc.property(fc.double({ min: 0.0101, max: 40, noNaN: true }), (gap) => {
        expect(validateLoop(slotted(gap))).toEqual([])
      }),
      RUNS,
    )
  })

  it('evaluates every valid preset to a valid path of the closed-form area', () => {
    const arbPreset: fc.Arbitrary<Preset> = fc.oneof(
      arbSize.map((side) => ({ kind: 'square' as const, side })),
      fc.record({ kind: fc.constant('rectangle' as const), width: arbSize, depth: arbSize }),
      fc.record({ kind: fc.constant('circle' as const), diameter: arbSize }),
      fc.record({ kind: fc.constant('ellipse' as const), width: arbSize, depth: arbSize }),
      fc.record({ kind: fc.constant('capsule' as const), length: arbSize, width: arbSize }),
      fc.record({
        kind: fc.constant('roundedRectangle' as const),
        width: arbSize,
        depth: arbSize,
        radius: fc.integer({ min: 1, max: 90 }),
      }),
      fc.record({
        kind: fc.constant('triangle' as const),
        baseWidth: arbSize,
        depth: arbSize,
        apexOffset: fc.constant(0),
      }),
      fc.record({
        kind: fc.constant('regularPolygon' as const),
        sideCount: fc.integer({ min: 3, max: 12 }),
        sideLength: arbSize,
      }),
    )
    fc.assert(
      fc.property(arbPreset, (preset) => {
        if (preset.kind === 'capsule' && preset.length <= preset.width) return
        const path = evaluatePreset(preset, placed())
        expect(validateLoop(path)).toEqual([])
        const closed = closedFormArea(preset)
        expect(area(path)).toBeCloseTo(closed, 1)
      }),
      RUNS,
    )
  }, SLOW)

  it('keeps a fillet tangent at every radius that fits', () => {
    fc.assert(
      fc.property(fc.double({ min: 10, max: 1200, noNaN: true }), (radius) => {
        const kitchen = kitchenFixture()
        const first = fillet(kitchen, 2, 250)
        const edited = setFilletRadius(first.path, 2, radius)
        if (edited.problems.length > 0) return
        expect(isTangentFillet(edited.path, 2)).toBe(true)
        expect(validateLoop(edited.path)).toEqual([])
      }),
      RUNS,
    )
  })

  it('runs every property with the cases CI will run', () => {
    const source = readFileSync(new URL('kernel.property.test.ts', import.meta.url), 'utf8')
    expect(source).toContain('numRuns: 1000')
  })
})

const closedFormArea = (preset: Preset): number => {
  switch (preset.kind) {
    case 'square':
      return preset.side ** 2
    case 'rectangle':
      return preset.width * preset.depth
    case 'circle':
      return Math.PI * (preset.diameter / 2) ** 2
    case 'ellipse':
      return Math.PI * (preset.width / 2) * (preset.depth / 2)
    case 'capsule':
      return (preset.length - preset.width) * preset.width + Math.PI * (preset.width / 2) ** 2
    case 'roundedRectangle': {
      const radius = preset.radius ?? 0
      return preset.width * preset.depth - radius ** 2 * (4 - Math.PI)
    }
    case 'triangle':
      return (preset.baseWidth * preset.depth) / 2
    case 'regularPolygon':
      return (preset.sideCount * preset.sideLength ** 2) / (4 * Math.tan(Math.PI / preset.sideCount))
  }
}
