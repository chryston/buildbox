/**
 * The derived Room picture of one Floor (#67 §3).
 *
 * Three things live here, all of them analytic and all of them memoised per Floor:
 *
 *  - **Area, perimeter and label anchor** of every Room Outline. Area and perimeter are the
 *    same Green's-theorem and arc-length integrals `geometry` uses everywhere else, so a Room
 *    drawn with two arcs reports the number its outline actually bounds rather than the number
 *    a flattened polyline would suggest. The label anchor is the pole of inaccessibility at
 *    1 mm, which is what lets a label sit inside an L-shaped Room instead of in the notch its
 *    bounding box has but the Room does not.
 *  - **Placed Item membership**: `inside`, `crosses` or `outside` every Room on the Floor, plus
 *    the analytic area of the footprint *outside* each Room it crosses. The area is
 *    `footprint − overlap`, never a sampled polygon, which is the fix for the prototype's
 *    crossing measure that came out identical for a 37° and a 52° rotation of the same item.
 *  - **Bounds**: the Floor's own extent and the extent of its Rooms.
 *
 * Membership is derived and never stored: moving a Placed Item changes no Room and moving a
 * Room changes no Placed Item, and the two are only ever asked about together.
 */
import { area, containment, nearestOnSegment, overlap, TOLERANCE_MM, edgeToFace, ontoFaceVector } from '../geometry'
import type { ClosedPath, LineSegment, Pt, WallSide } from '../geometry'
import type { EntityId, Project, Room, RoomOutline, RoomSegment } from '../domain'
import { roomArea, roomBounds, roomLabelAnchor, roomOutlineAfterSlide, roomOutlinePath, roomPerimeter, roomSegments } from '../domain'
import { effectiveFloor } from './effective'
import type { Rect } from './effective'
import type { DerivedFace, FloorWalls } from './walls'

/** The overlap area below which a footprint and a Room count as not overlapping at all (#67 §16). */
const MIN_ROOM_OVERLAP_MM2 = 0.01

/** One Room as the rest of `derive` and the surfaces read it. */
export interface DerivedRoom {
  readonly id: EntityId
  readonly floorId: EntityId
  readonly name: string
  /** The stored Outline, so a signature can be taken of what the model holds. */
  readonly outline: RoomOutline
  /** The Outline evaluated, in Floor coordinates — what every measurement is taken on. */
  readonly path: ClosedPath
  /** Square millimetres, analytic. */
  readonly areaMm2: number
  /** Square metres, analytic — what the Measurements tab and the Room label print. */
  readonly areaM2: number
  /** Millimetres, analytic: every edge length including arcs. */
  readonly perimeterMm: number
  /** The pole of inaccessibility of the Outline, always inside it, concave shapes included. */
  readonly labelAnchor: Pt
  /** The Outline's own box; the Floor's box is separate. */
  readonly bounds: Rect
}

/** The least a membership answer needs to know about a Room. */
export interface MeasurableRoom {
  readonly id: EntityId
  readonly name: string
  /** The Room Outline evaluated, in Floor coordinates. */
  readonly path: ClosedPath
}

/** How one Placed Item stands against one Room (#67 §15). */
export interface RoomMembership {
  readonly roomId: EntityId
  readonly roomName: string
  readonly relation: 'inside' | 'crosses' | 'outside'
  /**
   * Square millimetres of the footprint lying outside that Room, analytic.
   *
   * Zero unless the item crosses or misses the Room entirely, and never more than the
   * footprint's own area — the two ends of the range the crossing warning's percentage is
   * read against.
   */
  readonly outsideAreaMm2: number
}

/** Every Room of one Floor, and how its Placed Items sit in them. */
export interface FloorRooms {
  readonly floorId: EntityId
  /** Existing-Model order, so a re-derive never reorders the Rooms panel. */
  readonly rooms: DerivedRoom[]
  /** The union of every Room Outline, or `null` for a Floor with no Rooms. */
  readonly roomBounds: Rect | null
  /** The Floor's own extent: every footprint and the Plan Image, as `effectiveFloor` bounds it. */
  readonly floorBounds: Rect | null
  /**
   * Every Room of this Floor an item has a relation to, keyed by Placed Item ID.
   *
   * A Room the item misses entirely is absent rather than listed as `outside`: an item in one
   * Room of a five-Room Floor would otherwise carry four rows saying nothing (#67 D7).
   */
  readonly membership: ReadonlyMap<EntityId, readonly RoomMembership[]>
}

