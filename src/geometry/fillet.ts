/**
 * Fillets (#54 §6, behaviour 14).
 *
 * A fillet is the circle of the entered radius tangent to both neighbours of a corner.
 * Line/line is the textbook `t = r · tan(φ/2)`; a circular neighbour puts the centre on a
 * concentric locus circle of radius `|R ∓ r|`, which is still closed form; only an
 * elliptical neighbour needs a solve, and it is solved to 0.01 mm tangency by bisection on
 * the trim. Nothing here stores a relationship — tangency is a property of the geometry,
 * re-recognised by `isTangentFillet` whenever it is asked for.
 */
import { locusIntersect, nearestOnSegment, pieceSegment, pointOn, spanOf, supportLocus } from './curve'
import type { Locus } from './curve'
import {
  arcForm,
  arcTangent,
  DEG,
  cross,
  dot,
  lengthBetween,
  lengthOf,
  rotate,
  segmentStart,
  sub,
} from './segment'
import type { ClosedPath, GeometryProblem, Pt, Segment } from './types'
import { TOLERANCE_MM, geometryProblem } from './types'

/** An edit that either produced a new path or said why it could not, leaving the input alone. */
export interface EditResult {
  path: ClosedPath
  problems: GeometryProblem[]
}

const unit = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y)
  return { x: v.x / l, y: v.y / l }
}

/** The signed angle from `a` to `b`, positive for a clockwise-on-screen turn (#54 §1). */
const signedAngle = (a: Pt, b: Pt): number => Math.atan2(cross(a, b), dot(a, b))

/** The unit tangent of a segment at its own parameter. */
export const tangentAt = (segment: Segment, from: Pt, t: number): Pt =>
  segment.kind === 'line' ? unit(sub(segment.to, from)) : unit(arcTangent(arcForm(segment, from), t))

/** The normal a positive (clockwise on screen) turn bends toward. */
const turnNormal = (d: Pt): Pt => ({ x: -d.y, y: d.x })

/**
 * The parameter of a point known to lie on a segment's own curve, aligned to the sweep the
 * segment actually runs so a trim parameter is comparable with its span.
 */
const paramOf = (segment: Segment, from: Pt, at: Pt): number => {
  if (segment.kind === 'line') {
    const d = sub(segment.to, from)
    return dot(sub(at, from), d) / dot(d, d)
  }
  const form = arcForm(segment, from)
  const d = sub(at, form.center)
  const local = form.circular ? d : rotate(d, -form.phi / DEG)
  const raw = Math.atan2(local.y / form.ry, local.x / form.rx)
  const turns = Math.round((form.t1 - raw) / (Math.PI * 2))
  return raw + turns * Math.PI * 2
}

const within = (t: number, lo: number, hi: number): boolean =>
  t >= Math.min(lo, hi) - 1e-9 && t <= Math.max(lo, hi) + 1e-9

// ---------------------------------------------------------------------------
// The centre solve

/** The locus of fillet centres for one neighbour, and how to recover its touch point. */
interface CentreLocus {
  locus: Locus
  touch: (centre: Pt) => Pt
}

/**
 * Centres of circles of `radius` tangent to `segment` on the `sense` side, at the joint
 * parameter `t`. A straight neighbour gives an offset line; a circular one a concentric
 * circle whose radius is `|R − r|` when it curves the same way as the fillet and `R + r`
 * when it curves the other way.
 */
const locusOf = (segment: Segment, from: Pt, t: number, sense: number, radius: number): CentreLocus => {
  if (segment.kind === 'line') {
    const dir = unit(sub(segment.to, from))
    const n = turnNormal(dir)
    const at = pointOn(segment, from, t)
    return {
      locus: {
        kind: 'line',
        point: { x: at.x + sense * radius * n.x, y: at.y + sense * radius * n.y },
        dir,
        radius: 0,
      },
      touch: (centre) => ({
        x: centre.x - sense * radius * n.x,
        y: centre.y - sense * radius * n.y,
      }),
    }
  }
  const form = arcForm(segment, from)
  const sigma = Math.sign(segment.kind === 'arc' ? segment.sweepDeg : 1)
  const factor = sense * radius - sigma * form.rx
  const k = (-sigma * form.rx) / factor
  return {
    locus: {
      kind: 'circle',
      point: form.center,
      dir: { x: 1, y: 0 },
      radius: Math.abs(factor),
    },
    touch: (centre) => ({
      x: form.center.x + k * (centre.x - form.center.x),
      y: form.center.y + k * (centre.y - form.center.y),
    }),
  }
}

