/**
 * Wall clean-up (#64 §5): the tidied outline of every Wall at its Junctions.
 *
 * One Junction at a time, the rule is the same for every case the issue names. Each member
 * end has two faces; each face is bounded by whichever member lies on that side, and the
 * point where the two faces cross is the corner both members share. Sharing the corner is
 * what makes the union read as one wall band with no internal seam:
 *
 * - **L, equal thickness** — the shared corners are the two face intersections, so each end
 *   is cut on the bisector: a mitre.
 * - **Mixed thickness, multi-way** — the same intersections, and the thinner member's cap
 *   ends lie on the thicker member's face lines, which is what "butts into the thicker face"
 *   means. Ties are equal thickness, so they mitre.
 * - **T** — the hosted branch's two faces are cut on the host's *near* face, so the cap runs
 *   along it and the host keeps both its faces unbroken. The host is never split.
 * - **Run-through and X** — two collinear opposite ends of equal thickness and matching
 *   faces have no face intersection at all: their faces are the same lines. They keep their
 *   spans and lose the end cap, which is the continuous face pair; an X is two of those.
 * - **Arcs** — faces are offset arcs and the intersections are the analytic line–circle and
 *   circle–circle solves of `curve.ts`, so any angle joins and no tangent continuity is
 *   asked for.
 * - **Near-parallel** — where the face intersection lies further from the Junction than ten
 *   times the thicker thickness, the corner is dropped and both members end square. That
 *   fallback is deterministic and cannot self-intersect, which is the only thing a join at
 *   0.5° can honestly promise.
 *
 * Pure and deterministic: the same walls and Junctions give byte-identical output, and
 * nothing here reads a Wall it was not given.
 */
import { DEG, distance, normaliseDeg, sub } from './segment'
import { supportLocus, locusIntersect } from './curve'
import type { Locus } from './curve'
import { refSegment, refTangentDeg, offsetRefLine } from './wall'
import type { WallRefLine } from './wall'
import type { ClosedPath, Pt, Segment } from './types'
import { TOLERANCE_MM } from './types'

/** Where the reference line sits within the thickness; see `domain`'s `WallJustification`. */
export type WallJustification = 'left' | 'centre' | 'right'

/** One of a Wall's two faces. `left` is the first face of the reference direction. */
export type WallSide = 'left' | 'right'

/** A Wall as clean-up sees it: its reference line, thickness and justification. */
export interface JoinWall {
  readonly id: string
  readonly line: WallRefLine
  readonly thickness: number
  readonly justification: WallJustification
}

/** Which end of which Wall a Junction member holds. */
export interface JoinEnd {
  readonly wallId: string
  readonly end: 'start' | 'end'
}

/** A Junction as clean-up sees it: its member ends, and its host when it is a T-attach. */
export interface JoinJunction {
  readonly id: string
  readonly ends: readonly JoinEnd[]
  readonly host?: { wallId: string; at: number }
}

/** One tidied face: the curve between the two corners it now ends at. */
export interface JoinedFace {
  readonly side: WallSide
  readonly from: Pt
  readonly to: Pt
  readonly segment: Segment
}

/** One Wall after clean-up. */
export interface JoinedWall {
  readonly id: string
  /** `[left, right]`, in the reference line's own direction. */
  readonly faces: [JoinedFace, JoinedFace]
  /** The filled outline the drawing shows: the two faces closed by their end caps. */
  readonly outline: ClosedPath
  /** Whether each end draws a cap. A run-through end does not — that is the merged face. */
  readonly capStart: boolean
  readonly capEnd: boolean
}

/** The offsets of the two faces from the reference line, in millimetres. */
export const faceOffsets = (thickness: number, justification: WallJustification): [number, number] =>
  justification === 'centre'
    ? [-thickness / 2, thickness / 2]
    : justification === 'left' ? [0, thickness] : [-thickness, 0]

/** The direction a member's body lies in from the Junction: degrees, clockwise, [0, 360). */
const awayDeg = (wall: JoinWall, end: 'start' | 'end'): number =>
  end === 'start' ? refTangentDeg(wall.line, 'start') : normaliseDeg(refTangentDeg(wall.line, 'end') + 180)

/** The point one of the reference line's ends sits at. */
const endAt = (line: WallRefLine, end: 'start' | 'end'): Pt => (end === 'start' ? line.start : line.end)

/** The supporting curve of one face, and the face's own reference line. */
const faceCurve = (wall: JoinWall, side: WallSide): { line: WallRefLine; locus: Locus } => {
  const offset = faceOffsets(wall.thickness, wall.justification)[side === 'left' ? 0 : 1]
  const line = offsetRefLine(wall.line, offset)
  const { segment, from } = refSegment(line)
  return { line, locus: supportLocus(segment, from) }
}

