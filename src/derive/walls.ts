/**
 * The Walls of one Floor, tidied and named (#64 §6).
 *
 * `geometry.joinWalls` turns stored reference lines into tidied outlines; this is the layer
 * above it that answers the questions the rest of the app asks: which faces a Floor has, where
 * those faces meet, how long each Wall is along its own reference line, and what the snap
 * engine should be offered. Nothing here is stored: clean-up is derived on every read, which is
 * what lets a Junction be pure topology — a shared connection point, never a cached polygon.
 *
 * A face is named by `(wallId, side)`, stable across every edit that does not move that face,
 * which is what lets a caller hold a face key across an Edit Transaction.
 *
 * A corner is where two tidied faces meet, or where a face ends at a free end. The corner of a
 * Junction is one point shared by every member there, so it is emitted once, and it is named
 * after the Walls that meet — `Corner of W-3 and W-5` — never after a side (#64 §7: no
 * left/right wording, ever). A point where a run-through pair's faces carry straight across is
 * not a corner at all and is not emitted.
 *
 * The Design Option is part of the cache key but not of the answer: Walls belong to the
 * Existing Model until #69 gives them Option ownership, so two Options of one Floor derive the
 * same Walls today.
 */
import { joinWalls, refLength } from '../geometry'
import type { ClosedPath, JoinJunction, JoinWall, Pt, Segment, WallSide } from '../geometry'
import type { EntityId, Project } from '../domain'
import type { WallFaceSource } from './snapCandidates'
import { faceRoomNames } from './rooms'
import { effectiveModel } from './effectiveModel'

/** One tidied face, with the key that names it (#64 §6). */
export interface DerivedFace {
  /** `(wallId, side)`, stable while the face itself is not moved. */
  readonly key: string
  readonly wallId: EntityId
  readonly side: WallSide
  readonly from: Pt
  readonly to: Pt
  readonly segment: Segment
}

/** One point where tidied faces meet, or where a face ends. */
export interface DerivedCorner {
  readonly point: Pt
  /** `Corner of W-3 and W-5`, or `End of W-3` (#64 §7). */
  readonly label: string
  /** Every Wall whose face passes through this point; one at a free end. */
  readonly wallIds: readonly EntityId[]
}

/** One Wall of the Floor after clean-up. */
export interface DerivedWall {
  readonly id: EntityId
  /** The display reference `W-5`, used for every label of this Wall. */
  readonly ref: string
  readonly outline: ClosedPath
  /** `[left, right]`, in the reference line's own direction. */
  readonly faces: readonly [DerivedFace, DerivedFace]
  /** Length along the reference line, in millimetres — never along a face. */
  readonly length: number
  readonly capStart: boolean
  readonly capEnd: boolean
}

/** Everything derived for one Floor's Walls. */
export interface FloorWalls {
  readonly walls: readonly DerivedWall[]
  readonly byId: ReadonlyMap<EntityId, DerivedWall>
  /** Every tidied face of the Floor, both of each Wall. */
  readonly faces: readonly DerivedFace[]
  /** Every distinct corner, once each, in Wall order. */
  readonly corners: readonly DerivedCorner[]
  /** The same faces and corners in the shape the shared snap engine takes (#59 §5). */
  readonly snapSources: readonly WallFaceSource[]
}

/** The trailing number of a display reference, so `W-3` sorts before `W-10`. */
const refNumber = (ref: string): number => {
  const digits = /\d+/.exec(ref)
  return digits === null ? 0 : Number(digits[0])
}

