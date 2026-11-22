/**
 * The Room Intents (#67 §4, §7, §11–§13, §17).
 *
 * Every one of them ends at the same gate: `checkRoomProposal`. A Room is committed only when
 * its outline describes a shape and shares no positive area with another Room of the same
 * Floor, so an overlap is refused before it is ever drawn — never drawn and then warned about.
 *
 * The two face Intents are the reason a Room Edge has a stable ID at all. Attaching slides the
 * Edge onto the face and records the claim; detaching drops the claim and leaves the geometry
 * exactly where it is, because undoing an attachment should not also move a wall of the house.
 */
import {
  getPresetEntry,
  nextOpeningLabel,
  nextRoomName,
  roomOutlineAfterSlide,
  roomOutlinePath,
  roomSegmentOf,
  roomSegments,
} from '../../domain'
import type { EntityId, Opening, Project, Room, RoomOutline, RoomWallFaceRef, Wall, WallJunction } from '../../domain'
import type { ClosedPath, LineSegment, Pt } from '../../geometry'
import { TOLERANCE_MM, distance, edgeToFace, lengthOf, ontoFaceVector, pt } from '../../geometry'
import type { Locator, RoomIntent, RoomOutlineShape } from '../intents'
import type { IntentHandler } from './context'
import { creationLayerField } from './creationLayer'
import { nextWallRef, refuse, requireFloor, sameJsonValue, spendIds } from './support'
import { checkRoomProposal, edgeName, faceOf, roomPath, requireRoom, requireWall, wallPathOf } from './roomSupport'

/** The pack the fixed shelter entry lives in (#64). */
const HDB_BTO_TYPICAL = 'hdb-bto-typical'

/** `a - b`, the vector from one point to another. */
const minus = (a: Pt, b: Pt): Pt => pt(a.x - b.x, a.y - b.y)

const planLocator = (floorId: EntityId | null): Locator => ({
  floorId,
  viewId: null,
  view: 'plan',
  itemDesignIds: [],
  placedItemIds: [],
})

const roomFloor = (project: Project, roomId: EntityId): EntityId | null =>
  project.existingModel.rooms.find((room) => room.id === roomId)?.floorId ?? null

/** The shape the caller drew, with the Edge IDs it was given, in order. */
const withIds = (shape: RoomOutlineShape, ids: readonly EntityId[]): RoomOutline => ({
  ...shape,
  segmentIds: [...ids],
})

/** Edge count of an outline shape, which is how many IDs it spends. */
const shapeEdgeCount = (shape: RoomOutlineShape): number => roomOutlinePath(withIds(shape, [])).segments.length

/** The first point of Edge `index` of a closed path. */
const pathStart = (path: ClosedPath, index: number): Pt =>
  index === 0 ? pt(path.start.x, path.start.y) : pt(path.segments[index - 1].to.x, path.segments[index - 1].to.y)

/** Where a Room's Edge meets a face: whether it lies on it within tolerance. */
const onFace = (edge: LineSegment, from: Pt, wall: Wall, side: 'left' | 'right'): boolean => {
  const relation = edgeToFace(edge, from, faceOf(wall, side))
  return relation !== null && relation.distance <= TOLERANCE_MM && relation.skew <= TOLERANCE_MM
}

// --- Draw and rename ----------------------------------------------------------

const createRoom: IntentHandler<'room.create'> = {
  run({ project, draft, intent }) {
    const floor = requireFloor(project, intent.payload.floorId)
    const [roomId, ...segmentIds] = spendIds(
      intent.ids,
      1 + shapeEdgeCount(intent.payload.outline),
      'room.create',
    )
    const room: Room = {
      id: roomId,
      floorId: floor.id,
      name: intent.payload.name ?? nextRoomName(project),
      outline: withIds(intent.payload.outline, segmentIds),
      wallFaceRefs: [],
      // A Room is surveyed built fabric like the Walls around it, which is the layer decision #71 §2
      // owns: new Rooms join `Structure`.
      ...creationLayerField(project, intent.payload.target?.viewId, 'fabric'),
    }
    checkRoomProposal(project, room)
    draft.existingModel.rooms.push(room)
  },
  locate: (_project, intent) => planLocator(intent.payload.floorId),
}