/** The Room Outlines of one Floor, evaluated and measured. */
const derivedRoomsOf = (rooms: readonly Room[]): DerivedRoom[] =>
  rooms.map((room) => {
    const areaMm2 = roomArea(room.outline)
    return {
      id: room.id,
      floorId: room.floorId,
      name: room.name,
      outline: room.outline,
      path: roomOutlinePath(room.outline),
      areaMm2,
      areaM2: areaMm2 / 1_000_000,
      perimeterMm: roomPerimeter(room.outline),
      labelAnchor: roomLabelAnchor(room.outline),
      bounds: rectOf(roomBounds(room.outline)),
    }
  })

/** `geometry` bounds a path as a corner box; the rest of `derive` passes `{x, y, w, h}`. */
const rectOf = (box: { minX: number; minY: number; maxX: number; maxY: number }): Rect => ({
  x: box.minX,
  y: box.minY,
  w: box.maxX - box.minX,
  h: box.maxY - box.minY,
})

/** The union of two boxes; `geometry` bounds a path but never a pair of boxes. */
const unionBounds = (a: Rect, b: Rect): Rect => {
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  return {
    x: minX,
    y: minY,
    w: Math.max(a.x + a.w, b.x + b.w) - minX,
    h: Math.max(a.y + a.h, b.y + b.h) - minY,
  }
}

/** The footprint area lying outside `room`, clamped to `[0, footprintArea]`. */
const outsideAreaOf = (footprintArea: number, footprint: ClosedPath, room: ClosedPath): number => {
  const shared = overlap(footprint, room)
  const inside = shared.kind === 'positive' && shared.area > MIN_ROOM_OVERLAP_MM2 ? shared.area : 0
  return Math.min(footprintArea, Math.max(0, footprintArea - inside))
}

/**
 * How one Floor's Placed Items sit in one Floor's Rooms.
 *
 * `geometry.containment` answers the relation from the two loops' crossings, so an item whose
 * edge runs exactly along a Room edge is `inside` rather than `crosses` — the same tolerance
 * the overlap rule uses, and the reason a sofa pushed flush against a Kitchen wall does not
 * warn about itself.
 *
 * Exported because the crossing warning asks the identical question of the identical shapes:
 * one measurement, one place that rounds it.
 */
export const roomMembershipOf = (footprint: ClosedPath, rooms: readonly MeasurableRoom[]): RoomMembership[] => {
  const footprintArea = area(footprint)
  const rows: RoomMembership[] = []
  for (const room of rooms) {
    const relation = containment(footprint, room.path)
    if (relation === 'inside') {
      rows.push({ roomId: room.id, roomName: room.name, relation, outsideAreaMm2: 0 })
      continue
    }
    const outside = outsideAreaOf(footprintArea, footprint, room.path)
    if (relation === 'outside' && outside >= footprintArea) continue
    rows.push({ roomId: room.id, roomName: room.name, relation, outsideAreaMm2: outside })
  }
  return rows
}

/** Everything #67 derives about one Floor's Rooms. */
export function deriveRooms(project: Project, floorId: EntityId): FloorRooms {
  const rooms = derivedRoomsOf(project.existingModel.rooms.filter((room) => room.floorId === floorId))
  const derived = effectiveFloor(project, 0, floorId, null)

  let box: Rect | null = null
  for (const room of rooms) box = box === null ? room.bounds : unionBounds(box, room.bounds)

  const membership = new Map<EntityId, readonly RoomMembership[]>()
  for (const placement of derived.placements) {
    const rows = roomMembershipOf(placement.worldPath, rooms)
    if (rows.length > 0) membership.set(placement.id, rows)
  }

  return { floorId, rooms, roomBounds: box, floorBounds: derived.bounds, membership }
}

// --- The face picker ----------------------------------------------------------

/**
 * One Wall face an Edge could be attached to (#67 §10).
 *
 * The list is the picker's whole answer: only parallel faces within the acquisition range are
 * candidates, each carries the Outline `Attach` produces, and each wears the name of the Room it
 * borders — because `W-5 · left` means nothing to a person standing in the Kitchen (D8).
 */
export interface RoomFaceCandidate {
  readonly wallId: EntityId
  readonly wallRef: string
  readonly side: WallSide
  /** `W-5 · Kitchen's side`, `W-5 · Balcony side` or `W-5 · far side`. */
  readonly label: string
  /** Perpendicular distance from the Edge to the face, in millimetres. */
  readonly distanceMm: number
  /** `true` when the Edge already lies on the face: attaching claims it without moving it. */
  readonly onFace: boolean
  /**
   * The Outline the attach produces — the Edge on the face, its neighbours extended or trimmed —
   * or `null` when the Room's representation cannot take the slide. A preset that would have to
   * change kind is still listed, because the picker has to say why it cannot be attached.
   */
  readonly outline: RoomOutline | null
}

