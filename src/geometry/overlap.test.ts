/**
 * The overlap kernel on the shapes Rooms actually make (#67).
 *
 * Two Rooms on a Floor are axis-aligned more often than not, which puts the test point of a
 * boundary piece exactly on the line another Edge runs along. The winding test casts its ray
 * along +X, so that ray can lie on the outline and miss the crossing behind it — the bug these
 * tests pin.
 */
import { describe, expect, it } from 'vitest'
import { classifyPoint, overlap } from './index'
import type { ClosedPath, Pt } from './index'

/** A closed loop: the last vertex is the first, as every stored path keeps it. */
const loop = (pts: Pt[]): ClosedPath => ({
  start: pts[0]!,
  segments: [...pts.slice(1), pts[0]!].map((p) => ({ kind: 'line', to: p })),
})

const box = (x0: number, y0: number, x1: number, y1: number): ClosedPath =>
  loop([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }])

// The L of the fixture Kitchen: an arm 3,250 × 2,300 and a second arm 1,700 × 1,600 below its
// left end, so the interior is unbroken across y = 3,000 for x < 2,400.
const lShape = loop([
  { x: 700, y: 700 },
  { x: 3950, y: 700 },
  { x: 3950, y: 3000 },
  { x: 2400, y: 3000 },
  { x: 2400, y: 4600 },
  { x: 700, y: 4600 },
])

describe('a point on the line another edge runs along (#67)', () => {
  it('is inside when the interior continues across that line', () => {
    expect(classifyPoint({ x: 2000, y: 3000 }, lShape)).toBe('inside')
    expect(classifyPoint({ x: 1500, y: 3000 }, lShape)).toBe('inside')
  })

  it('is outside when the interior stops at that line', () => {
    expect(classifyPoint({ x: 3000, y: 3000 }, lShape)).toBe('boundary')
    expect(classifyPoint({ x: 4500, y: 3000 }, lShape)).toBe('outside')
    expect(classifyPoint({ x: 3000, y: 4000 }, lShape)).toBe('outside')
  })
})

describe('the overlap of an axis-aligned Room with an L-shaped one (#67)', () => {
  it('measures the whole shared area, not a bare touch', () => {
    const shared = overlap(box(2000, 2000, 5000, 4000), lShape)
    expect(shared.kind).toBe('positive')
    expect(shared.area).toBeCloseTo(2_350_000, 6)
  })

  it('still measures the arms separately when the box spans both', () => {
    const shared = overlap(box(1000, 2000, 5000, 4000), lShape)
    expect(shared.kind).toBe('positive')
    expect(shared.area).toBeCloseTo(4_350_000, 6)
  })

  it('keeps a shared edge with nothing enclosed a touch', () => {
    const shared = overlap(box(3950, 1000, 5000, 2500), lShape)
    expect(shared.kind).toBe('touch')
    expect(shared.area).toBe(0)
  })

  it('keeps a Room clear of the Floor clear of the other', () => {
    const shared = overlap(box(6000, 5000, 9000, 6500), lShape)
    expect(shared.kind).toBe('none')
    expect(shared.area).toBe(0)
  })
})
