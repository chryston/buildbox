/**
 * Evaluation and measurement (#54 §2), all analytic.
 *
 * Area comes from Green's theorem, ∮(x dy − y dx)/2, split into the chord term
 * `cross(p0, p1)/2` plus the closed-form segment term: `r²(θ − sin θ)/2` for a circular
 * arc and `rx·ry(θ − sin θ)/2` for an elliptical one. Nothing here samples the curve;
 * `flatten` is the one exception and exists only for renderers.
 */
import {
  add,
  arcContains,
  arcForm,
  arcPoint,
  DEG,
  distance,
  ellipticArcLength,
  rotate,
  segmentStart,
  sub,
} from './segment'
import type { ArcForm } from './segment'
import type { ClosedPath, Pt, Segment, Transform } from './types'

/** One exact parametric piece of a path, ready for a renderer or a hit-test. */
export type EvaluatedSegment = {
  kind: 'line'
  from: Pt
  to: Pt
} | {
  kind: 'arc'
  from: Pt
  to: Pt
  center: Pt
  radius: number
  /** Radians, signed; the start and end polar angles. */
  startAngle: number
  endAngle: number
  /** True when |sweep| > π, which SVG's large-arc flag carries (#54 criterion 13). */
  largeArc: boolean
  /** Positive = clockwise on screen. */
  sweepSign: 1 | -1
} | {
  kind: 'ellipticalArc'
  from: Pt
  to: Pt
  center: Pt
  rx: number
  ry: number
  rotationDeg: number
  startParam: number
  endParam: number
  largeArc: boolean
  sweepSign: 1 | -1
}

/**
 * The exact parametric pieces of a path (#54 §2). There is no fixed sampling: an SVG
 * renderer can emit `A rx ry rot largeArc sweep x y` straight from these.
 */
export const evaluate = (path: ClosedPath): EvaluatedSegment[] =>
  path.segments.map((segment, i) => evaluateSegment(segment, segmentStart(path, i)))

/** One segment in exact parametric form. */
export const evaluateSegment = (segment: Segment, from: Pt): EvaluatedSegment => {
  if (segment.kind === 'line') return { kind: 'line', from, to: segment.to }
  const form = arcForm(segment, from)
  const span = form.t1 - form.t0
  const largeArc = Math.abs(span) > Math.PI
  const sweepSign: 1 | -1 = span >= 0 ? 1 : -1
  if (form.circular) {
    return {
      kind: 'arc',
      from,
      to: segment.to,
      center: form.center,
      radius: form.rx,
      startAngle: form.t0,
      endAngle: form.t1,
      largeArc,
      sweepSign,
    }
  }
  return {
    kind: 'ellipticalArc',
    from,
    to: segment.to,
    center: form.center,
    rx: form.rx,
    ry: form.ry,
    rotationDeg: form.phi / DEG,
    startParam: form.t0,
    endParam: form.t1,
    largeArc,
    sweepSign,
  }
}

/**
 * The signed area in mm²: positive for a loop that is clockwise on screen (#54 §1), which
 * is the plain shoelace sign in a +Y-down frame.
 */
export const signedArea = (path: ClosedPath): number =>
  path.segments.reduce((total, segment, i) => total + signedAreaOf(segment, segmentStart(path, i)), 0)

/** The chord term plus the closed-form segment term for one segment. */
export const signedAreaOf = (segment: Segment, from: Pt): number => {
  const chord = (from.x * segment.to.y - segment.to.x * from.y) / 2
  if (segment.kind === 'line') return chord
  const form = arcForm(segment, from)
  const span = form.t1 - form.t0
  return chord + (form.rx * form.ry * (span - Math.sin(span))) / 2
}

/** The unsigned enclosed area in mm². */
export const area = (path: ClosedPath): number => Math.abs(signedArea(path))

/**
 * The perimeter in mm. Lines and circular arcs are exact; an elliptical arc uses adaptive
 * Gauss–Kronrod quadrature to 0.001 mm (#54 §2).
 */
export const perimeter = (path: ClosedPath): number =>
  path.segments.reduce((total, segment, i) => {
    if (segment.kind === 'line') return total + distance(segmentStart(path, i), segment.to)
    const form = arcForm(segment, segmentStart(path, i))
    const span = Math.abs(form.t1 - form.t0)
    return total + (form.circular ? form.rx * span : ellipticArcLength(form))
  }, 0)

/** The axis-aligned bounds of a path. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Exact axis-aligned bounds of one segment, including the extrema an arc turns through.
 * Validation uses it to reject pairs of edges that cannot possibly meet (#54 §9 bench).
 */
export const segmentBounds = (segment: Segment, from: Pt): Bounds => {
  let box: Bounds = {
    minX: Math.min(from.x, segment.to.x),
    minY: Math.min(from.y, segment.to.y),
    maxX: Math.max(from.x, segment.to.x),
    maxY: Math.max(from.y, segment.to.y),
  }
  if (segment.kind === 'line') return box
  const form = arcForm(segment, from)
  for (const t of arcExtrema(form)) {
    const p = arcPoint(form, t)
    box = {
      minX: Math.min(box.minX, p.x),
      minY: Math.min(box.minY, p.y),
      maxX: Math.max(box.maxX, p.x),
      maxY: Math.max(box.maxY, p.y),
    }
  }
  return box
}

