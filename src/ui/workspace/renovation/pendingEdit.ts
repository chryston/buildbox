/**
 * The pending edit of §7a, read as data.
 *
 * The forced choice asks what a refused edit of an Existing entity was meant to be, and both answers
 * need to know what that edit would have done: `Replace in <Option>` gives the successor the geometry
 * the person was dragging toward, and the danger dialog says in one word whether the baseline entity
 * moves, changes, disappears or appears. Neither may re-implement the edit — `app` evaluates the
 * Intent against a copy and these helpers only read the two records either side of it.
 */
import { designOptionsOf } from '../../../domain'
import type { Project, ProposedModel } from '../../../domain'
import type { Intent } from '../../../edit'

/** One record of any collection, seen only far enough to find it again. */
interface Identified {
  readonly id: string
}

/** What a record is called, and what it holds, without naming which collection it came from. */
export interface EntityFields {
  readonly ref: string
  readonly fields: Record<string, unknown>
}

/** The fields a successor never carries from its predecessor: identity and provenance (#69 §7). */
const NOT_CARRIED: readonly string[] = ['id', 'ref', 'floorId', 'hostWallId', 'predecessorIds']

/** The payload fields that name exactly one subject, in the order the Intents use them. */
const SUBJECT_FIELDS: readonly string[] = ['entityId', 'wallId', 'openingId', 'roomId', 'placedItemId', 'beamId']
/** The payload fields that can name a subject, when they name only one. */
const SUBJECT_LISTS: readonly string[] = ['wallIds', 'openingIds', 'roomIds', 'placedItemIds', 'entityIds']

function fieldsOf(entity: Identified): EntityFields | null {
  const fields: Record<string, unknown> = { ...entity }
  const ref = typeof fields.ref === 'string'
    ? fields.ref
    : typeof fields.label === 'string'
      ? fields.label
      : typeof fields.name === 'string'
        ? fields.name
        : null
  return ref === null ? null : { ref, fields }
}

/**
 * The record one entity is, in the Existing Model or in the open Option's own work. `null` when
 * nothing answers to the id, which is the dialog's cue to ask nothing.
 */
export function entityFields(project: Project, entityId: string): EntityFields | null {
  const model = project.existingModel
  const collections: (readonly Identified[])[] = [
    model.walls,
    model.openings,
    model.rooms,
    model.placedItems,
  ]
  for (const option of designOptionsOf(project)) {
    const proposed = option.proposed
    if (proposed === undefined) continue
    collections.push([proposed.walls, proposed.openings, proposed.rooms, proposed.placedItems].flat())
  }
  for (const collection of collections) {
    for (const entity of collection) {
      if (entity.id !== entityId) continue
      // A Placed Item carries no name of its own: the Design it is a copy of has it.
      if ('itemDesignId' in entity) {
        const designId: unknown = entity.itemDesignId
        const design = typeof designId === 'string'
          ? project.itemDesigns.find((each) => each.id === designId)
          : undefined
        if (design !== undefined) return { ref: design.name, fields: { ...entity } }
      }
      return fieldsOf(entity)
    }
  }
  return null
}

/**
 * The field values the evaluated record carries that the live one does not — the `edit` a
 * `renovation.replace` successor takes (#69 §7). Empty means the edit changed nothing the successor
 * could carry, which is the inspector's `Replace…` with the geometry left alone.
 */
export function replaceEditOf(before: EntityFields, after: EntityFields): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(after.fields)) {
    if (NOT_CARRIED.includes(key)) continue
    if (JSON.stringify(before.fields[key]) !== JSON.stringify(value)) changed[key] = value
  }
  return changed
}

/** One record of an Option's own work, seen far enough to trace its provenance. */
interface Predecessored {
  readonly id: string
  readonly predecessorIds?: readonly string[]
}

/** Which collection a successor came from, so the workspace can select it in the right one. */
export interface SuccessorHit {
  readonly id: string
  readonly kind: 'wall' | 'opening' | 'room' | 'item'
}

/**
 * The successor that was just made of `predecessorId`. `dispatch` hands back no ids, so the new record
 * is the one that names its predecessor and stands last in its collection — collections are appended
 * to within a transaction, never reordered (#69 §7).
 */
export function successorOf(proposed: ProposedModel, predecessorId: string): SuccessorHit | null {
  const groups: readonly { kind: SuccessorHit['kind']; records: readonly Predecessored[] }[] = [
    { kind: 'wall', records: proposed.walls },
    { kind: 'opening', records: proposed.openings },
    { kind: 'room', records: proposed.rooms },
    { kind: 'item', records: proposed.placedItems },
  ]
  for (const group of groups) {
    for (let at = group.records.length - 1; at >= 0; at -= 1) {
      const each = group.records[at]
      if (each !== undefined && (each.predecessorIds ?? []).includes(predecessorId))
        return { id: each.id, kind: group.kind }
    }
  }
  return null
}

/** The single record an Intent is aimed at, or `null` when it names several or names none. */
function firstOf(payload: Record<string, unknown>, fields: readonly string[]): unknown {
  for (const field of fields) {
    const value = payload[field]
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * The single record an Intent is aimed at, or `null` when it names several or names none.
 */
export function subjectOfIntent(intent: Intent): string | null {
  const payload: Record<string, unknown> = { ...intent.payload }
  const single = firstOf(payload, SUBJECT_FIELDS)
  if (typeof single === 'string') return single
  const list = firstOf(payload, SUBJECT_LISTS)
  if (Array.isArray(list) && list.length === 1) {
    const only = list[0]
    if (typeof only === 'string') return only
  }
  return null
}
