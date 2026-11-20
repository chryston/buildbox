/**
 * Openings along a Wall's reference line (#65 §2, §3).
 *
 * Two questions live here, and both are answered on the reference line alone — which is
 * why an Opening stores one number instead of two Floor points and follows its host
 * through every Wall edit:
 *
 * - **chord ↔ arc length.** `width` is the chord, the number on a drawing. The distance
 *   along an arc Wall it covers is `2·R·asin(w / 2R)`, and the two convert both ways.
 * - **the usable interval.** Which stretches of the reference line an Opening may
 *   occupy. Those come out of `joinWalls` — the same call that draws the tidied band —
 *   so a placement that passes here can never disagree with what is on the screen.
 *
 * `domain`'s validator and `derive`'s preview both read this file, and neither re-derives
 * a trim of its own (#65 §3).
 */
import { DEG, arcTangent, normaliseDeg, type ArcForm } from './segment'
import { arcFromThrough, refLength, refParamAt, refPointAt, type WallRefLine } from './wall'
import { joinWalls, type JoinJunction, type JoinWall, type JoinedWall } from './joinWalls'
import { interval, overlapLength, type Interval } from './interval'
import { TOLERANCE_MM, pt, type ClosedPath, type Pt, type Segment } from './types'

/** The arc length a chord of `chord` covers on a circle of `radius`. */
export const arcLengthOfChord = (radius: number, chord: number): number =>
  2 * radius * Math.asin(Math.min(1, Math.max(-1, chord / (2 * radius))))

/** The chord that `arcLength` of a circle of `radius` subtends. Its own inverse. */
export const chordOfArcLength = (radius: number, arcLength: number): number =>
  2 * radius * Math.sin(arcLength / (2 * radius))

/** The radius of an arc reference line, or `null` for a straight one. */
export const refRadius = (line: WallRefLine): number | null =>
  line.kind === 'line' ? null : arcFromThrough(line.start, line.through, line.end)?.radius ?? null

/**
 * The distance along the reference line of the far jamb of an opening that starts at
 * `start` and spans a chord of `width`. Equal to `start + width` on a straight Wall, and
 * always a little further on an arc — the chord is shorter than the arc it cuts across.
 */
export const openingEnd = (line: WallRefLine, start: number, width: number): number => {
  const radius = refRadius(line)
  return radius === null ? start + width : start + arcLengthOfChord(radius, width)
}

/** The two jambs of an opening, in Floor coordinates: the chord itself. */
export const openingChord = (line: WallRefLine, start: number, width: number): { from: Pt; to: Pt } => ({
  from: refPointAt(line, start),
  to: refPointAt(line, openingEnd(line, start, width)),
})

/** A stretch of reference line an Opening may occupy. */
export interface UsableGap {
  readonly from: number
  readonly to: number
}

/** Why a stretch of reference line is not usable, and what a message has to name. */
export type BlockCause =
  /** The Wall's own end, trimmed by the Junction that meets it. */
  | { readonly kind: 'host-end'; readonly end: 'start' | 'end' }
  /** A Junction hosted mid-span: `wallId` is the branch whose footprint blocks the host. */
  | { readonly kind: 'junction'; readonly junctionId: string; readonly wallId: string }

/** A blocked stretch of reference line, with its cause. */
export interface UsableBlock {
  readonly from: number
  readonly to: number
  readonly cause: BlockCause
}

/** What one Wall offers an Opening: its length, what blocks it, and the gaps between. */
export interface UsableInterval {
  readonly wallId: string
  /** Length along the reference line, so an arc is measured as an arc. */
  readonly length: number
  readonly gaps: readonly UsableGap[]
  readonly blocks: readonly UsableBlock[]
}

/** Where an opening of `width` starting at `start` stands against the usable interval. */
export interface OpeningFit {
  readonly fits: boolean
  /**
   * `ok` when it fits; `no-room` when no gap on this Wall is wide enough at all;
   * `blocked` when a gap exists but this position runs into an end or a Junction.
   */
  readonly reason: 'ok' | 'no-room' | 'blocked'
  /** What it ran into, when `reason` is `blocked`. */
  readonly cause: BlockCause | null
  /** The gap it sits in when it fits, otherwise the widest gap the Wall has. */
  readonly gap: UsableGap | null
}

/** The widest gap of an interval, or `null` when the Wall offers nothing. */
const widest = (gaps: readonly UsableGap[]): UsableGap | null =>
  gaps.reduce<UsableGap | null>((best, gap) => (best === null || gap.to - gap.from > best.to - best.from ? gap : best), null)

/** How much chord a gap can hold: its own length on a line, its chord on an arc. */
export const gapChord = (line: WallRefLine, gap: UsableGap): number => {
  const radius = refRadius(line)
  return radius === null ? gap.to - gap.from : chordOfArcLength(radius, gap.to - gap.from)
}

