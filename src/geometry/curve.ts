/**
 * Curve primitives: exact points, tangents, nearest points, distances and pairwise
 * intersections of two segments (#54 §4, §8).
 *
 * Lines and circular arcs are closed form throughout. An elliptical arc is exact for
 * points and tangents; where a solve has no closed form — nearest point, distance to
 * another curve, intersection with another ellipse — the curve is subdivided until every
 * piece lies within `TOLERANCE_MM` of its chord, the piecewise solve runs, and the result
 * is refined onto the exact curves by bisection. The subdivision bounds the error, which
 * is what #20 §2 asks for, and nothing here is used by `flatten`.
 */
import { arcForm, arcPoint, arcTangent, cross, DEG, distance, dot, sub } from './segment'
import type { ArcForm } from './segment'
import type { ClosedPath, EllipticalArcSegment, Pt, Segment } from './types'
import { TOLERANCE_MM, pt } from './types'

/** A segment's supporting curve, extended as far as it goes: a line, or a full circle. */
export interface Locus {
  kind: 'line' | 'circle'
  /** A point on the line, or the circle's centre. */
  point: Pt
  /** The line's unit direction; unused for a circle. */
  dir: Pt
  radius: number
}

/** The curve a segment lies on, extended past its endpoints. */
export const supportLocus = (segment: Segment, from: Pt): Locus => {
  if (segment.kind === 'line') {
    const d = sub(segment.to, from)
    const l = Math.hypot(d.x, d.y)
    return { kind: 'line', point: from, dir: { x: d.x / l, y: d.y / l }, radius: 0 }
  }
  const form = arcForm(segment, from)
  return {
    kind: 'circle',
    point: form.center,
    dir: { x: 1, y: 0 },
    radius: form.circular ? form.rx : Math.max(form.rx, form.ry),
  }
}

/** Where two supporting curves meet, which is where a corner between them would be. */
export const locusIntersect = (a: Locus, b: Locus): Pt[] => {
  if (a.kind === 'line' && b.kind === 'line') {
    const qp = sub(b.point, a.point)
    const denominator = cross(a.dir, b.dir)
    if (Math.abs(denominator) < 1e-12) return []
    const t = cross(qp, b.dir) / denominator
    return [{ x: a.point.x + a.dir.x * t, y: a.point.y + a.dir.y * t }]
  }
  if (a.kind === 'line' || b.kind === 'line') {
    const [line, circle] = a.kind === 'line' ? [a, b] : [b, a]
    const q = sub(circle.point, line.point)
    const along = dot(q, line.dir)
    const squared = circle.radius * circle.radius - (dot(q, q) - along * along)
    if (squared < 0) return []
    const root = Math.sqrt(squared)
    return [-root, root].map((d) => ({
      x: line.point.x + line.dir.x * (along + d),
      y: line.point.y + line.dir.y * (along + d),
    }))
  }
  const d = sub(b.point, a.point)
  const dd = Math.hypot(d.x, d.y)
  if (dd === 0 || dd > a.radius + b.radius || dd < Math.abs(a.radius - b.radius)) return []
  const along = (a.radius * a.radius - b.radius * b.radius + dd * dd) / (2 * dd)
  const squared = a.radius * a.radius - along * along
  if (squared < 0) return []
  const root = Math.sqrt(squared)
  const base = { x: a.point.x + (d.x * along) / dd, y: a.point.y + (d.y * along) / dd }
  const offset = { x: (d.y * root) / dd, y: (-d.x * root) / dd }
  return [
    { x: base.x + offset.x, y: base.y + offset.y },
    { x: base.x - offset.x, y: base.y - offset.y },
  ]
}

/** The parametric interval of a segment: `[0, 1]` for a line, `[t0, t1]` for an arc. */
export interface Span {
  lo: number
  hi: number
}

