/**
 * The cross-Project paste (#72) — dark until `VITE_FF_RENOVATION` is on.
 *
 * Reachable from exactly one place: the flag-gated spread in `../registry`. With the flag off that
 * spread folds to nothing, the import goes unused, and this module is gone from the bundle whole —
 * the same mechanism `./renovationHandlers` documents.
 *
 * One Intent, and the only one in the catalogue whose subject is another Project: the payload is the
 * by-value snapshot `Copy` took over there, so nothing here reads the source Project or needs it to
 * still exist. Three things decide what lands, and all three were said out loud by `../pasteReview`
 * before this ran — where the active view says new work belongs, which Layer the mapping answered
 * for each record, and which records cannot be cut loose from what they stand on.
 *
 * What it never does is invent identity twice. Every record of the copy takes one fresh ID from the
 * pre-allocated list and keeps it everywhere it is named, through the same walk `remapIds` pays for
 * a whole Project with (#72 §4), and an ID the copy names that it did not bring is a refusal rather
 * than a dangling reference.
 */
import { drawingLayerById, remapEntities } from '../../domain'
import type { EntityId, Project, ProposedModel } from '../../domain'
import type { IdReplacement } from '../../domain'
import type {
  Intent,
  Locator,
  PasteLayerResolution,
  PasteResolutions,
  PasteReview,
  RenovationIntentType,
} from '../intents'
import { pasteReviewOf } from '../pasteReview'
import type { Handler, IntentHandler } from './context'
import { checkRoomProposal } from './roomSupport'
import { containerOf, effectiveView, isInOption, nextWallRef, proposedProvenance, refuse } from './support'

/** The paste half of the renovation set. */
export type PasteIntentType = Extract<RenovationIntentType, 'renovation.pasteFromProject'>

/**
 * The IDs a paste spends, in the order it takes them: one per copied record in the copy set's own
 * order — Walls, Junctions, Openings, Rooms, Placed Items — then one per Item Design it brings, then
 * one per source Layer. `intentIdCount` states the count from the payload alone, which is why the
 * slots exist for records that turn out not to come: a Layer sent onto one this Project already has,
 * and an Opening dropped for want of its Wall, leave their slots unspent rather than shifting the
 * ones after them (#72 §4).
 */
export const PASTE_INTENT_ID_ORDER: { [T in PasteIntentType]: readonly string[] } = {
  'renovation.pasteFromProject': ['…'],
}

/**
 * The base of the transaction label. The row that sends the paste appends the count and the source
 * Project's name — `Paste 4 entities from “Unit 4 Fitout”` — because both are data, and a released
 * bundle holds neither the words of a flagged command nor the name of a Project it has never seen.
 */
export const PASTE_INTENT_LABELS: { [T in PasteIntentType]: string } = {
  'renovation.pasteFromProject': 'Paste from other Project',
}

/**
 * The mapping the dialog answered with, keyed by the Layer it was asked about (#72 §5).
 *
 * Every Layer the pasted records ride has to be answered for — an unanswered one is the paste
 * guessing at where the user's work goes — and an answer that sends work onto a Layer this Project
 * does not have is the same kind of mistake as no answer. A Layer the copy no longer brings an
 * entity for is not a mistake: its answer is simply about something that is not coming.
 */
function readMapping(
  resolutions: unknown,
  review: PasteReview,
  project: Project,
): Map<EntityId, PasteLayerResolution> {
  const layers = (resolutions as PasteResolutions | undefined)?.layers
  if (!Array.isArray(layers))
    refuse('unknown-target', 'resolutions.layers', 'A paste carries an answer for every layer the copy brings.')
  const answers = new Map<EntityId, PasteLayerResolution>()
  for (const answer of layers) {
    if (answer.target.kind === 'existing' && drawingLayerById(project, answer.target.layerId) === null) {
      refuse('layer-blocked', 'resolutions.layers', `There is no layer ${answer.target.layerId} in this Project.`)
    }
    answers.set(answer.sourceLayerId, answer)
  }
  for (const row of review.rows) {
    if (!answers.has(row.sourceLayerId))
      refuse(
        'layer-blocked',
        'resolutions.layers',
        `Every layer the copy brings needs an answer before it can be pasted — "${row.sourceLayerName.trim()}" has none.`,
      )
  }
  return answers
}

