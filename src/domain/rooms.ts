/**
 * The Room as one thing to ask questions of (#67).
 *
 * A Room Outline is the same two representations an Item Footprint uses — a preset with
 * parameters, or a Custom Path — placed in Floor coordinates instead of footprint-local ones,
 * plus one stable ID per Edge. Everything the rest of the app needs is answered here so the
 * switch on `outline.kind` happens once: the path, the measurements, the Edges with their
 * stable IDs, the Wall face an Edge is referenced to, and whether two Rooms overlap.
 *
 * Nothing in this file reads a Design Option, a view or a Layer: overlap is asked of the
 * effective model the caller already has, which is what lets #69 change the argument without
 * changing a signature.
 */
import {
  TOLERANCE_MM,
  bounds,
  edgeToFace,
  evaluatePreset,
  faceCurve,
  labelAnchor,
  overlap,
  perimeter,
  segmentStart,
  signedArea,
  slideLineEdge,
  validateLoop,
} from '../geometry'
import type {
  Bounds,
  ClosedPath,
  FaceCurve,
  FaceRelation,
  GeometryProblem,
  LineSegment,
  Pt,
  Segment,
  WallJustification,
  WallRefLine,
  WallSide,
} from '../geometry'
import type { EntityId, Project, Room, RoomOutline, RoomWallFaceRef } from './project'

/** The overlap area below which two Room Outlines count as not overlapping at all (#67 §2). */
export const MIN_ROOM_OVERLAP_MM2 = 0.01

/** The closed loop a Room Outline describes, in Floor millimetres. */
export function roomOutlinePath(outline: RoomOutline): ClosedPath {
  return outline.kind === 'preset'
    ? evaluatePreset(outline.preset, { centre: outline.centre, orientationDeg: outline.orientationDeg })
    : outline.path
}

/**
 * Why this outline is not a shape, or nothing when it is.
 *
 * A preset is checked as a parameterisation first, exactly as an Item Footprint is, so an
 * impossible radius is reported as the radius rather than as whatever the evaluated loop
 * happens to look like.
 */
export function roomOutlineProblems(outline: RoomOutline): GeometryProblem[] {
  return outline.kind === 'preset'
    ? validateLoop({ preset: outline.preset, placement: { centre: outline.centre, orientationDeg: outline.orientationDeg } })
    : validateLoop(outline.path)
}

/** Enclosed area in square millimetres, analytic over arcs; 0 for a loop that encloses nothing. */
export function roomArea(outline: RoomOutline): number {
  return Math.abs(signedArea(roomOutlinePath(outline)))
}

/** Distance around the outline in millimetres, arcs measured along the arc. */
export function roomPerimeter(outline: RoomOutline): number {
  return perimeter(roomOutlinePath(outline))
}

/** The outline's axis-aligned box in Floor millimetres. */
export function roomBounds(outline: RoomOutline): Bounds {
  return bounds(roomOutlinePath(outline))
}

/**
 * The label anchor: the interior point farthest from the outline, to 1 mm.
 *
 * Always inside, even for an L or a U, which is the whole reason it is not the bounds' centre
 * (#67 behaviour 35).
 */
export function roomLabelAnchor(outline: RoomOutline): Pt {
  return labelAnchor(roomOutlinePath(outline))
}

/** One Edge of a Room Outline, with the stable ID a reference names. */
export interface RoomSegment {
  /** The stored stable ID. */
  readonly id: EntityId
  /** 0-based position in the evaluated path, which is what `slideLineEdge` and the editor index by. */
  readonly index: number
  /** 1-based Edge number, which is what every message and table uses (#54 §1). */
  readonly edge: number
  readonly segment: Segment
  readonly from: Pt
}

/** Every Edge, in order, paired with its stable ID. Shorter lists pair with nothing. */
export function roomSegments(outline: RoomOutline): RoomSegment[] {
  const path = roomOutlinePath(outline)
  return path.segments.map((segment, index) => ({
    id: outline.segmentIds[index] ?? '',
    index,
    edge: index + 1,
    segment,
    from: segmentStart(path, index),
  }))
}

/** The Edge a stable ID names, or `null` when the outline has no such Edge. */
export function roomSegmentOf(outline: RoomOutline, segmentId: EntityId): RoomSegment | null {
  return roomSegments(outline).find((segment) => segment.id === segmentId) ?? null
}

/** The three fields a face is read from; a `Wall` and the validator's parsed Wall both are one. */
export interface WallFaceOwner {
  readonly line: WallRefLine
  readonly thickness: number
  readonly justification: WallJustification
}

/** The supporting curve of the face one reference points at. */
export function roomFaceCurve(wall: WallFaceOwner, side: WallSide): FaceCurve {
  return faceCurve(wall.line, wall.thickness, wall.justification, side)
}

