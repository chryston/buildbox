/**
 * The relation between one straight Edge and one Wall face (#67 behaviours 26–28, D8).
 *
 * A Room's claim on a Wall says: *this Edge lies on that face*. That is a statement about
 * geometry, and this file is the only place it is measured. Three numbers answer it:
 *
 *  - **`offset`** — the signed perpendicular distance from the face to the Edge, positive on
 *    the face's own left. It is what an attach preview prints (`Moves edge 300 mm`) and what
 *    a slide needs as its vector.
 *  - **`distance`** — the worst distance of the Edge's two ends to the face curve. An Edge
 *    that is off the face at one end and on it at the other is not on the face, so the
 *    invariant is checked at both ends and not at the middle.
 *  - **`skew`** — how far the Edge is from running parallel, expressed the way the issue
 *    states it: millimetres of departure over the Edge's own length. `0.01 mm` over a 4 m
 *    side is a face a homeowner would call parallel; `1 mm` over it is not.
 *
 * Faces are the reference line offset by the Wall's own justification — the same offset
 * `joinWalls` cuts them with — so a face measured here is the face drawn on screen.
 */
import { faceOffsets } from './joinWalls'
import type { WallJustification } from './joinWalls'
import type { WallSide } from './joinWalls'
import { nearestOnSegment } from './curve'
import { tangentAt } from './fillet'
import { offsetRefLine, refSegment } from './wall'
import type { WallRefLine } from './wall'
import { distance, sub } from './segment'
import type { LineSegment, Pt, Segment } from './types'

/** One face of one Wall, as an open curve. */
export interface FaceCurve {
  readonly segment: Segment
  readonly from: Pt
}

/** How far a face sits from the reference line, positive along the reference's own normal. */
export const faceOffsetOf = (thickness: number, justification: WallJustification, side: WallSide): number =>
  faceOffsets(thickness, justification)[side === 'left' ? 0 : 1]

/** The supporting curve of one face of a Wall, before any Junction cuts it back. */
export const faceCurve = (
  line: WallRefLine,
  thickness: number,
  justification: WallJustification,
  side: WallSide,
): FaceCurve => {
  const { segment, from } = refSegment(offsetRefLine(line, faceOffsetOf(thickness, justification, side)))
  return { segment, from }
}

/** How one straight Edge sits against one face. */
export interface FaceRelation {
  /** Worst distance of the two ends to the face, in millimetres. */
  readonly distance: number
  /** Signed perpendicular distance from the face to the Edge's midpoint, positive on the face's left. */
  readonly offset: number
  /** Departure from parallel, in millimetres over the Edge's own length. */
  readonly skew: number
  /** The Edge's length, which is what `skew` is measured over. */
  readonly length: number
}

/** The unit vector a face's tangent turns left toward — the direction "off the face" points. */
const leftNormal = (segment: Segment, from: Pt, t: number): Pt => {
  const tangent = tangentAt(segment, from, t)
  return { x: -tangent.y, y: tangent.x }
}

/**
 * How `edge` — starting at `from` — relates to `face`.
 *
 * The two ends are each snapped to the nearest point of the face, so an arc face is measured
 * along its own curve rather than along its chord; the midpoint's signed offset is what a
 * slide has to travel.
 */
export const edgeToFace = (edge: LineSegment, from: Pt, face: FaceCurve): FaceRelation => {
  const length = distance(from, edge.to)
  const ends = [from, edge.to]
  let worst = 0
  let skew = 0
  const direction = { x: (edge.to.x - from.x) / (length || 1), y: (edge.to.y - from.y) / (length || 1) }
  for (const at of ends) {
    const near = nearestOnSegment(at, face.segment, face.from)
    if (near.distance > worst) worst = near.distance
    const tangent = tangentAt(face.segment, face.from, near.t)
    const departure = Math.abs(direction.x * tangent.y - direction.y * tangent.x) * length
    if (departure > skew) skew = departure
  }
  const middle = { x: (from.x + edge.to.x) / 2, y: (from.y + edge.to.y) / 2 }
  const near = nearestOnSegment(middle, face.segment, face.from)
  const normal = leftNormal(face.segment, face.from, near.t)
  const vector = sub(middle, near.point)
  return { distance: worst, offset: vector.x * normal.x + vector.y * normal.y, skew, length }
}

/** The vector that carries `edge` onto `face`: perpendicular to the face, `offset` millimetres back. */
export const ontoFaceVector = (edge: LineSegment, from: Pt, face: FaceCurve): Pt => {
  const relation = edgeToFace(edge, from, face)
  const middle = { x: (from.x + edge.to.x) / 2, y: (from.y + edge.to.y) / 2 }
  const near = nearestOnSegment(middle, face.segment, face.from)
  const normal = leftNormal(face.segment, face.from, near.t)
  return { x: -normal.x * relation.offset, y: -normal.y * relation.offset }
}
