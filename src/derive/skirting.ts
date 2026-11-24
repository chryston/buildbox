/**
 * The Skirting of one Floor, drawn and measured (#78 §1, §2).
 *
 * A Skirting stores a host Wall, one of its faces, a range along the reference line and a Vertical
 * Extent. Everything else is answered here, every time, from the host:
 *
 * - **the body** is the host's tidied face — the one `geometry.joinWalls` leaves after clean-up —
 *   stood off by `thickness`. A Skirting never stores a polygon: the face it stands off belongs to
 *   the Wall, and a copy of it would be a second answer that goes stale the moment the Wall moves.
 * - **the corners** are clipped to that tidied face. A mitre shortens one face and not the other,
 *   which is why the clip is read off the face the Skirting stands off rather than off the Wall.
 * - **the gaps** are where something else occupies the same space: an Opening on the same host whose
 *   height range strictly overlaps this one, and a joined Wall butting into this face at a T. Touching
 *   is not overlap — a window with its sill exactly at the Skirting's top leaves the Skirting whole.
 * - **the lengths**: gross is `end − start`, net is what is left after the clips and the gaps.
 *
 * Which Openings count is the Display's business (#78 §2): a proposed door cut through a skirted
 * wall opens a gap in `Proposed` and `Combined` and none in `Existing`, and no gap is ever a record.
 *
 * Pure and deterministic: the same Project, Floor, Option and Display give a byte-identical answer.
 */
import type { EntityId, Project, RenovationDisplay, Skirting, Wall } from '../domain'
import { skirtingLabel, skirtingTop } from '../domain'
import type { ClosedPath, Interval, Pt, Segment, WallRefLine, WallSide } from '../geometry'
import {
  TOLERANCE_MM,
  faceCurveBetween,
  faceOffsets,
  facePointAt,
  interval,
  overlapLength,
  refLength,
  refParamAt,
  reverse,
} from '../geometry'
import { displayModel } from './renovationDisplay'
import { effectiveModel } from './effectiveModel'
import { faceRoomNames } from './rooms'
import { deriveWalls } from './walls'

/** Why a piece of the range is not Skirting. */
export type SkirtingGapReason = 'opening' | 'junction' | 'corner'

/** One gap along the host's reference line, with the reason the plan and the inspector give. */
export interface SkirtingGap {
  readonly from: number
  readonly to: number
  readonly reason: SkirtingGapReason
}

/** One unbroken piece of Skirting: the range it covers and the band the plan paints. */
export interface SkirtingRun {
  readonly from: number
  readonly to: number
  /** The body: the host face, the exposed face `thickness` beyond it, and the two end caps. */
  readonly outline: ClosedPath
}

/** One Skirting of the Floor, with the geometry the plan paints and the lengths it measures. */
export interface DerivedSkirting {
  readonly id: EntityId
  /** `Skirting SK-3`, or `Skirting` where nobody named it. */
  readonly label: string
  readonly hostWallId: EntityId
  readonly side: WallSide
  /** The stored range, unclipped — what the inspector edits. */
  readonly start: number
  readonly end: number
  readonly bottom: number
  /** `bottom + height`, derived and never stored. */
  readonly top: number
  readonly thickness: number
  /** The host face the body stands off, and the exposed face, as offsets of the reference line. */
  readonly innerOffset: number
  readonly outerOffset: number
  /** `end − start`, in millimetres. */
  readonly grossLength: number
  /** What is left after the corner clips and the gaps, in millimetres. */
  readonly netLength: number
  readonly gaps: readonly SkirtingGap[]
  readonly runs: readonly SkirtingRun[]
}

/** Everything derived for one Floor's Skirting. */
export interface FloorSkirting {
  readonly skirting: readonly DerivedSkirting[]
  readonly byId: ReadonlyMap<EntityId, DerivedSkirting>
}

/** The unit vector pointing away from the reference line, at `along`: outward for a positive offset. */
const offsetDirection = (line: WallRefLine, along: number): Pt => {
  const near = facePointAt(line, 0, along)
  const far = facePointAt(line, 1000, along)
  const length = Math.hypot(far.x - near.x, far.y - near.y) || 1
  return { x: (far.x - near.x) / length, y: (far.y - near.y) / length }
}

/**
 * How far `at` lies from the reference line, signed: positive is the `right` face's side.
 *
 * Exported for the Warnings engine (#78 §6), which measures the depth a Skirting reaches into a
 * Placed Item's footprint perpendicular to the host face — the same perpendicular this module uses
 * to decide which face a joined Wall butts against.
 */
export const perpendicularOffsetOf = (line: WallRefLine, at: Pt): number => {
  const along = refParamAt(line, at)
  const on = facePointAt(line, 0, along)
  const direction = offsetDirection(line, along)
  return (at.x - on.x) * direction.x + (at.y - on.y) * direction.y
}

