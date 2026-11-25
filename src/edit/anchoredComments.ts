/**
 * The anchored-deletion guard (#80 §14).
 *
 * A Comment is only worth keeping while the thing it is about still exists. Until the dependency
 * review of #82 ships, the rule is blunt and it is enforced here rather than in each handler: an
 * Intent that would leave a surviving Comment pointing at a deleted Wall, a removed Floor, a
 * demolished Design Option, a cabinet node that a tree edit dropped, or a feature its owner's kind
 * never registered is refused outright and changes nothing. The validator carries the same invariant
 * for imports (#80 §15); this is the half that runs on every Edit Transaction, and it is written once
 * so that nothing the catalogue gains later can slip past it — the question is what the finished
 * Project looks like, not which Intent was sent.
 *
 * The message names the target and lists the references, because "delete it" is not an answer the
 * user can act on when they cannot see what was hanging off it.
 */
import type { Comment, CommentAnchor, EntityId, ItemDesign, Project } from '../domain'
import {
  cabinetFeatureIds,
  compareCommentReferences,
  designOptionsOf,
  ENTITY_COLLECTION_KEYS,
  ownerKindOfCollection,
  registeredFeatureIds,
} from '../domain'
import type { EntityCollectionKey, FeatureOwnerKind } from '../domain'
import { refuse } from './handlers/support'

/** One record that an Anchor can point at, with the collection it came from. */
interface EntityHit {
  readonly kind: 'entity'
  readonly record: Record<string, unknown>
  readonly ownerKind: FeatureOwnerKind
}

/** Every entity record of one model, existing or proposed, as a plain record. */
function* entityRecords(model: Record<string, unknown>): Generator<{ record: Record<string, unknown>; key: EntityCollectionKey }> {
  for (const key of ENTITY_COLLECTION_KEYS) {
    const list = model[key]
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        yield { record: entry as Record<string, unknown>, key }
      }
    }
  }
}

/** The entity an `entity` or `feature` Anchor names, searched across the baseline and every Option. */
function findEntity(project: Project, entityId: EntityId): EntityHit | null {
  const models: Record<string, unknown>[] = [project.existingModel as unknown as Record<string, unknown>]
  for (const option of designOptionsOf(project)) models.push(option.proposed as unknown as Record<string, unknown>)
  for (const model of models) {
    for (const { record, key } of entityRecords(model)) {
      if (record.id === entityId) {
        const shape = record.shape === 'riser' ? 'riser' : 'run'
        return { kind: 'entity' as const, record, ownerKind: ownerKindOfCollection(key, shape) }
      }
    }
  }
  return null
}

/** The name a record answers to, in the order the house uses for a label. */
export function nameOf(record: Record<string, unknown>): string | null {
  for (const field of ['name', 'ref', 'label'] as const) {
    const value = record[field]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/**
 * What owns one feature: an Item Design (whose cabinet nodes are its features) or one entity record
 * (whose faces and ends are).
 *
 * An Anchor stores only `ownerId`, so the owner is looked up rather than declared — which is also what
 * makes a stale Anchor resolvable to nothing instead of to the wrong thing.
 */
function findFeatureOwner(project: Project, ownerId: EntityId): { readonly kind: 'design'; design: ItemDesign } | EntityHit | null {
  const design = project.itemDesigns.find((each) => each.id === ownerId)
  if (design !== undefined) return { kind: 'design', design }
  return findEntity(project, ownerId)
}

/**
 * What an Anchor is about, in words the user can act on (#80 §14).
 *
 * Read from the Project the Comment still has, so a target that survives keeps its own name; when the
 * record is gone the kind's plain wording stands in, because the one thing the message must not do is
 * print a raw kind code (`entity`, `floor_point`) at somebody (#80 criterion 19).
 */
export function targetLabel(project: Project, anchor: CommentAnchor): string {
  switch (anchor.kind) {
    case 'project':
      return project.meta.name
    case 'floor': {
      const floor = project.floors.find((each) => each.id === anchor.floorId)
      return floor === undefined ? 'a Floor' : `Floor “${floor.name}”`
    }
    case 'design_option': {
      const option = designOptionsOf(project).find((each) => each.id === anchor.designOptionId)
      return option === undefined ? 'a Design Option' : `Design Option “${option.name}”`
    }
    case 'item_design': {
      const design = project.itemDesigns.find((each) => each.id === anchor.itemDesignId)
      return design === undefined ? 'an Item Design' : `Item Design “${design.name}”`
    }
    case 'entity': {
      const hit = findEntity(project, anchor.entityId)
      const name = hit === null ? null : nameOf(hit.record)
      return name === null ? 'an element' : `“${name}”`
    }
    case 'feature': {
      const owner = findFeatureOwner(project, anchor.ownerId)
      if (owner === null) return 'an element'
      if (owner.kind === 'design') return `Item Design “${owner.design.name}”`
      const name = nameOf(owner.record)
      return name === null ? 'an element' : `“${name}”`
    }
    case 'floor_point':
      return 'a Floor Point'
  }
}

/** Whether an Anchor's target exists in this Project, and its feature is registered for its owner. */
export function anchorResolves(project: Project, anchor: CommentAnchor): boolean {
  switch (anchor.kind) {
    case 'project':
      return true
    case 'floor':
    case 'floor_point':
      return project.floors.some((each) => each.id === anchor.floorId)
    case 'design_option':
      return designOptionsOf(project).some((each) => each.id === anchor.designOptionId)
    case 'item_design':
      return project.itemDesigns.some((each) => each.id === anchor.itemDesignId)
    case 'entity':
      return findEntity(project, anchor.entityId) !== null
    case 'feature': {
      const owner = findFeatureOwner(project, anchor.ownerId)
      if (owner === null) return false
      if (owner.kind === 'design') {
        if (owner.design.kind !== 'cabinet') return false
        return cabinetFeatureIds(owner.design.construction.root).includes(anchor.featureId)
      }
      const registered = registeredFeatureIds(owner.ownerKind)
      return registered !== null && registered.includes(anchor.featureId)
    }
  }
}

/**
 * Refuse an edit that leaves a Comment anchored to nothing (#80 §14).
 *
 * Only Comments that were already in the Project are judged: a Comment this very Intent created is its
 * own handler's business, and a Project that arrived broken is the validator's. The rejection names the
 * target once and lists every reference hanging off it, sorted as the panel sorts them.
 */
export function guardAnchoredComments(before: Project, after: Project): void {
  if (before.comments.length === 0) return
  const beforeIds = new Set<EntityId>(before.comments.map((comment) => comment.id))
  const groups = new Map<string, Comment[]>()
  for (const comment of after.comments) {
    if (!beforeIds.has(comment.id) || anchorResolves(after, comment.anchor)) continue
    // Read the name out of the Project the edit started from: the target is exactly the thing that has
    // gone missing, so the only place it still has one is the record as it was.
    const label = targetLabel(before, comment.anchor)
    const group = groups.get(label)
    if (group === undefined) groups.set(label, [comment])
    else group.push(comment)
  }
  if (groups.size === 0) return

  // One target per refusal, the first in the Project's own order: the user fixes that and retries, and
  // a list of five refusals would read as a wall of text about a Project they cannot edit anyway.
  for (const [label, list] of groups) {
    const references = list.map((comment) => comment.reference).sort(compareCommentReferences)
    refuse(
      'has-dependants',
      `comments[${list[0]!.id}]`,
      `${list.length} ${list.length === 1 ? 'Comment is' : 'Comments are'} anchored to ${label}: ${references.join(', ')}. Answer the dependency review that opens when this is asked.`,
    )
  }
}
