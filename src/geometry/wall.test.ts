import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  arcFromThrough,
  faceOffsets,
  offsetRefLine,
  refDistance,
  refLength,
  refParamAt,
  refPointAt,
  refSegment,
  refTangentDeg,
} from './index'
import type { WallRefLine } from './index'
import { TOLERANCE_MM, pt } from './types'
import type { Pt } from './types'
import { distance } from './segment'

/** The third point of an arc reference line, narrowed rather than asserted. */
const throughOf = (line: WallRefLine): Pt => (line.kind === 'arc' ? line.through : line.start)

/** A 4,000 mm straight reference line running east along y = 0. */
const east = (length = 4000): WallRefLine => ({ kind: 'line', start: pt(0, 0), end: pt(length, 0) })

/** A 2,000 mm arc bulging west, its midpoint 600 mm off the chord. */
const westArc = (): WallRefLine => ({ kind: 'arc', start: pt(0, 0), through: pt(-600, 1000), end: pt(0, 2000) })

const close = (value: number, expected: number): void => {
  expect(Math.abs(value - expected)).toBeLessThan(1e-6)
}

/** Points compared with the float slack a derived circle deserves, but no more. */
const near = (at: Pt, expected: Pt): void => {
  expect(distance(at, expected)).toBeLessThan(1e-6)
}

describe('arcFromThrough (#64)', () => {
  it('finds the circle through three points', () => {
    const arc = arcFromThrough(pt(0, 0), pt(-600, 1000), pt(0, 2000))
    expect(arc).not.toBeNull()
    if (arc === null) return
    // Every one of the three points is one radius from the centre, and the centre lies on
    // the perpendicular bisector of the chord, which here is the line y = 1000.
    close(arc.center.y, 1000)
    for (const at of [pt(0, 0), pt(-600, 1000), pt(0, 2000)]) {
      close(distance(at, arc.center), arc.radius)
    }
    // The bulge is 600 over a 2,000 chord, so the radius is (600² + 1000²) / (2 · 600).
    close(arc.radius, (600 * 600 + 1000 * 1000) / (2 * 600))
  })

  it('refuses three collinear points, which is the degenerate arc the validator rejects', () => {
    expect(arcFromThrough(pt(0, 0), pt(1000, 0), pt(2000, 0))).toBeNull()
    // A bulge under the one topology tolerance is the same degeneracy, not a very large circle.
    expect(arcFromThrough(pt(0, 0), pt(1000, TOLERANCE_MM / 2), pt(2000, 0))).toBeNull()
  })

  it('refuses a repeated point', () => {
    expect(arcFromThrough(pt(0, 0), pt(0, 0), pt(1000, 0))).toBeNull()
    expect(arcFromThrough(pt(0, 0), pt(500, 500), pt(500, 500))).toBeNull()
  })
})

