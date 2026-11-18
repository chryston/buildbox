/**
 * Intersection, containment and overlap (#54 §4).
 *
 * Every classification is exact geometry against the single `TOLERANCE_MM`: the winding
 * number of a point is counted on the analytic curves, never on a sampled polyline, and
 * the overlap area is the boundary integral over the pieces of each loop that lie inside
 * the other, so arcs contribute their closed-form segment term rather than a mesh.
 */
import {
  intersectSegments,
  nearestOnSegment,
  pieceSegment,
  pointOn,
  spanOf,
  windingNumber,
} from './curve'
import type { SegmentIntersections } from './curve'
import { normaliseOrientation, signedAreaOf } from './measure'
import { segmentStart } from './segment'
import type { ClosedPath, Pt, Segment } from './types'
import { TOLERANCE_MM } from './types'

/** A stretch two paths run together, with the 1-based edge number of each side. */
export interface OverlapInterval {
  from: Pt
  to: Pt
  edges: [number, number]
}

/** Every meeting of two closed paths. The point sets are symmetric in `a` and `b`. */
export interface PathIntersections {
  crossings: Pt[]
  touches: Pt[]
  overlaps: OverlapInterval[]
}

/** A canonical order for a point, so `intersect(a, b)` and `intersect(b, a)` compare equal. */
const key = (p: Pt): number => Math.round(p.x * 1e6) * 4_194_304 + Math.round(p.y * 1e6)

const sortPts = (points: Pt[]): Pt[] => [...points].sort((p, q) => key(p) - key(q))

/** Every meeting of two Room Outlines or Item Footprints, in a canonical order. */
export const intersect = (a: ClosedPath, b: ClosedPath): PathIntersections => {
  const crossings: Pt[] = []
  const touches: Pt[] = []
  const overlaps: OverlapInterval[] = []
  eachPair(a, b, (i, j, result) => {
    crossings.push(...result.crossings.map((m) => m.at))
    touches.push(...result.touches.map((m) => m.at))
    for (const stretch of result.overlaps) {
      overlaps.push({ from: stretch.from, to: stretch.to, edges: [i + 1, j + 1] })
    }
  })
  return {
    crossings: sortPts(crossings),
    touches: sortPts(touches),
    overlaps: [...overlaps].sort((p, q) => key(p.from) - key(q.from)),
  }
}

const eachPair = (
  a: ClosedPath,
  b: ClosedPath,
  visit: (i: number, j: number, result: SegmentIntersections) => void,
): void => {
  a.segments.forEach((segmentA, i) => {
    const fromA = segmentStart(a, i)
    b.segments.forEach((segmentB, j) => {
      visit(i, j, intersectSegments(segmentA, fromA, segmentB, segmentStart(b, j)))
    })
  })
}

/** `'boundary'` within tolerance, otherwise the winding number decides inside or out. */
export const classifyPoint = (p: Pt, path: ClosedPath): 'inside' | 'boundary' | 'outside' => {
  if (isBoundary(p, path)) return 'boundary'
  return windingNumber(p, path) !== 0 ? 'inside' : 'outside'
}

/** True when `p` lies on the path's outline within tolerance. */
export const isBoundary = (p: Pt, path: ClosedPath): boolean =>
  path.segments.some((segment, i) => nearestOnSegment(p, segment, segmentStart(path, i)).distance <= TOLERANCE_MM)

/** The winding test alone, which is what decides the interior of an overlap piece. */
const isInside = (p: Pt, path: ClosedPath): boolean => windingNumber(p, path) !== 0

/** Whether `inner` lies wholly inside `outer`, crosses it, or lies wholly outside. */
export const containment = (inner: ClosedPath, outer: ClosedPath): 'inside' | 'crosses' | 'outside' => {
  let crosses = false
  eachPair(inner, outer, (_i, _j, result) => {
    crosses = crosses || result.crossings.length > 0
  })
  if (crosses) return 'crosses'
  return isInside(inner.start, outer) ? 'inside' : 'outside'
}

// ---------------------------------------------------------------------------
// Overlap

/** The intersection of two closed paths. */
export interface Overlap {
  kind: 'none' | 'touch' | 'positive'
  area: number
  region: ClosedPath[]
}