interface Solved {
  centre: Pt
  t1: number
  t2: number
}

/**
 * The fillet circle for one corner: the centre whose touch points both fall inside the two
 * neighbours, taking the one that trims least when more than one fits.
 */
const filletCentre = (
  incoming: Segment,
  inFrom: Pt,
  outgoing: Segment,
  outFrom: Pt,
  sense: number,
  radius: number,
): Solved | null => {
  if (incoming.kind === 'ellipticalArc' || outgoing.kind === 'ellipticalArc') {
    return numericFillet(incoming, inFrom, outgoing, outFrom, sense, radius)
  }
  const sin = spanOf(incoming, inFrom)
  const sout = spanOf(outgoing, outFrom)
  const la = locusOf(incoming, inFrom, sin.hi, sense, radius)
  const lb = locusOf(outgoing, outFrom, sout.lo, sense, radius)
  let best: Solved | null = null
  let bestTrim = Infinity
  for (const centre of locusIntersect(la.locus, lb.locus)) {
    const t1 = paramOf(incoming, inFrom, la.touch(centre))
    const t2 = paramOf(outgoing, outFrom, lb.touch(centre))
    if (!within(t1, sin.lo, sin.hi) || !within(t2, sout.lo, sout.hi)) continue
    const trim = lengthBetween(incoming, inFrom, t1, sin.hi) + lengthBetween(outgoing, outFrom, sout.lo, t2)
    if (trim < bestTrim) {
      best = { centre, t1, t2 }
      bestTrim = trim
    }
  }
  return best
}

/**
 * The same solve when a neighbour is an elliptical arc, which has no closed-form offset.
 * The trim of the incoming neighbour is the unknown: at trim 0 the fillet centre sits on
 * the corner, so its distance to the outgoing neighbour is 0, and it grows with the trim.
 * Bisecting that distance against the radius finds the tangency to well inside 0.01 mm.
 */
const numericFillet = (
  incoming: Segment,
  inFrom: Pt,
  outgoing: Segment,
  outFrom: Pt,
  sense: number,
  radius: number,
): Solved | null => {
  const sin = spanOf(incoming, inFrom)
  const total = lengthOf(incoming, inFrom)
  const centreAt = (trim: number): Pt => {
    const at = pointAtArcLength(incoming, inFrom, sin.hi, -trim)
    const n = turnNormal(tangentAt(incoming, inFrom, paramOf(incoming, inFrom, at)))
    return { x: at.x + sense * radius * n.x, y: at.y + sense * radius * n.y }
  }
  const error = (trim: number): number =>
    nearestOnSegment(centreAt(trim), outgoing, outFrom).distance - radius
  if (error(total) < 0) return null
  let lo = 0
  let hi = total
  while (hi - lo > 1e-7) {
    const mid = (lo + hi) / 2
    if (error(mid) < 0) lo = mid
    else hi = mid
  }
  const centre = centreAt(hi)
  const t1 = paramOf(incoming, inFrom, pointAtArcLength(incoming, inFrom, sin.hi, -hi))
  const t2 = paramOf(outgoing, outFrom, nearestOnSegment(centre, outgoing, outFrom).point)
  return { centre, t1, t2 }
}

/** The point a given arc length along (positive) or back (negative) from a parameter. */
const pointAtArcLength = (segment: Segment, from: Pt, t: number, delta: number): Pt => {
  if (delta === 0) return pointOn(segment, from, t)
  const span = spanOf(segment, from)
  const total = lengthOf(segment, from)
  const fraction = Math.min(Math.max(delta / total, -1), 1)
  const target = t + (span.hi - span.lo) * fraction
  return pointOn(segment, from, target)
}

// ---------------------------------------------------------------------------
// Public edits

/**
 * Insert a circular arc of exactly `radius`, tangent to both neighbours of `vertexIndex`
 * (1-based; vertex 1 is `path.start`, joining the last edge to the first). Both neighbours
 * are trimmed to the tangent points. A trim that does not fit — including one that runs
 * into a neighbouring fillet on the same side — is `corner-radii-overlap` naming the edge,
 * and the path comes back unchanged.
 */