const renameRoom: IntentHandler<'room.rename'> = {
  run({ draft, intent }) {
    const room = requireRoom(draft, intent.payload.roomId)
    if (room.name === intent.payload.name) {
      refuse('no-change', roomPath(room.id), `${room.name} is already called that.`)
    }
    room.name = intent.payload.name
  },
  locate: (project, intent) => planLocator(roomFloor(project, intent.payload.roomId)),
}

// --- Restate the outline ------------------------------------------------------

const setRoomOutline: IntentHandler<'room.setOutline'> = {
  run({ project, draft, intent }) {
    const room = requireRoom(draft, intent.payload.roomId)
    const outline = withIds(
      intent.payload.outline,
      spendIds(intent.ids, shapeEdgeCount(intent.payload.outline), 'room.setOutline'),
    )
    // A reference names an Edge, never a position. An Edge that leaves the outline takes its
    // attachment with it, and that is the homeowner's decision to make — never ours to take
    // silently by pointing the reference at whatever Edge now sits in its place (#67 §10).
    for (const reference of room.wallFaceRefs) {
      const segment = roomSegmentOf(outline, reference.segmentId)
      if (segment === null) {
        refuse(
          'room-blocked',
          roomPath(room.id),
          `${edgeName(room, reference.segmentId)} is attached to a wall face, so it cannot be removed. Detach it first.`,
        )
      }
      const host = requireWall(project, reference.wallId)
      if (segment.segment.kind !== 'line' || !onFace(segment.segment as LineSegment, segment.from, host, reference.side)) {
        refuse(
          'room-blocked',
          roomPath(room.id),
          `${edgeName(room, reference.segmentId)} is attached to ${host.ref}, and this outline moves it off that wall.`,
        )
      }
    }
    if (sameJsonValue(outline, room.outline)) refuse('no-change', roomPath(room.id), 'That is already its shape.')
    room.outline = outline
    checkRoomProposal(draft, room)
  },
  locate: (project, intent) => planLocator(roomFloor(project, intent.payload.roomId)),
}

// --- Attach and detach --------------------------------------------------------

const attachRoomFace: IntentHandler<'room.attachFace'> = {
  run({ project, draft, intent }) {
    const { roomId, segmentId, wallId, side } = intent.payload
    const room = requireRoom(draft, roomId)
    const host = requireWall(project, wallId)
    if (host.floorId !== room.floorId) {
      refuse('invalid-wall', wallPathOf(host.id), `${host.ref} is on another floor, so ${room.name} cannot attach to it.`)
    }
    const segment = roomSegmentOf(room.outline, segmentId)
    if (segment === null) {
      refuse('unknown-target', roomPath(room.id), `No edge of ${room.name} answers to ${segmentId}.`)
    }
    const already = room.wallFaceRefs.find((reference) => reference.segmentId === segmentId)
    const straight = segment.segment.kind === 'line' ? (segment.segment as LineSegment) : null
    if (already !== undefined && already.wallId === host.id && already.side === side && straight !== null) {
      if (onFace(straight, segment.from, host, side)) {
        refuse('no-change', roomPath(room.id), `${edgeName(room, segmentId)} is already attached to ${host.ref}.`)
      }
    }
    // Only a straight Edge can lie on a face, and only an outline that can take the slide can
    // carry one: a preset that would have to change kind says so in the words the issue gives.
    if (straight === null) refuse('room-blocked', roomPath(room.id), 'Convert to Custom Path to attach this edge')
    const face = faceOf(host, side)
    const relation = edgeToFace(straight, segment.from, face)
    if (relation === null || relation.skew > TOLERANCE_MM) {
      refuse(
        'room-blocked',
        roomPath(room.id),
        `${edgeName(room, segmentId)} is not parallel to ${host.ref}, so it cannot lie on that face.`,
      )
    }
    const slid = roomOutlineAfterSlide(room.outline, segment.index + 1, ontoFaceVector(straight, segment.from, face))
    if (slid === null) refuse('room-blocked', roomPath(room.id), 'Convert to Custom Path to attach this edge')
    const reference: RoomWallFaceRef = { segmentId, wallId: host.id, side }
    const carried = room.wallFaceRefs.some((existing) => existing.segmentId === segmentId)
    room.outline = slid
    room.wallFaceRefs = carried
      ? room.wallFaceRefs.map((existing) => (existing.segmentId === segmentId ? reference : existing))
      : [...room.wallFaceRefs, reference]
    checkRoomProposal(draft, room)
  },
  locate: (project, intent) => planLocator(roomFloor(project, intent.payload.roomId)),
}

