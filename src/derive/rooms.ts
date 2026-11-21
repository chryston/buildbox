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
import { area, containment, overlap } from '../geometry'
import type { ClosedPath, Pt } from '../geometry'
import type { EntityId, Project, Room, RoomOutline } from '../domain'
import { roomArea, roomBounds, roomLabelAnchor, roomOutlinePath, roomPerimeter } from '../domain'
import { effectiveFloor } from './effective'
import type { Rect } from './effective'

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
