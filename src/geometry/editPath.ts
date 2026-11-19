/**
 * Direct manipulation of one edge (#54 §7, decision D2).
 *
 * A Room Outline is a closed chain, so moving one edge moves its neighbours: the fixed
 * endpoint stays, the free endpoint goes where the typed length and direction say, the
 * segment on the free side rides along by the same vector unchanged, and the segment after
 * that absorbs the change. Nothing is stored about which edge drives which — the join is
 * recomputed from the chain each time, and if the absorbing segment or the loop comes out
 * invalid nothing at all has moved.
 */
import { DEG, dot, segmentStart, sub } from './segment'
import type { ClosedPath, EllipticalArcSegment, GeometryProblem, Pt, Segment } from './types'
import { TOLERANCE_MM, geometryProblem, pt } from './types'
import type { EditResult } from './fillet'

/** Which endpoint of the edge stays where it is (#54 §7). */
export type KeepFixed = 'start' | 'end'

/** The typed length and direction, in exact mm and degrees; anything left out keeps its value. */
export interface LineEdgeChange {
  length?: number
  directionDeg?: number
}

/** The changes to make to a circular arc; both endpoints stay put. */
export interface ArcChange {
  radius?: number
  sweepDeg?: number
  flip?: boolean
}

/** The changes to make to an elliptical arc; both endpoints stay put. */
export interface EllipticalArcChange {
  rx?: number
  ry?: number
  rotationDeg?: number
  sweepDeg?: number
  flip?: boolean
}

const unitOf = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y)
  return pt(v.x / l, v.y / l)
}

/** The normal a positive (clockwise on screen) turn bends toward. */
const turnNormal = (d: Pt): Pt => pt(-d.y, d.x)

/**
 * Change one straight edge's length or direction. The fixed endpoint stays and the free
 * endpoint goes to `fixed + length · unit(direction)`; the segment on the free side moves
 * by the same vector keeping its direction and length, and the segment after that absorbs
 * the change. If the absorbing segment or the loop comes out invalid the problems come
 * back and the path is returned unchanged, so a partial edit is never proposed.
 *
 * `arc-not-closed` naming the edge says the edge is not straight, so it has no single
 * length or direction to set.
 */
export const editLineEdge = (
  path: ClosedPath,
  segmentIndex: number,
  change: LineEdgeChange,
  keepFixed: KeepFixed = 'start',
): EditResult => {
  const n = path.segments.length
  const i = segmentIndex - 1
  const segment = path.segments[i]
  if (segment.kind !== 'line') return wrongKind(path, segmentIndex)
  const from = segmentStart(path, i)
  const vector = sub(segment.to, from)
  const fixed = keepFixed === 'start' ? from : segment.to
  const angle = (change.directionDeg ?? Math.atan2(vector.y, vector.x) / DEG) * DEG
  const length = change.length ?? Math.hypot(vector.x, vector.y)
  const back = keepFixed === 'start' ? 1 : -1
  const free = pt(fixed.x + back * Math.cos(angle) * length, fixed.y + back * Math.sin(angle) * length)
  const delta = sub(free, keepFixed === 'start' ? segment.to : from)
  const segments = [...path.segments]
  const carrier = keepFixed === 'start' ? (i + 1) % n : (i - 1 + n) % n
  const absorber = keepFixed === 'start' ? (i + 2) % n : (i - 2 + n) % n
  if (keepFixed === 'start') {
    segments[i] = { kind: 'line', to: free }
    segments[carrier] = carry(segments[carrier], delta)
    segments[absorber] = reChord(segments[absorber], segments[carrier].to, segments[absorber].to, segmentStart(path, absorber))
  } else {
    segments[carrier] = { ...segments[carrier], to: free }
    const moved = add(segments[absorber].to, delta)
    segments[absorber] = { ...reChord(segments[absorber], segmentStart(path, absorber), moved), to: moved }
  }
  const edited: ClosedPath = {
    // The chain's one open end. `Keep fixed: end` runs the propagation backwards, and it reaches
    // `path.start` two different ways: the edited Edge may *be* the first one, in which case its
    // own start is the free end; or the carrier may be, in which case the whole first Edge has
    // just been shifted and its start has to shift with it. Leaving either behind unjoins the
    // loop — and a first Edge whose start stayed put has quietly changed its own direction and
    // length, which is the one thing the absorbing rule promises it will not do (#59 criterion 10).
    start: keepFixed === 'end' && i === 0
      ? free
      : keepFixed === 'end' && carrier === 0
        ? add(path.start, delta)
        : path.start,
    segments,
  }
  const problems = brokenEdges(path, edited)
  return problems.length === 0 ? { path: edited, problems } : { path, problems }
}

/** The neighbour that rides along: the same shape, shifted by the edit's own vector. */
const carry = (segment: Segment, delta: Pt): Segment => {
  const moved = { ...segment, to: add(segment.to, delta) }
  if (segment.kind === 'arc' || segment.kind === 'ellipticalArc') {
    return { ...moved, center: add(segment.center, delta) } as Segment
  }
  return moved as Segment
}