const detachRoomFace: IntentHandler<'room.detachFace'> = {
  run({ draft, intent }) {
    const room = requireRoom(draft, intent.payload.roomId)
    if (!room.wallFaceRefs.some((reference) => reference.segmentId === intent.payload.segmentId)) {
      refuse('no-change', roomPath(room.id), `${edgeName(room, intent.payload.segmentId)} is not attached to a wall.`)
    }
    // The reference goes and the geometry stays: detaching undoes a claim, not a move.
    room.wallFaceRefs = room.wallFaceRefs.filter((reference) => reference.segmentId !== intent.payload.segmentId)
  },
  locate: (project, intent) => planLocator(roomFloor(project, intent.payload.roomId)),
}

// --- The household shelter ----------------------------------------------------

/** Where two Wall reference lines meet, extended as far as they need to (#67 §17). */
function lineJoin(a: { start: Pt; end: Pt }, b: { start: Pt; end: Pt }): Pt | null {
  const r = minus(a.end, a.start)
  const s = minus(b.end, b.start)
  const cross = r.x * s.y - r.y * s.x
  if (Math.abs(cross) < 1e-9) return null
  const qmp = minus(b.start, a.start)
  const t = (qmp.x * s.y - qmp.y * s.x) / cross
  return pt(a.start.x + r.x * t, a.start.y + r.y * t)
}

/**
 * Place the fixed `Household shelter` pack entry (#67 §17).
 *
 * The pack gives the interior, the thickness and the door; everything else follows from the
 * drawing. The Room is the interior; each Wall's reference line is the centre of the band
 * standing half a thickness outside one of its Edges, and consecutive reference lines are
 * joined where they meet, so the Walls close the corners without a gap. Each Edge is then
 * attached to whichever face of its Wall it actually lies on, which is what makes the shelter
 * an ordinary drawing afterwards: move a Wall and that side of the shelter moves with it.
 */
