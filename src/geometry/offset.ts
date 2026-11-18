/**
 * Parallel offset (#54 §7).
 *
 * Each edge moves along its own normal and the corners are re-solved where two moved edges
 * meet again, which is what keeps a tangent joint tangent: a line and a circle that were
 * tangent are tangent after both move, so their two intersections have collapsed into one.
 * An elliptical arc has no parallel curve, so it is offset as an ellipse with both radii
 * grown by the same amount, which is exact to first order and within tolerance for the
 * shallow arcs an Item Footprint carries.
 */
import { locusIntersect, spanOf } from './curve'
import type { Locus } from './curve'
import { signedArea } from './measure'
import { add, arcForm, DEG, rotate, scale, segmentStart, sub } from './segment'
import type { ClosedPath, Pt, Segment } from './types'
import { TOLERANCE_MM, pt } from './types'

/**
 * The path moved `delta` mm perpendicular to itself, positive outwards. Edges that vanish
 * — a side offset away from itself between two corners that have crossed — are dropped.
 */
export const offset = (path: ClosedPath, delta: number): ClosedPath => {
  const n = path.segments.length
  const outward = Math.sign(signedArea(path)) || 1
  const moved = path.segments.map((segment, i) => offsetSegment(segment, segmentStart(path, i), delta, outward))
  const corners: (Pt | null)[] = path.segments.map((_segment, i) => {
    const before = moved[i]
    const after = moved[(i + 1) % n]
    if (before === null || after === null) return null
    return corner(before.locus, after.locus, outward)
  })
  const cycle: { segment: Segment; start: Pt }[] = []
  for (let i = 0; i < n; i++) {
    const movedSegment = moved[i]
    const start = corners[(i - 1 + n) % n]
    const end = corners[i]
    if (movedSegment === null || start === null || end === null) continue
    const segment = trim(movedSegment, start, end, path.segments[i], segmentStart(path, i))
    if (segment === null) continue
    cycle.push({ segment, start })
  }
  if (cycle.length === 0) return { start: path.start, segments: [] }
  return { start: cycle[0].start, segments: cycle.map((entry) => entry.segment) }
}

interface Moved {
  locus: Locus
  /** The arc centre and radii, moved with the edge. */
  center: Pt
  rx: number
  ry: number
  rotationDeg: number
  sweepDeg: number
}

/** The edge's own curve, moved `delta` outwards along its normal. */
const offsetSegment = (segment: Segment, from: Pt, delta: number, outward: number): Moved | null => {
  if (segment.kind === 'line') {
    const d = { x: segment.to.x - from.x, y: segment.to.y - from.y }
    const l = Math.hypot(d.x, d.y)
    if (l === 0) return null
    const n = pt((outward * d.y) / l, (-outward * d.x) / l)
    const point = pt(from.x + n.x * delta, from.y + n.y * delta)
    return {
      locus: { kind: 'line', point, dir: pt(d.x / l, d.y / l), radius: 0 },
      center: point,
      rx: 0,
      ry: 0,
      rotationDeg: 0,
      sweepDeg: 0,
    }
  }
  const form = arcForm(segment, from)
  const sense = Math.sign(segment.sweepDeg)
  if (segment.kind === 'arc') {
    const radius = form.rx + sense * delta
    if (radius <= TOLERANCE_MM) return null
    return {
      locus: { kind: 'circle', point: form.center, dir: pt(1, 0), radius },
      center: form.center,
      rx: radius,
      ry: radius,
      rotationDeg: 0,
      sweepDeg: segment.sweepDeg,
    }
  }
  return {
    locus: { kind: 'circle', point: form.center, dir: pt(1, 0), radius: Math.max(form.rx, form.ry) + delta },
    center: form.center,
    rx: form.rx + delta,
    ry: form.ry + delta,
    rotationDeg: segment.rotationDeg,
    sweepDeg: segment.sweepDeg,
  }
}

/**
 * Where two moved edges meet. Two candidates means a concave corner, where the outside of
 * one corner and the inside of the next both cross; the one further out from the original
 * corner is the one the outline actually takes.
 */
const corner = (a: Locus, b: Locus, outward: number): Pt | null => {
  const candidates = locusIntersect(a, b)
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const mid = a.kind === 'line' && b.kind === 'line'
    ? pt((a.point.x + b.point.x) / 2, (a.point.y + b.point.y) / 2)
    : candidates[0]
  const normal = a.kind === 'line' ? pt(outward * a.dir.y, -outward * a.dir.x) : pt(0, 0)
  return candidates.reduce((best, at) =>
    (at.x - mid.x) * normal.x + (at.y - mid.y) * normal.y >= (best.x - mid.x) * normal.x + (best.y - mid.y) * normal.y
      ? at
      : best,
  )
}

