/**
 * `moveVertex` (#59 §2, behaviour 8): dragging one vertex moves only the two Edges that meet
 * there, a curved Edge keeps its sweep, and a drag that breaks the loop is reported rather than
 * silently dropped. These are the three properties the canvas drag depends on, and none of them
 * is visible from `editLineEdge`'s tests, which edit an Edge rather than its endpoint.
 */
import { describe, expect, it } from 'vitest'
import { TOLERANCE_MM, area, lengthOf, moveVertex, perimeter, pt, segmentStart, validateLoop } from './index'
import type { ArcSegment, ClosedPath } from './index'
import { kitchenFixture } from './testing'

/**
 * A three-Edge loop with one arc: `start` (0, 0), a quarter arc of radius 1 000 about (0, 1000)
 * to (1000, 1000), then two straight Edges home. Vertex 2 is the arc's far end.
 */
const arcLoop = (): ClosedPath => ({
  start: pt(0, 0),
  segments: [
    { kind: 'arc', to: pt(1000, 1000), center: pt(0, 1000), sweepDeg: 90 },
    { kind: 'line', to: pt(0, 1000) },
    { kind: 'line', to: pt(0, 0) },
  ],
})

const radiusOf = (segment: ArcSegment): number => Math.hypot(segment.center.x, segment.center.y)

describe('moveVertex on a chain of straight Edges', () => {
  it('moves only the two Edges that meet at the vertex (criterion 8)', () => {
    const kitchen = kitchenFixture()
    const before = perimeter(kitchen)
    const moved = moveVertex(kitchen, 2, pt(5300, 1300))
    expect(moved.problems).toEqual([])
    // Vertex 2 is (4800, 1300): Edge 1 runs to it and Edge 2 runs from it.
    expect(moved.path.segments[0]).toEqual({ kind: 'line', to: pt(5300, 1300) })
    expect(moved.path.segments[1].to).toEqual(pt(4800, 4000))
    // Edges 3 to 6 are untouched, which is what makes a drag local in a way a typed length is not.
    for (let index = 2; index < 6; index += 1) {
      expect(moved.path.segments[index]).toEqual(kitchen.segments[index])
    }
    expect(moved.path.start).toEqual(kitchen.start)
    // Edge 1 grows by the 500 it was dragged, and Edge 2 — which used to run straight down from
    // the vertex — becomes the hypotenuse of that 500 against its own 2 700.
    expect(perimeter(moved.path)).toBeCloseTo(before + 500 - 2700 + Math.hypot(500, 2700), 6)
  })

  it('moves `start` itself, and with it the last Edge that runs into it', () => {
    const kitchen = kitchenFixture()
    const moved = moveVertex(kitchen, 1, pt(1200, 800))
    expect(moved.problems).toEqual([])
    expect(moved.path.start).toEqual(pt(1200, 800))
    expect(moved.path.segments[5].to).toEqual(pt(1200, 800))
    expect(moved.path.segments[0].to).toEqual(pt(4800, 1300))
    expect(segmentStart(moved.path, 0)).toEqual(pt(1200, 800))
    expect(validateLoop(moved.path)).toEqual([])
  })

  it('keeps the loop closed whichever vertex is dragged', () => {
    const kitchen = kitchenFixture()
    for (let vertex = 1; vertex <= 6; vertex += 1) {
      const moved = moveVertex(kitchen, vertex, pt(2000 + vertex * 100, 2100))
      // The chain stays joined: every Edge still starts where the one before ended, and the last
      // one lands back on `start`, whatever the drag did to the two Edges it touched.
      expect(moved.path.segments[moved.path.segments.length - 1].to).toEqual(moved.path.start)
      for (let index = 0; index < moved.path.segments.length; index += 1) {
        const from = index === 0 ? moved.path.start : moved.path.segments[index - 1].to
        expect(segmentStart(moved.path, index), `vertex ${vertex} edge ${index + 1}`).toEqual(from)
      }
    }
  })
})

describe('moveVertex beside a curved Edge', () => {
  it('keeps the arc sweep and re-finds the centre its new chord implies (criterion 8, D2)', () => {
    const loop = arcLoop()
    const moved = moveVertex(loop, 2, pt(2000, 1000))
    expect(moved.problems).toEqual([])
    const arc = moved.path.segments[0]
    expect(arc.kind).toBe('arc')
    if (arc.kind !== 'arc') return
    expect(arc.sweepDeg).toBe(90)
    expect(arc.to).toEqual(pt(2000, 1000))
    // Both ends sit on the circle it found, and the radius has moved with the chord.
    const far = Math.hypot(arc.center.x - arc.to.x, arc.center.y - arc.to.y)
    expect(far).toBeCloseTo(radiusOf(arc), 6)
    expect(radiusOf(arc)).not.toBeCloseTo(1000, 6)
    // The straight Edge that starts at the vertex keeps its own endpoint.
    expect(moved.path.segments[1].to).toEqual(pt(0, 1000))
  })

  it('re-chords the arc on the incoming side without touching the one being dragged past', () => {
    const loop = arcLoop()
    const moved = moveVertex(loop, 3, pt(0, 1500))
    expect(moved.problems).toEqual([])
    expect(moved.path.segments[0]).toEqual(loop.segments[0])
    expect(moved.path.segments[1]).toEqual({ kind: 'line', to: pt(0, 1500) })
    expect(moved.path.segments[2]).toEqual(loop.segments[2])
  })
})

describe('moveVertex on a drag that breaks the loop', () => {
  it('reports the collapsed Edge and still returns the dragged shape, so the canvas can go red', () => {
    const loop = arcLoop()
    // Vertex 3 dragged onto vertex 2 leaves Edge 2 with no length. The arc is not the Edge that
    // breaks, because a zero-chord arc has no centre to report and the loop would not survive it.
    const moved = moveVertex(loop, 3, pt(1000, 1000))
    expect(moved.problems.length).toBeGreaterThan(0)
    // Deliberate, and unlike `editLineEdge`: a drag is under the cursor, and the crossing has to
    // be on screen for the red to mean anything. Committing is the caller's decision.
    expect(moved.path.segments[1]).toEqual({ kind: 'line', to: pt(1000, 1000) })
    expect(lengthOf(moved.path.segments[1], pt(1000, 1000))).toBeLessThan(TOLERANCE_MM)
    expect(moved.path.segments[0]).toEqual(loop.segments[0])
  })

  it('leaves a valid loop no smaller than it was when the vertex only slides outward', () => {
    const kitchen = kitchenFixture()
    const before = area(kitchen)
    const moved = moveVertex(kitchen, 2, pt(5300, 800))
    expect(validateLoop(moved.path)).toEqual([])
    expect(area(moved.path)).toBeGreaterThan(before)
  })
})
