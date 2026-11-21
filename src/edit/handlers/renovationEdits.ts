/**
 * The base-plan renovation-edit table (#69 §7–§8) — dark until `VITE_FF_RENOVATION` is on, and
 * reachable only through the flag-gated spread in `../registry` (see `./renovationHandlers` for
 * why that matters).
 *
 * Three Intents, each one Edit Transaction with one undo:
 *
 * - `renovation.placeOpening` and `renovation.knockThrough` cut a proposed Opening into a Wall
 *   that stands in the Option, leaving that Wall retained — no demolition, no successor. They
 *   reuse the S7 Opening checks wholesale (`requireDoorFields`, `requireFit`) against the
 *   **effective** model of the Option, which is why a proposed Opening is measured against the
 *   gaps the Option has already made rather than the survey's.
 * - `renovation.demolish` records that Existing work comes down, or deletes the Option's own
 *   proposed record. A Wall is never demolished quietly: its Openings go with it in the same
 *   transaction, and the review that listed them has to be the answer that comes back.
 *
 * Nothing here forks a Wall, Opening, Room or Placed Item handler: editing proposed work is
 * `wall.setThickness` with a `target`, and #69 §7 says so. What is new is only which container a
 * record lands in, and the two questions the model cannot answer for itself — what comes down with
 * a Wall, and what is standing in the way.
 */
import { effectiveModel } from '../../derive'
import { designOptionsOf, roomSegments } from '../../domain'
import type { DesignOption, EntityId, Opening, OpeningKind, Project } from '../../domain'
import { compareCodePoints } from '../../lib'
import type { DemolitionReview, Locator, RenovationIntentType } from '../intents'
import type { Handler, IntentHandler } from './context'
import { requireDoorFields, requireFit } from './openingSupport'
import { refuse, spendIds } from './support'

/** The edit-table Intent types, written once. */
type EditIntentType = Extract<RenovationIntentType, `renovation.${string}`>

/**
 * The Project as one Option sees it: its effective collections standing in for the Existing
 * Model's, so every existing check — usable intervals, fit, joins — reads what the user is looking
 * at. Built for one Floor, and only ever for a renovation Intent.
 */
function effectiveView(project: Project, floorId: EntityId, optionId: EntityId): Project {
  const model = effectiveModel(project, floorId, optionId)
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      walls: [...model.standingWalls],
      wallJunctions: [...model.standingWallJunctions],
      openings: [...model.standingOpenings],
      rooms: [...model.standingRooms],
      placedItems: [...model.standingPlacedItems],
    },
  }
}

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
  readonly intent: { readonly type: string; readonly ids: readonly string[]; readonly payload: { readonly floorId: EntityId; readonly hostWallId: EntityId; readonly target: { readonly designOptionId: EntityId } } }
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
}

/** The IDs the edit table spends: one proposed Opening per cut; a demolition spends none. */
export const RENOVATION_EDIT_INTENT_ID_ORDER: { [T in EditIntentType]: readonly string[] } = {
  'renovation.placeOpening': ['openingId'],
  'renovation.knockThrough': ['openingId'],
  'renovation.demolish': [],
}

/** The default label per edit-table Intent, dark with everything else here. */
export const RENOVATION_EDIT_INTENT_LABELS: { [T in EditIntentType]: string } = {
  'renovation.placeOpening': 'Add opening',
  'renovation.knockThrough': 'Knock through',
  'renovation.demolish': 'Mark demolition',
}
