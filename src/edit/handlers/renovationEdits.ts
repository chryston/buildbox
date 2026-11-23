/**
 * The base-plan renovation-edit table (#69 §7–§8), and
 * reachable only through the flag-gated spread in `../registry` (see `./renovationHandlers` for
 * why that matters).
 *
 * Five Intents, each one Edit Transaction with one undo:
 *
 * - `renovation.placeOpening` and `renovation.knockThrough` cut a proposed Opening into a Wall
 *   that stands in the Option, leaving that Wall retained — no demolition, no successor. They
 *   reuse the S7 Opening checks wholesale (`requireDoorFields`, `requireFit`) against the
 *   **effective** model of the Option, which is why a proposed Opening is measured against the
 *   gaps the Option has already made rather than the survey's.
 * - `renovation.demolish` records that Existing work comes down, or deletes the Option's own
 *   proposed record. A Wall is never demolished quietly: its Openings go with it in the same
 *   transaction, and the review that listed them has to be the answer that comes back.
 * - `renovation.replace` puts a successor where the survey had an entity, carrying the edit, the
 *   Openings cut into it and the joins the successor's geometry still makes.
 * - `renovation.restore` takes all of that back: the demolition record, the successors built out of
 *   the entity and everything carried onto them, so the effective model is what it was before the
 *   first replace.
 *
 * Nothing here forks a Wall, Opening, Room or Placed Item handler: editing proposed work is
 * `wall.setThickness` with a `target`, and #69 §7 says so. What is new is only which container a
 * record lands in, and the two questions the model cannot answer for itself — what comes down with
 * a Wall, and what is standing in the way.
 */
import { effectiveModel } from '../../derive'
import { designOptionsOf, roomSegments } from '../../domain'
import type {
  DesignOption,
  EntityId,
  Opening,
  OpeningKind,
  PlacedItem,
  Project,
  Room,
  RoomOutline,
  Wall,
  WallJunction,
} from '../../domain'
import { compareCodePoints } from '../../lib'
import { refLength, refParamAt, refPointAt } from '../../geometry'
import type { DemolitionDependency, DemolitionReview, Locator, RenovationIntentType, RestoreReview } from '../intents'
import type { Handler, IntentHandler } from './context'
import { requireDoorFields, requireFit, requireOpeningsFit } from './openingSupport'
import { checkRoomProposal, edgeName, faceCanCarry, slideOntoFace } from './roomSupport'
import { creationLayerField } from './creationLayer'
import { effectiveView, refuse, spendIds } from './support'
import type { CorrectionIntentType } from './correctionHandlers'
import type { PasteIntentType } from './pasteHandlers'

/** The edit-table Intent types, written once: the renovation set less the two corrections. */
type EditIntentType = Exclude<
  Extract<RenovationIntentType, `renovation.${string}`>,
  CorrectionIntentType | PasteIntentType
>

/** The Option an edit belongs to; without it there is nothing to write into. */
function requireOption(draft: Project, optionId: EntityId): DesignOption {
  const option = designOptionsOf(draft).find((entry) => entry.id === optionId)
  if (option === undefined)
    refuse('unknown-target', 'designOptions', `There is no Design Option ${optionId} to hold this edit.`)
  return option
}

const optionOf = (project: Project, optionId: EntityId): DesignOption | undefined =>
  designOptionsOf(project).find((entry) => entry.id === optionId)

/** An Option is edited on its Floor; the Locator follows the subject when one can be found. */
const locatorOn = (floorId: EntityId | null): Locator => ({
  floorId,
  viewId: null,
  view: 'plan',
  itemDesignIds: [],
  placedItemIds: [],
})

/** `W-3`, `Door 1`, `Kitchen` — what a message names a thing by, falling back to its ID. */
function nameOf(project: Project, option: DesignOption, id: EntityId): string {
  const model = project.existingModel
  const proposed = option.proposed
  const wall = [...model.walls, ...proposed.walls].find((entry) => entry.id === id)
  if (wall !== undefined) return wall.ref
  const opening = [...model.openings, ...proposed.openings].find((entry) => entry.id === id)
  if (opening !== undefined) return opening.label
  const room = [...model.rooms, ...proposed.rooms].find((entry) => entry.id === id)
  if (room !== undefined) return room.name
  const placed = [...model.placedItems, ...proposed.placedItems].find((entry) => entry.id === id)
  if (placed !== undefined)
    return project.itemDesigns.find((design) => design.id === placed.itemDesignId)?.name ?? placed.id
  return id
}

