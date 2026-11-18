/**
 * The #54 §9 bench, run by `npm run bench` and recorded in the PR as input to the #20 §8
 * derive budget: validation of a 200-segment mixed path and the overlap of two 50-segment
 * paths, which is what a workspace with a few hundred rooms pays per interaction.
 */
import { bench, describe } from 'vitest'
import { overlap, roundAllCorners, validateLoop } from './index'
import type { ClosedPath, Pt, Segment } from './index'

/** The kitchen plan's outline (#46 §4), inlined because `testing.ts` is test-only. */
const KITCHEN_POINTS: Pt[] = [
  { x: 1200, y: 1300 },
  { x: 4800, y: 1300 },
  { x: 4800, y: 4000 },
  { x: 3300, y: 4000 },
  { x: 3300, y: 5600 },
  { x: 1200, y: 5600 },
]

const kitchenFixture = (): ClosedPath => ({
  start: KITCHEN_POINTS[0],
  segments: [...KITCHEN_POINTS.slice(1), KITCHEN_POINTS[0]].map((to) => ({ kind: 'line' as const, to })),
})


/**
 * A staircase of straight steps and quarter arcs, always advancing east and north so the
 * path never comes near itself: what the kernel pays for is the pair scan, not meetings.
 */
const walk = (start: Pt, count: number, step: number): Segment[] => {
  const segments: Segment[] = []
  let at = start
  let east = true
  while (segments.length < count) {
    at = east ? { x: at.x + step, y: at.y } : { x: at.x, y: at.y - step }
    segments.push({ kind: 'line', to: at })
    if (segments.length >= count) break
    const next: Pt = east ? { x: at.x + step / 2, y: at.y - step / 2 } : { x: at.x + step / 2, y: at.y - step / 2 }
    segments.push({ kind: 'arc', to: next, center: east ? { x: at.x, y: at.y - step / 2 } : { x: at.x, y: at.y }, sweepDeg: east ? 90 : -90 })
    at = next
    east = !east
  }
  return segments
}

/** A 200-segment mixed path: the kitchen's rounded outline, then a walk to reach 200. */
const wide = (): ClosedPath => {
  const base = roundAllCorners(kitchenFixture(), 250).path
  return { start: base.start, segments: [...base.segments, ...walk(base.start, 200 - base.segments.length, 40)] }
}

/** A 50-segment rounded rectangle with a walk appended, for the overlap bench. */
const many = (shift: number): ClosedPath => {
  const start: Pt = { x: shift, y: 0 }
  return { start, segments: walk(start, 50, 20) }
}

const WIDE = wide()
const LEFT = many(0)
const RIGHT = many(200)

describe('geometry kernel bench', () => {
  bench('validateLoop of a 200-segment mixed path', () => {
    validateLoop(WIDE)
  }, { time: 400 })

  bench('overlap of two 50-segment paths', () => {
    overlap(LEFT, RIGHT)
  }, { time: 400 })
})