/** The face intersection nearest `near`, or `null` when the faces do not cross. */
const crossPoint = (a: Locus, b: Locus, near: Pt): Pt | null => {
  const found = locusIntersect(a, b)
  if (found.length === 0) return null
  return found.reduce((best, at) => (distance(at, near) < distance(best, near) ? at : best))
}

/**
 * Which of `self`'s faces a neighbour's body lies against: the cross product of the two away
 * directions says which way round they turn, and the face with the negative offset is the
 * `left` one.
 */
const sideOf = (self: JoinWall, selfEnd: 'start' | 'end', other: JoinWall, otherEnd: 'start' | 'end'): WallSide => {
  const a = Math.cos(awayDeg(self, selfEnd) * DEG)
  const a2 = Math.sin(awayDeg(self, selfEnd) * DEG)
  const b = Math.cos(awayDeg(other, otherEnd) * DEG)
  const b2 = Math.sin(awayDeg(other, otherEnd) * DEG)
  return a * b2 - a2 * b < 0 ? 'left' : 'right'
}

/** The angle between two away directions, in degrees, 0…180. */
const angleGap = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180)

/** True when two ends form a run-through pair: collinear, opposite, equal, matching faces. */
const isRunThrough = (a: JoinWall, aEnd: 'start' | 'end', b: JoinWall, bEnd: 'start' | 'end'): boolean => {
  if (a.thickness !== b.thickness) return false
  if (faceOffsets(a.thickness, a.justification).join() !== faceOffsets(b.thickness, b.justification).join()) return false
  if (a.line.kind !== b.line.kind) return false
  if (Math.abs(angleGap(awayDeg(a, aEnd), awayDeg(b, bEnd)) - 180) > 0.01) return false
  if (a.line.kind === 'line' && b.line.kind === 'line') {
    // Collinear: b's start lies on a's supporting line.
    const d = sub(a.line.end, a.line.start)
    const l = Math.hypot(d.x, d.y)
    if (l === 0) return false
    const q = sub(b.line.start, a.line.start)
    return Math.abs(q.x * d.y - q.y * d.x) / l <= TOLERANCE_MM
  }
  if (a.line.kind === 'arc' && b.line.kind === 'arc') {
    const oa = refSegment(a.line)
    const ob = refSegment(b.line)
    if (oa.segment.kind !== 'arc' || ob.segment.kind !== 'arc') return false
    return (
      distance(oa.segment.center, ob.segment.center) <= TOLERANCE_MM
      && Math.abs(Math.abs(oa.segment.sweepDeg) - Math.abs(ob.segment.sweepDeg)) <= 0.01
    )
  }
  return false
}

/** The other side of a Wall. */
const opposite = (side: WallSide): WallSide => (side === 'left' ? 'right' : 'left')

/**
 * Which face of a Wall lies on the away-frame `side` — the side a neighbour falls on seen
 * from the Junction, looking down the member’s own body. At a `start` that frame is the
 * reference line’s own; at an `end` the body lies behind the Junction and the two mirror.
 */
const faceSide = (end: 'start' | 'end', side: WallSide): WallSide => (end === 'start' ? side : opposite(side))

/** True when `middle` stands off the line from `from` to `to` by more than a micron. */
const turns = (from: Pt, middle: Pt, to: Pt): boolean => {
  const d = sub(to, from)
  const l = Math.hypot(d.x, d.y)
  if (l === 0) return false
  return Math.abs(d.x * (middle.y - from.y) - d.y * (middle.x - from.x)) / l > 1e-6
}

/** One member of a Junction. */
type Member = { readonly wall: JoinWall; readonly end: 'start' | 'end' }

interface EndCorners {
  left: Pt
  right: Pt
  /** The Junction point itself when the cap turns through it, otherwise `null`. */
  via: Pt | null
  /** True at a run-through end, where the faces carry on and no seam is drawn. */
  butt: boolean
}

/** The square end: both faces cut perpendicular to the reference at this end. */
const squareEnd = (wall: JoinWall, end: 'start' | 'end'): EndCorners => {
  const [left, right] = faceOffsets(wall.thickness, wall.justification)
  const line = wall.line
  const at = (offset: number): Pt => {
    const offsetLine = offsetRefLine(line, offset)
    return endAt(offsetLine, end)
  }
  return { left: at(left), right: at(right), via: null, butt: false }
}