/**
 * The intersection of two closed paths, both taken in clockwise form so the region boundary
 * runs the same way round as the loops that make it up.
 *
 * Each loop is cut at every meeting with the other and its pieces classified: a piece of
 * `a` is kept when it lies inside or exactly on `b`, a piece of `b` only when it lies
 * strictly inside `a`, so a shared collinear stretch is taken from `a` once and never
 * twice. The kept pieces that chain into a closed outline bound the intersection, and its
 * area is the same Green's-theorem integral over those pieces — arcs included, exactly.
 * What is left over — a point contact, a shared edge with nothing enclosed — is `touch`.
 */
export const overlap = (a: ClosedPath, b: ClosedPath): Overlap => {
  const first = normaliseOrientation(a)
  const second = normaliseOrientation(b)
  const pieces = [...clipPieces(first, second), ...clipPieces(second, first).filter((piece) => piece.inside)]
  const region = chain(pieces)
  if (region.length === 0) {
    let meeting = false
    eachPair(a, b, (_i, _j, result) => {
      meeting = meeting || result.crossings.length > 0 || result.touches.length > 0 || result.overlaps.length > 0
    })
    return { kind: meeting ? 'touch' : 'none', area: 0, region: [] }
  }
  const total = region.reduce(
    (sum, loop) => sum + loop.segments.reduce((one, segment, i) => one + signedAreaOf(segment, segmentStart(loop, i)), 0),
    0,
  )
  return { kind: 'positive', area: Math.abs(total), region }
}

/** One boundary piece of one loop, kept when it lies inside or on the other loop. */
interface Piece {
  from: Pt
  segment: Segment
  inside: boolean
}

/** `path` cut at every meeting with `other`, keeping the pieces inside or on it. */
const clipPieces = (path: ClosedPath, other: ClosedPath): Piece[] => {
  const out: Piece[] = []
  path.segments.forEach((segment, i) => {
    const from = segmentStart(path, i)
    const span = spanOf(segment, from)
    const cuts = [span.lo, span.hi]
    other.segments.forEach((otherSegment, j) => {
      const meetings = intersectSegments(segment, from, otherSegment, segmentStart(other, j))
      const points = [
        ...meetings.crossings.map((m) => m.at),
        ...meetings.touches.map((m) => m.at),
        ...meetings.overlaps.flatMap((stretch) => [stretch.from, stretch.to]),
      ]
      for (const point of points) {
        const near = nearestOnSegment(point, segment, from)
        if (near.distance <= TOLERANCE_MM) cuts.push(near.t)
      }
    })
    const sorted = dedupe(cuts, span)
    for (let k = 0; k + 1 < sorted.length; k++) {
      const t0 = sorted[k]
      const t1 = sorted[k + 1]
      if (Math.abs(t1 - t0) < 1e-12) continue
      const where = classifyPoint(pointOn(segment, from, (t0 + t1) / 2), other)
      if (where === 'outside') continue
      out.push({
        from: pointOn(segment, from, t0),
        segment: pieceSegment(segment, from, t0, t1),
        inside: where === 'inside',
      })
    }
  })
  return out
}

const dedupe = (values: number[], span: { lo: number; hi: number }): number[] => {
  const low = Math.min(span.lo, span.hi)
  const high = Math.max(span.lo, span.hi)
  const sorted = values
    .filter((value) => value >= low - 1e-9 && value <= high + 1e-9)
    .sort((p, q) => p - q)
  const out: number[] = []
  for (const value of sorted) {
    if (out.length === 0 || Math.abs(value - out[out.length - 1]) > 1e-9) out.push(value)
  }
  return out
}

/** The endpoints of kept pieces agree to far better than a micrometre. */
const same = (p: Pt, q: Pt): boolean => Math.abs(key(p) - key(q)) < 1

/**
 * Chain the kept pieces into closed outlines, following any piece that starts where the
 * last one ended. A walk that does not come back to its start is an open stub — a shared
 * edge with nothing enclosed — and is dropped, which is what makes a bare touch `touch`.
 */
const chain = (pieces: Piece[]): ClosedPath[] => {
  const remaining = new Set(pieces)
  const regions: ClosedPath[] = []
  for (const seed of pieces) {
    if (!remaining.has(seed)) continue
    remaining.delete(seed)
    const start = seed.from
    const segments: Segment[] = [seed.segment]
    let end = seed.segment.to
    let closed = same(end, start)
    while (!closed) {
      const next = [...remaining].find((piece) => same(piece.from, end))
      if (next === undefined) break
      remaining.delete(next)
      segments.push(next.segment)
      end = next.segment.to
      closed = same(end, start)
    }
    if (closed) regions.push({ start, segments })
  }
  return regions
}
