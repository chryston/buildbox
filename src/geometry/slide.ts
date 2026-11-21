/**
 * One Edge sliding onto a parallel line, and its neighbours following (#67 behaviours 27–28).
 *
 * `slideLineEdge` is the geometry behind `Attach to wall face` and behind a referenced Wall
 * face moving: the Edge goes onto the face by a pure perpendicular slide, and the chain
 * absorbs it the way decision D2 says a chain absorbs an edge edit — a neighbour that runs
 * **tangentially** on into the Edge rides along unchanged (a filleted corner follows the side
 * it rounds), and the first neighbour that meets the Edge **at a corner** extends or trims
 * along its own line. Nothing else in the loop moves, which is why a Room whose referenced
 * side follows a Wall keeps its other three sides exactly where they were.
 *
 * The slide is given as a vector rather than a target line so the caller states the
 * perpendicular distance it is proposing — the number the preview prints — and the geometry
 * cannot quietly disagree with it.
 */
import { intersectSegments, spanOf } from './curve'
import { tangentAt } from './fillet'
import type { Pt, Segment } from './types'
import { pt } from './types'

/** One segment with its own start and end spelled out, which is what a walk needs. */
interface Curve {
  segment: Segment
  from: Pt
  to: Pt
}

const add = (a: Pt, b: Pt): Pt => pt(a.x + b.x, a.y + b.y)

const shift = (curve: Curve, delta: Pt): Curve => ({
  segment: shiftSegment(curve.segment, delta),
  from: add(curve.from, delta),
  to: add(curve.to, delta),
})

/** The same curve moved sideways: an arc's centre goes with it, or it stops being that arc. */
const shiftSegment = (segment: Segment, delta: Pt): Segment => {
  const moved = { ...segment, to: add(segment.to, delta) }
  if (segment.kind === 'arc' || segment.kind === 'ellipticalArc') {
    return { ...moved, center: add(segment.center, delta) } as Segment
  }
  return moved as Segment
}

const startsOf = (path: { start: Pt; segments: Segment[] }): Curve[] => {
  let at = path.start
  return path.segments.map((segment) => {
    const curve = { segment, from: at, to: segment.to }
    at = segment.to
    return curve
  })
}

/**
 * Whether the vertex two neighbouring curves share is smooth: their tangents agree, so one
 * runs into the other rather than turning. A smooth vertex is what makes a corner arc part
 * of the side it rounds.
 */
const tangentThrough = (before: Curve, after: Curve): boolean => {
  const out = tangentAt(before.segment, before.from, spanOf(before.segment, before.from).hi)
  const inAt = tangentAt(after.segment, after.from, spanOf(after.segment, after.from).lo)
  return Math.hypot(out.x - inAt.x, out.y - inAt.y) <= 1e-7
}

/**
 * Where `moving` meets `own`'s curve again, nearest `near`, or `null` when the two do not
 * cross at a point. A run together (`overlaps`) is deliberately `null`: a neighbour that lies
 * along the Edge it is supposed to trim to has no length to set, and inventing one would put
 * a wrong number on the drawing.
 */
const meet = (moving: Curve, own: Curve, near: Pt): Pt | null => {
  const found = intersectSegments(moving.segment, moving.from, own.segment, own.from)
  if (found.overlaps.length > 0) return null
  const points = [...found.crossings, ...found.touches].map((meeting) => meeting.at)
  if (points.length === 0) return null
  return points.reduce((best, at) => (Math.hypot(at.x - near.x, at.y - near.y) < Math.hypot(best.x - near.x, best.y - near.y) ? at : best))
}

/**
 * Slide segment `segmentIndex` (1-based) of a closed loop by `delta`, with the chain following.
 *
 * `null` when the loop cannot follow: the Edge is not straight, a neighbour that has to trim
 * is not straight either, two of them end up running together, or the whole loop is one
 * smooth curve with nowhere to take up the slack. A `null` is a blocked proposal, never a
 * partial edit — the caller leaves the model exactly as it was.
 */
export const slideLineEdge = (
  path: { start: Pt; segments: Segment[] },
  segmentIndex: number,
  delta: Pt,
): { start: Pt; segments: Segment[] } | null => {
  const n = path.segments.length
  if (n < 3) return null
  const i = segmentIndex - 1
  const edge = path.segments[i]
  if (edge === undefined || edge.kind !== 'line') return null
  if (delta.x === 0 && delta.y === 0) return { start: path.start, segments: path.segments.map((s) => ({ ...s })) }
  const curves = startsOf(path)
  curves[i] = { segment: edge, from: add(curves[i].from, delta), to: add(curves[i].to, delta) }

  /** Walk out from the slid Edge in one direction, translating the smooth run and trimming at the corner. */
  const walk = (direction: 1 | -1): Pt | null => {
    let anchor = i
    let k = (i + direction + n) % n
    for (let guard = 0; guard < n; guard += 1) {
      const before = direction === 1 ? curves[anchor] : curves[k]
      const after = direction === 1 ? curves[k] : curves[anchor]
      if (!tangentThrough(before, after)) {
        // The neighbour keeps its own curve; the shared vertex goes where the two meet.
        const shared = direction === 1 ? curves[k].from : curves[k].to
        const point = meet(curves[anchor], curves[k], shared)
        if (point === null) return null
        if (direction === 1) curves[k] = { ...curves[k], from: point }
        else curves[k] = { ...curves[k], to: point }
        return point
      }
      curves[k] = shift(curves[k], delta)
      anchor = k
      k = (k + direction + n) % n
    }
    return null
  }

  const back = walk(-1)
  if (back === null) return null
  const forward = walk(1)
  if (forward === null) return null
  // The slid Edge is trimmed at both ends: its own line is fixed by the slide, its endpoints
  // by what it meets. `walk` already moved the neighbour's shared vertex; this is the other
  // half of the same point.
  curves[i] = { segment: edge, from: back, to: forward }
  const previous = (i - 1 + n) % n
  curves[previous] = { ...curves[previous], to: back }
  const next = (i + 1) % n
  curves[next] = { ...curves[next], to: curves[next].to, from: forward }

  const segments: Segment[] = curves.map((curve) => ({ ...curve.segment, to: curve.to }))
  return { start: curves[0].from, segments }
}
