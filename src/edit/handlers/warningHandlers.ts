/**
 * The warning half of the catalogue (#66 §4).
 *
 * Both handlers address a warning by exactly the key the engine computes for it, and both
 * take the key's *inputs* rather than the key: an Entity ID may contain a comma (#42 §3), so
 * a key is write-only and cannot be parsed back. Everything else about an acknowledgement —
 * its ID, its timestamp — comes from the Intent's pre-allocated `ids` and `now`, like every
 * other edit (#42 §3).
 *
 * The third thing here is the post-step `applyIntent` runs after every handler. It is not a
 * handler, but it belongs beside them because it is the other half of what makes an
 * acknowledgement safe to keep: a record of a decision about a Wall that no longer exists
 * would outlive the warning it was about, and nothing would ever show it again.
 */
import { warningKey } from '../../domain'
import type { EntityId, Project } from '../../domain'
import type { Intent, Locator } from '../intents'
import type { Handler, IntentHandler } from './context'
import { refuse, spendIds } from './support'

/** The warning a payload is about, addressed the only way a warning can be addressed. */
type WarningPayload = Intent<'warning.acknowledge'>['payload'] | Intent<'warning.editNote'>['payload']

const findRecord = (draft: Project, payload: WarningPayload) => {
  const key = warningKey(payload.warningType, payload.subjectIds, payload.designOptionId)
  return draft.warningAcknowledgements.find(
    (record) => warningKey(record.warningType, record.subjectIds, record.designOptionId) === key,
  )
}

const acknowledge: Handler<'warning.acknowledge'> = (ctx) => {
  const { warningType, subjectIds, designOptionId, signature, note } = ctx.intent.payload
  const [id] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  const existing = findRecord(ctx.draft, ctx.intent.payload)
  // Acknowledging a reopened warning overwrites the old decision rather than adding a second
  // record: one warning carries one note, and the strip shows one row per warning.
  if (existing === undefined) {
    ctx.draft.warningAcknowledgements.push({
      id,
      warningType,
      subjectIds: [...subjectIds],
      designOptionId,
      signature,
      note,
      acknowledgedAt: ctx.intent.now,
    })
  } else {
    existing.signature = signature
    existing.note = note
    existing.acknowledgedAt = ctx.intent.now
  }
}

const editNote: Handler<'warning.editNote'> = (ctx) => {
  const { note } = ctx.intent.payload
  const existing = findRecord(ctx.draft, ctx.intent.payload)
  if (existing === undefined) {
    refuse(
      'unknown-target',
      'warningAcknowledgements',
      `There is no acknowledgement of ${ctx.intent.payload.warningType} to put a note on.`,
    )
  }
  // The signature is deliberately left alone: editing a note is not re-deciding the warning,
  // so a note edit never clears a reopening that is already owed.
  existing.note = note
}

/**
 * Where an acknowledgement is seen: the Floor its subjects stand on, with the Placed Items
 * and Item Designs among them named, so #66's Locate can select what it can. A warning about
 * a Wall or a Junction has no selection to make, so it only moves the reader to the Floor.
 */
function warningLocator(project: Project, subjects: readonly EntityId[]): Locator {
  const locator: Locator = { floorId: null, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] }
  const model = project.existingModel
  const floorOf = (candidate: EntityId): EntityId | null => {
    const wall = model.walls.find((entry) => entry.id === candidate)
    if (wall !== undefined) return wall.floorId
    const junction = model.wallJunctions.find((entry) => entry.id === candidate)
    if (junction !== undefined) return junction.floorId
    const opening = model.openings.find((entry) => entry.id === candidate)
    if (opening !== undefined) return opening.floorId
    const placement = model.placedItems.find((entry) => entry.id === candidate)
    if (placement !== undefined) {
      if (!locator.placedItemIds.includes(placement.id)) locator.placedItemIds.push(placement.id)
      return placement.floorId
    }
    const design = project.itemDesigns.find((entry) => entry.id === candidate)
    if (design !== undefined) {
      if (!locator.itemDesignIds.includes(design.id)) locator.itemDesignIds.push(design.id)
      return null
    }
    const floor = project.floors.find((entry) => entry.id === candidate)
    if (floor !== undefined) return floor.id
    const view = project.views.find((entry) => entry.id === candidate)
    if (view !== undefined) {
      locator.viewId = view.id
      return view.floorId
    }
    return null
  }
  subjects.forEach((subject) => {
    const floorId = floorOf(subject)
    if (locator.floorId === null) locator.floorId = floorId
  })
  return locator
}

/**
 * Every ID the Project still has an entity for (#66 §4).
 *
 * The whole model, not only the collections a warning can name today: a producer added by
 * #67 or #71 points at a Plan Image or a Floor, and a pruning step that had to be widened
 * whenever a warning type was added would silently start keeping stale records instead.
 */
const liveEntityIds = (project: Project): Set<EntityId> => {
  const ids = new Set<EntityId>([project.id])
  project.floors.forEach((floor) => ids.add(floor.id))
  project.views.forEach((view) => ids.add(view.id))
  project.itemDesigns.forEach((design) => ids.add(design.id))
  const { walls, wallJunctions, openings, placedItems } = project.existingModel
  walls.forEach((wall) => ids.add(wall.id))
  wallJunctions.forEach((junction) => ids.add(junction.id))
  openings.forEach((opening) => ids.add(opening.id))
  placedItems.forEach((placement) => ids.add(placement.id))
  return ids
}

/**
 * Drop every acknowledgement whose subject has gone (#66 §4).
 *
 * `applyIntent` runs this inside the same immer producer as the handler, which is what makes
 * deleting W-5 remove its warning *and* its acknowledgement in one Edit Transaction — and
 * one undo bring both back, the note included, because the inverse patches cover both.
 *
 * A warning is gone as soon as one subject is: a crossing between two Walls is not still a
 * crossing once either of them has been deleted.
 */
export function pruneStaleAcknowledgements(draft: Project): void {
  const records = draft.warningAcknowledgements
  // The usual case, and the one on the 30 ms path: a Project nobody has acknowledged
  // anything in pays nothing but a length check.
  if (records.length === 0) return
  const live = liveEntityIds(draft)
  const kept = records.filter((record) => record.subjectIds.every((subject) => live.has(subject)))
  if (kept.length !== records.length) draft.warningAcknowledgements = kept
}

const warningLocate = <T extends 'warning.acknowledge' | 'warning.editNote'>(
  project: Project,
  intent: Intent<T>,
): Locator => warningLocator(project, intent.payload.subjectIds)

export const WARNING_HANDLERS = {
  'warning.acknowledge': { run: acknowledge, locate: warningLocate },
  'warning.editNote': { run: editNote, locate: warningLocate },
} satisfies {
  'warning.acknowledge': IntentHandler<'warning.acknowledge'>
  'warning.editNote': IntentHandler<'warning.editNote'>
}