/** How the Edge one reference names sits against the face it names. */
export function roomFaceRelation(
  outline: RoomOutline,
  reference: RoomWallFaceRef,
  wall: WallFaceOwner,
): FaceRelation | null {
  const segment = roomSegmentOf(outline, reference.segmentId)
  if (segment === null || segment.segment.kind !== 'line') return null
  return edgeToFace(segment.segment as LineSegment, segment.from, roomFaceCurve(wall, reference.side))
}

/** Two Rooms on one Floor whose outlines enclose area in common. */
export interface RoomOverlap {
  readonly first: EntityId
  readonly second: EntityId
  /** Square millimetres of the intersection. */
  readonly area: number
  /** The intersection itself, for the red hatch (#67 behaviour 20). */
  readonly region: readonly ClosedPath[]
}

/**
 * Every positive-area pair among `rooms`, in the order the list gives them.
 *
 * A shared collinear edge and a point contact enclose nothing, so they come back as nothing:
 * two Rooms that tile a Floor are a normal drawing, not a defect (#67 §2).
 */
export function roomOverlaps(rooms: readonly Room[]): RoomOverlap[] {
  const found: RoomOverlap[] = []
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const shared = overlap(roomOutlinePath(rooms[i].outline), roomOutlinePath(rooms[j].outline))
      if (shared.kind === 'positive' && shared.area > MIN_ROOM_OVERLAP_MM2) {
        found.push({ first: rooms[i].id, second: rooms[j].id, area: shared.area, region: shared.region })
      }
    }
  }
  return found
}

/**
 * The overlap of one proposed outline against the Rooms already on the Floor.
 *
 * `others` never contains the Room being edited: the caller passes the effective model with
 * that Room's own current outline replaced by the proposal, so a proposal is never compared
 * with itself.
 */
export function roomOverlapWith(roomId: EntityId, proposed: RoomOutline, others: readonly Room[]): RoomOverlap[] {
  const found: RoomOverlap[] = []
  for (const other of others) {
    const shared = overlap(roomOutlinePath(proposed), roomOutlinePath(other.outline))
    if (shared.kind === 'positive' && shared.area > MIN_ROOM_OVERLAP_MM2) {
      found.push({ first: roomId, second: other.id, area: shared.area, region: shared.region })
    }
  }
  return found
}

/**
 * The name a committed Room takes: `Room N` for the lowest N no Room on the Project uses.
 *
 * Project-wide rather than per Floor, because two Floors both showing `Room 1` in a Project
 * list is the confusion the numbering exists to avoid. A deleted Room's number is free again,
 * which is what "lowest unused" means.
 */
export function nextRoomName(project: Project): string {
  const used = new Set(
    project.existingModel.rooms
      .map((room) => /^Room (\d+)$/.exec(room.name)?.[1])
      .filter((digits): digits is string => digits !== undefined)
      .map(Number),
  )
  for (let candidate = 1; ; candidate += 1) if (!used.has(candidate)) return `Room ${candidate}`
}

/**
 * The outline the same Room has after one Edge slid onto a face, with its stable IDs intact.
 *
 * A Custom Path takes the slid loop directly. A Rectangle or Rounded Rectangle is re-fitted
 * from the slid loop instead — width, depth and centre follow, the corner radii stay — because
 * those two representations can describe the result and stay editable. Any other preset cannot
 * follow a face, and `null` is the caller's `Convert to Custom Path to attach this edge`.
 */
export function roomOutlineAfterSlide(outline: RoomOutline, segmentIndex: number, delta: Pt): RoomOutline | null {
  const slid = slideLineEdge(roomOutlinePath(outline), segmentIndex, delta)
  if (slid === null) return null
  if (outline.kind === 'path') return { ...outline, path: slid }
  const refitted = refitPreset(outline, slid)
  return refitted === null ? null : { ...outline, ...refitted }
}

/**
 * The preset parameters that draw `path`, for the presets whose shape is its bounding box.
 *
 * A Rectangle and a Rounded Rectangle are exactly their bounds plus radii, so a slid loop
 * re-reads as the same preset with a new size and place. A square keeps being a square only
 * when the slid loop is one; every other preset has parameters a bounding box cannot recover
 * (a turn, a side count, an apex offset), so it comes back `null` and the Edge cannot attach.
 */
function refitPreset(outline: Extract<RoomOutline, { kind: 'preset' }>, path: ClosedPath): RoomOutline | null {
  const box = bounds(path)
  const width = box.maxX - box.minX
  const depth = box.maxY - box.minY
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  if (outline.orientationDeg !== 0) return null
  switch (outline.preset.kind) {
    case 'rectangle':
      return { ...outline, preset: { ...outline.preset, width, depth }, centre }
    case 'square':
      if (Math.abs(width - depth) > TOLERANCE_MM) return null
      return { ...outline, preset: { ...outline.preset, side: width }, centre }
    case 'roundedRectangle':
      return { ...outline, preset: { ...outline.preset, width, depth }, centre }
    default:
      return null
  }
}