/** Which container a subject stands in, and on which Floor. `null` when nothing answers to it. */
function locateSubject(
  project: Project,
  option: DesignOption,
  id: EntityId,
): { floorId: EntityId; proposed: boolean } | null {
  const mine = [...option.proposed.walls, ...option.proposed.openings, ...option.proposed.rooms, ...option.proposed.placedItems].find(
    (entry) => entry.id === id,
  )
  if (mine !== undefined) return { floorId: mine.floorId, proposed: true }
  const model = project.existingModel
  const existing = [...model.walls, ...model.wallJunctions, ...model.openings, ...model.rooms, ...model.placedItems].find(
    (entry) => entry.id === id,
  )
  return existing === undefined ? null : { floorId: existing.floorId, proposed: false }
}

const isWallId = (project: Project, option: DesignOption, id: EntityId): boolean =>
  project.existingModel.walls.some((wall) => wall.id === id) || option.proposed.walls.some((wall) => wall.id === id)

/** What the two cut Intents differ in: a door carries what the user typed, a knock-through its Wall. */
interface CutShape {
  readonly kind: OpeningKind
  readonly label: string
  readonly start: number
  readonly width: number
  readonly sill: number
  readonly head: number
  readonly swing?: Opening['swing']
  readonly hingeSide?: Opening['hingeSide']
}

/** The part of the context both cut Intents answer with. */
interface CutContext {
  readonly project: Project
  readonly draft: Project
  readonly intent: { readonly type: string; readonly ids: readonly string[]; readonly payload: { readonly floorId: EntityId; readonly hostWallId: EntityId; readonly target: { readonly designOptionId: EntityId; readonly viewId?: EntityId | null } } }
}