export const fillet = (path: ClosedPath, vertexIndex: number, radius: number): EditResult => {
  const n = path.segments.length
  const inIdx = (vertexIndex - 2 + n) % n
  const outIdx = (vertexIndex - 1) % n
  const incoming = path.segments[inIdx]
  const outgoing = path.segments[outIdx]
  const inFrom = segmentStart(path, inIdx)
  const outFrom = segmentStart(path, outIdx)
  const sin = spanOf(incoming, inFrom)
  const sout = spanOf(outgoing, outFrom)
  const phi = signedAngle(tangentAt(incoming, inFrom, sin.hi), tangentAt(outgoing, outFrom, sout.lo))
  if (Math.abs(phi) < 1e-9) return { path, problems: [] }
  const solved = filletCentre(incoming, inFrom, outgoing, outFrom, Math.sign(phi), radius)
  if (solved === null) {
    return { path, problems: [geometryProblem('arc-radius-too-small', [inIdx + 1, outIdx + 1], { values: [radius] })] }
  }
  const { centre, t1, t2 } = solved
  const trimIn = lengthBetween(incoming, inFrom, t1, sin.hi)
  const trimOut = lengthBetween(outgoing, outFrom, sout.lo, t2)
  const problems: GeometryProblem[] = []
  if (trimIn > lengthOf(incoming, inFrom) + TOLERANCE_MM) {
    problems.push(geometryProblem('corner-radii-overlap', [inIdx + 1], { values: [trimIn, lengthOf(incoming, inFrom)] }))
  }
  if (trimOut > lengthOf(outgoing, outFrom) + TOLERANCE_MM) {
    problems.push(geometryProblem('corner-radii-overlap', [outIdx + 1], { values: [trimOut, lengthOf(outgoing, outFrom)] }))
  }
  if (problems.length > 0) return { path, problems }
  const sweepDeg = signedAngle(tangentAt(incoming, inFrom, t1), tangentAt(outgoing, outFrom, t2)) / DEG
  const startIn = pointOn(incoming, inFrom, t1)
  const startOut = pointOn(outgoing, outFrom, t2)
  const arc: Segment = { kind: 'arc', to: startOut, center: centre, sweepDeg }
  // The cycle is rebuilt from the corner outwards and then rotated back so the segment
  // that used to be first is first again, which keeps `path.start` meaningful.
  const cycle: { segment: Segment; start: Pt; origin: number }[] = [
    { segment: pieceSegment(incoming, inFrom, sin.lo, t1), start: inFrom, origin: inIdx },
    { segment: arc, start: startIn, origin: -1 },
    { segment: pieceSegment(outgoing, outFrom, t2, sout.hi), start: startOut, origin: outIdx },
  ]
  for (let k = 0; k < n; k++) {
    const idx = (outIdx + 1 + k) % n
    if (idx === inIdx) break
    cycle.push({ segment: path.segments[idx], start: segmentStart(path, idx), origin: idx })
  }
  const head = Math.max(cycle.findIndex((entry) => entry.origin === 0), 0)
  const rotated = [...cycle.slice(head), ...cycle.slice(0, head)]
  return { path: closeUp(rotated), problems: [] }
}

/** Drop the segments a trim shortened to nothing, keeping the chain and its start unbroken. */
const closeUp = (cycle: { segment: Segment; start: Pt }[]): ClosedPath => {
  const segments: Segment[] = []
  let start = cycle[0].start
  for (const entry of cycle) {
    if (lengthOf(entry.segment, entry.start) <= TOLERANCE_MM) continue
    if (segments.length === 0) start = entry.start
    segments.push(entry.segment)
  }
  return { start, segments }
}

/**
 * True when the two segments meeting at a joint run into each other without a kink. The
 * test is geometric, not an angle constant: the drift the kink builds up over the shorter
 * neighbour has to stay inside `TOLERANCE_MM`.
 */