/**
 * The segment that takes up the slack. A line simply gets new endpoints; a circular arc
 * keeps its sweep and finds the centre and radius its new chord implies; an elliptical arc
 * keeps its sweep, axis ratio and rotation and scales to the new chord.
 */
const reChord = (segment: Segment, from: Pt, to: Pt, oldFrom = from): Segment => {
  if (segment.kind === 'line') return segment
  const chord = sub(to, from)
  const length = Math.hypot(chord.x, chord.y)
  if (segment.kind === 'arc') {
    const sweep = segment.sweepDeg * DEG
    const offset = length / (2 * Math.tan(sweep / 2))
    // A chord with no length has no perpendicular bisector to stand a centre on, and a sweep of
    // 0° or 360° has no finite centre either; both divide by something that is not a number. The
    // NaN would travel straight into the SVG `d` attribute and silently erase the shape, which is
    // worse than the lie the rest of the kernel already tells about a zero-length Edge. So the
    // centre goes on the chord itself: finite, joined, radius zero, and `brokenEdges` reports the
    // Edge as having no length either way — an invalid proposal, not a vanished drawing.
    if (length <= TOLERANCE_MM || !Number.isFinite(offset)) {
      return { kind: 'arc', to, center: to, sweepDeg: segment.sweepDeg }
    }
    const normal = turnNormal(unitOf(chord))
    return {
      kind: 'arc',
      to,
      center: pt((from.x + to.x) / 2 + normal.x * offset, (from.y + to.y) / 2 + normal.y * offset),
      sweepDeg: segment.sweepDeg,
    }
  }
  const before = Math.hypot(segment.to.x - oldFrom.x, segment.to.y - oldFrom.y)
  const scale = before === 0 ? 1 : length / before
  const start = sub(oldFrom, segment.center)
  return {
    kind: 'ellipticalArc',
    to,
    center: pt(from.x - start.x * scale, from.y - start.y * scale),
    rx: segment.rx * scale,
    ry: segment.ry * scale,
    rotationDeg: segment.rotationDeg,
    sweepDeg: segment.sweepDeg,
  }
}

const add = (a: Pt, b: Pt): Pt => pt(a.x + b.x, a.y + b.y)

/**
 * Drag one vertex of a closed chain to a new point (#59 §2, behaviour 8).
 *
 * Only the two Edges that meet there follow. A straight one takes the new endpoint; a curved one
 * keeps its sweep and finds the centre — and for a circular arc the radius — its new chord
 * implies, which is the same absorbing rule `editLineEdge` uses (D2). Nothing else in the chain is
 * touched, which is what makes a drag local in a way that typing a length is not.
 *
 * `vertexIndex` is 1-based and counts from `path.start` exactly as `fillet` counts it, so the
 * vertex a handle selects and the vertex `Corner radius` rounds are the same number.
 *
 * Unlike `editLineEdge`, the dragged shape comes back even when `problems` is not empty. A typed
 * edit leaves the drawing alone and puts its sentence under the field; a drag is *under the
 * cursor*, and a person has to see the crossing they are dragging into for the red to mean
 * anything. Committing is the caller's decision, and `problems` plus the loop's own validation are
 * what tell it that this one commits nothing.
 */
export const moveVertex = (path: ClosedPath, vertexIndex: number, to: Pt): EditResult => {
  const n = path.segments.length
  const incoming = (vertexIndex - 2 + n) % n
  const outgoing = (vertexIndex - 1) % n
  const inSeg = path.segments[incoming]
  const outSeg = path.segments[outgoing]
  const segments = [...path.segments]
  segments[incoming] = inSeg.kind === 'line'
    ? { kind: 'line', to }
    : reChord(inSeg, segmentStart(path, incoming), to)
  // A straight outgoing Edge keeps its own endpoint: its start is the vertex, so it follows on
  // its own. A curved one re-chords, and `reChord` needs the start it is re-chording *from*.
  segments[outgoing] = outSeg.kind === 'line'
    ? outSeg
    : reChord(outSeg, to, outSeg.to, segmentStart(path, outgoing))
  const edited: ClosedPath = { start: outgoing === 0 ? to : path.start, segments }
  return { path: edited, problems: brokenEdges(path, edited) }
}

/**
 * Change a circular arc's radius or sweep with **both endpoints fixed**, which is what the
 * arc handle does: the centre moves to wherever the chord and the new sweep put it. A
 * radius under half the chord cannot reach and is `arc-radius-too-small`.
 */
