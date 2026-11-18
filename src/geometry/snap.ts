/**
 * Object-snap candidates (#54 §8).
 *
 * These are the points the drawing tools will offer while a command is in flight: the
 * endpoints and midpoints of edges, the centres of arcs, where two paths meet, the foot of
 * a perpendicular and the tangent lines from a point. Every one of them is computed on the
 * exact curve, so a snap lands on the outline rather than on the polyline that draws it.
 */
import { intersect } from './intersect'
import { arcForm, centre, distance, midpoint, segmentStart, sub } from './segment'
import type { ClosedPath, Pt, Segment } from './types'
import { pt } from './types'

/** The corners of a path: the start of every edge, which is also the end of the one before. */
export const endpoints = (path: ClosedPath): Pt[] =>
  path.segments.map((_segment, i) => segmentStart(path, i))

/** The midpoint of every edge, measured along the curve. */
export const midpoints = (path: ClosedPath): Pt[] =>
  path.segments.map((segment, i) => midpoint(segment, segmentStart(path, i)))

/** The centres of the path's circular and elliptical arcs. */
export const centres = (path: ClosedPath): Pt[] =>
  path.segments.map(centre).filter((at): at is Pt => at !== null)

/** Where two paths meet: crossings and tangential touches, in the order `intersect` gives. */
export const intersections = (a: ClosedPath, b: ClosedPath): Pt[] => {
  const both = intersect(a, b)
  const seen: Pt[] = []
  for (const at of [...both.crossings, ...both.touches]) {
    if (!seen.some((other) => distance(other, at) < 1e-6)) seen.push(at)
  }
  return seen
}

/**
 * The foot of the perpendicular from `at` to a segment's curve: the point of the curve
 * whose tangent runs square to the line joining it to `at`, on the curve extended past its
 * endpoints. A straight edge has exactly one; a circle has the two radial points.
 */
export const perpendicularFoot = (at: Pt, segment: Segment, from: Pt): Pt | null => {
  if (segment.kind === 'line') {
    const d = sub(segment.to, from)
    const dd = d.x * d.x + d.y * d.y
    if (dd === 0) return null
    const t = ((at.x - from.x) * d.x + (at.y - from.y) * d.y) / dd
    return pt(from.x + d.x * t, from.y + d.y * t)
  }
  const form = arcForm(segment, from)
  const radial = Math.atan2(at.y - form.center.y, at.x - form.center.x)
  const candidates = [radial, radial + Math.PI]
    .map((angle) => pt(
      form.center.x + form.rx * Math.cos(angle),
      form.center.y + form.ry * Math.sin(angle),
    ))
    .filter((candidate) => distance(candidate, at) > 0)
  if (candidates.length === 0) return null
  return candidates.reduce((best, candidate) => (distance(candidate, at) < distance(best, at) ? candidate : best))
}

/**
 * The points on a segment where a line drawn from `at` is tangent to it. A straight edge
 * has none — every line to it meets it at one point only, never tangentially — and a
 * circle has the usual pair, which is what lets a dimension run square off an arc.
 */
export const tangentPoints = (at: Pt, segment: Segment, from: Pt): Pt[] => {
  if (segment.kind === 'line') return []
  const form = arcForm(segment, from)
  if (!form.circular) return []
  const d = sub(at, form.center)
  const dd = Math.hypot(d.x, d.y)
  if (dd <= form.rx) return []
  const base = Math.atan2(d.y, d.x)
  const half = Math.acos(form.rx / dd)
  return [base - half, base + half].map((angle) => pt(
    form.center.x + form.rx * Math.cos(angle),
    form.center.y + form.rx * Math.sin(angle),
  ))
}