/** A proposed Opening cut into a Wall that stands in this Option (#69 §7 rows 1–2). */
function placeProposedOpening(ctx: CutContext, shape: CutShape): void {
  const { floorId, hostWallId, target } = ctx.intent.payload
  const option = requireOption(ctx.draft, target.designOptionId)
  const view = effectiveView(ctx.project, floorId, option.id)
  const host = view.existingModel.walls.find((wall) => wall.id === hostWallId)
  if (host === undefined)
    refuse('unknown-target', `existingModel.walls[${hostWallId}]`, `No wall answers to ${hostWallId}.`)
  if (host.floorId !== floorId)
    refuse('unknown-target', `existingModel.walls[${hostWallId}]`, 'That wall is on another floor, so nothing can be cut into it from here.')
  const [openingId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  if (!(shape.width > 0)) refuse('invalid-opening', `openings[${openingId}].width`, 'An opening has to be more than 0 mm wide.')
  if (!(shape.head > shape.sill))
    refuse('invalid-opening', `openings[${openingId}].head`, 'The top of an opening has to be above its bottom.')
  requireDoorFields(openingId, shape.kind, shape.swing, shape.hingeSide)
  // Measured against what stands in this Option: the gaps the Option has already cut count, and a
  // Wall the Option demolished is no host at all.
  requireFit(view, host, { id: openingId, label: shape.label, kind: shape.kind, width: shape.width }, shape.start, shape.width)
  option.proposed.openings.push({
    id: openingId,
    floorId,
    hostWallId,
    kind: shape.kind,
    label: shape.label,
    start: shape.start,
    width: shape.width,
    sill: shape.sill,
    head: shape.head,
    ...(shape.swing === undefined ? {} : { swing: shape.swing }),
    ...(shape.hingeSide === undefined ? {} : { hingeSide: shape.hingeSide }),
    // A proposed Opening is built fabric like the Wall it is cut into, so it follows the same
    // creation rule as `opening.create` — and a read-only layer refuses the cut (#71 §2).
    ...creationLayerField(ctx.project, target.viewId, 'fabric'),
    // Brand-new proposed work came out of nothing, which is an empty provenance and not a missing
    // one (#69 §3).
    predecessorIds: [],
  })
}

const placeOpening: Handler<'renovation.placeOpening'> = (ctx) => {
  const { kind, label, start, width, sill, head, swing, hingeSide } = ctx.intent.payload
  placeProposedOpening(ctx, {
    kind,
    label,
    start,
    width,
    sill,
    head,
    ...(swing === undefined ? {} : { swing }),
    ...(hingeSide === undefined ? {} : { hingeSide }),
  })
}

const knockThrough: Handler<'renovation.knockThrough'> = (ctx) => {
  const { floorId, hostWallId, label, start, width, target } = ctx.intent.payload
  const option = optionOf(ctx.project, target.designOptionId)
  const host =
    option === undefined
      ? undefined
      : effectiveView(ctx.project, floorId, option.id).existingModel.walls.find((wall) => wall.id === hostWallId)
  // The head comes from the Wall, which is the whole of what a knock-through is: the gap is as
  // tall as the Wall it goes through (#69 §7 row 2). A host that is not there fails the cut below.
  placeProposedOpening(ctx, { kind: 'removed_section', label, start, width, sill: 0, head: host?.height ?? 0 })
}

/** The Openings a Wall demolition takes with it: Existing, still standing, hosted on it. */
function dependantsOf(project: Project, option: DesignOption, wallId: EntityId): Opening[] {
  const demolished = new Set<EntityId>(option.demolishedIds)
  return project.existingModel.openings.filter(
    (opening) => opening.hostWallId === wallId && !demolished.has(opening.id) && !demolished.has(opening.hostWallId),
  )
}

/** The Junctions of this Option that lean a proposed Wall on `wallId`. */
function joinsOf(option: DesignOption, wallId: EntityId): EntityId[] {
  const proposedWalls = new Set<EntityId>(option.proposed.walls.map((wall) => wall.id))
  const others: EntityId[] = []
  for (const junction of option.proposed.wallJunctions) {
    const attached = junction.ends.some((end) => end.wallId === wallId) || junction.host?.wallId === wallId
    if (!attached) continue
    for (const id of junction.ends.map((end) => end.wallId).concat(junction.host === undefined ? [] : [junction.host.wallId]))
      if (id !== wallId && proposedWalls.has(id)) others.push(id)
  }
  return others
}

/** Rooms effective in this Option that refer to `wallId`'s faces, with the edge that does. */
function referencingRooms(project: Project, option: DesignOption, floorId: EntityId, wallId: EntityId) {
  const found: { name: string; edge: number }[] = []
  for (const { entity: room, renovationState } of effectiveModel(project, floorId, option.id).rooms) {
    if (renovationState === 'demolition') continue
    for (const ref of room.wallFaceRefs) {
      if (ref.wallId !== wallId) continue
      found.push({ name: room.name, edge: roomSegments(room.outline).find((segment) => segment.id === ref.segmentId)?.index ?? 0 })
    }
  }
  return found
}

/**
 * The Rooms standing in this Option with an Edge referenced to `wallId`. A demolition of the Wall
 * stops at them; a replace carries them onto the successor (#69 §7).
 */
function followingRooms(project: Project, option: DesignOption, floorId: EntityId, wallId: EntityId): Room[] {
  return effectiveModel(project, floorId, option.id)
    .rooms.filter(
      ({ entity: room, renovationState }) =>
        renovationState !== 'demolition' && room.wallFaceRefs.some((ref) => ref.wallId === wallId),
    )
    .map(({ entity: room }) => room)
}

/**
 * Why a Room that followed a Wall's successor may not stand where it landed. The edge that dragged
 * is named, because the homeowner was moving a Wall and not drawing a Room (#67 §12, #69 §7).
 */
function checkRoomsFit(project: Project, wallId: EntityId, followers: { room: Room; outline: RoomOutline }[]): void {
  for (const entry of followers) {
    const ref = entry.room.wallFaceRefs.find((candidate) => candidate.wallId === wallId)
    checkRoomProposal(
      project,
      { ...entry.room, outline: entry.outline },
      ref === undefined ? null : edgeName(entry.room, ref.segmentId),
    )
  }
}

/**
 * `Demolish W-3?` (#69 §8): what comes down with the Wall, and what is standing in the way. The
 * one function answers `previewIntent` and re-checks the answer when the Intent comes back, so a
 * review read against an old Project is refused rather than trusted.
 */
function reviewDemolition(project: Project, option: DesignOption, entityId: EntityId): DemolitionReview | null {
  const subject = locateSubject(project, option, entityId)
  if (subject === null) return null
  const entityRef = nameOf(project, option, entityId)
  // Deleting the Option's own work is an edit to `proposed`, and its Openings, Junctions and joins
  // go with it in the same transaction — nothing to confirm, and nothing to block it.
  const blockers: string[] = []
  const willDemolish: Opening[] = []
  if (!subject.proposed && isWallId(project, option, entityId)) {
    willDemolish.push(...dependantsOf(project, option, entityId))
    // Proposed Openings the Option itself cut into this Wall: it has to let go of its own work
    // before the Wall they were cut into can come down.
    for (const opening of option.proposed.openings.filter((entry) => entry.hostWallId === entityId))
      blockers.push(`Remove ${opening.label} from this option first.`)
    for (const other of joinsOf(option, entityId))
      blockers.push(
        `${nameOf(project, option, other)} is joined to ${entityRef}, which this option demolishes. Detach or re-host ${nameOf(project, option, other)} first.`,
      )
    for (const room of referencingRooms(project, option, subject.floorId, entityId))
      blockers.push(`${room.name} edge ${room.edge} refers to ${entityRef}. Detach, reattach, or remove the Room delta first.`)
  }
  return {
    kind: 'demolish',
    entityId,
    entityRef,
    willDemolish: willDemolish.map((opening) => ({ id: opening.id, label: opening.label })),
    blockers,
    message: `Demolish ${entityRef}?`,
  }
}

/** Add demolition records, kept sorted the way the model stores them (#69 §3). */
function demolishRecords(option: DesignOption, ids: readonly EntityId[]): void {
  const next = new Set<EntityId>(option.demolishedIds)
  ids.forEach((id) => next.add(id))
  option.demolishedIds = [...next].sort(compareCodePoints)
}

/** Delete the Option's own proposed record, and the Openings and Junctions that hung off it. */
function deleteProposed(option: DesignOption, id: EntityId): void {
  const proposed = option.proposed
  const gone = new Set<EntityId>([
    id,
    ...proposed.openings.filter((opening) => opening.hostWallId === id).map((opening) => opening.id),
  ])
  const drop = <T extends { id: EntityId }>(list: T[]): T[] => list.filter((entry) => !gone.has(entry.id))
  proposed.walls = drop(proposed.walls)
  proposed.openings = drop(proposed.openings)
  proposed.rooms = drop(proposed.rooms)
  proposed.placedItems = drop(proposed.placedItems)
  proposed.wallJunctions = proposed.wallJunctions.filter(
    (junction) =>
      !gone.has(junction.id) &&
      !junction.ends.some((end) => gone.has(end.wallId)) &&
      !(junction.host !== undefined && gone.has(junction.host.wallId)),
  )
}

const demolish: Handler<'renovation.demolish'> = (ctx) => {
  const { entityId, dependants, target } = ctx.intent.payload
  const option = requireOption(ctx.draft, target.designOptionId)
  const subject = locateSubject(ctx.project, option, entityId)
  if (subject === null) refuse('unknown-target', 'designOptions', `Nothing in this Project answers to ${entityId}.`)
  const review = reviewDemolition(ctx.project, option, entityId)
  if (review !== null && review.blockers.length > 0)
    refuse('has-dependants', 'designOptions', review.blockers.join(' '))
  const listed = dependants ?? []
  const expected = review?.willDemolish.map((entry) => entry.id) ?? []
  // The answer has to be the question that was asked: a Wall whose Openings have moved since the
  // review was shown is refused rather than demolished on an old picture (#69 §8).
  if (listed.length !== expected.length || listed.some((id, at) => id !== expected[at]))
    refuse(
      'dependency-changed',
      'designOptions',
      'The wall to demolish has changed since this review was shown. Look at it again.',
    )
  // An Option's own work is deleted, never demolished: a demolition record can only name Existing
  // work, which is the state #69 §4 refuses outright.
  if (subject.proposed) deleteProposed(option, entityId)
  else demolishRecords(option, [entityId, ...listed])
}

// --- Replace -----------------------------------------------------------------

/** Two points this close are one place: a join is carried where the new geometry still makes it. */
const TOLERANCE_MM = 0.01

type WallLine = Wall['line']
type JunctionHost = WallJunction['host']
type JunctionEnd = WallJunction['ends'][number]

const endPoint = (line: WallLine, end: JunctionEnd['end']): { x: number; y: number } =>
  end === 'start' ? line.start : line.end

const coincides = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) <= TOLERANCE_MM