/** How an Edge sits to a face, or `null` when the two are not comparable as lines. */
const edgeFaceRelation = (edge: RoomSegment, face: DerivedFace): { distance: number; skew: number } | null => {
  if (edge.segment.kind !== 'line' || face.segment.kind !== 'line') return null
  const relation = edgeToFace(edge.segment as LineSegment, edge.from, { from: face.from, segment: face.segment })
  return { distance: relation.distance, skew: relation.skew }
}

/** `true` when the Edge lies on the face: parallel, and no further off than the tolerance. */
const liesOnFace = (edge: RoomSegment, face: DerivedFace): boolean => {
  const relation = edgeFaceRelation(edge, face)
  return relation !== null && relation.skew <= TOLERANCE_MM && relation.distance <= TOLERANCE_MM
}

/** The name of another Room bordering this face, by claim or by shape. */
const borderingRoom = (face: DerivedFace, edited: Room, rooms: readonly Room[]): string | null => {
  for (const other of rooms) {
    if (other.floorId !== edited.floorId || other.id === edited.id) continue
    if (other.wallFaceRefs.some((ref) => ref.wallId === face.wallId && ref.side === face.side)) return other.name
    for (const edge of roomSegments(other.outline)) {
      if (liesOnFace(edge, face)) return other.name
    }
  }
  return null
}

/**
 * The name a face wears for this Room (#67 §9, D8): the side the Room stands on is its own, the
 * other side belongs to whichever Room borders it, and a face bordering no Room is the far side.
 * `left` and `right` never appear — a person reads a face as the side of the Kitchen, not the side
 * of the Wall.
 */
export function roomFaceLabel(room: Room, face: DerivedFace, walls: FloorWalls, rooms: readonly Room[]): string {
  const wall = walls.byId.get(face.wallId)
  const ref = wall?.ref ?? face.wallId
  const interior = roomLabelAnchor(room.outline)
  const twin = walls.faces.find((other) => other.wallId === face.wallId && other.side !== face.side)
  const here = nearestOnSegment(interior, face.segment, face.from).distance
  const there = twin === undefined ? Number.POSITIVE_INFINITY : nearestOnSegment(interior, twin.segment, twin.from).distance
  if (here <= there) return `${ref} · ${room.name}'s side`
  const other = borderingRoom(face, room, rooms)
  return other === null ? `${ref} · far side` : `${ref} · ${other} side`
}

/**
 * The faces one Edge of a Room may be attached to, nearest first (#67 §10).
 *
 * Parallelism is the issue's own test — the far end of the Edge may depart from the face by no more
 * than 0.01 mm over the Edge's length — and the range is a screen distance the caller has already
 * converted from CSS pixels, so zooming in reaches further across the Floor and zooming out less.
 * A face that is not parallel is not listed at all, however close it is: an Edge cannot lie on a
 * face it is skew to, and offering one would promise a move that the Intent must refuse.
 */
export function roomFaceCandidates(
  room: Room,
  segmentId: EntityId,
  walls: FloorWalls,
  rooms: readonly Room[],
  reachMm: number,
): RoomFaceCandidate[] {
  const edge = roomSegments(room.outline).find((each) => each.id === segmentId)
  if (edge === undefined) return []
  const candidates: RoomFaceCandidate[] = []
  for (const face of walls.faces) {
    const relation = edgeFaceRelation(edge, face)
    if (relation === null || relation.skew > TOLERANCE_MM || relation.distance > reachMm) continue
    const wall = walls.byId.get(face.wallId)
    if (wall === undefined) continue
    candidates.push({
      wallId: face.wallId,
      wallRef: wall.ref,
      side: face.side,
      label: roomFaceLabel(room, face, walls, rooms),
      distanceMm: relation.distance,
      onFace: relation.distance <= TOLERANCE_MM,
      outline: roomOutlineAfterSlide(
        room.outline,
        edge.index + 1,
        ontoFaceVector(edge.segment as LineSegment, edge.from, { from: face.from, segment: face.segment }),
      ),
    })
  }
  return candidates.sort((a, b) => a.distanceMm - b.distanceMm || (a.wallId < b.wallId ? -1 : 1))
}