/**
 * The usable interval of every Wall of a set, read off `joinWalls`' own output (#65 §3):
 *
 * - a free end reaches the square end, so the interval runs to the reference line's end;
 * - an end in a Junction starts after the deeper of its two face trims, which is what the
 *   tidied band actually leaves, and so covers unequal thicknesses and multi-way joins;
 * - a Junction hosted mid-span blocks the projection of each branch's tidied footprint
 *   onto the host's reference line — the host is not trimmed there, but nothing may be
 *   cut through the join.
 */
export const usableIntervals = (
  walls: readonly JoinWall[],
  junctions: readonly JoinJunction[],
): Map<string, UsableInterval> => {
  const joined = joinWalls(walls, junctions)
  const byId = new Map<string, JoinedWall>(joined.map((wall) => [wall.id, wall]))
  const out = new Map<string, UsableInterval>()
  for (const wall of walls) {
    const shape = byId.get(wall.id)
    const length = refLength(wall.line)
    const blocks: UsableBlock[] = []
    if (shape !== undefined) {
      for (const junction of junctions) {
        const hosted = junction.host !== undefined && junction.host.wallId === wall.id
        if (hosted) {
          for (const member of junction.ends) {
            if (member.wallId === wall.id) continue
            const branch = byId.get(member.wallId)
            if (branch === undefined) continue
            // The branch's tidied footprint, projected onto the host's reference line.
            const at = (side: 0 | 1): number => {
              const face = branch.faces[side]
              return refParamAt(wall.line, member.end === 'start' ? face.from : face.to)
            }
            const span = interval(at(0), at(1))
            blocks.push({
              from: span.lo,
              to: span.hi,
              cause: { kind: 'junction', junctionId: junction.id, wallId: member.wallId },
            })
          }
          continue
        }
        for (const member of junction.ends) {
          if (member.wallId !== wall.id) continue
          // The deeper of the two face trims at this end, measured along the reference line.
          const trim = (side: 0 | 1): number => {
            const face = shape.faces[side]
            const at = refParamAt(wall.line, member.end === 'start' ? face.from : face.to)
            return member.end === 'start' ? at : length - at
          }
          const depth = Math.max(trim(0), trim(1))
          if (depth > TOLERANCE_MM) {
            blocks.push({
              from: member.end === 'start' ? 0 : length - depth,
              to: member.end === 'start' ? depth : length,
              cause: { kind: 'host-end', end: member.end },
            })
          }
        }
      }
    }
    out.set(wall.id, { wallId: wall.id, length, blocks, gaps: gapsOf(blocks, length) })
  }
  return out
}

/** What is left of `[0, length]` once every blocked stretch is taken away. */
const gapsOf = (blocks: readonly UsableBlock[], length: number): UsableGap[] => {
  const sorted = [...blocks].sort((a, b) => a.from - b.from)
  const gaps: UsableGap[] = []
  let cursor = 0
  for (const block of sorted) {
    if (block.from > cursor) gaps.push({ from: cursor, to: Math.min(block.from, length) })
    cursor = Math.max(cursor, block.to)
  }
  if (cursor < length) gaps.push({ from: cursor, to: length })
  return gaps.filter((gap) => gap.to - gap.from > TOLERANCE_MM)
}

/**
 * Whether an opening of `width` starting at `start` sits inside one gap of `usable`, and
 * if not what stopped it. Both edges are judged at the topology tolerance, so an opening
 * that ends exactly on a trim fits — the acceptance numbers of #65 §3 turn on that.
 */
export const fitOpening = (line: WallRefLine, usable: UsableInterval, start: number, width: number): OpeningFit => {
  const end = openingEnd(line, start, width)
  const want = interval(start, end)
  for (const gap of usable.gaps) {
    if (want.lo >= gap.from - TOLERANCE_MM && want.hi <= gap.to + TOLERANCE_MM) {
      return { fits: true, reason: 'ok', cause: null, gap }
    }
  }
  const widestGap = widest(usable.gaps)
  const roomy = usable.gaps.some((gap) => gapChord(line, gap) >= width - TOLERANCE_MM)
  if (!roomy) return { fits: false, reason: 'no-room', cause: null, gap: widestGap }
  const hit = usable.blocks.find((block) => overlapLength({ lo: block.from, hi: block.to }, want) > TOLERANCE_MM)
  if (hit !== undefined) return { fits: false, reason: 'blocked', cause: hit.cause, gap: widestGap }
  // Nothing was crossed: the opening simply stands over one end of the Wall or the other.
  const end_ = want.hi > usable.length - TOLERANCE_MM ? 'end' : 'start'
  return { fits: false, reason: 'blocked', cause: { kind: 'host-end', end: end_ }, gap: widestGap }
}

/**
 * The point of the face `offset` millimetres from the reference line, `at` millimetres
 * along it. An arc's face is concentric, so the offset runs along the radius through that
 * point — the same face `offsetRefLine` draws, reached by distance instead of by endpoint.
 */