/** A successor is named after what it replaced, with a prime on the end (#69 §3). */
const primed = (name: string): string => `${name}′`

/**
 * The Junction a replaced Wall took part in, re-anchored on the successor — or `null` when the new
 * geometry no longer makes that join. A join that has moved is left behind rather than stretched:
 * the gap that opens is what lengthens the neighbour's usable interval, and inventing a join the
 * drawing does not show is the one thing a carry may not do (#69 §4).
 */
function carriedJunction(
  junction: WallJunction,
  predecessorId: EntityId,
  successorId: EntityId,
  successorLine: WallLine,
  wallOf: (id: EntityId) => Wall | undefined,
): { ends: JunctionEnd[]; host?: JunctionHost } | null {
  const mine = junction.ends.find((entry) => entry.wallId === predecessorId)
  const ends = junction.ends.map((entry) =>
    entry.wallId === predecessorId ? { wallId: successorId, end: entry.end } : { ...entry },
  )
  if (junction.host !== undefined && junction.host.wallId === predecessorId) {
    // The predecessor carried another Wall's end along its middle; the successor has to still be
    // there, and the member is stored at the point on the successor's line it comes to. The
    // predecessor names itself nowhere in `ends`: it is the host.
    const member = junction.ends.find((entry) => entry.wallId !== predecessorId)
    if (member === undefined) return null
    const memberWall = wallOf(member.wallId)
    if (memberWall === undefined) return null
    const memberPoint = endPoint(memberWall.line, member.end)
    const param = refParamAt(successorLine, memberPoint)
    if (param <= 0 || param >= refLength(successorLine)) return null
    return coincides(refPointAt(successorLine, param), memberPoint)
      ? { ends, host: { wallId: successorId, at: param } }
      : null
  }
  if (mine === undefined) return null
  const at = endPoint(successorLine, mine.end)
  if (junction.host === undefined) {
    for (const other of junction.ends) {
      if (other.wallId === predecessorId) continue
      const wall = wallOf(other.wallId)
      if (wall === undefined || !coincides(at, endPoint(wall.line, other.end))) return null
    }
    return { ends }
  }
  // The predecessor's end rode another Wall's middle.
  const host = wallOf(junction.host.wallId)
  if (host === undefined) return null
  return coincides(at, refPointAt(host.line, junction.host.at)) ? { ends, host: { ...junction.host } } : null
}

