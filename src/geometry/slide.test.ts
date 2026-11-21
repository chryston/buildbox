/**
 * One Edge sliding sideways with the loop taking up the slack (#67 behaviours 27–28).
 *
 * The claim these tests pin is the one a referenced Room edge depends on: the Edge moves by
 * exactly the vector it was given, at **both** of its ends, and the two neighbours that meet it
 * at a corner are trimmed or extended along their own lines — including past where they stopped
 * today, because a Room whose Wall face moved away gets bigger rather than smaller. Nothing
 * else in the loop moves.
 */
import { describe, expect, it } from 'vitest'
import { slideLineEdge } from './slide'
import type { ClosedPath, Pt } from './types'
import { pt } from './types'

/** A 4000 × 2000 rectangle, anticlockwise on the page, starting at the top-left corner. */
const rect = (): ClosedPath => ({
  start: pt(0, 0),
  segments: [
    { kind: 'line', to: pt(4000, 0) },
    { kind: 'line', to: pt(4000, 2000) },
    { kind: 'line', to: pt(0, 2000) },
    { kind: 'line', to: pt(0, 0) },
  ],
})

/** Every vertex of a closed loop, starting with its start point, rounded to nanometres. */
const corners = (path: ClosedPath): Pt[] =>
  [path.start, ...path.segments.map((segment) => segment.to)].map((at) => pt(Math.round(at.x * 1e6) / 1e6, Math.round(at.y * 1e6) / 1e6))

describe('slideLineEdge', () => {
  it('moves both ends of the Edge and trims the two neighbours that meet it', () => {
    const slid = slideLineEdge(rect(), 1, pt(0, 500))
    expect(slid).not.toBeNull()
    expect(corners(slid!)).toEqual([pt(0, 500), pt(4000, 500), pt(4000, 2000), pt(0, 2000), pt(0, 500)])
  })

  it('extends the neighbours past where they stopped when the loop grows', () => {
    // The face moved away from the Room, so the two sides have to reach further than they did.
    const slid = slideLineEdge(rect(), 1, pt(0, -750))
    expect(corners(slid!)).toEqual([pt(0, -750), pt(4000, -750), pt(4000, 2000), pt(0, 2000), pt(0, -750)])
  })

  it('leaves the three Edges that do not touch the slid one exactly where they were', () => {
    const slid = slideLineEdge(rect(), 2, pt(500, 0))
    expect(corners(slid!)).toEqual([pt(0, 0), pt(4500, 0), pt(4500, 2000), pt(0, 2000), pt(0, 0)])
    expect(slid!.segments[1]!.to).toEqual(pt(4500, 2000))
  })

  it('slides the last Edge, whose far end is the loop’s own start point', () => {
    const slid = slideLineEdge(rect(), 4, pt(-250, 0))
    // The bottom Edge reaches further left to meet it, and the start point — the vertex this
    // Edge shares with the first one — goes with it.
    expect(corners(slid!)).toEqual([pt(-250, 0), pt(4000, 0), pt(4000, 2000), pt(-250, 2000), pt(-250, 0)])
  })

  it('returns the same loop for a slide of nothing', () => {
    const slid = slideLineEdge(rect(), 1, pt(0, 0))
    expect(corners(slid!)).toEqual(corners(rect()))
  })

  it('refuses to slide an Edge that is not straight', () => {
    const loop: ClosedPath = {
      start: pt(0, 0),
      segments: [
        { kind: 'arc', to: pt(4000, 0), center: pt(2000, 0), sweepDeg: 60 },
        { kind: 'line', to: pt(4000, 2000) },
        { kind: 'line', to: pt(0, 0) },
      ],
    }
    expect(slideLineEdge(loop, 1, pt(0, 100))).toBeNull()
  })

  it('refuses a loop that is one smooth curve, with nowhere to take up the slack', () => {
    const circle: ClosedPath = {
      start: pt(-1000, 0),
      segments: [
        { kind: 'arc', to: pt(1000, 0), center: pt(0, 0), sweepDeg: 180 },
        { kind: 'arc', to: pt(-1000, 0), center: pt(0, 0), sweepDeg: 180 },
      ],
    }
    expect(slideLineEdge(circle, 1, pt(0, 100))).toBeNull()
  })

  it('refuses a loop too small to have a neighbour at each end', () => {
    const degenerate: ClosedPath = {
      start: pt(0, 0),
      segments: [
        { kind: 'line', to: pt(1000, 0) },
        { kind: 'line', to: pt(0, 0) },
      ],
    }
    expect(slideLineEdge(degenerate, 1, pt(0, 100))).toBeNull()
  })
})