/** `a` with every interval of `cuts` taken out of it, in order, dropping anything that closes up. */
const subtract = (a: Interval, cuts: readonly Interval[]): Interval[] => {
  let pieces: Interval[] = [a]
  for (const cut of cuts) {
    const next: Interval[] = []
    for (const piece of pieces) {
      if (overlapLength(piece, cut) <= TOLERANCE_MM) {
        next.push(piece)
        continue
      }
      if (cut.lo - piece.lo > TOLERANCE_MM) next.push({ lo: piece.lo, hi: cut.lo })
      if (piece.hi - cut.hi > TOLERANCE_MM) next.push({ lo: cut.hi, hi: piece.hi })
    }
    pieces = next
  }
  return pieces
}

/** The band between two faces of the host's reference line over one range. */
const band = (line: WallRefLine, innerOffset: number, outerOffset: number, from: number, to: number): ClosedPath => {
  const inner = faceCurveBetween(line, innerOffset, from, to)
  const outer = faceCurveBetween(line, outerOffset, from, to)
  const outerTo: Pt = outer.segment.to
  const back = reverse({ start: outer.from, segments: [outer.segment] })
  const caps: Segment[] = [{ kind: 'line', to: outerTo }, ...back.segments, { kind: 'line', to: inner.from }]
  return { start: inner.from, segments: [inner.segment, ...caps] }
}

/** The range the tidied face of `side` actually covers, measured along the reference line. */
const faceSpan = (faces: readonly { wallId: EntityId; side: WallSide; from: Pt; to: Pt }[], host: Wall, side: WallSide): Interval => {
  const face = faces.find((row) => row.wallId === host.id && row.side === side)
  if (face === undefined) return interval(0, refLength(host.line))
  return interval(refParamAt(host.line, face.from), refParamAt(host.line, face.to))
}

/** The ranges the Walls butting into this face at a T cover, on this side only. */
const junctionGaps = (
  host: Wall,
  side: WallSide,
  junctions: readonly { id: EntityId; host?: { wallId: EntityId; at: number }; ends: readonly { wallId: EntityId; end: 'start' | 'end' }[] }[],
  wallById: ReadonlyMap<EntityId, Wall>,
): SkirtingGap[] => {
  const gaps: SkirtingGap[] = []
  for (const junction of junctions) {
    if (junction.host === undefined || junction.host.wallId !== host.id) continue
    for (const member of junction.ends) {
      const branch = wallById.get(member.wallId)
      if (branch === undefined) continue
      // The branch's cap corners at the end that meets the host: the width it covers along the host.
      const at = member.end === 'start' ? 0 : refLength(branch.line)
      const [near, far] = faceOffsets(branch.thickness, branch.justification)
      const a = facePointAt(branch.line, near, at)
      const b = facePointAt(branch.line, far, at)
      // The branch covers the face it butts against — the one its body lies against. The end that
      // meets the host is often exactly on the host's reference line, so the side is read from the
      // far end of the branch, which is unambiguously on one side or the other.
      const away = facePointAt(branch.line, 0, member.end === 'start' ? refLength(branch.line) : 0)
      const covered = perpendicularOffsetOf(host.line, away) >= 0 ? 'right' : 'left'
      if (covered !== side) continue
      const span = interval(refParamAt(host.line, a), refParamAt(host.line, b))
      if (span.hi - span.lo > TOLERANCE_MM) gaps.push({ from: span.lo, to: span.hi, reason: 'junction' })
    }
  }
  return gaps
}

/** One Skirting's gaps, clips, runs and lengths, read off the host and the Display. */
function deriveOne(
  entry: Skirting,
  host: Wall,
  openings: readonly { start: number; width: number; sill: number; head: number }[],
  junctions: Parameters<typeof junctionGaps>[2],
  wallById: ReadonlyMap<EntityId, Wall>,
  faces: readonly { wallId: EntityId; side: WallSide; from: Pt; to: Pt }[],
): DerivedSkirting {
  const top = skirtingTop(entry)
  const [leftOffset, rightOffset] = faceOffsets(host.thickness, host.justification)
  const innerOffset = entry.side === 'left' ? leftOffset : rightOffset
  const outerOffset = entry.side === 'left' ? innerOffset - entry.thickness : innerOffset + entry.thickness
  const clip = faceSpan(faces, host, entry.side)

  const gaps: SkirtingGap[] = []
  if (clip.lo - entry.start > TOLERANCE_MM) gaps.push({ from: entry.start, to: clip.lo, reason: 'corner' })
  if (entry.end - clip.hi > TOLERANCE_MM) gaps.push({ from: clip.hi, to: entry.end, reason: 'corner' })
  for (const opening of openings) {
    // Strict overlap of the height ranges: touching is not overlap (#78 §2).
    if (!(opening.sill < top && opening.head > entry.bottom)) continue
    gaps.push({ from: opening.start, to: opening.start + opening.width, reason: 'opening' })
  }
  gaps.push(...junctionGaps(host, entry.side, junctions, wallById))

  const standing = interval(Math.max(entry.start, clip.lo), Math.min(entry.end, clip.hi))
  const pieces = standing.hi - standing.lo <= TOLERANCE_MM ? [] : subtract(standing, gaps.map((gap) => interval(gap.from, gap.to)))
  const runs: SkirtingRun[] = pieces.map((piece) => ({
    from: piece.lo,
    to: piece.hi,
    outline: band(host.line, innerOffset, outerOffset, piece.lo, piece.hi),
  }))
  return {
    id: entry.id,
    label: skirtingLabel(entry),
    hostWallId: entry.hostWallId,
    side: entry.side,
    start: entry.start,
    end: entry.end,
    bottom: entry.bottom,
    top,
    thickness: entry.thickness,
    innerOffset,
    outerOffset,
    grossLength: entry.end - entry.start,
    netLength: runs.reduce((total, run) => total + (run.to - run.from), 0),
    gaps,
    runs,
  }
}

