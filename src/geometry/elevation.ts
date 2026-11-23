/**
 * The Elevation View's own geometry: the band a view looks through, and what that band does to a shape (#75 §4).
 *
 * An Elevation View is a line, a side and a distance. Those three numbers bound a finite rectangle in
 * plan — the footprint of a prism standing on the view line, `L` long and `depth` deep — and every
 * question the Elevation View asks of the model is asked in that rectangle's coordinates:
 *
 *     s(p) = (p − start) · u    along the line, 0 … L
 *     d(p) = (p − start) · n    into the band, 0 … depth
 *
 * with `u` the unit vector start→end and `n` the viewing normal of the side the viewer stands on. This
 * module owns `u`, `n` and those two projections, and nothing else: which entities exist, how tall they
 * are and what paint they wear are the model's business, and the caller hands the shapes here as
 * ordinary plan outlines.
 *
 * Two conventions are pinned here because everything downstream reads them off this file.
 *
 * **The side.** `geometry` may not import `domain`, so `ElevationSide` is spelled again — structurally
 * identical to `ElevationViewSide`, which is what a caller passes. The normal follows a Wall's faces
 * (#64): the reference normal of `u` is `(-u.y, u.x)`, `right` is that side and `left` is its negative.
 * So `n = (u.y, -u.x)` for `'left'` and `n = (-u.y, u.x)` for `'right'`, and the plan marker's arrow —
 * which points along `n`, into the band — and the elevation's content cannot disagree (#75 criterion 7).
 *
 * **The band is closed.** `0 ≤ s ≤ L` and `0 ≤ d ≤ depth`, both ends included, so content touching the
 * far edge exactly is in the view (#75 criterion 10). The band is *not* clipped along the line by
 * anything else: content beyond an end of the line is out of the view, and content that merely reaches
 * past an end is clipped at the view edge by the caller, which is what `sMin`/`sMax` being clamped to
 * `[0, L]` says.
 *
 * Angles are unrestricted: a view line at 30° to the plan axes is the same arithmetic, which is what
 * the property tests in `elevation.test.ts` hold to — `s` and `d` are invariant under moving or turning
 * the world and the view together.
 */
import type { Pt } from './types'

/** Which side of the view line the viewer stands on; the same two words `domain` uses (#75 §1). */
export type ElevationSide = 'left' | 'right'

/** The view line: two places on the Floor. Any angle; the two ends are never the same place. */
export interface ElevationLine {
  readonly start: Pt
  readonly end: Pt
}

/** A view line read as a frame: the two unit axes, the length and the depth, in millimetres. */
export interface ElevationFrame {
  readonly start: Pt
  /** Unit vector start→end. */
  readonly u: Pt
  /** Unit viewing normal, into the band, for `side`. */
  readonly n: Pt
  /** `L`, the line's length. */
  readonly length: number
  readonly depth: number
  readonly side: ElevationSide
}

/** `-0` is a rendering bug waiting to happen, and a unit vector can produce one on an axis. */
const unsigned = (value: number): number => (value === 0 ? 0 : value)

/**
 * The frame of one Elevation View.
 *
 * A line of no length has no direction to take, and the strict validator refuses one (#75 §1); it is
 * answered here with an axis-parallel frame whose `L` is 0, which bounds a band of no width and so
 * contains nothing a viewer could be shown.
 */
export function elevationFrame(line: ElevationLine, side: ElevationSide, depth: number): ElevationFrame {
  const dx = line.end.x - line.start.x
  const dy = line.end.y - line.start.y
  const length = Math.hypot(dx, dy)
  const u: Pt = length === 0 ? { x: 1, y: 0 } : { x: unsigned(dx / length), y: unsigned(dy / length) }
  const sign = side === 'left' ? 1 : -1
  const n: Pt = { x: unsigned(sign * u.y), y: unsigned(-sign * u.x) }
  return { start: line.start, u, n, length, depth, side }
}

/** `s`: how far along the view line a place is, in millimetres. */
export function alongElevation(frame: ElevationFrame, at: Pt): number {
  return (at.x - frame.start.x) * frame.u.x + (at.y - frame.start.y) * frame.u.y
}

/** `d`: how far into the band a place is, in millimetres. Zero is the view line itself. */
export function elevationDistance(frame: ElevationFrame, at: Pt): number {
  return (at.x - frame.start.x) * frame.n.x + (at.y - frame.start.y) * frame.n.y
}

/** The pair `(s, d)` of one place, which is the whole transform this module is about. */
export function elevationCoords(frame: ElevationFrame, at: Pt): { s: number; d: number } {
  return { s: alongElevation(frame, at), d: elevationDistance(frame, at) }
}

/** Whether one place is inside the band, both ends included (#75 criterion 10). */
export function insideElevationBand(frame: ElevationFrame, at: Pt): boolean {
  const { s, d } = elevationCoords(frame, at)
  return s >= 0 && s <= frame.length && d >= 0 && d <= frame.depth
}

/**
 * What a plan shape does inside one Elevation View.
 *
 * `inside` is the answer to "does this appear in the view": some part of the shape is inside the band.
 * `distance` is the painter's-order key — the least `d` over the part of the shape that is inside, so
 * the nearer face of a wall is what decides which wall is drawn on top (#75 criterion 12). `sMin` and
 * `sMax` are where it lands across the drawing, already clamped to `[0, L]`: a shape that reaches past
 * an end of the view line is clipped at the view edge rather than drawn past it (#75 criterion 10).
 * `crossesLine` says the shape is cut by the view line itself, which is the content drawn with the
 * heavier outline (#75 criterion 13).
 */