/** `W-3`, `W-3 and W-5`, `W-1, W-2 and W-4` — plain words, in reference order (#64 §7). */
const joinRefs = (refs: readonly string[]): string => {
  const sorted = [...refs].sort((a, b) => refNumber(a) - refNumber(b) || (a < b ? -1 : 1))
  if (sorted.length <= 1) return sorted[0] ?? ''
  return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`
}

/**
 * The tidied Walls, faces, corners and lengths of one Floor (#64 §6).
 *
 * Pure: the same Project, Floor and Design Option always give a byte-identical answer, and a Floor
 * with no Walls gives an empty result rather than `undefined`. The Walls of the Option that is
 * standing are what is tidied: a Wall this Option demolishes is not drawn as a Wall and takes part
 * in no join, which is the standing set of #69 §5 rather than the whole Existing Model.
 */
export const deriveWalls = (project: Project, floorId: EntityId, optionId: EntityId | null = null): FloorWalls => {
  const model = effectiveModel(project, floorId, optionId)
  const stored = model.standingWalls
  const junctions = model.standingWallJunctions
  const refOf = new Map(stored.map((wall) => [wall.id, wall.ref]))
  const joined = joinWalls(
    stored.map((wall): JoinWall => ({
      id: wall.id,
      line: wall.line,
      thickness: wall.thickness,
      justification: wall.justification,
    })),
    junctions.map(
      (junction): JoinJunction => ({
        id: junction.id,
        ends: junction.ends.map((member) => ({ wallId: member.wallId, end: member.end })),
        ...(junction.host === undefined ? {} : { host: { wallId: junction.host.wallId, at: junction.host.at } }),
      }),
    ),
  )

  // Which Junction holds each Wall end, and which Walls meet at it: its members, plus the host
  // whose reference line the Junction rides on, because the host's faces pass through the point.
  // A Wall end is the address of its Junction: the tidied corners at that end are offset from the
  // Junction's own point by the join, so they are found by topology and never by distance.
  const junctionOf = new Map<string, readonly EntityId[]>()
  for (const junction of junctions) {
    const wallIds = junction.ends.map((member) => member.wallId)
    if (junction.host !== undefined && !wallIds.includes(junction.host.wallId)) wallIds.push(junction.host.wallId)
    for (const member of junction.ends) junctionOf.set(`${member.wallId}/${member.end}`, wallIds)
  }

  const walls: DerivedWall[] = joined.map((item) => {
    const storedWall = stored.find((wall) => wall.id === item.id)!
    const faces = item.faces.map((face): DerivedFace => ({
      key: `${item.id}/${face.side}`,
      wallId: item.id,
      side: face.side,
      from: face.from,
      to: face.to,
      segment: face.segment,
    })) as [DerivedFace, DerivedFace]
    return {
      id: item.id,
      ref: storedWall.ref,
      outline: item.outline,
      faces,
      length: refLength(storedWall.line),
      capStart: item.capStart,
      capEnd: item.capEnd,
    }
  })

  // Corners, once each. A face’s endpoints are exactly where it meets another face or ends, so
  // they are the corners; the two ends of a run-through pair are excluded because the faces
  // carry straight across them and there is nothing there for a tool to catch on.
  const seen = new Map<string, DerivedCorner>()
  const cornersOf = new Map<EntityId, DerivedCorner[]>()
  for (const wall of walls) {
    const mine: DerivedCorner[] = []
    for (const face of wall.faces) {
      for (const [point, end, capped] of [
        [face.from, 'start', wall.capStart],
        [face.to, 'end', wall.capEnd],
      ] as [Pt, 'start' | 'end', boolean][]) {
        if (!capped) continue
        const key = `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`
        const existing = seen.get(key)
        if (existing !== undefined) {
          mine.push(existing)
          continue
        }
        const ids = junctionOf.get(`${wall.id}/${end}`) ?? [wall.id]
        const corner: DerivedCorner = {
          point,
          label: ids.length <= 1 ? `End of ${wall.ref}` : `Corner of ${joinRefs(ids.map((id) => refOf.get(id) ?? ''))}`,
          wallIds: ids,
        }
        seen.set(key, corner)
        mine.push(corner)
      }
    }
    cornersOf.set(wall.id, mine)
  }

  // A face that borders a Room is named for it — `W-5 · Kitchen side face` — because that is how
  // the person aiming at it is thinking: the side of the Kitchen, never the left or the right of a
  // Wall (#67 §9). A face bordering no Room keeps the plain wording, which is the truth about it.
  const faceNames = faceRoomNames(
    walls.map((wall) => [...wall.faces]).flat(),
    model.standingRooms,
  )
  const snapSources: WallFaceSource[] = walls.map((wall) => ({
    id: wall.id,
    label: `${wall.ref} · face`,
    corners: (cornersOf.get(wall.id) ?? []).map((corner) => ({ point: corner.point, label: corner.label })),
    faces: wall.faces.map((face) => {
      const name = faceNames.get(`${face.wallId}|${face.side}`)
      return {
        from: face.from,
        to: face.to,
        segment: face.segment,
        ...(name === undefined ? {} : { label: `${wall.ref} · ${name} side face` }),
      }
    }),
  }))

  return {
    walls,
    byId: new Map(walls.map((wall) => [wall.id, wall])),
    faces: walls.map((wall) => [...wall.faces]).flat(),
    corners: [...seen.values()],
    snapSources,
  }
}