/**
 * Replace (dimensions) and Replace (identity) (#69 §7): what stands here comes down, and a successor
 * takes its place carrying the edit. The Openings cut into a replaced Wall come along — Existing ones
 * are cut again in the successor carrying the same place and size, the Option's own simply follow the
 * Wall they were cut into — and so do the joins that still land. One transaction, one undo.
 *
 * A Room whose edge refers to the Wall's faces blocks the replace exactly as it blocks a demolition:
 * the Room delta that follows a moved Wall is #69 §9's work. An edit naming a field the subject does
 * not have is left to the strict validator, which says which field on which entity it objected to.
 */
const replace: Handler<'renovation.replace'> = (ctx) => {
  const { entityId, edit, target } = ctx.intent.payload
  const option = requireOption(ctx.draft, target.designOptionId)
  const base = optionOf(ctx.project, target.designOptionId)
  if (base === undefined)
    refuse('unknown-target', 'designOptions', `There is no Design Option ${target.designOptionId} to replace work in.`)
  const subject = locateSubject(ctx.project, base, entityId)
  if (subject === null) refuse('unknown-target', 'designOptions', `Nothing in this Project answers to ${entityId}.`)
  const view = effectiveView(ctx.project, subject.floorId, target.designOptionId)
  const model = view.existingModel
  const wallOf = (id: EntityId): Wall | undefined => model.walls.find((found) => found.id === id)
  const wall = wallOf(entityId)
  const opening = wall === undefined ? model.openings.find((found) => found.id === entityId) : undefined
  const room =
    wall === undefined && opening === undefined ? model.rooms.find((found) => found.id === entityId) : undefined
  const placed =
    wall === undefined && opening === undefined && room === undefined
      ? model.placedItems.find((found) => found.id === entityId)
      : undefined
  if (wall === undefined && opening === undefined && room === undefined && placed === undefined)
    refuse('unknown-target', 'designOptions', `Nothing in this Project answers to ${entityId}.`)
  // Only Existing work is replaced. The Option's own work is edited where it stands — which is what
  // the S7 Intents do with a `target` — and a successor of a successor is provenance the model
  // refuses to record (#69 §3).
  if (subject.proposed)
    refuse(
      'unknown-target',
      'designOptions',
      `${nameOf(ctx.project, base, entityId)} is this option's own work: change it instead of replacing it.`,
    )
  const wallEdit = edit as Partial<Omit<Wall, 'id' | 'floorId'>>
  const line: WallLine = wall === undefined ? ({} as WallLine) : wallEdit.line ?? wall.line
  // What the successor takes over. Whether a join survives is decided by the successor's geometry,
  // so the survivors are worked out before the IDs are spent and rebuilt once with the successor's
  // own ID in them.
  const hosted = wall === undefined ? [] : model.openings.filter((found) => found.hostWallId === entityId)
  const copies = hosted.filter((found) => found.predecessorIds === undefined)
  // A Room standing on the Wall's faces follows the successor under the #67 compatible-edit rules:
  // the Edge slides onto the face it is referenced to and the outline follows. A Room that cannot
  // follow — a face that turned, an outline that would stop being a shape, a neighbour it would
  // land on — refuses the whole replace, naming the Room and the edge (#69 §7).
  const followers =
    wall === undefined
      ? []
      : followingRooms(ctx.project, base, subject.floorId, entityId).map((follower) => {
          const now: Wall = { ...wall, ...wallEdit, id: entityId, floorId: wall.floorId }
          let outline = follower.outline
          for (const ref of follower.wallFaceRefs) {
            if (ref.wallId !== entityId) continue
            if (!faceCanCarry(wall, now))
              refuse(
                'room-blocked',
                'designOptions',
                `${wall.ref} is referenced by ${edgeName(follower, ref.segmentId)}.`,
              )
            outline = slideOntoFace(follower, outline, ref, now)
          }
          return { room: follower, outline }
        })
  const survivors =
    wall === undefined
      ? []
      : model.wallJunctions
          .filter(
            (junction) =>
              junction.ends.some((end) => end.wallId === entityId) || junction.host?.wallId === entityId,
          )
          .flatMap((junction) => {
            const carry = carriedJunction(junction, entityId, '', line, wallOf)
            return carry === null ? [] : [{ junction, carry }]
          })
  const spent = spendIds(
    ctx.intent.ids,
    1 + copies.length + survivors.length + followers.length,
    'renovation.replace',
  )
  const container = option.proposed
  // What was there comes down: one demolition record for the Wall, for every Existing Opening cut
  // into it that the successor takes over, and for every Room whose edge follows the face (#69 §4).
  demolishRecords(option, [entityId, ...copies.map((found) => found.id), ...followers.map((entry) => entry.room.id)])
  if (wall !== undefined) {
    const successor: Wall = {
      ...wall,
      ...wallEdit,
      id: spent[0] as string,
      ref: primed(wall.ref),
      floorId: wall.floorId,
      predecessorIds: [entityId],
    }
    container.walls.push(successor)
    // Every Room that followed has to be a shape and stand clear of its neighbours in this option,
    // checked against the model the replace leaves behind: this successor standing, the Rooms that
    // followed it already slid onto it (#69 §7).
    const leaving = effectiveView(ctx.project, subject.floorId, target.designOptionId)
    checkRoomsFit(
      {
        ...leaving,
        existingModel: {
          ...leaving.existingModel,
          walls: [...leaving.existingModel.walls.filter((entry) => entry.id !== entityId), successor],
          rooms: leaving.existingModel.rooms.map((entry) => {
            const slid = followers.find((candidate) => candidate.room.id === entry.id)
            return slid === undefined ? entry : { ...entry, outline: slid.outline }
          }),
        },
      },
      entityId,
      followers,
    )
    copies.forEach((found, at) => {
      container.openings.push({
        ...found,
        id: spent[1 + at] as string,
        label: primed(found.label),
        hostWallId: successor.id,
        predecessorIds: [found.id],
      })
    })
    for (const found of hosted) {
      // The Option's own Opening follows the Wall it was cut into: the same record, a new host.
      if (found.predecessorIds === undefined) continue
      const live = container.openings.find((candidate) => candidate.id === found.id)
      if (live !== undefined) live.hostWallId = successor.id
    }
    // The joins this Wall made belong to the Option from now on: its own Junctions that leaned on
    // the Wall are dropped, and every join the successor still makes is written down afresh (#69 §4).
    container.wallJunctions = container.wallJunctions.filter(
      (junction) =>
        !junction.ends.some((end) => end.wallId === entityId) &&
        !(junction.host !== undefined && junction.host.wallId === entityId),
    )
    survivors.forEach((survivor, at) => {
      const rebuilt = carriedJunction(survivor.junction, entityId, successor.id, line, wallOf)
      if (rebuilt === null) return
      container.wallJunctions.push({
        id: spent[1 + copies.length + at] as string,
        floorId: subject.floorId,
        ends: rebuilt.ends,
        ...(rebuilt.host === undefined ? {} : { host: rebuilt.host }),
        // The join is this Option's now: it holds the successor in place, and the Existing Junction
        // it came from stands in no Option a successor may point back to.
        predecessorIds: [],
      })
    })
    // The Rooms that followed are this Option's work from here: successors of the Rooms that stood
    // here, named after them, their edges now referenced to the Wall that replaced the one they
    // were drawn against (#69 §7).
    followers.forEach((entry, at) => {
      container.rooms.push({
        ...entry.room,
        id: spent[1 + copies.length + survivors.length + at] as string,
        name: primed(entry.room.name),
        outline: entry.outline,
        wallFaceRefs: entry.room.wallFaceRefs.map((ref) =>
          ref.wallId === entityId ? { ...ref, wallId: successor.id } : ref,
        ),
        predecessorIds: [entry.room.id],
      })
    })
  } else if (room !== undefined) {
    // A Room is altered by replacing it: the outline, the name and the edges it is referenced by
    // are the Room's own, so the edit is the Room's fields and the successor carries them (#69 §7).
    const changed = { ...room, ...(edit as Partial<Omit<Room, 'id' | 'floorId'>>) }
    const successor: Room = {
      ...changed,
      id: spent[0] as string,
      name: primed(changed.name),
      predecessorIds: [entityId],
    }
    // The successor is checked where it will stand: this option's model, with the Room it replaces
    // gone and everything else as it is.
    const view = effectiveView(ctx.project, subject.floorId, target.designOptionId)
    checkRoomProposal(
      {
        ...view,
        existingModel: {
          ...view.existingModel,
          rooms: view.existingModel.rooms.map((entry) =>
            entry.id === entityId ? { ...successor, id: entityId } : entry,
          ),
        },
      },
      { ...successor, id: entityId },
      null,
    )
    container.rooms.push(successor)
  } else if (opening !== undefined) {
    container.openings.push({
      ...opening,
      ...(edit as Partial<Omit<Opening, 'id' | 'floorId' | 'hostWallId'>>),
      id: spent[0] as string,
      label: primed(opening.label),
      hostWallId: opening.hostWallId,
      predecessorIds: [entityId],
    })
  } else if (placed !== undefined) {
    container.placedItems.push({
      ...placed,
      ...(edit as Partial<Omit<PlacedItem, 'id' | 'floorId'>>),
      id: spent[0] as string,
      floorId: placed.floorId,
      predecessorIds: [entityId],
    })
  }
  // A thicker Wall leaves less room along it, so the openings that survived are measured again
  // against what now stands in this Option (#65 §3).
  requireOpeningsFit(effectiveView(ctx.draft, subject.floorId, target.designOptionId))
}