export const spanOf = (segment: Segment, from: Pt): Span => {
  if (segment.kind === 'line') return { lo: 0, hi: 1 }
  const form = arcForm(segment, from)
  return { lo: form.t0, hi: form.t1 }
}

/** The point of a segment at its own parameter. */
export const pointOn = (segment: Segment, from: Pt, t: number): Pt => {
  if (segment.kind === 'line') {
    return pt(from.x + (segment.to.x - from.x) * t, from.y + (segment.to.y - from.y) * t)
  }
  return arcPoint(arcForm(segment, from), t)
}

/** The unit tangent of a segment at its own parameter. */
export const tangentOn = (segment: Segment, from: Pt, t: number): Pt => {
  if (segment.kind === 'line') {
    const d = sub(segment.to, from)
    const n = Math.hypot(d.x, d.y) || 1
    return pt(d.x / n, d.y / n)
  }
  const d = arcTangent(arcForm(segment, from), t)
  const n = Math.hypot(d.x, d.y) || 1
  return pt(d.x / n, d.y / n)
}

/** The y-component of the tangent, which decides the sign of a ray crossing. */
const dyOn = (segment: Segment, from: Pt, t: number): number => {
  if (segment.kind === 'line') return segment.to.y - from.y
  return arcTangent(arcForm(segment, from), t).y
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

const clampSpan = (t: number, span: Span): number =>
  span.lo <= span.hi ? Math.min(Math.max(t, span.lo), span.hi) : Math.min(Math.max(t, span.hi), span.lo)

/**
 * The nearest point of a segment to `p`, with its distance. Lines and circular arcs are
 * closed form; an elliptical arc is solved by coarse scan then golden-section refinement
 * until the parameter interval is small enough that the curve cannot move 0.01 mm.
 */
export const nearestOnSegment = (p: Pt, segment: Segment, from: Pt): { point: Pt; t: number; distance: number } => {
  const span = spanOf(segment, from)
  if (segment.kind === 'line') {
    const d = sub(segment.to, from)
    const squared = d.x * d.x + d.y * d.y
    const t = squared === 0 ? 0 : clamp01(((p.x - from.x) * d.x + (p.y - from.y) * d.y) / squared)
    const point = pointOn(segment, from, t)
    return { point, t, distance: distance(p, point) }
  }
  const form = arcForm(segment, from)
  if (form.circular) {
    const raw = Math.atan2(p.y - form.center.y, p.x - form.center.x)
    const t = clampSpan(alignTo(raw, form.t0, form.t1), span)
    const point = arcPoint(form, t)
    return { point, t, distance: distance(p, point) }
  }
  const t = refineNearestElliptic(p, form)
  const point = arcPoint(form, t)
  return { point, t, distance: distance(p, point) }
}

/** The polar angle `raw` carried by whole turns to the arc's own interval. */
const alignTo = (raw: number, t0: number, t1: number): number => {
  const span = t1 - t0
  if (span === 0) return raw
  const k = Math.round((t0 - raw) / (Math.PI * 2))
  return raw + k * Math.PI * 2
}

/** Golden-section search for the nearest parametric angle of an elliptical arc. */
const refineNearestElliptic = (p: Pt, form: ArcForm): number => {
  const lo = Math.min(form.t0, form.t1)
  const hi = Math.max(form.t0, form.t1)
  const f = (t: number): number => {
    const q = arcPoint(form, t)
    return (q.x - p.x) ** 2 + (q.y - p.y) ** 2
  }
  // Coarse scan first: an ellipse's distance function is not unimodal over a long sweep.
  const steps = Math.max(8, Math.ceil(Math.abs(hi - lo) / DEG / 5))
  let best = lo
  let bestValue = f(lo)
  for (let i = 1; i <= steps; i++) {
    const t = lo + ((hi - lo) * i) / steps
    const value = f(t)
    if (value < bestValue) {
      bestValue = value
      best = t
    }
  }
  const window = (hi - lo) / steps
  let a = Math.max(lo, best - window)
  let b = Math.min(hi, best + window)
  const golden = 0.6180339887498949
  for (let i = 0; i < 60; i++) {
    const m1 = b - (b - a) * golden
    const m2 = a + (b - a) * golden
    if (f(m1) < f(m2)) b = m2
    else a = m1
    if (b - a < 1e-12) break
  }
  return (a + b) / 2
}

/** The distance from a point to a segment. */
export const distanceToSegment = (p: Pt, segment: Segment, from: Pt): number =>
  nearestOnSegment(p, segment, from).distance

/**
 * The minimum distance between two segments. Lines and circular arcs are closed form;
 * anything elliptical runs a scan-then-refine over both parameters.
 */
export const distanceBetweenSegments = (
  a: Segment,
  aFrom: Pt,
  b: Segment,
  bFrom: Pt,
): { distance: number; at: Pt; onA: Pt; onB: Pt } => {
  const sa = spanOf(a, aFrom)
  const sb = spanOf(b, bFrom)
  const pair = (ta: number, tb: number): { d: number; pa: Pt; pb: Pt } => {
    const pa = pointOn(a, aFrom, ta)
    const pb = pointOn(b, bFrom, tb)
    return { d: distance(pa, pb), pa, pb }
  }
  if (a.kind === 'line' && b.kind === 'line') {
    const near = closestOnLines(a, aFrom, b, bFrom)
    return { distance: near.d, at: near.pa, onA: near.pa, onB: near.pb }
  }
  // Scan each curved parameter against the exact nearest point of the other curve. Two
  // samples every degree is finer than the tolerance can distinguish on any real radius.
  let best = pair(sa.lo, sb.lo)
  const scan = (
    arc: Segment,
    arcFrom: Pt,
    arcSpan: Span,
    other: Segment,
    otherFrom: Pt,
    flipped: boolean,
  ): number => {
    const steps = Math.max(16, Math.ceil((Math.abs(arcSpan.hi - arcSpan.lo) / DEG) / 2))
    for (let i = 0; i <= steps; i++) {
      const t = arcSpan.lo + ((arcSpan.hi - arcSpan.lo) * i) / steps
      const q = pointOn(arc, arcFrom, t)
      const near = nearestOnSegment(q, other, otherFrom)
      const candidate = flipped
        ? { d: near.distance, pa: near.point, pb: q }
        : { d: near.distance, pa: q, pb: near.point }
      if (candidate.d < best.d) best = candidate
    }
    return (arcSpan.hi - arcSpan.lo) / steps
  }
  const stepA = scan(a, aFrom, sa, b, bFrom, false)
  const stepB = scan(b, bFrom, sb, a, aFrom, true)
  // Polish with a shrinking window, which makes the scan's answer exact to float64.
  let ta = nearestOnSegment(best.pa, a, aFrom).t
  let tb = nearestOnSegment(best.pb, b, bFrom).t
  for (let shrink = Math.max(stepA, stepB); shrink > 1e-12; shrink /= 2) {
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const candidate = pair(clampSpan(ta + i * shrink, sa), clampSpan(tb + j * shrink, sb))
        if (candidate.d < best.d) best = candidate
      }
    }
    ta = nearestOnSegment(best.pa, a, aFrom).t
    tb = nearestOnSegment(best.pb, b, bFrom).t
  }
  return { distance: best.d, at: best.pa, onA: best.pa, onB: best.pb }
}

