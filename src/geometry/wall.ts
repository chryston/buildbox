/**
 * The reference line of a Wall (#64, #20 §7).
 *
 * A Wall is drawn along one straight or circular-arc reference: the arc arrives as three
 * points — `start`, `end`, and any `through` strictly between them — because that is what a
 * bulge gesture produces and what a numeric radius edit re-solves. The centre, radius and
 * sweep are always derived from those three points and never stored, so there is exactly one
 * arc a Wall describes.
 *
 * `geometry` may not import `domain` (ADR 0003), so the shape is spelled here and `domain`
 * names it again; the two are the same type, not two types that happen to agree.
 */
import { DEG, arcPoint, arcTangent, distance, normaliseDeg, sub } from './segment'
import type { ArcForm } from './segment'
import type { Pt, Segment } from './types'
import { TOLERANCE_MM, pt } from './types'

/** A Wall's reference line: straight, or a circular arc through a third point. */
export type WallRefLine =
  | { kind: 'line'; start: Pt; end: Pt }
  | { kind: 'arc'; start: Pt; end: Pt; through: Pt }

/** The circle through three points, in the same shape `arcForm` reads. */
export interface ArcThrough {
  center: Pt
  radius: number
  /** The parametric angle of `start`, and the signed sweep to `end` past `through`. */
  t0: number
  t1: number
}

/** A circle in the shape `arcPoint` and `arcTangent` read, for a centre, radius and span. */
const circle = (center: Pt, radius: number, t0: number, t1: number): ArcForm => ({
  center,
  rx: radius,
  ry: radius,
  phi: 0,
  t0,
  t1,
  circular: true,
})

/**
 * The unique circle through three points, or `null` when they are collinear — which is the
 * degenerate arc the validator refuses (#64 §4). Collinearity is judged by the perpendicular
 * distance of `through` from the `start`–`end` chord against the one topology tolerance.
 */
export const arcFromThrough = (start: Pt, through: Pt, end: Pt): ArcThrough | null => {
  const ax = through.x - start.x
  const ay = through.y - start.y
  const bx = end.x - start.x
  const by = end.y - start.y
  const denominator = 2 * (ax * by - ay * bx)
  if (Math.abs(denominator) < 1e-9) return null
  const chord = Math.hypot(bx, by)
  if (chord <= TOLERANCE_MM) return null
  // The sagitta: how far `through` stands off the chord. Under the tolerance, no circle.
  const sagitta = Math.abs(bx * ay - by * ax) / chord
  if (sagitta <= TOLERANCE_MM) return null
  const aa = ax * ax + ay * ay
  const bb = bx * bx + by * by
  const ux = (by * aa - ay * bb) / denominator
  const uy = (ax * bb - bx * aa) / denominator
  const center = pt(start.x + ux, start.y + uy)
  const radius = Math.hypot(ux, uy)
  const angle = (at: Pt): number => Math.atan2(at.y - center.y, at.x - center.x)
  const t0 = angle(start)
  const mid = angle(through)
  const raw = angle(end)
  // The sweep is the turn from `start` to `end` that passes through `through`, signed by the
  // direction of that turn, so a `through` on the far side gives a major arc (#64 §1).
  const turn = (from: number, to: number): number => {
    let d = to - from
    while (d > Math.PI) d -= Math.PI * 2
    while (d <= -Math.PI) d += Math.PI * 2
    return d
  }
  const first = turn(t0, mid)
  const second = turn(mid, raw)
  const signed = Math.sign(first) === Math.sign(second) || Math.abs(first) + Math.abs(second) < Math.PI
    ? first + second
    : first + second + (first >= 0 ? Math.PI * 2 : -Math.PI * 2)
  return { center, radius, t0, t1: t0 + signed }
}

/** The reference line as the kernel's own segment, with the point it starts at. */
export const refSegment = (line: WallRefLine): { segment: Segment; from: Pt } => {
  if (line.kind === 'line') return { segment: { kind: 'line', to: line.end }, from: line.start }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return { segment: { kind: 'line', to: line.end }, from: line.start }
  return {
    segment: {
      kind: 'arc',
      to: line.end,
      center: arc.center,
      sweepDeg: (arc.t1 - arc.t0) / DEG,
    },
    from: line.start,
  }
}

/** The length along the reference line: the chord's length, or the arc length. */
export const refLength = (line: WallRefLine): number => {
  if (line.kind === 'line') return distance(line.start, line.end)
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return distance(line.start, line.end)
  return arc.radius * Math.abs(arc.t1 - arc.t0)
}