describe('the reference line measured along itself (#64)', () => {
  it('counts a straight line by its length', () => {
    close(refLength(east()), 4000)
    close(refLength({ kind: 'line', start: pt(1000, 2000), end: pt(1000, 500) }), 1500)
  })

  it('counts an arc by its arc length, never by its chord', () => {
    const line = westArc()
    const arc = arcFromThrough(line.start, throughOf(line), line.end)!
    const chord = distance(line.start, line.end)
    expect(refLength(line)).toBeGreaterThan(chord)
    close(refLength(line), arc.radius * Math.abs(arc.t1 - arc.t0))
  })

  it('starts and ends where the line does', () => {
    for (const line of [east(), westArc()]) {
      const length = refLength(line)
      near(refPointAt(line, 0), line.start)
      near(refPointAt(line, length), line.end)
    }
  })

  it('passes through the arc’s own third point at its own parameter', () => {
    const line = westArc()
    const length = refLength(line)
    const through = throughOf(line)
    // The arc is symmetric about its midpoint, so the third point sits halfway along.
    near(refPointAt(line, length / 2), through)
    close(refParamAt(line, through), length / 2)
    close(refDistance(line, through), 0)
  })

  it('clamps the parameter to the span, so a point beyond an end asks for that end', () => {
    const line = east()
    close(refParamAt(line, pt(-500, 300)), 0)
    close(refParamAt(line, pt(9000, -300)), 4000)
    // `refPointAt` runs along the line rather than clamping, so a parameter outside the span
    // walks past the end. A caller that wants a point of the Wall goes through `refParamAt`.
    near(refPointAt(line, -10), pt(-10, 0))
    near(refPointAt(line, 4010), pt(4010, 0))
  })

  it('measures distance to the curve, not to the chord', () => {
    const line = westArc()
    // The midpoint of the chord is 1,000 mm along y from the start; the arc bulges 600 west
    // of it, so a point on the chord is 600 mm from the arc, not 0.
    close(refDistance(line, pt(0, 1000)), 600)
    close(refDistance(east(), pt(2000, 250)), 250)
    // Beyond an end the distance is to the curve, so it grows again rather than staying flat.
    close(refDistance(east(), pt(-1000, 0)), 1000)
  })

  it('projects a point beyond an end onto that end, whichever way the arc sweeps', () => {
    // The property found this one: an arc that runs the short way round, with the query point
    // off the start. Wrapping the angle into an absolute window used to answer with the end.
    const line: WallRefLine = { kind: 'arc', start: pt(0, 150), through: pt(-100, 0), end: pt(-50, 50) }
    close(refParamAt(line, pt(0, 200)), 0)
    close(refDistance(line, pt(0, 200)), 50)
    close(refParamAt(line, pt(-100, -100)), refLength(line))
  })

  it('keeps a major arc’s own points inside its span', () => {
    // More than half a circle: the reference line runs the long way from (0,0) through
    // (-50,0) to (0,200), so a point on the far side of the centre is still on the curve.
    const line: WallRefLine = { kind: 'arc', start: pt(0, 0), through: pt(-50, 0), end: pt(0, 200) }
    const length = refLength(line)
    const arc = arcFromThrough(line.start, line.through, line.end)!
    expect(Math.abs(arc.t1 - arc.t0)).toBeGreaterThan(Math.PI)
    expect(length).toBeGreaterThan(distance(line.start, line.end))
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const at = refPointAt(line, length * fraction)
      close(refDistance(line, at), 0)
      close(refParamAt(line, at), length * fraction)
    }
    // The face of a major arc sits its offset away from the reference, everywhere along it.
    const face = offsetRefLine(line, 10)
    for (const fraction of [0, 0.5, 1]) {
      close(refDistance(line, refPointAt(face, refLength(face) * fraction)), 10)
    }
  })

  it('reports the tangent direction at each end, clockwise and normalised', () => {
    close(refTangentDeg(east(), 'start'), 0)
    close(refTangentDeg(east(), 'end'), 0)
    const line = westArc()
    // The arc leaves (0,0) heading west-and-down and arrives at (0,2000) heading east-and-down.
    const start = refTangentDeg(line, 'start')
    const end = refTangentDeg(line, 'end')
    expect(start).toBeGreaterThan(90)
    expect(start).toBeLessThan(180)
    expect(end).toBeGreaterThan(0)
    expect(end).toBeLessThan(90)
  })

  it('is the same segment the kernel already draws', () => {
    const { segment, from } = refSegment(east())
    expect(from).toEqual(pt(0, 0))
    expect(segment).toEqual({ kind: 'line', to: pt(4000, 0) })
    const arc = refSegment(westArc())
    expect(arc.segment.kind).toBe('arc')
  })
})

describe('offsetRefLine (#64)', () => {
  it('moves a straight line sideways, positive being the reference’s own normal', () => {
    const offset = offsetRefLine(east(), 50)
    expect(offset.kind).toBe('line')
    expect(refPointAt(offset, 0).y).toBeCloseTo(50, 9)
    expect(refPointAt(offset, 4000).y).toBeCloseTo(50, 9)
    close(refLength(offset), 4000)
  })

  it('keeps an arc on a concentric circle, growing or shrinking its radius', () => {
    const line = westArc()
    const length = refLength(line)
    const outward = offsetRefLine(line, 100)
    // Every point of the offset is 100 mm from the original curve, on the outward side.
    for (const at of [0, length / 4, length / 2, length]) {
      const moved = refPointAt(outward, at)
      close(refDistance(line, moved), 100)
    }
    // Offsetting outward along the normal lengthens a westward bulge and shortens the inside.
    expect(refLength(outward)).not.toBeCloseTo(length, 6)
    expect(refLength(offsetRefLine(line, -100))).not.toBeCloseTo(refLength(outward), 6)
  })

  it('round-trips: offset out and back lands where it started', () => {
    for (const line of [east(), westArc()]) {
      const back = offsetRefLine(offsetRefLine(line, 75), -75)
      const length = refLength(line)
      for (const at of [0, length / 3, (2 * length) / 3, length]) {
        const a = refPointAt(line, at)
        const b = refPointAt(back, at)
        expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6)
        expect(Math.abs(a.y - b.y)).toBeLessThan(1e-6)
      }
    }
  })
})