/**
 * The corners of one member end at one Junction.
 *
 * `host` is the host Wall when the Junction is a T-attach; a hosted member is trimmed to the
 * host's near face and the host itself never reaches here, because a hosted Junction sits
 * mid-span and not at one of its ends.
 */
const cornersAt = (
  wall: JoinWall,
  end: 'start' | 'end',
  members: readonly Member[],
  host: JoinWall | null,
): EndCorners => {
  const at = endAt(wall.line, end)
  if (host !== null) {
    // A T-attach: both faces are cut on the host's near face, so the cap runs along it.
    const near = nearFace(host, wall, end)
    const self = [faceCurve(wall, 'left'), faceCurve(wall, 'right')]
    const found = self.map((face) => crossPoint(face.locus, near.locus, at))
    if (found[0] !== null && found[1] !== null) return { left: found[0], right: found[1], via: null, butt: false }
    return squareEnd(wall, end)
  }
  const others = members.filter((member) => member.wall.id !== wall.id)
  if (others.length === 0) return squareEnd(wall, end)
  // The member this one runs through, if any: the same line carried on the far side. Its face
  // intersection with that partner is at infinity, so the partner never bounds a corner — but
  // it does mean this end carries no seam.
  const partner = others.find((other) => isRunThrough(wall, end, other.wall, other.end))
  const rest = partner === undefined ? others : others.filter((other) => other.wall.id !== partner.wall.id)
  const plain = squareEnd(wall, end)
  if (rest.length === 0) {
    // The faces continue into the partner: no corner, no seam.
    return { left: plain.left, right: plain.right, via: null, butt: true }
  }
  const selfDeg = awayDeg(wall, end)
  const limit = 10 * Math.max(wall.thickness, ...members.map((member) => member.wall.thickness))
  const nearest = (list: readonly Member[]): Member | undefined =>
    [...list].sort(
      (a, b) => angleGap(selfDeg, awayDeg(a.wall, a.end)) - angleGap(selfDeg, awayDeg(b.wall, b.end)),
    )[0]
  /** The corner on the face that lies on `self`’s away-frame `side`, bounded by its neighbour. */
  const cornerFor = (side: WallSide): { point: Pt; far: boolean } | null => {
    const onSide = rest.filter((other) => sideOf(wall, end, other.wall, other.end) === side)
    // A pair of members mitres both its faces, so the neighbour on the other side bounds this
    // one too. Three or more: a face with no angular neighbour on its side is the outer edge
    // of the fan and simply ends, square, where the union’s boundary does.
    const neighbour = nearest(onSide) ?? (rest.length === 1 ? rest[0] : undefined)
    if (neighbour === undefined) return null
    const mine = faceCurve(wall, faceSide(end, side))
    const theirs = faceCurve(neighbour.wall, faceSide(neighbour.end, opposite(side)))
    const found = crossPoint(mine.locus, theirs.locus, at)
    // Two faces that never meet — a kink whose inner faces diverge — leave that face its own
    // end point, which is what the union’s boundary does there.
    if (found === null) return null
    return { point: found, far: distance(found, at) > limit }
  }
  const left = cornerFor(faceSide(end, 'left'))
  const right = cornerFor(faceSide(end, 'right'))
  // Either face meeting its neighbour more than ten thicknesses down the line is the
  // near-parallel case: both faces square, which is the one answer that cannot self-intersect
  // and cannot disagree with the neighbour about where the joint is.
  if (left?.far === true || right?.far === true) return { ...plain, butt: partner !== undefined }
  // The cap turns through the Junction point, where the members’ reference lines meet. Two
  // members at 90° put it on the mitre line anyway; three or more split the small polygon at
  // the centre between them, which is what lets the tidied bands tile with no gap or overlap.
  const leftPoint = left?.point ?? plain.left
  const rightPoint = right?.point ?? plain.right
  return {
    left: leftPoint,
    right: rightPoint,
    via: turns(leftPoint, at, rightPoint) ? at : null,
    butt: partner !== undefined,
  }
}

/** The host face the branch butts: the one its own body lies against. */
const nearFace = (host: JoinWall, branch: JoinWall, branchEnd: 'start' | 'end'): { line: WallRefLine; locus: Locus } => {
  const other = branchEnd === 'start' ? 'end' : 'start'
  const far = endAt(branch.line, other)
  const candidates = (['left', 'right'] as const).map((side) => ({ side, ...faceCurve(host, side) }))
  return candidates.reduce((best, candidate) => {
    const d = distance(candidate.line.start, far) + distance(candidate.line.end, far)
    return d < distance(best.line.start, far) + distance(best.line.end, far) ? candidate : best
  })
}