export const editArc = (path: ClosedPath, segmentIndex: number, change: ArcChange): EditResult => {
  const i = segmentIndex - 1
  const segment = path.segments[i]
  if (segment.kind !== 'arc') return wrongKind(path, segmentIndex)
  const from = segmentStart(path, i)
  const chord = sub(segment.to, from)
  const length = Math.hypot(chord.x, chord.y)
  let sweep = (change.sweepDeg ?? segment.sweepDeg) * DEG
  if (change.flip === true) sweep = sweep - Math.sign(sweep) * Math.PI * 2
  let radius = change.radius ?? length / (2 * Math.abs(Math.sin(sweep / 2)))
  if (change.sweepDeg === undefined && change.radius !== undefined) {
    if (radius < length / 2) {
      return { path, problems: [geometryProblem('arc-radius-too-small', [segmentIndex], { values: [radius, length / 2] })] }
    }
    const half = Math.asin(length / (2 * radius))
    sweep = Math.sign(sweep) * (Math.abs(change.sweepDeg ?? segment.sweepDeg) > 180 ? Math.PI * 2 - 2 * half : 2 * half)
  }
  radius = length / (2 * Math.abs(Math.sin(sweep / 2)))
  if (radius < length / 2 - TOLERANCE_MM) {
    return { path, problems: [geometryProblem('arc-radius-too-small', [segmentIndex], { values: [radius, length / 2] })] }
  }
  const centre = pt(
    (from.x + segment.to.x) / 2 + turnNormal(unitOf(chord)).x * (length / (2 * Math.tan(sweep / 2))),
    (from.y + segment.to.y) / 2 + turnNormal(unitOf(chord)).y * (length / (2 * Math.tan(sweep / 2))),
  )
  const edited: ClosedPath = {
    start: path.start,
    segments: path.segments.map((other, k) =>
      k === i ? { kind: 'arc', to: segment.to, center: centre, sweepDeg: sweep / DEG } : other,
    ),
  }
  return { path: edited, problems: [] }
}

/**
 * Change an elliptical arc's radii, rotation or sweep with **both endpoints fixed**. The
 * endpoints are re-read as parametric angles of the new ellipse, so they stay exactly on
 * it; `sweepDeg` and `flip` choose which way round the arc runs between them.
 */
export const editEllipticalArc = (
  path: ClosedPath,
  segmentIndex: number,
  change: EllipticalArcChange,
): EditResult => {
  const i = segmentIndex - 1
  const segment = path.segments[i]
  if (segment.kind !== 'ellipticalArc') return wrongKind(path, segmentIndex)
  const from = segmentStart(path, i)
  const rx = change.rx ?? segment.rx
  const ry = change.ry ?? segment.ry
  const rotationDeg = change.rotationDeg ?? segment.rotationDeg
  const param = (at: Pt): number => {
    const local = rotate(at, -rotationDeg)
    return Math.atan2(local.y / ry, local.x / rx)
  }
  const t0 = param(sub(from, segment.center))
  const t1 = param(sub(segment.to, segment.center))
  let sweep = t1 - t0
  if (sweep > Math.PI) sweep -= Math.PI * 2
  if (sweep < -Math.PI) sweep += Math.PI * 2
  if (change.flip === true) sweep = sweep - Math.sign(sweep) * Math.PI * 2
  if (change.sweepDeg !== undefined) {
    const wanted = change.sweepDeg * DEG
    if (Math.sign(wanted) !== Math.sign(sweep)) sweep = sweep - Math.sign(sweep) * Math.PI * 2
    if (Math.abs(wanted) > Math.PI !== Math.abs(sweep) > Math.PI) sweep = sweep - Math.sign(sweep) * Math.PI * 2
  }
  const edited: EllipticalArcSegment = {
    kind: 'ellipticalArc',
    to: segment.to,
    center: segment.center,
    rx,
    ry,
    rotationDeg,
    sweepDeg: sweep / DEG,
  }
  return {
    path: { start: path.start, segments: path.segments.map((other, k) => (k === i ? edited : other)) },
    problems: [],
  }
}

const rotate = (v: Pt, deg: number): Pt => {
  const r = deg * DEG
  return pt(v.x * Math.cos(r) - v.y * Math.sin(r), v.x * Math.sin(r) + v.y * Math.cos(r))
}

const wrongKind = (path: ClosedPath, segmentIndex: number): EditResult => ({
  path,
  problems: [geometryProblem('arc-not-closed', [segmentIndex])],
})

/** Edges the edit collapsed to nothing or turned end for end. */
const brokenEdges = (before: ClosedPath, after: ClosedPath): GeometryProblem[] => {
  const problems: GeometryProblem[] = []
  after.segments.forEach((segment, i) => {
    const previous = before.segments[i]
    if (previous === undefined) return
    const vector = sub(segment.to, segmentStart(after, i))
    const old = sub(previous.to, segmentStart(before, i))
    const length = Math.hypot(vector.x, vector.y)
    if (length <= TOLERANCE_MM || dot(vector, old) < 0) {
      problems.push(geometryProblem('edge-no-length', [i + 1], { values: [length] }))
    }
  })
  return problems
}
