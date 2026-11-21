/**
 * What the Room Intents and the Wall Intents share (#67 §7, §11–§13).
 *
 * A Room Edge referenced to a Wall face is a standing claim: the Edge lies on that face, and
 * when the face moves the Edge goes with it. Two things follow, and both live here so the
 * Wall handlers and the Room handlers cannot disagree about them.
 *
 * The first is the **proposal check**: an outline is committed only when it describes a shape
 * and shares no positive area with another Room of the same Floor. Shared collinear edges and
 * point contacts are fine — `roomOverlapWith` already ignores them — so the check is one call.
 *
 * The second is **following**. A Wall edit is *compatible* with a reference when the face the
 * Edge rides moves as a whole across itself: translation, perpendicular offset, a thickness or
 * justification change, and extending or trimming along the same line all do. Rotation, a
 * line-to-arc change and a radius change do not — the face stops being the line the Edge lies
 * on — so those are refused rather than approximated. A compatible edit slides the Edge onto
 * the face it now has, in the same transaction, and the whole transaction is refused if any
 * Room that has to follow would end up invalid or overlapping.
 */
import {
  formatGeometryProblem,
  roomFaceCurve,
  roomOutlineAfterSlide,
  roomOutlineProblems,
  roomOverlapWith,
  roomSegmentOf,
} from '../../domain'
import { roomDeleteBlock, roomEdgeName, roomFaceRefList } from '../../derive'
import type {
  DisplayFormat,
  EntityId,
  Project,
  Room,
  RoomOutline,
  RoomWallFaceRef,
  Wall,
  WallFaceSide,
} from '../../domain'
import { TOLERANCE_MM, arcFromThrough, distance, ontoFaceVector, pt } from '../../geometry'
import type { LineSegment, Pt } from '../../geometry'
import { refuse, sameJsonValue } from './support'

const MM: DisplayFormat = { unit: 'mm', precision: 0 }

/** Square millimetres to the two-decimal square metres every message prints. */
export const squareMetres = (mm2: number): string => (mm2 / 1_000_000).toFixed(2)

export const roomPath = (roomId: EntityId): string => `existingModel.rooms[${roomId}]`
export const wallPathOf = (wallId: EntityId): string => `existingModel.walls[${wallId}]`

/** The Room, or a rejection: every Room Intent names one. */
export const requireRoom = (project: Project, roomId: EntityId): Room => {
  const found = project.existingModel.rooms.find((room) => room.id === roomId)
  if (found === undefined) refuse('unknown-target', roomPath(roomId), `No room answers to ${roomId}.`)
  return found
}

/** The Wall whose face a reference names, or a rejection. */
export const requireWall = (project: Project, wallId: EntityId): Wall => {
  const found = project.existingModel.walls.find((wall) => wall.id === wallId)
  if (found === undefined) refuse('unknown-target', wallPathOf(wallId), `No Wall answers to ${wallId}.`)
  return found
}

/** `Kitchen edge 2` — the pair every block message names (#67 §12). */
export const edgeName = roomEdgeName

/** Every Room Edge that references `wallId`, in the order the Project lists Rooms. */
export const faceRefsOn = (project: Project, wallId: EntityId): { room: Room; ref: RoomWallFaceRef }[] =>
  project.existingModel.rooms.flatMap((room) =>
    room.wallFaceRefs.filter((reference) => reference.wallId === wallId).map((reference) => ({ room, ref: reference })),
  )

/** `Kitchen edge 2 and Hall edge 4` — the list the delete block reads out (#67 §12). */
export const faceRefList = roomFaceRefList

/**
 * A Wall a Room is standing on cannot be deleted or merged away (#67 §12). The wording is the
 * prototype's, kept because it names every claim at once and says what to do about them; it lives
 * in `derive` because the Wall inspector shows the same sentence with Delete put out of reach.
 */
export const refuseReferencedWall = (project: Project, wall: Wall): never =>
  refuse('room-blocked', wallPathOf(wall.id), roomDeleteBlock(wall.ref, faceRefList(project, wall.id)))

// --- The proposal check -------------------------------------------------------

/**
 * Why this Room may not be committed, in the homeowner's words; nothing when it may.
 *
 * `followedBy` is the Edge number for a Wall edit that dragged a Room along: the same failure
 * reads differently when the homeowner was moving a Wall rather than drawing a Room, because
 * the Room is not what they were editing (#67 §12).
 */
export function checkRoomProposal(project: Project, room: Room, followedBy: string | null = null): void {
  const [problem] = roomOutlineProblems(room.outline)
  if (problem !== undefined) {
    refuse(
      'invalid-shape',
      roomPath(room.id),
      followedBy === null
        ? formatGeometryProblem(problem, MM)
        : `${followedBy} can't follow this change: ${room.name} would stop being a shape.`,
    )
  }
  const others = project.existingModel.rooms.filter((other) => other.id !== room.id && other.floorId === room.floorId)
  for (const overlap of roomOverlapWith(room.id, room.outline, others)) {
    const otherId = overlap.first === room.id ? overlap.second : overlap.first
    const other = others.find((candidate) => candidate.id === otherId)
    if (other === undefined) continue
    refuse(
      'room-blocked',
      roomPath(room.id),
      followedBy === null
        ? `Overlaps ${other.name} by ${squareMetres(overlap.area)} m².`
        : `${followedBy} can't follow this change: it would overlap ${other.name}.`,
    )
  }
}

// --- Following a face ---------------------------------------------------------

/** The unit direction of a straight reference line; `null` when it has none. */
const directionOf = (wall: Wall): Pt | null => {
  if (wall.line.kind !== 'line') return null
  const d = pt(wall.line.end.x - wall.line.start.x, wall.line.end.y - wall.line.start.y)
  const length = Math.hypot(d.x, d.y)
  return length === 0 ? null : pt(d.x / length, d.y / length)
}