// --- Restore -----------------------------------------------------------------

/** A proposed record, whichever of the Option's collections it stands in. */
interface ProposedRecord {
  readonly id: EntityId
  readonly predecessorIds?: EntityId[]
}

/**
 * Everything this Option built out of `seed`, in the order the Restore warning lists it (#69 §9):
 * the successors that name it, whatever was carried onto them — the Openings cut into a successor
 * Wall, the Rooms whose edges follow its faces — and whatever was built out of those in turn, which
 * is how a successor of a successor comes down with the entity it all came from.
 */
function successorsOf(option: DesignOption, seed: EntityId): ProposedRecord[] {
  const proposed = option.proposed
  const all: ProposedRecord[] = [
    ...proposed.walls,
    ...proposed.openings,
    ...proposed.rooms,
    ...proposed.placedItems,
  ]
  const doomed = new Set<EntityId>()
  for (;;) {
    const before = doomed.size
    for (const record of all) {
      if (doomed.has(record.id)) continue
      if ((record.predecessorIds ?? []).some((id) => id === seed || doomed.has(id))) doomed.add(record.id)
    }
    for (const opening of proposed.openings)
      if (!doomed.has(opening.id) && doomed.has(opening.hostWallId)) doomed.add(opening.id)
    for (const room of proposed.rooms)
      if (!doomed.has(room.id) && room.wallFaceRefs.some((ref) => doomed.has(ref.wallId))) doomed.add(room.id)
    if (doomed.size === before) return all.filter((record) => doomed.has(record.id))
  }
}

