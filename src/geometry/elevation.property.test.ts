/**
 * fast-check properties for the Elevation View's band (#75 §4, §Verification).
 *
 * The issue states its projection criteria for a line at any angle, so the tests cannot be a handful
 * of chosen angles: these run the frame and the projection over arbitrary lines, sides, depths and
 * shapes, and hold to the three things that must be true of all of them — the pair `(s, d)` is a
 * property of the world and the view together and not of where the world happens to sit, the band is
 * exactly the closed rectangle the issue writes down, and a projection never reports a span outside
 * the view.
 */
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { elevationCoords, elevationFrame, insideElevationBand, projectElevationOutline, wallBodyOutline } from './index'
import type { ElevationLine, ElevationSide, Pt } from './index'

const RUNS = { numRuns: 1000 }

/** Millimetre coordinates the scene could plausibly hold, without the float noise of 1e12. */
const mm = fc.integer({ min: -20000, max: 20000 })
const positiveMm = fc.integer({ min: 1, max: 20000 })
const sides: ElevationSide[] = ['left', 'right']
const side = fc.constantFrom(...sides)

/** A line of some length: an arbitrary start and an arbitrary offset that is never zero. */
const lineArb: fc.Arbitrary<ElevationLine> = fc
  .tuple(mm, mm, fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: -5000, max: 5000 }))
  .filter(([, , dx, dy]) => dx !== 0 || dy !== 0)
  .map(([x, y, dx, dy]) => ({ start: { x, y }, end: { x: x + dx, y: y + dy } }))

const pointArb: fc.Arbitrary<Pt> = fc.tuple(mm, mm).map(([x, y]) => ({ x, y }))

/** A line long enough that a millimetre of slack at each end still leaves room inside it. */
const longLineArb: fc.Arbitrary<ElevationLine> = fc
  .tuple(mm, mm, fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: -5000, max: 5000 }))
  .filter(([, , dx, dy]) => Math.hypot(dx, dy) >= 1000)
  .map(([x, y, dx, dy]) => ({ start: { x, y }, end: { x: x + dx, y: y + dy } }))

const deepMm = fc.integer({ min: 1000, max: 20000 })

const rotate = (at: Pt, about: Pt, deg: number): Pt => {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = at.x - about.x
  const dy = at.y - about.y
  return { x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos }
}

const turn = (line: ElevationLine, about: Pt, deg: number): ElevationLine => ({
  start: rotate(line.start, about, deg),
  end: rotate(line.end, about, deg),
})

describe('the frame is the world’s, not the axes’', () => {
  it('reads the same (s, d) for a place, a line and a world moved together', () => {
    fc.assert(
      fc.property(lineArb, side, positiveMm, pointArb, mm, mm, (line, s, depth, at, dx, dy) => {
        const before = elevationCoords(elevationFrame(line, s, depth), at)
        const moved = elevationCoords(
          elevationFrame({ start: { x: line.start.x + dx, y: line.start.y + dy }, end: { x: line.end.x + dx, y: line.end.y + dy } }, s, depth),
          { x: at.x + dx, y: at.y + dy },
        )
        expect(Math.abs(moved.s - before.s)).toBeLessThan(1e-6)
        expect(Math.abs(moved.d - before.d)).toBeLessThan(1e-6)
      }),
      RUNS,
    )
  })

  it('reads the same (s, d) for a place, a line and a world turned together', () => {
    fc.assert(
      fc.property(lineArb, side, positiveMm, pointArb, fc.integer({ min: 0, max: 359 }), mm, mm, (line, s, depth, at, deg, px, py) => {
        const before = elevationCoords(elevationFrame(line, s, depth), at)
        const pivot = { x: px, y: py }
        const after = elevationCoords(elevationFrame(turn(line, pivot, deg), s, depth), rotate(at, pivot, deg))
        expect(Math.abs(after.s - before.s)).toBeLessThan(1e-6)
        expect(Math.abs(after.d - before.d)).toBeLessThan(1e-6)
      }),
      RUNS,
    )
  })

  it('flips the distance and nothing else when the direction is flipped', () => {
    fc.assert(
      fc.property(lineArb, positiveMm, pointArb, (line, depth, at) => {
        const left = elevationCoords(elevationFrame(line, 'left', depth), at)
        const right = elevationCoords(elevationFrame(line, 'right', depth), at)
        expect(Math.abs(left.s - right.s)).toBeLessThan(1e-9)
        expect(Math.abs(left.d + right.d)).toBeLessThan(1e-9)
      }),
      RUNS,
    )
  })
})