/**
 * The distance between two straight segments: the minimum of the four endpoint-to-segment
 * distances, which is exact unless they meet, when it is zero at the meeting point.
 */
const closestOnLines = (a: Segment, aFrom: Pt, b: Segment, bFrom: Pt): { d: number; pa: Pt; pb: Pt } => {
  const met = lineLinePoint(a, aFrom, b, bFrom)
  if (met !== null) return { d: 0, pa: met, pb: met }
  const sa = spanOf(a, aFrom)
  const sb = spanOf(b, bFrom)
  let best: { d: number; pa: Pt; pb: Pt } | null = null
  for (const ta of [sa.lo, sa.hi]) {
    const q = pointOn(a, aFrom, ta)
    const near = nearestOnSegment(q, b, bFrom)
    const candidate = { d: near.distance, pa: q, pb: near.point }
    if (best === null || candidate.d < best.d) best = candidate
  }
  for (const tb of [sb.lo, sb.hi]) {
    const q = pointOn(b, bFrom, tb)
    const near = nearestOnSegment(q, a, aFrom)
    const candidate = { d: near.distance, pa: near.point, pb: q }
    if (best === null || candidate.d < best.d) best = candidate
  }
  return best ?? { d: 0, pa: aFrom, pb: bFrom }
}

/** The single point where two non-parallel straight segments meet, or `null`. */
const lineLinePoint = (a: Segment, aFrom: Pt, b: Segment, bFrom: Pt): Pt | null => {
  const r = sub(a.to, aFrom)
  const s = sub(b.to, bFrom)
  const denominator = r.x * s.y - r.y * s.x
  if (Math.abs(denominator) < 1e-12) return null
  const qp = sub(bFrom, aFrom)
  const t = (qp.x * s.y - qp.y * s.x) / denominator
  const u = (qp.x * r.y - qp.y * r.x) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return pointOn(a, aFrom, t)
}