/**
 * The Skirting of one Floor, as the Display `display` shows it (#78 §2).
 *
 * A Skirting whose host Wall does not stand in this Option is skipped rather than guessed at: with
 * the Wall gone there is no face to stand off, and drawing a band in mid-air would be a claim about
 * a Wall that is not there.
 */
export function deriveSkirting(
  project: Project,
  floorId: EntityId,
  optionId: EntityId | null = null,
  display: RenovationDisplay = 'combined',
): FloorSkirting {
  const model = effectiveModel(project, floorId, optionId)
  const drawn = displayModel(model, display)
  const wallById = new Map(model.standingWalls.map((wall) => [wall.id, wall]))
  const junctions = model.standingWallJunctions
  const faces = deriveWalls(project, floorId, optionId).faces
  const rows: DerivedSkirting[] = []
  for (const entry of drawn.skirting.map((row) => row.entity)) {
    const host = wallById.get(entry.hostWallId)
    if (host === undefined) continue
    const openings = drawn.openings
      .filter((row) => row.entity.hostWallId === entry.hostWallId)
      .map((row) => row.entity)
    rows.push(deriveOne(entry, host, openings, junctions, wallById, faces))
  }
  return { skirting: rows, byId: new Map(rows.map((row) => [row.id, row])) }
}

/**
 * One Wall face the Skirting tool can be pointed at (#78 §3 step 1), with the range a click on it
 * means. The range is the **tidied** face, so a click at a corner creates Skirting that stops at the
 * corner instead of reaching into the junction it shares with the next Wall.
 */
export interface SkirtingFaceTarget {
  readonly wallId: EntityId
  readonly side: WallSide
  /** `W-1`, the same reference every other label of this Wall uses. */
  readonly ref: string
  /** The Room whose side this face is, or `null` when no Room adjoins it. */
  readonly roomName: string | null
  /**
   * 1 or 2, the wording for a face with no Room — `W-1 · side 1`. It is a name for the face, not a
   * compass bearing: which of the two is 1 never changes and never says left or right (#78 §3).
   */
  readonly sideNumber: 1 | 2
  /** Millimetres along the host's reference line — the `start` a click sends. */
  readonly start: number
  /** Millimetres along the host's reference line — the `end` a click sends. */
  readonly end: number
  /** The face's own ends, on the real line: an arc Wall is highlighted along the arc (#78 §7). */
  readonly from: Pt
  readonly to: Pt
}

/**
 * Every face of every standing Wall of one Floor, in Wall order then side order (#78 §3). The tool
 * picks the nearest of these to the pointer, which is what makes "the nearer face" the same answer
 * for the highlight, the label and the record that gets written.
 */
export function skirtingFaceTargets(
  project: Project,
  floorId: EntityId,
  optionId: EntityId | null = null,
): SkirtingFaceTarget[] {
  const model = effectiveModel(project, floorId, optionId)
  const derived = deriveWalls(project, floorId, optionId)
  const refOf = new Map(derived.walls.map((wall) => [wall.id, wall.ref]))
  const lineOf = new Map(model.standingWalls.map((wall) => [wall.id, wall.line]))
  const roomNames = faceRoomNames(derived.faces, model.standingRooms)
  const targets: SkirtingFaceTarget[] = []
  for (const face of derived.faces) {
    const line = lineOf.get(face.wallId)
    const ref = refOf.get(face.wallId)
    if (line === undefined || ref === undefined) continue
    const span = interval(refParamAt(line, face.from), refParamAt(line, face.to))
    targets.push({
      wallId: face.wallId,
      side: face.side,
      ref,
      roomName: roomNames.get(`${face.wallId}|${face.side}`) ?? null,
      sideNumber: face.side === 'left' ? 1 : 2,
      start: span.lo,
      end: span.hi,
      from: face.from,
      to: face.to,
    })
  }
  return targets
}
