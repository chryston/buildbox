/**
 * Drawing a Room Outline on the Floor, and checking it as it is drawn (#67 §4, §7, §17).
 *
 * The path machine is the Item Footprint editor's own. `shape/draftPath` is pure `Pt` arithmetic
 * with no design space in it, so the same Line / Arc / Elliptical arc gestures, the same typed
 * lengths and the same closing rules run here in Floor millimetres — which is what makes a Room
 * drawn with the shape tools and a Footprint drawn with them the same skill (#67 §4).
 *
 * What a Room adds and a Footprint never needs is the live overlap check: no proposal may enclose
 * area another Room on this Floor already has, and it is asked on every pointer move rather than
 * only when the draft closes, because a person has to see the region before they let go of the
 * idea (#67 §7, shape-prototype defect "overlap is checked only on close").
 */
import type { ClosedPath, Pt } from '../../../derive'
import type { Room, RoomOutline } from '../../../domain'
import { getPresetEntry, getPresetPack, roomOutlinePath, roomOverlapWith } from '../../../domain'
import type { RoomOutlineShape } from '../../../edit'
import { STRINGS } from '../../strings'
import { formatSquareMetres } from '../displayUnits'
import { draftIsJudgeable, draftLoop } from '../shape/draftPath'
import type { PathDraft } from '../shape/draftPath'

/** The one built-in pack, the same id the Door / window tool reads. */
const PACK = 'hdb-bto-typical'

/** The id a proposal that has no Room yet is checked under; no entity id looks like this. */
const PROVISIONAL_ID = '@room-proposal'

const DEG = Math.PI / 180

/**
 * The loop the draft would commit, or `null` while it is not a shape yet.
 *
 * A two-Edge draft is not judgeable (#59 `too-few-edges`), so a draft that has just started is
 * not reported as invalid — the difference between an empty canvas and a red one.
 */
export function roomDraftLoop(draft: PathDraft): ClosedPath | null {
  return draftIsJudgeable(draft) ? draftLoop(draft) : null
}

/** The outline `Close` would write, in the shape `room.create` and `room.setOutline` take. */
export function roomDraftOutline(draft: PathDraft): RoomOutlineShape | null {
  const path = roomDraftLoop(draft)
  return path === null ? null : { kind: 'path', path }
}

/**
 * The loop a proposal paints: the path of any outline shape, preset or drawn. A proposal is not in
 * the model yet, so it has no Edge ids — the geometry is all the Plan View needs.
 */
export function roomOutlineShapePath(shape: RoomOutlineShape): ClosedPath {
  return roomOutlinePath({ ...shape, segmentIds: [] })
}

/** What a proposal does to the Rooms it is being checked against. */
export interface RoomOverlapPreview {
  readonly blocked: boolean
  /** The regions to paint — never empty unless the proposal is clean. */
  readonly regions: readonly ClosedPath[]
  /** The one sentence naming the other Room, or `null` when there is nothing to say. */
  readonly message: string | null
}

const CLEAN: RoomOverlapPreview = { blocked: false, regions: [], message: null }

/**
 * The live overlap check (#67 §7): the proposal against every other Room on its Floor.
 *
 * `rooms` are the Rooms of that Floor, including the one being edited — `roomId` names it, and it
 * is dropped before the comparison, because a proposal is never compared with the outline it
 * replaces. Shared collinear edges and point contacts come back clean: two Rooms that tile a
 * Floor are a normal drawing.
 */
export function roomOverlapPreview(
  roomId: string | null,
  outline: RoomOutlineShape | null,
  rooms: readonly Room[],
): RoomOverlapPreview {
  if (outline === null) return CLEAN
  const proposed: RoomOutline = { ...outline, segmentIds: [] }
  const others = rooms.filter((room) => room.id !== roomId)
  for (const shared of roomOverlapWith(PROVISIONAL_ID, proposed, others)) {
    const other = others.find((room) => room.id === shared.second)
    if (other === undefined) continue
    return {
      blocked: true,
      regions: shared.region,
      message: STRINGS.overlapsRoom(other.name, formatSquareMetres(shared.area)),
    }
  }
  return CLEAN
}

/** The pack's own words for the menu group it fills: `HDB BTO (typical)`. */
export function shelterPackName(): string {
  return getPresetPack(PACK).name
}

/** The pack's own words for the entry: `Household shelter`. */
export function shelterName(): string {
  return getPresetEntry(PACK, 'shelter.household').name
}

/** The shelter's internal size, in millimetres, as the pack states it. */
export function shelterSize(): { width: number; depth: number } {
  const entry = getPresetEntry(PACK, 'shelter.household')
  if (entry.kind !== 'shelter') throw new Error('shelter.household is not a shelter entry')
  return { width: entry.values.internalWidth, depth: entry.values.internalDepth }
}

/**
 * The rectangle a click on the Floor would place: the shelter's internal box, centred on the
 * click and turned by `orientationDeg`.
 *
 * The Intent builds the real thing — Room, four Walls, four references, one door — from the same
 * pack numbers. This is the ghost the pointer carries and the shape the overlap check is asked
 * about before the click lands, so the two can never disagree about where the shelter would go.
 */
export function shelterOutline(centre: Pt, orientationDeg: number): RoomOutlineShape {
  const { width, depth } = shelterSize()
  const cos = Math.cos(orientationDeg * DEG)
  const sin = Math.sin(orientationDeg * DEG)
  const corner = (dx: number, dy: number): Pt => ({
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  })
  const half = { x: width / 2, y: depth / 2 }
  const start = corner(-half.x, -half.y)
  return {
    kind: 'path',
    path: {
      start,
      segments: [
        { kind: 'line', to: corner(half.x, -half.y) },
        { kind: 'line', to: corner(half.x, half.y) },
        { kind: 'line', to: corner(-half.x, half.y) },
        { kind: 'line', to: start },
      ],
    },
  }
}