/** One point where two segments meet, with the classification #54 §3 asks for. */
export interface SegmentMeeting {
  at: Pt
  kind: 'cross' | 'touch'
}

/** A stretch where two segments run together, in each segment's own parameter. */
export interface SegmentOverlap {
  from: Pt
  to: Pt
  a: [number, number]
  b: [number, number]
}

export interface SegmentIntersections {
  crossings: SegmentMeeting[]
  touches: SegmentMeeting[]
  overlaps: SegmentOverlap[]
}

const emptyMeetings = (): SegmentIntersections => ({ crossings: [], touches: [], overlaps: [] })

/**
 * Every meeting of two segments: transverse crossings, tangential or endpoint touches, and
 * collinear or co-circular overlap stretches. Symmetric in its arguments up to ordering,
 * which the fast-check property in §9 asserts.
 */
export const intersectSegments = (a: Segment, aFrom: Pt, b: Segment, bFrom: Pt): SegmentIntersections => {
  const out = emptyMeetings()
  const sa = spanOf(a, aFrom)
  const sb = spanOf(b, bFrom)
  if (a.kind === 'ellipticalArc' && b.kind === 'ellipticalArc') {
    const shared = sharedEllipse(a, aFrom, b, bFrom)
    if (shared !== null) {
      pushOverlap(out, a, aFrom, shared, shared)
      return out
    }
  }
  if (a.kind === 'line' && b.kind === 'line') {
    lineLine(a, aFrom, b, bFrom, out)
    return out
  }
  if (a.kind === 'ellipticalArc' || b.kind === 'ellipticalArc') {
    ellipticMeetings(a, aFrom, b, bFrom, out)
    return out
  }
  if (a.kind !== 'line' && b.kind !== 'line') {
    circleCircle(arcForm(a, aFrom), sa, arcForm(b, bFrom), sb, a, aFrom, b, bFrom, out)
    return out
  }
  if (a.kind !== 'line' && b.kind === 'line') {
    lineCircle(b, bFrom, arcForm(a, aFrom), a, aFrom, true, out)
    return out
  }
  if (a.kind === 'line' && b.kind !== 'line') {
    lineCircle(a, aFrom, arcForm(b, bFrom), b, bFrom, false, out)
    return out
  }
  return out
}

/**
 * The parametric stretch two elliptical arcs share when they lie on one ellipse, or `null`
 * when the ellipses differ or the sweeps do not overlap.
 */
