/**
 * Where a label sits inside a closed path (#67 behaviour 35).
 *
 * The **label anchor** is the pole of inaccessibility: the interior point farthest from the
 * outline. It is the one point a label can be centred on that is as far as possible from
 * every Edge, which is what keeps `Kitchen · 13.08 m²` clear of the vertex handles and the
 * wall labels drawn on that same outline — and, unlike a bounding-box centre, it is inside
 * the shape for an L or a U, which is the shape prototype's defect this fixes.
 *
 * The search is Mapbox's polylabel subdivision: the bounds are split into squares, each
 * square's best possible answer is its centre's distance plus its circumradius, and the
 * square with the highest promise is split next. What makes it exact geometry rather than a
 * mesh is the distance function: `distanceToOutline` is the nearest point of the analytic
 * curves — a line, a circular arc, an elliptical arc — never a distance to a flattened
 * polyline. Only the *search* is discrete, and it stops at `precision` millimetres.
 */
import { bounds } from './measure'
import { nearestOnSegment, windingNumber } from './curve'
import { segmentStart } from './segment'
import type { ClosedPath, Pt } from './types'
import { pt } from './types'

/** The anchor's resolution in millimetres: 1 mm is finer than a label is tall. */
export const LABEL_PRECISION_MM = 1

/** The signed distance from `p` to the outline: positive inside, negative outside. */
const signedDistance = (p: Pt, path: ClosedPath): number => {
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < path.segments.length; i += 1) {
    const found = nearestOnSegment(p, path.segments[i], segmentStart(path, i)).distance
    if (found < nearest) nearest = found
  }
  return windingNumber(p, path) !== 0 ? nearest : -nearest
}

/** One square of the subdivision: centre, half-width, and the answer at its centre. */
interface Cell {
  readonly x: number
  readonly y: number
  readonly half: number
  /** The distance from the centre to the outline, positive inside. */
  readonly distance: number
  /** The best any point in this square could do: `distance` plus the circumradius. */
  readonly promise: number
}

const cell = (x: number, y: number, half: number, path: ClosedPath): Cell => {
  const distance = signedDistance(pt(x, y), path)
  return { x, y, half, distance, promise: distance + half * Math.SQRT2 }
}

/**
 * The interior point of `path` farthest from its outline, to within `precision` millimetres.
 *
 * A path that encloses nothing has no interior, and `pt(0, 0)` is as good an answer as any
 * for a shape that does not exist — the caller has already refused the proposal by then.
 */
export const labelAnchor = (path: ClosedPath, precision: number = LABEL_PRECISION_MM): Pt => {
  const box = bounds(path)
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  if (!(width > 0) || !(height > 0)) return pt(box.minX, box.minY)
  const half = Math.max(width, height) / 2
  const queue: Cell[] = [cell(box.minX + half, box.minY + half, half, path)]
  // The bounds' own centre is a real interior point of every convex shape, and the fallback
  // for any other: an anchor has to be a point even when the search finds nothing better.
  let best = cell(box.minX + width / 2, box.minY + height / 2, 0, path)

  while (queue.length > 0) {
    let top = 0
    for (let i = 1; i < queue.length; i += 1) if (queue[i].promise > queue[top].promise) top = i
    // No square still on the list can beat the best answer by more than `precision`, so the
    // search is done: what is left is finer than the resolution asked for.
    if (queue[top].promise - best.distance <= precision) break
    const current = queue[top]
    queue.splice(top, 1)
    if (current.distance > best.distance) best = current
    if (current.half * 2 <= precision) continue
    const next = current.half / 2
    for (const dx of [-next, next]) {
      for (const dy of [-next, next]) {
        queue.push(cell(current.x + dx, current.y + dy, next, path))
      }
    }
  }
  return pt(best.x, best.y)
}

/** The distance from `p` to the outline, signed so that inside is positive (#67 §3). */
export const distanceToOutline = (p: Pt, path: ClosedPath): number => signedDistance(p, path)