/** The face segment between two corners of one Wall's reference line. */
const faceSegment = (wall: JoinWall, side: WallSide, from: Pt, to: Pt): Segment => {
  const line = offsetRefLine(wall.line, faceOffsets(wall.thickness, wall.justification)[side === 'left' ? 0 : 1])
  if (line.kind === 'line') return { kind: 'line', to }
  const arc = refSegment(line)
  if (arc.segment.kind !== 'arc') return { kind: 'line', to }
  const center = arc.segment.center
  const angle = (at: Pt): number => Math.atan2(at.y - center.y, at.x - center.x)
  const sweep = angle(to) - angle(from)
  const same = Math.sign(sweep) === Math.sign(arc.segment.sweepDeg)
  const turned = same ? sweep : sweep + (arc.segment.sweepDeg > 0 ? 360 : -360)
  return { kind: 'arc', to, center, sweepDeg: turned }
}

/** The closed band between two faces, capped at both ends unless a run-through says not to. */
const band = (
  wall: JoinWall,
  start: EndCorners,
  end: EndCorners,
): [JoinedFace, JoinedFace] => {
  const build = (side: WallSide): JoinedFace => {
    const from = side === 'left' ? start.left : start.right
    const to = side === 'left' ? end.left : end.right
    return { side, from, to, segment: faceSegment(wall, side, from, to) }
  }
  return [build('left'), build('right')]
}

/** The outline of one tidied Wall: face, cap, face back, cap. Always closed. */
const outlineOf = (faces: readonly [JoinedFace, JoinedFace], start: EndCorners, end: EndCorners): ClosedPath => {
  const [left, right] = faces
  const back = (face: JoinedFace): Segment =>
    face.segment.kind === 'arc'
      ? { kind: 'arc', to: face.from, center: face.segment.center, sweepDeg: -face.segment.sweepDeg }
      : { kind: 'line', to: face.from }
  // A cap is a straight line across the band, bent once through the Junction point where the
  // members’ reference lines meet. A run-through end still closes its own outline — the two
  // partners share that edge exactly, so the pair reads as one band with no seam in it.
  const cap = (from: Pt, via: Pt | null, to: Pt): Segment[] =>
    via === null || !turns(from, via, to)
      ? [{ kind: 'line', to }]
      : [
          { kind: 'line', to: via },
          { kind: 'line', to },
        ]
  return {
    start: right.from,
    segments: [
      ...cap(right.from, start.via, left.from),
      left.segment,
      ...cap(left.to, end.via, right.to),
      back(right),
    ],
  }
}

/**
 * Tidy every Wall against every Junction it takes part in (#64 §5).
 *
 * Walls and Junctions arrive as the whole Floor's data because a Wall's outline depends on
 * both its ends at once, and the two ends can belong to two different Junctions. The result
 * is in the order the Walls were given, so it never depends on Junction order or object key
 * order. A Wall in no Junction is its own plain band.
 */
export const joinWalls = (
  walls: readonly JoinWall[],
  junctions: readonly JoinJunction[],
): JoinedWall[] => {
  const byId = new Map(walls.map((wall) => [wall.id, wall]))
  // A Wall end belongs to at most one Junction — the validator enforces it — so one end
  // maps to one Junction, hosted or not.
  const junctionAtEnd = new Map<string, JoinJunction>()
  for (const junction of junctions) {
    for (const member of junction.ends) {
      const key = `${member.wallId} ${member.end}`
      if (!junctionAtEnd.has(key)) junctionAtEnd.set(key, junction)
    }
  }

  return walls.map((wall) => {
    const cornersFor = (end: 'start' | 'end'): EndCorners => {
      const junction = junctionAtEnd.get(`${wall.id} ${end}`)
      if (junction === undefined) return squareEnd(wall, end)
      const members = junction.ends
        .map((member) => ({ wall: byId.get(member.wallId), end: member.end }))
        .filter((member): member is { wall: JoinWall; end: 'start' | 'end' } => member.wall !== undefined)
      // The host of a T-attach keeps both faces unbroken: it is never trimmed by a Junction
      // that sits mid-span on it, and it is not one of the Junction's ends either.
      const hostId = junction.host?.wallId
      if (hostId !== undefined && hostId === wall.id) return squareEnd(wall, end)
      const host = hostId === undefined ? null : byId.get(hostId) ?? null
      return cornersAt(wall, end, members, host)
    }
    const start = cornersFor('start')
    const end = cornersFor('end')
    const faces = band(wall, start, end)
    return {
      id: wall.id,
      faces,
      outline: outlineOf(faces, start, end),
      capStart: !start.butt,
      capEnd: !end.butt,
    }
  })
}
