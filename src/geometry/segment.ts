/**
 * Segment arithmetic (#54 §2): the analytic form every other file reads.
 *
 * A circular arc is treated as the degenerate ellipse `rx = ry = r, phi = 0`, so one
 * parametric form covers both kinds: `p(t) = c + R(phi)·(rx cos t, ry sin t)`. For a
 * circle `t` is the polar angle; for an ellipse it is the parametric angle, which is what
 * `sweepDeg` is measured in (#54 §1).
 */
import type { ArcSegment, ClosedPath, EllipticalArcSegment, LineSegment, Pt, Segment } from './types'
import { TOLERANCE_MM } from './types'

export const DEG = Math.PI / 180

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y
/** The 2D cross product; positive means `b` is clockwise from `a` on screen (+Y down). */
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x
export const len = (a: Pt): number => Math.hypot(a.x, a.y)
export const distance = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)
export const equalPts = (a: Pt, b: Pt, tolerance = TOLERANCE_MM): boolean => distance(a, b) <= tolerance

/** Clockwise rotation by `deg` in the +Y-down frame, matching SVG `rotate()`. */
export const rotate = (a: Pt, deg: number): Pt => {
  if (deg === 0) return { ...a }
  const r = deg * DEG
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

/** Degrees normalised to [0, 360). */
export const normaliseDeg = (deg: number): number => {
  const d = deg % 360
  return d < 0 ? d + 360 : d
}

/** The signed area of the triangle `oab`, positive when `b` is clockwise from `a`. */
export const triangleArea = (o: Pt, a: Pt, b: Pt): number => cross(sub(a, o), sub(b, o)) / 2

/**
 * The parametric form of a circular or elliptical arc. `t0` and `t1` are radians and
 * `t1 − t0` carries the sign of `sweepDeg`; |t1 − t0| is in (0, 2π).
 */
export interface ArcForm {
  center: Pt
  rx: number
  ry: number
  /** The ellipse's rotation in radians; always 0 for a circle. */
  phi: number
  t0: number
  t1: number
  circular: boolean
}

/** The point where segment `i` starts; segment 0 starts at `path.start`. */
export const segmentStart = (path: ClosedPath, i: number): Pt =>
  i === 0 ? path.start : path.segments[i - 1].to

/** The point where segment `i` ends. */
export const segmentEnd = (path: ClosedPath, i: number): Pt => path.segments[i].to

/** Every segment as `[start, end]`, in order. */
export const segmentPairs = (path: ClosedPath): [Pt, Pt][] =>
  path.segments.map((segment, i) => [segmentStart(path, i), segment.to])

/** The parametric form of an arc segment, given the point it starts at. */
export const arcForm = (segment: ArcSegment | EllipticalArcSegment, from: Pt): ArcForm => {
  const c = segment.center
  if (segment.kind === 'arc') {
    const r = distance(from, c)
    const t0 = Math.atan2(from.y - c.y, from.x - c.x)
    const t1 = t0 + segment.sweepDeg * DEG
    return { center: c, rx: r, ry: r, phi: 0, t0, t1, circular: true }
  }
  const phi = segment.rotationDeg * DEG
  const cos = Math.cos(-phi)
  const sin = Math.sin(-phi)
  const d = sub(from, c)
  // The start point in the ellipse's own frame.
  const lx = d.x * cos - d.y * sin
  const ly = d.x * sin + d.y * cos
  const t0 = Math.atan2(ly / segment.ry, lx / segment.rx)
  const t1 = t0 + segment.sweepDeg * DEG
  return { center: c, rx: segment.rx, ry: segment.ry, phi, t0, t1, circular: false }
}

/** A point on an arc form at parametric angle `t` (radians). */
export const arcPoint = (form: ArcForm, t: number): Pt =>
  add(form.center, rotate({ x: form.rx * Math.cos(t), y: form.ry * Math.sin(t) }, form.phi / DEG))

/** The tangent vector of an arc form at parametric angle `t`, pointing along increasing `t`. */
export const arcTangent = (form: ArcForm, t: number): Pt =>
  rotate({ x: -form.rx * Math.sin(t), y: form.ry * Math.cos(t) }, form.phi / DEG)

/** True when parametric angle `t` (radians) lies inside the arc's sweep. */
export const arcContains = (form: ArcForm, t: number): boolean => {
  const span = form.t1 - form.t0
  const d = t - form.t0
  return span > 0 ? d >= 0 && d <= span : d <= 0 && d >= span
}

/** The tangent direction in degrees at the start (`end` false) or end of a segment. */
export const tangentDeg = (segment: Segment, from: Pt, atEnd: boolean): number => {
  if (segment.kind === 'line') return directionDegOf(from, segment.to)
  const form = arcForm(segment, from)
  return (Math.atan2(arcTangent(form, atEnd ? form.t1 : form.t0).y, arcTangent(form, atEnd ? form.t1 : form.t0).x)) / DEG
}

/** The direction from `a` to `b` in degrees, clockwise from +X, in (−180, 180]. */
export const directionDegOf = (a: Pt, b: Pt): number => (Math.atan2(b.y - a.y, b.x - a.x) / DEG)

/** The direction a line segment runs in (#54 §2). */
export const directionDeg = (segment: LineSegment, from: Pt): number => directionDegOf(from, segment.to)

/** The exact length of any segment. */
export const lengthOf = (segment: Segment, from: Pt): number => {
  if (segment.kind === 'line') return distance(from, segment.to)
  const form = arcForm(segment, from)
  if (form.circular) return form.rx * Math.abs(form.t1 - form.t0)
  return ellipticArcLength(form)
}

/** The exact length of the part of a segment between two of its own parameters. */
export const lengthBetween = (segment: Segment, from: Pt, t0: number, t1: number): number => {
  if (segment.kind === 'line') return Math.abs(t1 - t0) * distance(from, segment.to)
  const form = arcForm(segment, from)
  if (form.circular) return form.rx * Math.abs(t1 - t0)
  return ellipticArcLength({ ...form, t0, t1 })
}

/**
 * The length of an elliptical arc by adaptive quadrature of the speed |p′(t)|, absolute
 * error ≤ 0.001 mm (#54 §2). The speed is smooth and periodic in `t`, so doubling a
 * composite Simpson rule converges in a handful of rounds.
 */
export const ellipticArcLength = (form: ArcForm): number => {
  const speed = (t: number): number => {
    const d = arcTangent(form, t)
    return Math.hypot(d.x, d.y)
  }
  return integrate(speed, form.t0, form.t1, 1e-3)
}

/** Composite Simpson over `panels` panels on `[a, b]`. */
const simpson = (f: (x: number) => number, a: number, b: number, panels: number): number => {
  const h = (b - a) / panels
  let total = f(a) + f(b)
  for (let i = 1; i < panels; i++) total += f(a + h * i) * (i % 2 === 1 ? 4 : 2)
  return (total * h) / 3
}

/**
 * Adaptive quadrature: double the panel count until two successive estimates agree within
 * `tol`, which for a smooth integrand is the same guarantee Richardson extrapolation gives.
 */
export const integrate = (f: (x: number) => number, a: number, b: number, tol: number): number => {
  if (a === b) return 0
  let panels = 4
  let previous = simpson(f, a, b, panels)
  for (let round = 0; round < 24; round++) {
    panels *= 2
    const next = simpson(f, a, b, panels)
    if (Math.abs(next - previous) <= tol) return next
    previous = next
  }
  return previous
}

/** The midpoint of a segment: the arc midpoint, not the chord midpoint (#54 §2). */
export const midpoint = (segment: Segment, from: Pt): Pt => {
  if (segment.kind === 'line') return { x: (from.x + segment.to.x) / 2, y: (from.y + segment.to.y) / 2 }
  const form = arcForm(segment, from)
  return arcPoint(form, (form.t0 + form.t1) / 2)
}

/** The centre of a circular or elliptical arc segment. */
export const centre = (segment: Segment): Pt | null =>
  segment.kind === 'line' ? null : segment.center