const sharedEllipse = (
  a: EllipticalArcSegment,
  aFrom: Pt,
  b: EllipticalArcSegment,
  bFrom: Pt,
): [number, number] | null => {
  const same = distance(a.center, b.center) <= TOLERANCE_MM
    && Math.abs(a.rx - b.rx) <= TOLERANCE_MM
    && Math.abs(a.ry - b.ry) <= TOLERANCE_MM
    && Math.abs(normaliseDelta(a.rotationDeg, b.rotationDeg)) <= 1e-9
  if (!same) return null
  const fa = arcForm(a, aFrom)
  const fb = alignFrame(arcForm(b, bFrom), fa)
  const lo = Math.max(Math.min(fa.t0, fa.t1), Math.min(fb.t0, fb.t1))
  const hi = Math.min(Math.max(fa.t0, fa.t1), Math.max(fb.t0, fb.t1))
  return hi - lo > 1e-9 ? [lo, hi] : null
}

/** The same arc parameters carried by whole turns into `frame`'s range. */
const alignFrame = (form: ArcForm, frame: ArcForm): ArcForm => {
  const k = Math.round((frame.t0 - form.t0) / (Math.PI * 2))
  return { ...form, t0: form.t0 + k * Math.PI * 2, t1: form.t1 + k * Math.PI * 2 }
}