/** The moved edge cut or extended to run between its two new corners. */
const trim = (moved: Moved, start: Pt, end: Pt, original: Segment, from: Pt): Segment | null => {
  if (original.kind === 'line') {
    if (Math.hypot(end.x - start.x, end.y - start.y) <= TOLERANCE_MM) return null
    return { kind: 'line', to: end }
  }
  const span = spanOf(original, from)
  if (original.kind === 'arc') {
    const sweep = angleOf(moved.center, end) - angleOf(moved.center, start)
    const wrapped = wrap(sweep, span.hi - span.lo)
    if (Math.abs(wrapped) < TOLERANCE_MM / Math.max(moved.rx, 1)) return null
    return { kind: 'arc', to: end, center: moved.center, sweepDeg: wrapped / DEG }
  }
  return {
    kind: 'ellipticalArc',
    to: end,
    center: moved.center,
    rx: moved.rx,
    ry: moved.ry,
    rotationDeg: moved.rotationDeg,
    sweepDeg: original.sweepDeg,
  }
}

const angleOf = (centre: Pt, at: Pt): number => Math.atan2(at.y - centre.y, at.x - centre.x)

/** The angle closest to the original sweep, so a corner that has folded away is not kept. */
const wrap = (angle: number, original: number): number => {
  const turns = Math.round((original - angle) / (Math.PI * 2))
  return angle + turns * Math.PI * 2
}

const turnNormal = (v: Pt): Pt => pt(-v.y, v.x)

/** The two faces of an element of constant thickness and the outline between them. */
export interface LinearElement {
  faces: [Segment, Segment]
  outline: ClosedPath
}

/**
 * The two face segments and the outline of an element of constant thickness drawn along a
 * straight or circular-arc reference (#54 §8) — the primitive Walls, Beams and Service Runs
 * will share (#20 §7). `justification` says where the reference sits within the thickness:
 * on the centreline, or on the left or right face as the reference runs.
 *
 * A circular reference offsets analytically: both faces are concentric arcs with the same
 * sweep, so the thickness is exact everywhere. It does not join anything: `joinWalls` is
 * #64.
 */
export const linearElement = (
  reference: Segment,
  from: Pt,
  thickness: number,
  justification: 'left' | 'centre' | 'right',
): LinearElement => {
  const offsets: [number, number] = justification === 'centre'
    ? [-thickness / 2, thickness / 2]
    : justification === 'left' ? [0, thickness] : [-thickness, 0]
  if (reference.kind === 'line') {
    const normal = turnNormal(sub(reference.to, from))
    const at = (point: Pt, offset: number): Pt => add(point, scale(normal, offset))
    const faces: [Segment, Segment] = [
      { kind: 'line', to: at(reference.to, offsets[0]) },
      { kind: 'line', to: at(reference.to, offsets[1]) },
    ]
    const start = at(from, offsets[0])
    return {
      faces,
      outline: {
        start,
        segments: [
          faces[0],
          { kind: 'line', to: at(reference.to, offsets[1]) },
          { kind: 'line', to: at(from, offsets[1]) },
          { kind: 'line', to: start },
        ],
      },
    }
  }
  const form = arcForm(reference, from)
  const face = (offset: number): { start: Pt; segment: Segment } => {
    const radius = form.rx + offset
    const unit = scale(sub(from, form.center), 1 / Math.hypot(from.x - form.center.x, from.y - form.center.y))
    const end = rotate(unit, reference.sweepDeg)
    return {
      start: pt(form.center.x + unit.x * radius, form.center.y + unit.y * radius),
      segment: {
        kind: 'arc',
        to: pt(form.center.x + end.x * radius, form.center.y + end.y * radius),
        center: form.center,
        sweepDeg: reference.sweepDeg,
      },
    }
  }
  const near = face(offsets[0])
  const far = face(offsets[1])
  return {
    faces: [near.segment, far.segment],
    outline: {
      start: near.start,
      segments: [
        near.segment,
        { kind: 'line', to: far.segment.to },
        { kind: 'arc', to: far.start, center: form.center, sweepDeg: -reference.sweepDeg },
        { kind: 'line', to: near.start },
      ],
    },
  }
}