/**
 * Exact axis-aligned bounds, including the arc extrema. With a `transform` the arc's own
 * parameters are rotated — its centre, its sweep, and an ellipse's rotation — and the
 * extrema of the rotated arc are found analytically, so the rotated bounding box is never
 * itself bounded (#54 §2).
 */
export const bounds = (path: ClosedPath, transform?: Transform): Bounds => {
  let box: Bounds | null = null
  const take = (one: Bounds): void => {
    box = box === null
      ? one
      : {
        minX: Math.min(box.minX, one.minX),
        minY: Math.min(box.minY, one.minY),
        maxX: Math.max(box.maxX, one.maxX),
        maxY: Math.max(box.maxY, one.maxY),
      }
  }
  path.segments.forEach((segment, i) => {
    const local = transform === undefined ? segment : transformSegment(segment, transform)
    const from = transform === undefined
      ? segmentStart(path, i)
      : applyTransform(segmentStart(path, i), transform)
    take(segmentBounds(local, from))
  })
  return box ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
}

/** The parametric angles inside an arc's sweep where an axis derivative vanishes. */
export const arcExtrema = (form: ArcForm): number[] => {
  const bases = form.circular
    ? [0, Math.PI / 2, Math.PI, Math.PI * 1.5]
    : ellipseExtremaBases(form)
  const out: number[] = []
  for (const base of bases) {
    for (let k = -2; k <= 2; k++) {
      const t = base + k * Math.PI * 2
      if (arcContains(form, t)) out.push(t)
    }
  }
  return out
}

/**
 * The four candidate parametric angles of a rotated ellipse: `dx/dt = 0` at
 * `atan2(−ry sin φ, rx cos φ)` and its antipode, `dy/dt = 0` at
 * `atan2(ry cos φ, rx sin φ)` and its antipode.
 */
const ellipseExtremaBases = (form: ArcForm): number[] => {
  const xs = Math.atan2(-form.ry * Math.sin(form.phi), form.rx * Math.cos(form.phi))
  const ys = Math.atan2(form.ry * Math.cos(form.phi), form.rx * Math.sin(form.phi))
  return [xs, xs + Math.PI, ys, ys + Math.PI]
}

/** A point through a placement: rotate about `pivot`, then translate. */
export const applyTransform = (p: Pt, transform: Transform): Pt =>
  add(rotate(sub(p, transform.pivot), transform.rotationDeg), add(transform.pivot, transform.translation))

/** A segment with its centre, sweep and rotation carried through a placement. */
export const transformSegment = (segment: Segment, transform: Transform): Segment => {
  const to = applyTransform(segment.to, transform)
  if (segment.kind === 'line') return { kind: 'line', to }
  const center = applyTransform(segment.center, transform)
  if (segment.kind === 'arc') return { kind: 'arc', to, center, sweepDeg: segment.sweepDeg + transform.rotationDeg }
  return {
    kind: 'ellipticalArc',
    to,
    center,
    rx: segment.rx,
    ry: segment.ry,
    rotationDeg: segment.rotationDeg + transform.rotationDeg,
    sweepDeg: segment.sweepDeg + transform.rotationDeg,
  }
}

/**
 * A polyline approximation, for renderers only (#54 §2). Validation, area, overlap and
 * warnings never call it; the import-graph test keeps it that way.
 */
export const flatten = (path: ClosedPath, chordTolerance: number): Pt[][] =>
  path.segments.map((segment, i) => flattenSegment(segment, segmentStart(path, i), chordTolerance))

/** One segment as a polyline whose sagitta is within `chordTolerance`. */
export const flattenSegment = (segment: Segment, from: Pt, chordTolerance: number): Pt[] => {
  if (segment.kind === 'line') return [from, segment.to]
  const form = arcForm(segment, from)
  const radius = Math.max(form.rx, form.ry)
  const span = Math.abs(form.t1 - form.t0)
  const step = radius > 0 ? Math.acos(Math.max(-1, 1 - chordTolerance / radius)) : span
  const steps = Math.max(2, Math.ceil(span / Math.max(step, 1e-6)))
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) out.push(arcPoint(form, form.t0 + ((form.t1 - form.t0) * i) / steps))
  return out
}

/** The segment endpoints a vertex handle sits on (#54 §5, behaviour 8). */
export const vertices = (path: ClosedPath): Pt[] => path.segments.map((_, i) => segmentStart(path, i))

/** The same loop traversed the other way; `signedArea` flips sign (#54 §9). */
export const reverse = (path: ClosedPath): ClosedPath => {
  const n = path.segments.length
  const segments: Segment[] = []
  for (let i = n - 1; i >= 0; i--) {
    segments.push(reverseSegment(path.segments[i], segmentStart(path, i)))
  }
  return { start: path.segments[n - 1].to, segments }
}

const reverseSegment = (segment: Segment, from: Pt): Segment => {
  if (segment.kind === 'line') return { kind: 'line', to: from }
  if (segment.kind === 'arc') return { kind: 'arc', to: from, center: segment.center, sweepDeg: -segment.sweepDeg }
  return {
    kind: 'ellipticalArc',
    to: from,
    center: segment.center,
    rx: segment.rx,
    ry: segment.ry,
    rotationDeg: segment.rotationDeg,
    sweepDeg: -segment.sweepDeg,
  }
}

/** The clockwise form of a loop, without changing the start vertex (#54 §1). */
export const normaliseOrientation = (path: ClosedPath): ClosedPath =>
  signedArea(path) >= 0 ? path : reverse(path)