describe('faceOffsets (#64)', () => {
  it('puts the reference line where the justification says', () => {
    expect(faceOffsets(100, 'centre')).toEqual([-50, 50])
    expect(faceOffsets(150, 'left')).toEqual([0, 150])
    expect(faceOffsets(150, 'right')).toEqual([-150, 0])
    // The two faces are always one thickness apart, whichever side the reference sits on.
    for (const justification of ['left', 'centre', 'right'] as const) {
      const [a, b] = faceOffsets(175, justification)
      close(b - a, 175)
    }
  })
})

describe('the reference line — properties (#64)', () => {
  // Real Wall dimensions: a 50 mm grid over a 20 m plan, and no arc tighter than a 100 mm
  // radius. A three-point arc under a millimetre across is a validator rejection, not a
  // Wall, and its derived circle is too ill-conditioned to be worth a property.
  const arbPoint = fc.record({
    x: fc.integer({ min: -400, max: 400 }).map((n) => n * 50),
    y: fc.integer({ min: -400, max: 400 }).map((n) => n * 50),
  })
  const arbLine: fc.Arbitrary<WallRefLine> = fc.oneof(
    fc.record({ kind: fc.constant('line' as const), start: arbPoint, end: arbPoint }).filter(
      (line) => distance(line.start, line.end) > 100,
    ),
    fc
      .record({
        kind: fc.constant('arc' as const),
        start: arbPoint,
        through: arbPoint,
        end: arbPoint,
      })
      .filter((line) => {
        const arc = arcFromThrough(line.start, line.through, line.end)
        return arc !== null && arc.radius >= 100 && distance(line.start, line.end) > 100
      }),
  )

  it('walks the whole span without a jump', () => {
    fc.assert(
      fc.property(arbLine, (line) => {
        const length = refLength(line)
        const steps = 8
        let previous = refPointAt(line, 0)
        for (let step = 1; step <= steps; step += 1) {
          const at = refPointAt(line, (length * step) / steps)
          // No step is longer than the arc it spans, and consecutive points are close.
          expect(distance(previous, at)).toBeLessThanOrEqual(length / steps + 1)
          previous = at
        }
        expect(distance(previous, line.end)).toBeLessThan(1e-6)
      }),
      { numRuns: 200 },
    )
  })

  it('answers refParamAt with the nearest point of the curve', () => {
    fc.assert(
      fc.property(arbLine, arbPoint, (line, at) => {
        const param = refParamAt(line, at)
        expect(param).toBeGreaterThanOrEqual(0)
        expect(param).toBeLessThanOrEqual(refLength(line))
        // The reported parameter’s point is no further away than either end, unless the
        // nearest point really is an end.
        const foot = refPointAt(line, param)
        const viaEnd = Math.min(distance(at, line.start), distance(at, line.end))
        // Sub-micron slack: at a clamp boundary the reported foot and the end it stands for
        // are the same point to within float noise, not to within a tenth of a millimetre.
        expect(distance(at, foot)).toBeLessThanOrEqual(viaEnd + 1e-9 * refLength(line))
      }),
      { numRuns: 200 },
    )
  })

  it('offsets both faces the same distance apart, everywhere along the line', () => {
    fc.assert(
      fc.property(arbLine, fc.integer({ min: 20, max: 300 }), (line, thickness) => {
        // A Wall half as thick as its own curve radius has no inner face: the offset passes
        // through the centre and comes back straight. Not a Wall a draughtsman can draw.
        const arc = line.kind === 'arc' ? arcFromThrough(line.start, line.through, line.end) : null
        fc.pre(arc === null || arc.radius > thickness / 2 + 10)
        const [a, b] = faceOffsets(thickness, 'centre')
        const fa = offsetRefLine(line, a)
        const fb = offsetRefLine(line, b)
        // Matching fractions of each face’s own length are matching angles on the same
        // centre, which is the only comparison an arc supports: equal arc length would put
        // the two faces at different angles.
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
          const left = refPointAt(fa, refLength(fa) * fraction)
          const right = refPointAt(fb, refLength(fb) * fraction)
          expect(distance(left, right)).toBeCloseTo(thickness, 2)
          // And each face sits its own half-thickness off the reference line.
          expect(refDistance(line, left)).toBeCloseTo(thickness / 2, 2)
          expect(refDistance(line, right)).toBeCloseTo(thickness / 2, 2)
        }
      }),
      { numRuns: 100 },
    )
  })
})