const tangentJoint = (before: Segment, beforeFrom: Pt, after: Segment, afterFrom: Pt): boolean => {
  const kink = Math.abs(signedAngle(
    tangentAt(before, beforeFrom, spanOf(before, beforeFrom).hi),
    tangentAt(after, afterFrom, spanOf(after, afterFrom).lo),
  ))
  const lever = Math.min(lengthOf(before, beforeFrom), lengthOf(after, afterFrom))
  return Math.sin(kink) * lever <= TOLERANCE_MM
}

/**
 * True for a circular arc tangent to both neighbours (behaviour 14). Tangency is read off
 * the geometry, never off a stored relationship.
 */
export const isTangentFillet = (path: ClosedPath, segmentIndex: number): boolean => {
  const n = path.segments.length
  const i = segmentIndex - 1
  const segment = path.segments[i]
  if (segment.kind !== 'arc') return false
  const prev = (i - 1 + n) % n
  const next = (i + 1) % n
  return tangentJoint(path.segments[prev], segmentStart(path, prev), segment, segmentStart(path, i))
    && tangentJoint(segment, segmentStart(path, i), path.segments[next], segmentStart(path, next))
}

/**
 * Round every corner that is not already tangent-continuous, at the same radius. Either
 * every fillet is applied or a problem list comes back and nothing changes.
 */
export const roundAllCorners = (path: ClosedPath, radius: number): EditResult => {
  let current = path
  for (let guard = 0; guard <= path.segments.length; guard++) {
    const vertex = firstKink(current)
    if (vertex === null) return { path: current, problems: [] }
    const result = fillet(current, vertex, radius)
    if (result.problems.length > 0) return { path, problems: result.problems }
    current = result.path
  }
  return { path, problems: [geometryProblem('corner-radii-overlap', [])] }
}

/** The first vertex whose two neighbours meet at a kink, or `null` when there are none. */
const firstKink = (path: ClosedPath): number | null => {
  const n = path.segments.length
  for (let k = 1; k <= n; k++) {
    const inIdx = (k - 2 + n) % n
    const outIdx = (k - 1) % n
    if (!tangentJoint(path.segments[inIdx], segmentStart(path, inIdx), path.segments[outIdx], segmentStart(path, outIdx))) {
      return k
    }
  }
  return null
}

/**
 * Change the radius of an existing tangent fillet (behaviour 14). The original corner is
 * reconstructed by extending both neighbours to where they meet, the arc is removed, and
 * the corner is filleted again at the new radius — so the result is tangent again and both
 * neighbours are re-trimmed. Nothing is stored about the corner in between.
 *
 * `arc-not-closed` naming the edge says the segment is not a tangent fillet, so there is
 * no corner to reconstruct.
 */
export const setFilletRadius = (path: ClosedPath, segmentIndex: number, radius: number): EditResult => {
  if (!isTangentFillet(path, segmentIndex)) {
    return { path, problems: [geometryProblem('arc-not-closed', [segmentIndex])] }
  }
  const n = path.segments.length
  const i = segmentIndex - 1
  const prev = (i - 1 + n) % n
  const next = (i + 1) % n
  const corner = supportIntersection(
    path.segments[prev],
    segmentStart(path, prev),
    path.segments[next],
    segmentStart(path, next),
  )
  if (corner === null) return { path, problems: [geometryProblem('arc-not-closed', [segmentIndex])] }
  const rebuilt: Segment[] = []
  for (let k = 0; k < n; k++) {
    if (k === i) continue
    rebuilt.push(k === prev ? { ...path.segments[k], to: corner } : path.segments[k])
  }
  const start = i === 0 ? corner : path.start
  return fillet({ start, segments: rebuilt }, i >= n - 1 ? 1 : i + 1, radius)
}

/**
 * Where the two curves a joint's neighbours lie on meet again — the corner a fillet cut
 * off. Straight neighbours extend to their lines; circular ones to their circles.
 */
const supportIntersection = (before: Segment, beforeFrom: Pt, after: Segment, afterFrom: Pt): Pt | null => {
  const candidates = locusIntersect(supportLocus(before, beforeFrom), supportLocus(after, afterFrom))
  const sin = spanOf(before, beforeFrom)
  const sout = spanOf(after, afterFrom)
  const extended = candidates.find(
    (at) => paramOf(before, beforeFrom, at) >= sin.hi && paramOf(after, afterFrom, at) <= sout.lo,
  )
  return extended ?? (candidates.length === 0 ? null : candidates[0])
}