const placeShelter: IntentHandler<'room.placeShelter'> = {
  run({ project, draft, intent }) {
    const floor = requireFloor(project, intent.payload.floorId)
    const entry = getPresetEntry(HDB_BTO_TYPICAL, 'shelter.household')
    if (entry.kind !== 'shelter') {
      refuse('invalid-shape', `existingModel`, 'The household shelter pack entry is not a shelter.')
    }
    const { internalWidth, internalDepth, wallThickness, doorWidth, doorHeight } = entry.values
    const spent = spendIds(intent.ids, 14, 'room.placeShelter')
    const [roomId, doorId] = spent
    const wallIds = spent.slice(2, 6)
    const junctionIds = spent.slice(6, 10)
    const segmentIds = spent.slice(10, 14)

    const outline: RoomOutline = {
      kind: 'preset',
      preset: { kind: 'rectangle', width: internalWidth, depth: internalDepth },
      centre: pt(intent.payload.centre.x, intent.payload.centre.y),
      orientationDeg: intent.payload.orientationDeg,
      segmentIds,
    }
    const path = roomOutlinePath(outline)
    const half = wallThickness / 2
    // Each Edge's line, pushed half a thickness away from the interior's centre: the centre of
    // the band that will stand on it.
    const lines: { start: Pt; end: Pt }[] = []
    path.segments.forEach((segment, index) => {
      if (segment.kind !== 'line') {
        refuse('invalid-shape', roomPath(roomId), 'The household shelter needs a rectangular interior.')
      }
      const from = pathStart(path, index)
      const d = minus(segment.to, from)
      const length = Math.hypot(d.x, d.y)
      if (length === 0) refuse('invalid-shape', roomPath(roomId), 'The household shelter needs a rectangular interior.')
      const n = pt(-d.y / length, d.x / length)
      const mid = pt((from.x + segment.to.x) / 2, (from.y + segment.to.y) / 2)
      // Whichever way the outline runs, the band stands on the side away from the interior.
      const outward =
        distance(pt(mid.x + n.x * half, mid.y + n.y * half), intent.payload.centre) >=
        distance(pt(mid.x - n.x * half, mid.y - n.y * half), intent.payload.centre)
          ? n
          : pt(-n.x, -n.y)
      lines.push({
        start: pt(from.x + outward.x * half, from.y + outward.y * half),
        end: pt(segment.to.x + outward.x * half, segment.to.y + outward.y * half),
      })
    })

    const height = floor.defaultWallHeight ?? project.preferences.defaultWallHeight
    // The whole pack is built fabric — its Walls, its door and the Room between them — so one
    // resolution decides all three, and a read-only layer refuses the pack before any of it stands.
    const layer = creationLayerField(project, intent.payload.target?.viewId, 'fabric')
    const walls: Wall[] = lines.map((line, index) => {
      const previous = lines[(index - 1 + lines.length) % lines.length]
      const next = lines[(index + 1) % lines.length]
      const start = lineJoin(previous, line)
      const end = lineJoin(line, next)
      if (start === null || end === null) {
        refuse('invalid-shape', roomPath(roomId), 'The household shelter walls do not close.')
      }
      // `nextWallRef` reads the Project it is given, so each Wall takes the next number.
      const wall: Wall = {
        id: wallIds[index],
        ref: nextWallRef(draft),
        floorId: floor.id,
        line: { kind: 'line', start: pt(start.x, start.y), end: pt(end.x, end.y) },
        thickness: wallThickness,
        justification: 'centre',
        baseElevation: 0,
        height,
        ...layer,
      }
      draft.existingModel.walls.push(wall)
      return wall
    })

    const wallFaceRefs: RoomWallFaceRef[] = []
    path.segments.forEach((segment, index) => {
      if (segment.kind !== 'line') {
        refuse('invalid-shape', roomPath(roomId), `Edge ${index + 1} of the household shelter is not straight.`)
      }
      const from = pathStart(path, index)
      const side = (['left', 'right'] as const).find((candidate) => onFace(segment as LineSegment, from, walls[index], candidate))
      if (side === undefined) {
        refuse('invalid-shape', roomPath(roomId), `Edge ${index + 1} of the household shelter does not lie on its wall.`)
      }
      wallFaceRefs.push({ segmentId: segmentIds[index], wallId: walls[index].id, side })
    })

    const junctions: WallJunction[] = walls.map((wall, index) => ({
      id: junctionIds[index],
      floorId: floor.id,
      ends: [
        { wallId: wall.id, end: 'end' },
        { wallId: walls[(index + 1) % walls.length].id, end: 'start' },
      ],
    }))

    // The door goes in the side the pack calls the interior width — the first such Edge in
    // outline order — centred on the Wall that carries it.
    const doorEdge = roomSegments(outline).find(
      (segment) => Math.abs(lengthOf(segment.segment, segment.from) - internalWidth) <= TOLERANCE_MM,
    )
    if (doorEdge === undefined) {
      refuse('invalid-shape', roomPath(roomId), 'The household shelter has no wall to put its door in.')
    }
    const host = walls[doorEdge.index]
    const door: Opening = {
      id: doorId,
      floorId: floor.id,
      hostWallId: host.id,
      kind: 'door',
      label: nextOpeningLabel(project.existingModel.openings, 'door'),
      start: (distance(host.line.start, host.line.end) - doorWidth) / 2,
      width: doorWidth,
      sill: 0,
      head: doorHeight,
      swing: 'left',
      hingeSide: 'start',
      ...layer,
    }

    const room: Room = { id: roomId, floorId: floor.id, name: nextRoomName(project), outline, wallFaceRefs, ...layer }
    checkRoomProposal(project, room)
    draft.existingModel.wallJunctions.push(...junctions)
    draft.existingModel.openings.push(door)
    draft.existingModel.rooms.push(room)
  },
  locate: (_project, intent) => planLocator(intent.payload.floorId),
}

export const ROOM_HANDLERS: { [T in RoomIntent['type']]: IntentHandler<T> } = {
  'room.create': createRoom,
  'room.rename': renameRoom,
  'room.setOutline': setRoomOutline,
  'room.attachFace': attachRoomFace,
  'room.detachFace': detachRoomFace,
  'room.placeShelter': placeShelter,
}