/** The point of the reference line `at` millimetres along it from `start`. */
export const refPointAt = (line: WallRefLine, at: number): Pt => {
  if (line.kind === 'line') {
    const d = sub(line.end, line.start)
    const l = Math.hypot(d.x, d.y) || 1
    return pt(line.start.x + (d.x * at) / l, line.start.y + (d.y * at) / l)
  }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return line.start
  const sweep = arc.t1 - arc.t0
  const t = arc.t0 + (sweep === 0 ? 0 : (at / arc.radius) * Math.sign(sweep))
  return arcPoint(circle(arc.center, arc.radius, arc.t0, arc.t1), t)
}

/** The tangent direction in degrees at one end of the reference line, clockwise, [0, 360). */
export const refTangentDeg = (line: WallRefLine, end: 'start' | 'end'): number => {
  if (line.kind === 'line') {
    const d = sub(line.end, line.start)
    return normaliseDeg(Math.atan2(d.y, d.x) / DEG)
  }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return 0
  const form = circle(arc.center, arc.radius, arc.t0, arc.t1)
  const d = arcTangent(form, end === 'start' ? arc.t0 : arc.t1)
  return normaliseDeg(Math.atan2(d.y, d.x) / DEG)
}

/** The distance from `at` to the reference line, measured to the curve itself. */
export const refDistance = (line: WallRefLine, at: Pt): number => {
  if (line.kind === 'line') {
    const d = sub(line.end, line.start)
    const squared = d.x * d.x + d.y * d.y
    if (squared === 0) return distance(at, line.start)
    const t = Math.min(1, Math.max(0, ((at.x - line.start.x) * d.x + (at.y - line.start.y) * d.y) / squared))
    return distance(at, pt(line.start.x + d.x * t, line.start.y + d.y * t))
  }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return distance(at, line.start)
  const raw = Math.atan2(at.y - arc.center.y, at.x - arc.center.x)
  const lo = Math.min(arc.t0, arc.t1)
  const hi = Math.max(arc.t0, arc.t1)
  let t = raw
  while (t < lo) t += Math.PI * 2
  while (t > hi) t -= Math.PI * 2
  const clamped = Math.min(hi, Math.max(lo, t))
  const onArc = arcPoint(circle(arc.center, arc.radius, arc.t0, arc.t1), clamped)
  const ends = [distance(at, line.start), distance(at, line.end)]
  return Math.min(distance(at, onArc), ...ends)
}

/**
 * The reference line moved `offset` millimetres sideways, positive along the reference's own
 * normal — the same normal `linearElement` offsets the faces by, so a face of a Wall is
 * exactly `offsetRefLine` of its reference line at that face's offset (#64).
 *
 * An arc offsets to a concentric arc with radius `radius + offset`, keeping the same centre
 * and the same angular span, which is what a wall band along a curve is. A reference line
 * pushed through the centre of its own circle has no arc left and comes back as the straight
 * line between its ends.
 */
export const offsetRefLine = (line: WallRefLine, offset: number): WallRefLine => {
  if (line.kind === 'line') {
    const d = sub(line.end, line.start)
    const l = Math.hypot(d.x, d.y)
    if (l === 0) return line
    const nx = (-d.y / l) * offset
    const ny = (d.x / l) * offset
    return { kind: 'line', start: pt(line.start.x + nx, line.start.y + ny), end: pt(line.end.x + nx, line.end.y + ny) }
  }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return line
  const radius = arc.radius + offset
  if (radius <= 0) return { kind: 'line', start: line.start, end: line.end }
  const form = circle(arc.center, radius, arc.t0, arc.t1)
  const at = (t: number): Pt => arcPoint(form, t)
  return { kind: 'arc', start: at(arc.t0), end: at(arc.t1), through: at(arc.t0 + (arc.t1 - arc.t0) / 2) }
}

/** The distance along the reference line of the point nearest `at`, clamped to the span. */
export const refParamAt = (line: WallRefLine, at: Pt): number => {
  if (line.kind === 'line') {
    const d = sub(line.end, line.start)
    const squared = d.x * d.x + d.y * d.y
    if (squared === 0) return 0
    const t = ((at.x - line.start.x) * d.x + (at.y - line.start.y) * d.y) / squared
    return Math.min(1, Math.max(0, t)) * Math.sqrt(squared)
  }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return 0
  const raw = Math.atan2(at.y - arc.center.y, at.x - arc.center.x)
  const lo = Math.min(arc.t0, arc.t1)
  const hi = Math.max(arc.t0, arc.t1)
  let t = raw
  while (t < lo) t += Math.PI * 2
  while (t > hi) t -= Math.PI * 2
  const clamped = Math.min(hi, Math.max(lo, t))
  return Math.abs(clamped - arc.t0) * arc.radius
}