export const facePointAt = (line: WallRefLine, offset: number, at: number): Pt => {
  const on = refPointAt(line, at)
  if (line.kind === 'line') {
    const dx = line.end.x - line.start.x
    const dy = line.end.y - line.start.y
    const l = Math.hypot(dx, dy) || 1
    return pt(on.x + (-dy / l) * offset, on.y + (dx / l) * offset)
  }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return on
  const rx = on.x - arc.center.x
  const ry = on.y - arc.center.y
  const r = Math.hypot(rx, ry) || 1
  const radius = arc.radius + offset
  return pt(arc.center.x + (rx / r) * radius, arc.center.y + (ry / r) * radius)
}

/**
 * The curve of one face between two reference-line distances, starting at `from`. This is
 * how a Wall band is cut into pieces at its Openings: each piece is the same two faces
 * over a shorter span, so its corners stay on the tidied faces (#65 §4).
 */
export const faceCurveBetween = (
  line: WallRefLine,
  offset: number,
  from: number,
  to: number,
): { from: Pt; segment: Segment } => {
  const start = facePointAt(line, offset, from)
  const end = facePointAt(line, offset, to)
  if (line.kind === 'line') return { from: start, segment: { kind: 'line', to: end } }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return { from: start, segment: { kind: 'line', to: end } }
  // A concentric face arc spans the same angles as the reference arc, so only its endpoints
  // change — the segment is still described by the same centre and sweep.
  const sweep = arc.t1 - arc.t0
  const angleAt = (at: number): number => arc.t0 + (sweep === 0 ? 0 : (at / arc.radius) * Math.sign(sweep))
  const t0 = angleAt(from)
  const t1 = angleAt(to)
  return {
    from: start,
    segment: { kind: 'arc', to: end, center: arc.center, sweepDeg: (t1 - t0) / (Math.PI / 180) },
  }
}

/** The two face offsets of a Wall's faces, relative to its reference line. */
export type FaceOffsets = readonly [number, number]

/** One unbroken piece of a tidied Wall band, between two Openings. */
export interface WallPiece {
  /** Reference-line distance of the piece's near end. */
  readonly from: number
  /** Reference-line distance of the piece's far end. */
  readonly to: number
  readonly outline: ClosedPath
}

/**
 * The tidied band of a Wall cut into pieces at its Openings (#65 §4). Each piece runs
 * between two cut lines square across the band, on the Wall's own two faces, so the gap an
 * Opening leaves is exactly the interval the fit rule checked — the drawing and the
 * validator read the same numbers, which is the whole reason an Opening is stored along
 * the reference line.
 */
export const wallPieces = (
  line: WallRefLine,
  offsets: FaceOffsets,
  length: number,
  cuts: readonly Interval[],
): WallPiece[] => {
  const pieces: WallPiece[] = []
  const piece = (from: number, to: number): void => {
    const near = faceCurveBetween(line, offsets[1], from, to)
    const far = faceCurveBetween(line, offsets[0], from, to)
    const back = (face: { from: Pt; segment: Segment }): Segment =>
      face.segment.kind === 'arc'
        ? { kind: 'arc', to: face.from, center: face.segment.center, sweepDeg: -face.segment.sweepDeg }
        : { kind: 'line', to: face.from }
    pieces.push({
      from,
      to,
      outline: {
        start: near.from,
        segments: [
          near.segment,
          { kind: 'line', to: far.segment.to },
          back(far),
          { kind: 'line', to: near.from },
        ],
      },
    })
  }
  const sorted = [...cuts].sort((a, b) => a.lo - b.lo)
  let cursor = 0
  for (const cut of sorted) {
    if (cut.lo > cursor) piece(cursor, Math.min(cut.lo, length))
    cursor = Math.max(cursor, cut.hi)
  }
  if (cursor < length) piece(cursor, length)
  return pieces
}

/**
 * The tangent direction of the reference line at any distance along it, clockwise degrees.
 * A door leaf is drawn square to the Wall at its jamb, which needs the tangent mid-span as
 * well as at the ends, where `refTangentDeg` stops.
 */
export const refTangentAt = (line: WallRefLine, at: number): number => {
  if (line.kind === 'line') {
    return normaliseDeg((Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x) / DEG) * 360)
  }
  const arc = arcFromThrough(line.start, line.through, line.end)
  if (arc === null) return 0
  const sweep = arc.t1 - arc.t0
  const t = arc.t0 + (sweep === 0 ? 0 : (at / arc.radius) * Math.sign(sweep))
  const form: ArcForm = { center: arc.center, rx: arc.radius, ry: arc.radius, phi: 0, t0: arc.t0, t1: arc.t1, circular: true }
  const d = arcTangent(form, t)
  // Along the reference line, which runs with decreasing parameter on a negatively swept arc.
  const along = sweep < 0 ? -1 : 1
  return normaliseDeg((Math.atan2(d.y * along, d.x * along) / DEG) * 360)
}