/**
 * What Restore writes (#69 §9): the records it deletes, the demolition records that go with the
 * copies they were made from, and the ones that stay — a merge successor names more than one
 * predecessor, and the entities it was merged *with* are not the one being restored.
 */
function restorePlan(project: Project, option: DesignOption, entityId: EntityId) {
  const deletes: DemolitionDependency[] = []
  const keeps: DemolitionDependency[] = []
  const removes = new Set<EntityId>([entityId])
  for (const record of successorsOf(option, entityId)) {
    deletes.push({ id: record.id, label: nameOf(project, option, record.id) })
    const predecessors = record.predecessorIds ?? []
    for (const other of predecessors) {
      if (other === entityId) continue
      // A copy comes back with the thing it was copied from; a merge leaves the other Walls down,
      // and says so in the warning rather than quietly un-demolishing a Wall nobody restored.
      if (predecessors.length > 1) keeps.push({ id: other, label: nameOf(project, option, other) })
      else removes.add(other)
    }
  }
  return { deletes, keeps, removes }
}

/** `Restore W-3?` (#69 §9): the successors that come down for the entity to stand again. */
function reviewRestore(project: Project, option: DesignOption, entityId: EntityId): RestoreReview | null {
  const subject = locateSubject(project, option, entityId)
  if (subject === null) return null
  const entityRef = nameOf(project, option, entityId)
  const plan = restorePlan(project, option, entityId)
  return { kind: 'restore', entityId, entityRef, deletes: plan.deletes, keeps: plan.keeps, message: `Restore ${entityRef}?` }
}