describe('the band is the closed rectangle the issue writes', () => {
  it('reads back the (s, d) a place was built from, at any angle', () => {
    fc.assert(
      fc.property(lineArb, side, positiveMm, fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (line, s, depth, aPct, bPct) => {
        const frame = elevationFrame(line, s, depth)
        const a = (frame.length * aPct) / 100
        const b = (depth * bPct) / 100
        const at: Pt = { x: frame.start.x + frame.u.x * a + frame.n.x * b, y: frame.start.y + frame.u.y * a + frame.n.y * b }
        const coords = elevationCoords(frame, at)
        expect(Math.abs(coords.s - a)).toBeLessThan(1e-6)
        expect(Math.abs(coords.d - b)).toBeLessThan(1e-6)
      }),
      RUNS,
    )
  })

  it('holds every place a millimetre inside both of its axes', () => {
    fc.assert(
      fc.property(longLineArb, side, deepMm, fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (line, s, depth, aPct, bPct) => {
        const frame = elevationFrame(line, s, depth)
        // A millimetre of slack at every edge: the band is closed, and a place a millimetre off an
        // edge is in it whatever the float noise along a turned axis does to the last digit.
        const a = 1 + ((frame.length - 2) * aPct) / 100
        const b = 1 + ((depth - 2) * bPct) / 100
        const at: Pt = { x: frame.start.x + frame.u.x * a + frame.n.x * b, y: frame.start.y + frame.u.y * a + frame.n.y * b }
        expect(insideElevationBand(frame, at)).toBe(true)
      }),
      RUNS,
    )
  })

  it('holds nothing past any of its four edges', () => {
    fc.assert(
      fc.property(lineArb, side, positiveMm, fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 0, max: 3 }), (line, s, depth, past, away, edge) => {
        const frame = elevationFrame(line, s, depth)
        const beyond = [
          { x: frame.start.x - frame.u.x * past, y: frame.start.y - frame.u.y * past },
          { x: line.end.x + frame.u.x * past, y: line.end.y + frame.u.y * past },
          { x: frame.start.x - frame.n.x * away, y: frame.start.y - frame.n.y * away },
          { x: frame.start.x + frame.n.x * (depth + away), y: frame.start.y + frame.n.y * (depth + away) },
        ][edge]!
        expect(insideElevationBand(frame, beyond)).toBe(false)
      }),
      RUNS,
    )
  })
})

describe('a projection never reports a span outside the view', () => {
  it('clips every shape to 0 … L and keeps its distance inside the band', () => {
    fc.assert(
      fc.property(lineArb, side, positiveMm, pointArb, positiveMm, positiveMm, (line, s, depth, at, width, height) => {
        const frame = elevationFrame(line, s, depth)
        const outline = wallBodyOutline({ kind: 'line', start: at, end: { x: at.x + width, y: at.y + height } }, [-100, 100])
        const seen = projectElevationOutline(frame, outline)
        expect(seen.sMin).toBeGreaterThanOrEqual(0)
        expect(seen.sMax).toBeLessThanOrEqual(frame.length)
        expect(seen.sMin).toBeLessThanOrEqual(seen.sMax)
        if (seen.inside) {
          expect(seen.distance).toBeGreaterThanOrEqual(-1e-9)
          expect(seen.distance).toBeLessThanOrEqual(depth + 1e-9)
        } else {
          expect(seen.distance).toBe(Number.POSITIVE_INFINITY)
        }
      }),
      RUNS,
    )
  })

  it('sees a shape the view looks at, and only the depth decides when it looks away', () => {
    fc.assert(
      fc.property(positiveMm, pointArb, (depth, at) => {
        // A Wall body lying 400 … 600 on one side of the line: the side that faces it sees it, the
        // other side never does, and the far edge decides the rest.
        const body = wallBodyOutline({ kind: 'line', start: { x: at.x, y: at.y + 500 }, end: { x: at.x + 300, y: at.y + 500 } }, [-100, 100])
        const line = { start: at, end: { x: at.x + 1000, y: at.y } }
        const facing = elevationFrame(line, 'right', depth)
        const back = elevationFrame(line, 'left', depth)
        expect(projectElevationOutline(facing, body).inside).toBe(depth >= 400)
        expect(projectElevationOutline(back, body).inside).toBe(false)
      }),
      RUNS,
    )
  })
})