const pasteFromOtherProject: Handler<'renovation.pasteFromProject'> = (ctx) => {
  const { floorId, viewId, copySet } = ctx.intent.payload
  const view = ctx.project.views.find((candidate) => candidate.id === viewId)
  if (view === undefined) refuse('unknown-target', `views[${viewId}]`, `There is no saved view ${viewId} to paste into.`)
  const review = pasteReviewOf(ctx.project, view, copySet)
  // The same answer the dialog was built from, re-read against the Project this is committing
  // against: a display switched under the dialog refuses the paste instead of writing into it.
  if (review.destination.kind === 'blocked') refuse('option-blocked', `views[${viewId}]`, review.destination.reason)
  const designOptionId = review.destination.kind === 'option' ? review.destination.designOptionId : null
  const answers = readMapping(ctx.intent.resolutions, review, ctx.project)

  const slots = ctx.intent.ids
  let taken = 0
  const nextId = (): EntityId => {
    const id = slots[taken]
    taken += 1
    if (id === undefined)
      refuse(
        'missing-ids',
        'ids',
        `${ctx.intent.type} spends one pre-allocated ID per copied record, Item Design and layer; this Intent carried ${slots.length}.`,
      )
    return id
  }

  const { walls, wallJunctions, openings, rooms, placedItems } = copySet.entities
  const carried = [...walls, ...wallJunctions, ...openings, ...rooms, ...placedItems]
  // The identity map: one fresh ID per record, and the Floor the copy stands on, which is this
  // Project's whichever Floor it was copied from.
  const map = new Map<EntityId, EntityId>()
  for (const record of carried) map.set(record.floorId, floorId)
  const claim = (records: readonly { id: EntityId }[]): void => {
    for (const record of records) map.set(record.id, nextId())
  }
  claim(walls)
  claim(wallJunctions)
  claim(openings)
  claim(rooms)
  claim(placedItems)
  // One fresh identity per Item Design, and nothing else about it changes: a cabinet's construction
  // — its spaces, boards and hardware, node IDs included — is not the copy's to renumber (#72 §4).
  const designIds: EntityId[] = []
  for (const design of copySet.itemDesigns) {
    const id = nextId()
    map.set(design.id, id)
    designIds.push(id)
  }
  // One slot per source Layer, spent only by the rows the mapping sends to a Layer made here.
  const layerSlot = new Map<EntityId, EntityId>()
  for (const row of review.rows) layerSlot.set(row.sourceLayerId, nextId())

  const replace: IdReplacement = (id) => {
    const mapped = map.get(id)
    if (mapped === undefined)
      refuse('unknown-target', 'payload.copySet', `The copy names ${id}, which is not one of the records it brought.`)
    return mapped
  }

  // An Opening whose Wall stayed behind has nothing to be cut into, and a Room edge whose Wall stayed
  // behind stops following a face that is not here (#72 §5). The review listed both before the user
  // agreed to the paste; this is where the promise is kept, and the reason `replace` may refuse an
  // ID it was not given — anything still standing has to have come across.
  const copied = new Set(walls.map((wall) => wall.id))
  const crossing: ProposedModel = {
    walls,
    wallJunctions,
    openings: openings.filter((opening) => copied.has(opening.hostWallId)),
    rooms: rooms.map((room) => {
      const faces = room.wallFaceRefs.filter((face) => copied.has(face.wallId))
      return faces.length === room.wallFaceRefs.length ? room : { ...room, wallFaceRefs: faces }
    }),
    placedItems,
  }
  const remapped = remapEntities(crossing, replace)

  // A Layer the mapping answered `Create “Services” here` is made exactly the way `layer.add` makes
  // one: at the end of the Project's list, which is the front of the drawing, and at the front of
  // every view that keeps an order of its own (#71 §1, §2). A duplicate name is no obstacle here
  // either — the validator allows two layers of one name, and the dialog has just shown the colour
  // and the count that tell them apart.
  const created = new Map<EntityId, EntityId>()
  for (const row of review.rows) {
    if (answers.get(row.sourceLayerId)?.target.kind !== 'new') continue
    const layerId = layerSlot.get(row.sourceLayerId) ?? refuse('missing-ids', 'ids', `${ctx.intent.type} ran out of pre-allocated IDs.`)
    if (ctx.draft.drawingLayers === undefined) ctx.draft.drawingLayers = []
    ctx.draft.drawingLayers.push({ id: layerId, name: row.sourceLayerName, color: row.sourceLayerColor })
    for (const target of ctx.draft.views) if (target.layerOrder !== undefined && target.layerOrder !== null) target.layerOrder.push(layerId)
    created.set(row.sourceLayerId, layerId)
  }

  const container = containerOf(ctx.draft, designOptionId)
  const provenance = proposedProvenance(isInOption(container, ctx.draft))

  /** Which Layer one record of the copy rides here, per the mapping (#72 §5). */
  const layerField = (sourceLayerId: EntityId | null | undefined): { drawingLayerId?: EntityId } => {
    // Work that rode no layer there rides none here: Unlayered is a place of its own in both
    // Projects, and the dialog says so rather than quietly filing it somewhere.
    if (sourceLayerId === null || sourceLayerId === undefined) return {}
    const answer = answers.get(sourceLayerId)
    if (answer === undefined)
      refuse('layer-blocked', 'resolutions.layers', `Every layer the copy brings needs an answer — ${sourceLayerId} has none.`)
    if (answer.target.kind === 'unlayered') return {}
    if (answer.target.kind === 'existing') return { drawingLayerId: answer.target.layerId }
    // A row answered `new` always has its Layer made above; landing it on nothing would be the one
    // way this paste could quietly lose where the user said the work goes.
    return { drawingLayerId: created.get(sourceLayerId) ?? refuse('missing-ids', 'ids', `${ctx.intent.type} lost a layer it said it would create.`) }
  }

  /**
   * The record as it arrives here: the provenance it was copied with left behind at the door —
   * `predecessorIds` names records of the Project the work came from, and work invented here has
   * provenance of its own (#72 §5).
   */
  const stripped = <T extends { predecessorIds?: EntityId[] }>(record: T): T => {
    const arrived = { ...record } as Record<string, unknown>
    delete arrived.predecessorIds
    return { ...arrived, ...provenance } as T
  }

  /** …and the Layer the mapping answered with put on, in place of the one it rode there. */
  const filed = <T extends { predecessorIds?: EntityId[]; drawingLayerId?: EntityId | null }>(record: T): T => {
    const arrived = { ...stripped(record) } as Record<string, unknown>
    delete arrived.drawingLayerId
    return { ...arrived, ...layerField(record.drawingLayerId) } as T
  }

  // A Wall reference is allocated once and never reused, and it is unique in the Project (#64 §1),
  // so the copy cannot bring the numbers it had over. `nextWallRef` reads the Project it is given,
  // which is why the pasted Walls are counted against a scratch view of the destination as they take
  // theirs — the effective model, because a reference has to differ from the Option's own Walls too.
  const seen = effectiveView(ctx.project, floorId, designOptionId)
  const ground: Project = { ...seen, existingModel: { ...seen.existingModel, walls: [...seen.existingModel.walls] } }
  for (const wall of remapped.walls) {
    const record = { ...filed(wall), ref: nextWallRef(ground) }
    ground.existingModel.walls.push(record)
    container.walls.push(record)
  }
  // A Junction is the one kind that rides no Layer of its own — it follows the Walls it joins — so
  // it comes across with its provenance answered for and no layer field (#71 §1).
  for (const junction of remapped.wallJunctions) container.wallJunctions.push(stripped(junction))
  for (const opening of remapped.openings) container.openings.push(filed(opening))
  for (const room of remapped.rooms) container.rooms.push(filed(room))
  for (const item of remapped.placedItems) container.placedItems.push(filed(item))
  copySet.itemDesigns.forEach((design, index) => {
    const id = designIds[index]
    if (id !== undefined) ctx.draft.itemDesigns.push({ ...design, id })
  })

  // A Room is committed only when it overlaps nothing it can see (#67 §7), and borrowed work is no
  // exception: each pasted Room is checked against the Rooms this view stands on and against the
  // pasted Rooms before it, so two Rooms copied on top of each other are refused too.
  const roomsHere = [...seen.existingModel.rooms]
  for (const room of remapped.rooms) {
    checkRoomProposal({ ...ground, existingModel: { ...ground.existingModel, rooms: roomsHere } }, room)
    roomsHere.push(room)
  }
}

/**
 * Where the paste lands, named before it runs (#48, #56). The IDs are pre-allocated, so the Placed
 * Items and the Item Designs are the blocks `PASTE_INTENT_ID_ORDER` puts where they say they are:
 * the Placed Items close the records, the Designs follow them.
 */
function locatePaste(project: Project, intent: Intent<'renovation.pasteFromProject'>): Locator {
  const { floorId, viewId, copySet } = intent.payload
  const { walls, wallJunctions, openings, rooms, placedItems } = copySet.entities
  const items = walls.length + wallJunctions.length + openings.length + rooms.length
  return {
    floorId,
    viewId,
    view: 'plan',
    itemDesignIds: intent.ids.slice(items, items + copySet.itemDesigns.length),
    placedItemIds: intent.ids.slice(Math.max(items - placedItems.length, 0), items),
  }
}

export const PASTE_HANDLERS: { [T in PasteIntentType]: IntentHandler<T> } = {
  'renovation.pasteFromProject': {
    run: pasteFromOtherProject,
    locate: locatePaste,
    review: (project, intent) => {
      const view = project.views.find((candidate) => candidate.id === intent.payload.viewId)
      return view === undefined ? null : pasteReviewOf(project, view, intent.payload.copySet)
    },
  },
}