const angleGap = (a: number, b: number): number => {
  let gap = (a - b) % (Math.PI * 2)
  if (gap > Math.PI) gap -= Math.PI * 2
  if (gap < -Math.PI) gap += Math.PI * 2
  return Math.abs(gap)
}

/**
 * Whether the face this Wall carries is still the same *kind* of line, so an Edge riding it
 * can be moved onto it by a perpendicular slide (#67 §12).
 *
 * Straight stays straight and along its own direction: the face may have shifted sideways,
 * which is what an offset, a thickness change or a justification change does to it. A curved
 * Wall keeps its radius and its sweep and may only translate — turning a curved Wall about its
 * centre slides the face along itself, which is not a slide an Edge can take, and changing the
 * radius bends the face out from under the Edge. A line that became an arc, or the reverse,
 * stops being a face an Edge lies on at all.
 */
export function faceCanCarry(was: Wall, now: Wall): boolean {
  if (was.line.kind !== now.line.kind) return false
  if (was.line.kind === 'line' && now.line.kind === 'line') {
    const a = directionOf(was)
    const b = directionOf(now)
    if (a === null || b === null) return false
    return Math.abs(a.x * b.y - a.y * b.x) <= 1e-9
  }
  if (was.line.kind !== 'arc' || now.line.kind !== 'arc') return false
  const a = arcFromThrough(was.line.start, was.line.through, was.line.end)
  const b = arcFromThrough(now.line.start, now.line.through, now.line.end)
  if (a === null || b === null) return false
  return (
    Math.abs(a.radius - b.radius) <= TOLERANCE_MM &&
    Math.abs((a.t1 - a.t0) - (b.t1 - b.t0)) <= 1e-9 &&
    angleGap(a.t0, b.t0) <= 1e-9
  )
}

/** Whether the face is in exactly the place it was, so nothing has to follow. */
const faceUnmoved = (was: Wall, now: Wall): boolean =>
  was.thickness === now.thickness &&
  was.justification === now.justification &&
  distance(was.line.start, now.line.start) <= 1e-9 &&
  distance(was.line.end, now.line.end) <= 1e-9 &&
  (was.line.kind !== 'arc' || now.line.kind !== 'arc' || distance(was.line.through, now.line.through) <= 1e-9)

/** The Edge's slide onto the face it is referenced to, and the outline that follows. */
function slideOntoFace(room: Room, outline: RoomOutline, ref: RoomWallFaceRef, host: Wall): RoomOutline {
  const segment = roomSegmentOf(outline, ref.segmentId)
  if (segment === null || segment.segment.kind !== 'line') {
    refuse(
      'room-blocked',
      roomPath(room.id),
      `${edgeName(room, ref.segmentId)} is not a straight edge, so it cannot follow ${host.ref}.`,
    )
  }
  const delta = ontoFaceVector(segment.segment as LineSegment, segment.from, roomFaceCurve(host, ref.side))
  if (Math.hypot(delta.x, delta.y) <= 1e-9) return outline
  const slid = roomOutlineAfterSlide(outline, segment.index + 1, delta)
  if (slid === null) {
    refuse(
      'room-blocked',
      roomPath(room.id),
      `${edgeName(room, ref.segmentId)} can't follow this change: ${room.name} would stop being a shape.`,
    )
  }
  return slid
}

/**
 * Every Room Edge referenced to a Wall this transaction changed follows that Wall's face, and
 * the whole transaction is refused if any of them cannot (#67 §12).
 *
 * Three passes, because the answer for one Room depends on the others having moved: first the
 * incompatible edits are refused before anything is written, then every outline is slid and
 * written, then every Room that moved is overlap-checked against the Project as it will be.
 * Checking Room by Room would compare a moved Room against a neighbour that has not moved yet
 * and refuse a pair that ends up perfectly well apart.
 */
export function followWallFaces(project: Project, draft: Project): void {
  const before = new Map(project.existingModel.walls.map((wall) => [wall.id, wall]))
  const after = new Map(draft.existingModel.walls.map((wall) => [wall.id, wall]))
  const moved: Room[] = []
  for (const room of draft.existingModel.rooms) {
    if (room.wallFaceRefs.length === 0) continue
    const base = requireRoom(project, room.id)
    for (const ref of room.wallFaceRefs) {
      const host = after.get(ref.wallId)
      if (host === undefined) {
        const gone = before.get(ref.wallId)
        if (gone !== undefined) refuseReferencedWall(project, gone)
        refuse('unknown-target', wallPathOf(ref.wallId), `${edgeName(base, ref.segmentId)} is attached to a wall that is no longer here.`)
      }
      const was = before.get(ref.wallId)
      if (was !== undefined && !faceCanCarry(was, host)) {
        refuse('room-blocked', wallPathOf(ref.wallId), `${host.ref} is referenced by ${edgeName(base, ref.segmentId)}.`)
      }
    }
    let outline = room.outline
    for (const ref of room.wallFaceRefs) {
      const host = after.get(ref.wallId)
      if (host === undefined) continue
      const was = before.get(ref.wallId)
      if (was !== undefined && faceUnmoved(was, host)) continue
      outline = slideOntoFace(base, outline, ref, host)
    }
    if (sameJsonValue(outline, room.outline)) continue
    room.outline = outline
    moved.push(room)
  }
  for (const room of moved) {
    const [ref] = room.wallFaceRefs
    checkRoomProposal(draft, room, ref === undefined ? null : edgeName(requireRoom(project, room.id), ref.segmentId))
  }
}

/** The face one reference names, as the Wall it points at carries it now. */
export const faceOf = (wall: Wall, side: WallFaceSide) => roomFaceCurve(wall, side)