const normaliseDelta = (a: number, b: number): number => {
  let d = (a - b) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

const lineLine = (a: Segment, aFrom: Pt, b: Segment, bFrom: Pt, out: SegmentIntersections): void => {
  const r = sub(a.to, aFrom)
  const s = sub(b.to, bFrom)
  const qp = sub(bFrom, aFrom)
  const denominator = r.x * s.y - r.y * s.x
  if (Math.abs(denominator) < 1e-12) {
    collinearLines(a, aFrom, b, bFrom, r, qp, out)
    return
  }
  const t = (qp.x * s.y - qp.y * s.x) / denominator
  const u = (qp.x * r.y - qp.y * r.x) / denominator
  if (t < -TOLERANCE_MM || t > 1 + TOLERANCE_MM || u < -TOLERANCE_MM || u > 1 + TOLERANCE_MM) return
  const interior = t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9
  pushMeeting(out, a, aFrom, t, interior ? 'cross' : 'touch')
}

/** Two parallel segments: an overlap stretch when they share a line, nothing otherwise. */
const collinearLines = (
  a: Segment,
  aFrom: Pt,
  b: Segment,
  bFrom: Pt,
  r: Pt,
  qp: Pt,
  out: SegmentIntersections,
): void => {
  const rr = r.x * r.x + r.y * r.y
  if (rr === 0) return
  if (Math.abs(qp.x * r.y - qp.y * r.x) > TOLERANCE_MM * Math.hypot(r.x, r.y)) return
  const s = sub(b.to, bFrom)
  const ss = s.x * s.x + s.y * s.y
  if (ss === 0) return
  const onA = (p: Pt): number => ((p.x - aFrom.x) * r.x + (p.y - aFrom.y) * r.y) / rr
  const onB = (p: Pt): number => ((p.x - bFrom.x) * s.x + (p.y - bFrom.y) * s.y) / ss
  const lo = Math.max(0, Math.min(onA(bFrom), onA(b.to)))
  const hi = Math.min(1, Math.max(onA(bFrom), onA(b.to)))
  if (hi - lo > 1e-12) {
    pushOverlap(out, a, aFrom, [lo, hi], [onB(pointOn(a, aFrom, lo)), onB(pointOn(a, aFrom, hi))])
    return
  }
  if (hi >= -1e-9 && hi <= 1 + 1e-9) pushMeeting(out, a, aFrom, Math.min(Math.max(hi, 0), 1), 'touch')
}

const lineCircle = (
  line: Segment,
  lineFrom: Pt,
  form: ArcForm,
  arc: Segment,
  arcFrom: Pt,
  arcIsA: boolean,
  out: SegmentIntersections,
): void => {
  const d = sub(line.to, lineFrom)
  const f = sub(lineFrom, form.center)
  const rx = form.rx
  const aa = d.x * d.x + d.y * d.y
  const bb = 2 * (f.x * d.x + f.y * d.y)
  const cc = f.x * f.x + f.y * f.y - rx * rx
  const disc = bb * bb - 4 * aa * cc
  if (disc < 0 || aa === 0) return
  const root = Math.sqrt(disc)
  const tangent = root <= TOLERANCE_MM * Math.max(1, rx)
  for (const raw of tangent ? [-bb / (2 * aa)] : [(-bb - root) / (2 * aa), (-bb + root) / (2 * aa)]) {
    if (raw < -TOLERANCE_MM || raw > 1 + TOLERANCE_MM) continue
    const t = Math.min(Math.max(raw, 0), 1)
    const at = pointOn(line, lineFrom, t)
    const u = paramForPoint(arc, arcFrom, at)
    if (u === null) continue
    const interior = t > 1e-9 && t < 1 - 1e-9 && !atSpanEnd(u, arc, arcFrom)
    const kind = tangent || !interior ? 'touch' : 'cross'
    if (arcIsA) pushMeeting(out, arc, arcFrom, u, kind)
    else pushMeeting(out, line, lineFrom, t, kind)
  }
}

const circleCircle = (
  fa: ArcForm,
  sa: Span,
  fb: ArcForm,
  sb: Span,
  a: Segment,
  aFrom: Pt,
  b: Segment,
  bFrom: Pt,
  out: SegmentIntersections,
): void => {
  const d = sub(fb.center, fa.center)
  const dd = Math.hypot(d.x, d.y)
  if (dd <= TOLERANCE_MM && Math.abs(fa.rx - fb.rx) <= TOLERANCE_MM) {
    const lo = Math.max(Math.min(sa.lo, sa.hi), Math.min(sb.lo, sb.hi))
    const hi = Math.min(Math.max(sa.lo, sa.hi), Math.max(sb.lo, sb.hi))
    if (hi - lo > 1e-9) pushOverlap(out, a, aFrom, [lo, hi], [lo, hi])
    return
  }
  const r0 = fa.rx
  const r1 = fb.rx
  if (dd > r0 + r1 + TOLERANCE_MM || dd < Math.abs(r0 - r1) - TOLERANCE_MM || dd === 0) return
  const along = (r0 * r0 - r1 * r1 + dd * dd) / (2 * dd)
  const squared = r0 * r0 - along * along
  const h = Math.sqrt(Math.max(0, squared))
  const base = pt(fa.center.x + (d.x * along) / dd, fa.center.y + (d.y * along) / dd)
  const offset = pt((d.y * h) / dd, (-d.x * h) / dd)
  const tangent = h <= TOLERANCE_MM
  for (const at of tangent ? [base] : [pt(base.x + offset.x, base.y + offset.y), pt(base.x - offset.x, base.y - offset.y)]) {
    const ta = paramForPoint(a, aFrom, at)
    const tb = paramForPoint(b, bFrom, at)
    if (ta === null || tb === null) continue
    const interior = !atSpanEnd(ta, a, aFrom) && !atSpanEnd(tb, b, bFrom)
    pushMeeting(out, a, aFrom, ta, tangent || !interior ? 'touch' : 'cross')
  }
}

/**
 * The part of a segment between two of its own parameters, as a segment in its own right.
 * `from` is the piece's own start point, which the caller takes from `pointOn`.
 */
export const pieceSegment = (segment: Segment, from: Pt, t0: number, t1: number): Segment => {
  const to = pointOn(segment, from, t1)
  if (segment.kind === 'line') return { kind: 'line', to }
  const sweepDeg = (t1 - t0) / DEG
  return segment.kind === 'arc'
    ? { kind: 'arc', to, center: segment.center, sweepDeg }
    : { kind: 'ellipticalArc', to, center: segment.center, rx: segment.rx, ry: segment.ry, rotationDeg: segment.rotationDeg, sweepDeg }
}

/** The parameter of a segment at a point known to lie on it, or `null` when it does not. */
export const paramForPoint = (segment: Segment, from: Pt, at: Pt): number | null => {
  const near = nearestOnSegment(at, segment, from)
  if (near.distance > TOLERANCE_MM) return null
  return near.t
}

const atSpanEnd = (t: number, segment: Segment, from: Pt): boolean => {
  const span = spanOf(segment, from)
  return Math.abs(t - span.lo) <= 1e-9 || Math.abs(t - span.hi) <= 1e-9
}

const pushMeeting = (
  out: SegmentIntersections,
  a: Segment,
  aFrom: Pt,
  ta: number,
  kind: 'cross' | 'touch',
): void => {
  const at = pointOn(a, aFrom, ta)
  const target = kind === 'cross' ? out.crossings : out.touches
  if (target.some((m) => distance(m.at, at) <= TOLERANCE_MM)) return
  target.push({ at, kind })
}

const pushOverlap = (
  out: SegmentIntersections,
  a: Segment,
  aFrom: Pt,
  ta: [number, number],
  tb: [number, number],
): void => {
  const from = pointOn(a, aFrom, ta[0])
  const to = pointOn(a, aFrom, ta[1])
  if (distance(from, to) <= TOLERANCE_MM) return
  out.overlaps.push({ from, to, a: ta, b: tb })
}

/**
 * Meetings involving an elliptical arc: both curves are subdivided until every piece lies
 * within the tolerance of its chord, the closed-form pair solves run on the pieces, and
 * each candidate is refined onto both exact curves by bisection on the signed distance.
 */
const ellipticMeetings = (a: Segment, aFrom: Pt, b: Segment, bFrom: Pt, out: SegmentIntersections): void => {
  for (const pieceA of chordPieces(a, aFrom)) {
    for (const pieceB of chordPieces(b, bFrom)) {
      const local = emptyMeetings()
      lineLine({ kind: 'line', to: pieceA.to }, pieceA.from, { kind: 'line', to: pieceB.to }, pieceB.from, local)
      for (const meeting of [...local.crossings, ...local.touches]) {
        const at = refineOntoBoth(meeting.at, a, aFrom, b, bFrom)
        const kind = meeting.kind === 'cross' && !nearEnd(at, a, aFrom) && !nearEnd(at, b, bFrom) ? 'cross' : 'touch'
        const target = kind === 'cross' ? out.crossings : out.touches
        if (target.some((m) => distance(m.at, at) <= TOLERANCE_MM)) continue
        target.push({ at, kind })
      }
    }
  }
}

const nearEnd = (at: Pt, segment: Segment, from: Pt): boolean =>
  distance(at, from) <= TOLERANCE_MM || distance(at, segment.to) <= TOLERANCE_MM

/** Alternating projection onto the two exact curves, which converges in a few steps. */
const refineOntoBoth = (guess: Pt, a: Segment, aFrom: Pt, b: Segment, bFrom: Pt): Pt => {
  let at = guess
  for (let i = 0; i < 24; i++) {
    const onB = nearestOnSegment(at, b, bFrom).point
    const next = nearestOnSegment(onB, a, aFrom).point
    const settled = distance(at, next) <= 1e-12
    at = next
    if (settled) break
  }
  return at
}

interface ChordPiece {
  from: Pt
  to: Pt
}

/**
 * Split a segment into chords whose sagitta is within `TOLERANCE_MM`, so a closed-form
 * solve on the pieces is accurate to the tolerance (#54 §4).
 */
const chordPieces = (segment: Segment, from: Pt): ChordPiece[] => {
  if (segment.kind === 'line') return [{ from, to: segment.to }]
  const form = arcForm(segment, from)
  const radius = Math.max(form.rx, form.ry)
  const span = form.t1 - form.t0
  const perStep = radius > 0 ? Math.acos(Math.max(-1, 1 - TOLERANCE_MM / radius)) : Math.abs(span)
  const steps = Math.max(1, Math.ceil(Math.abs(span) / Math.max(perStep, 1e-6)))
  const out: ChordPiece[] = []
  for (let i = 0; i < steps; i++) {
    out.push({
      from: arcPoint(form, form.t0 + (span * i) / steps),
      to: arcPoint(form, form.t0 + (span * (i + 1)) / steps),
    })
  }
  return out
}

/** Every interior point where a segment crosses the ray `y = p.y, x > p.x`, with its sign. */
export const rayCrossings = (p: Pt, segment: Segment, from: Pt): { at: Pt; sign: 1 | -1 }[] => {
  const span = spanOf(segment, from)
  const out: { at: Pt; sign: 1 | -1 }[] = []
  const push = (t: number): void => {
    if (!strictlyInside(t, span)) return
    const at = pointOn(segment, from, t)
    if (at.x <= p.x) return
    const dy = dyOn(segment, from, t)
    if (dy === 0) return
    out.push({ at, sign: dy > 0 ? 1 : -1 })
  }
  if (segment.kind === 'line') {
    const y1 = segment.to.y
    if (from.y === y1) return out
    push((p.y - from.y) / (y1 - from.y))
    return out
  }
  for (const t of solveY(arcForm(segment, from), p.y)) push(t)
  return out
}

const strictlyInside = (t: number, span: Span): boolean =>
  span.lo < span.hi ? t > span.lo && t < span.hi : t < span.lo && t > span.hi

/** The parametric angles where an arc's y equals `y`, over the whole curve. */
const solveY = (form: ArcForm, y: number): number[] => {
  if (form.circular) {
    const v = (y - form.center.y) / form.rx
    if (Math.abs(v) > 1) return []
    const base = Math.asin(v)
    return [base, Math.PI - base]
  }
  const a = form.rx * Math.sin(form.phi)
  const b = form.ry * Math.cos(form.phi)
  const amplitude = Math.hypot(a, b)
  if (amplitude === 0) return []
  const psi = Math.atan2(b, a)
  const v = (y - form.center.y) / amplitude
  if (Math.abs(v) > 1) return []
  const delta = Math.acos(v)
  return [psi + delta, psi - delta]
}

/**
 * The winding number of a closed path about `p`, from exact crossings of the ray to +X.
 * Vertices that lie exactly on the ray are settled by the pair of tangents that meet
 * there, so a tangential touch contributes nothing and a genuine crossing once.
 */
export const windingNumber = (p: Pt, path: ClosedPath): number => {
  const n = path.segments.length
  let total = 0
  for (let i = 0; i < n; i++) {
    const from = i === 0 ? path.start : path.segments[i - 1].to
    for (const crossing of rayCrossings(p, path.segments[i], from)) total += crossing.sign
  }
  for (let i = 0; i < n; i++) {
    const vertex = i === 0 ? path.start : path.segments[i - 1].to
    if (vertex.y !== p.y || vertex.x <= p.x) continue
    const incoming = path.segments[(i - 1 + n) % n]
    const incomingFrom = (i - 1 + n) % n === 0 ? path.start : path.segments[(i - 2 + n) % n].to
    const outgoing = path.segments[i]
    const dIn = dyOn(incoming, incomingFrom, spanOf(incoming, incomingFrom).hi)
    const dOut = dyOn(outgoing, vertex, spanOf(outgoing, vertex).lo)
    if (dIn * dOut > 0) total += dOut > 0 ? 1 : -1
  }
  return total
}