export interface ElevationProjection {
  readonly inside: boolean
  readonly sMin: number
  readonly sMax: number
  readonly distance: number
  readonly crossesLine: boolean
}

/** A shape with nothing in the band: no span, no distance, and nothing to draw. */
const OUTSIDE: ElevationProjection = { inside: false, sMin: 0, sMax: 0, distance: Number.POSITIVE_INFINITY, crossesLine: false }

/**
 * Clip a polygon's `(s, d)` outline to one half-plane `side(point) ≥ 0`, Sutherland–Hodgman style.
 *
 * The band is the intersection of four such half-planes — `s ≥ 0`, `s ≤ L`, `d ≥ 0`, `d ≤ depth`, each
 * written as a signed distance — and clipping in `(s, d)` rather than in plan turns every one of them
 * into a comparison against a constant, which is the whole reason the frame exists.
 */
function clip(points: readonly { s: number; d: number }[], side: (point: { s: number; d: number }) => number): { s: number; d: number }[] {
  if (points.length === 0) return []
  const out: { s: number; d: number }[] = []
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    const here = side(current)
    const there = side(next)
    if (here >= 0) out.push(current)
    if (here >= 0 !== there >= 0) {
      const t = here / (here - there)
      out.push({ s: current.s + (next.s - current.s) * t, d: current.d + (next.d - current.d) * t })
    }
  }
  return out
}

/** Whether the place `(s, d)` is inside a polygon, by ray casting along `+s`. */
function polygonHolds(points: readonly { s: number; d: number }[], at: { s: number; d: number }): boolean {
  let holds = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!
    const b = points[j]!
    if (a.d > at.d !== b.d > at.d && at.s < ((b.s - a.s) * (at.d - a.d)) / (b.d - a.d) + a.s) holds = !holds
  }
  return holds
}

/**
 * What one closed plan outline does inside one Elevation View.
 *
 * `outline` is the shape in plan — a Wall body's four corners, an Opening's rectangle inside its host,
 * a Placed Item's Item Footprint placed on the Floor. It is read as a closed polygon, so a shape with
 * fewer than three corners is treated as its own outline closed back on itself, which is what a
 * two-point Wall body is before its thickness is applied.
 *
 * The view line's own segment is the set `d = 0, 0 ≤ s ≤ L`, so "cut by the view line" is answered in
 * the frame too: an edge that crosses `d = 0` between the ends, or an end of the line that the shape
 * contains.
 */
export function projectElevationOutline(frame: ElevationFrame, outline: readonly Pt[]): ElevationProjection {
  if (outline.length === 0) return OUTSIDE
  const points = outline.map((at) => elevationCoords(frame, at))
  const crossesLine = crossesViewLine(frame, points)
  const { length, depth } = frame
  const band = clip(clip(clip(clip(points, (p) => p.s), (p) => p.d), (p) => length - p.s), (p) => depth - p.d)
  // The band is closed, so a shape touching an edge survives the clip, which is criterion 10's answer.
  if (band.length === 0) return { ...OUTSIDE, crossesLine }
  let sMin = Number.POSITIVE_INFINITY
  let sMax = Number.NEGATIVE_INFINITY
  let distance = Number.POSITIVE_INFINITY
  for (const point of band) {
    if (point.s < sMin) sMin = point.s
    if (point.s > sMax) sMax = point.s
    if (point.d < distance) distance = point.d
  }
  return {
    inside: true,
    sMin: Math.min(Math.max(sMin, 0), frame.length),
    sMax: Math.min(Math.max(sMax, 0), frame.length),
    distance,
    crossesLine,
  }
}

/** Whether a shape's outline crosses the view line between its ends, or contains one of them. */
function crossesViewLine(frame: ElevationFrame, points: readonly { s: number; d: number }[]): boolean {
  if (points.length < 2) return false
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    if (a.d === 0 && Math.min(a.s, b.s) <= frame.length && Math.max(a.s, b.s) >= 0) return true
    if (a.d === b.d) continue
    const t = a.d / (a.d - b.d)
    if (t < 0 || t > 1) continue
    const at = a.s + (b.s - a.s) * t
    if (at >= 0 && at <= frame.length) return true
  }
  return polygonHolds(points, { s: 0, d: 0 }) || polygonHolds(points, { s: frame.length, d: 0 })
}

/**
 * The four corners of a Wall body: the reference line thickened by `thickness`, centred on it.
 *
 * A Wall's body is what the band is tested against, not its reference line — a view line that runs
 * along the middle of a Wall cuts it, and one that stops 50 mm short of it does not (#75 criterion 13).
 * The corners are the reference ends offset by half the thickness along the Wall's own normal, which is
 * the same `(-u.y, u.x)` the faces use (#64).
 */
export function wallBodyOutline(start: Pt, end: Pt, thickness: number): Pt[] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return [start, end]
  const half = thickness / 2
  const nx = -dy / length
  const ny = dx / length
  return [
    { x: start.x + nx * half, y: start.y + ny * half },
    { x: end.x + nx * half, y: end.y + ny * half },
    { x: end.x - nx * half, y: end.y - ny * half },
    { x: start.x - nx * half, y: start.y - ny * half },
  ]
}