const restore: Handler<'renovation.restore'> = (ctx) => {
  const { entityId, target } = ctx.intent.payload
  const option = requireOption(ctx.draft, target.designOptionId)
  const base = optionOf(ctx.project, target.designOptionId)
  if (base === undefined)
    refuse('unknown-target', 'designOptions', `There is no Design Option ${target.designOptionId} to restore work in.`)
  const subject = locateSubject(ctx.project, base, entityId)
  if (subject === null) refuse('unknown-target', 'designOptions', `Nothing in this Project answers to ${entityId}.`)
  // Only Existing work is restored: the Option's own record is deleted, which is what a demolition
  // of it already does (#69 §7).
  if (subject.proposed)
    refuse(
      'unknown-target',
      'designOptions',
      `${nameOf(ctx.project, base, entityId)} is this option's own work: delete it instead of restoring it.`,
    )
  const plan = restorePlan(ctx.project, base, entityId)
  if (plan.deletes.length === 0 && !base.demolishedIds.includes(entityId))
    refuse(
      'no-change',
      'designOptions',
      `${nameOf(ctx.project, base, entityId)} stands in this option already: there is nothing to restore.`,
    )
  option.demolishedIds = option.demolishedIds.filter((id) => !plan.removes.has(id))
  // Each record goes the way `renovation.demolish` sends the Option's own work: the Openings cut
  // into it and the Junctions that held it follow it in the same transaction.
  plan.deletes.forEach((entry) => deleteProposed(option, entry.id))
  // What comes back is the survey's own work, but the Option may have cut more into it since.
  requireOpeningsFit(effectiveView(ctx.draft, subject.floorId, target.designOptionId))
}

/** The edit-table half of the renovation catalogue. */
export const RENOVATION_EDIT_HANDLERS: { [T in EditIntentType]: IntentHandler<T> } = {
  'renovation.placeOpening': {
    run: placeOpening,
    locate: (project, intent) =>
      locatorOn(project.existingModel.walls.find((wall) => wall.id === intent.payload.hostWallId)?.floorId ?? null),
  },
  'renovation.knockThrough': {
    run: knockThrough,
    locate: (project, intent) =>
      locatorOn(project.existingModel.walls.find((wall) => wall.id === intent.payload.hostWallId)?.floorId ?? null),
  },
  'renovation.demolish': {
    run: demolish,
    locate: (project, intent) => {
      const option = optionOf(project, intent.payload.target.designOptionId)
      const subject = option === undefined ? null : locateSubject(project, option, intent.payload.entityId)
      return locatorOn(subject?.floorId ?? null)
    },
    review: (project, intent) => {
      const option = optionOf(project, intent.payload.target.designOptionId)
      return option === undefined ? null : reviewDemolition(project, option, intent.payload.entityId)
    },
  },
  'renovation.replace': {
    run: replace,
    locate: (project, intent) => {
      const option = optionOf(project, intent.payload.target.designOptionId)
      const subject = option === undefined ? null : locateSubject(project, option, intent.payload.entityId)
      return locatorOn(subject?.floorId ?? null)
    },
  },
  'renovation.restore': {
    run: restore,
    locate: (project, intent) => {
      const option = optionOf(project, intent.payload.target.designOptionId)
      const subject = option === undefined ? null : locateSubject(project, option, intent.payload.entityId)
      return locatorOn(subject?.floorId ?? null)
    },
    review: (project, intent) => {
      const option = optionOf(project, intent.payload.target.designOptionId)
      return option === undefined ? null : reviewRestore(project, option, intent.payload.entityId)
    },
  },
}

/** The IDs the edit table spends: one proposed Opening per cut; a demolition spends none. */
export const RENOVATION_EDIT_INTENT_ID_ORDER: { [T in EditIntentType]: readonly string[] } = {
  'renovation.placeOpening': ['openingId'],
  'renovation.knockThrough': ['openingId'],
  'renovation.demolish': [],
  'renovation.replace': ['successorId', 'carryId…'],
  'renovation.restore': [],
}

/** The default label per edit-table Intent, dark with everything else here. */
export const RENOVATION_EDIT_INTENT_LABELS: { [T in EditIntentType]: string } = {
  'renovation.placeOpening': 'Add opening',
  'renovation.knockThrough': 'Knock through',
  'renovation.demolish': 'Mark demolition',
  'renovation.replace': 'Replace',
  'renovation.restore': 'Restore',
}
