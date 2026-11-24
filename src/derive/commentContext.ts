/**
 * Which Comments belong to the view a person is looking at (#80 §6).
 *
 * A Comment is written once and read in many places, so "is this one of the notes I should be seeing
 * right now?" is a derived question rather than a stored flag: it depends on the Floor the view draws,
 * the Design Option it draws it through, and whether the thing the Anchor names still stands there.
 * Storing the answer would let it go stale the moment an Option changed, which is the failure this
 * module exists to avoid.
 *
 * Two things are computed here. The **effective scope** answers "which alternatives is this Comment
 * about?" — either it chose one (`All Options` or a named Option), or it inherited the answer from the
 * work it is anchored to (the Existing Model, or the one Option that proposes that work). The
 * **context predicate** answers whether a Comment should be listed for one saved view.
 */
import { effectiveModel } from './effectiveModel'
import type { EffectiveModel } from './effectiveModel'
import type { Comment, CommentScope, EntityId, Project, ProposedModel, SavedViewSettings } from '../domain'
import { CHOOSING_ANCHOR_KINDS, COMMENT_SCOPE_ALL, compareCommentReferences, isCommentScopeAll, viewDesignOptionId } from '../domain'

/** Where a Comment's work stands, found by looking the Anchor's subject up. */
interface SubjectLocation {
  /** The Floor the subject stands on. */
  readonly floorId: EntityId
  /** The Option that proposes the subject, or `null` when the Existing Model holds it. */
  readonly optionId: EntityId | null
  /** Whether the subject is there to be pointed at under the Option the lookup asked for. */
  readonly stands: boolean
}

/** The scope a Comment is read under, with the answer's provenance kept alongside it. */
export type EffectiveCommentScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'existing'; readonly inherited: boolean }
  | { readonly kind: 'option'; readonly designOptionId: EntityId; readonly inherited: boolean }

/** Every entity collection of a container, so one lookup covers every kind of Anchor subject. */
const collectionsOf = (model: ProposedModel): readonly { readonly id: EntityId; readonly floorId: EntityId }[][] => [
  model.walls,
  model.wallJunctions,
  model.openings,
  model.rooms,
  model.placedItems,
]

/**
 * Where the subject of an entity or feature Anchor lives.
 *
 * The Existing Model is asked first, because an ID the Existing Model holds is the Existing Model's
 * even when an Option also carries a record under it. `optionId` says which Option proposes the subject
 * when the Existing Model does not hold it, which is what makes an inherited scope answerable without
 * the Comment storing one.
 */
function locateSubject(project: Project, subjectId: EntityId, optionId: EntityId | null): SubjectLocation | null {
  for (const collection of collectionsOf(project.existingModel)) {
    const found = collection.find((row) => row.id === subjectId)
    if (found !== undefined) return { floorId: found.floorId, optionId: null, stands: true }
  }
  for (const option of project.designOptions ?? []) {
    for (const collection of collectionsOf(option.proposed)) {
      const found = collection.find((row) => row.id === subjectId)
      if (found === undefined) continue
      // A subject one Option proposes is invisible to the view of another: it is not demolished, it
      // was simply never part of this alternative.
      return { floorId: found.floorId, optionId: option.id, stands: optionId === null || option.id === optionId }
    }
  }
  return null
}

/**
 * The scope a Comment is read under (#80 §6).
 *
 * An Anchor that chooses its own scope answers from the field the editor wrote. One that does not —
 * entity and feature — inherits from its subject, and says so, because `Existing Model (inherited)` and
 * `Existing Model` mean different things to the person reading the row: the first follows the work, the
 * second was picked.
 *
 * A subject that has since been deleted inherits `All Options`: there is no answer left to inherit,
 * and a Comment nobody can place is better listed widely than lost.
 */
export function effectiveCommentScope(project: Project, comment: Comment): EffectiveCommentScope {
  const anchor = comment.anchor
  if (CHOOSING_ANCHOR_KINDS.includes(anchor.kind)) {
    const scope = comment.scope as CommentScope | undefined
    if (scope === undefined || isCommentScopeAll(scope ?? COMMENT_SCOPE_ALL)) return { kind: 'all' }
    return { kind: 'option', designOptionId: scope, inherited: false }
  }
  const subjectId = anchor.kind === 'entity' ? anchor.entityId : anchor.kind === 'feature' ? anchor.ownerId : null
  if (subjectId === null) return { kind: 'all' }
  const located = locateSubject(project, subjectId, null)
  if (located === null) return { kind: 'all' }
  return located.optionId === null
    ? { kind: 'existing', inherited: true }
    : { kind: 'option', designOptionId: located.optionId, inherited: true }
}

/**
 * The words the row and the editor write beside a scope (#80 §6).
 *
 * An inherited answer is marked inherited, and an Option that has since been deleted reads as the
 * Existing Model rather than as a blank, which is how `designOptionName` already treats it in a table.
 */
export function commentScopeLabel(project: Project, scope: EffectiveCommentScope): string {
  if (scope.kind === 'all') return 'All Options'
  if (scope.kind === 'existing') return 'Existing Model (inherited)'
  const name = optionName(project, scope.designOptionId)
  return scope.inherited ? `${name} (inherited)` : name
}

/** The Option's name, or `Existing Model` for one the Project no longer has. */
function optionName(project: Project, optionId: EntityId): string {
  return (project.designOptions ?? []).find((option) => option.id === optionId)?.name ?? 'Existing Model'
}

/**
 * Whether a Comment belongs to the view (#80 §6), the five rules in the order the issue states them.
 *
 * `model` is the effective model the view is drawing, passed in because a panel listing a hundred
 * Comments asks for it once and every row after the first shares it.
 */
export function commentIsInContext(project: Project, view: SavedViewSettings & { floorId: EntityId }, comment: Comment, model: EffectiveModel): boolean {
  const anchor = comment.anchor
  const scope = effectiveCommentScope(project, comment)
  // 1. The scope has to be readable through the Option the view is drawn under.
  if (scope.kind === 'option' && scope.designOptionId !== model.optionId) return false
  switch (anchor.kind) {
    // 2. A Floor and a point on one belong to that Floor only.
    case 'floor':
    case 'floor_point':
      return anchor.floorId === view.floorId
    // 3. A Design Option Comment belongs to the view of the Option it names, and to no other.
    case 'design_option':
      return anchor.designOptionId === model.optionId
    // 4. Work that does not stand in this alternative is not work this view is showing.
    case 'entity':
    case 'feature': {
      const subjectId = anchor.kind === 'entity' ? anchor.entityId : anchor.ownerId
      return locatesIn(model, subjectId)
    }
    // 5. A Project-wide note and a note about a shared Item Design are everywhere, subject to rule 1.
    case 'project':
    case 'item_design':
      return true
  }
}

/** Whether the subject of an Anchor is one of the records this view is drawing. */
function locatesIn(model: EffectiveModel, subjectId: EntityId): boolean {
  type Row = readonly { readonly entity: { readonly id: EntityId } }[]
  const lists: readonly Row[] = [
    model.walls,
    model.wallJunctions,
    model.openings,
    model.rooms,
    model.placedItems,
    model.beams,
    model.skirting,
    model.services,
  ]
  return lists.some((list) => list.some((row) => row.entity.id === subjectId))
}

/**
 * The Comments the Notes panel lists for one saved view, in reference order (#80 §5).
 *
 * Reference order rather than the order the Project lists them, because the panel is read top to bottom
 * as a list of numbers and `C-999` before `C-1000` is the only order that reads correctly.
 */
export function commentsForView(
  project: Project,
  view: SavedViewSettings & { floorId: EntityId },
  comments: readonly Comment[] = project.comments,
): Comment[] {
  const model = effectiveModel(project, view.floorId, viewDesignOptionId(view))
  return comments
    .filter((comment) => commentIsInContext(project, view, comment, model))
    .sort((left, right) => compareCommentReferences(left.reference, right.reference))
}

/**
 * The Comments an Item Detail View lists (#80 §6): the Project's own, and the ones about this Item
 * Design or a feature of it.
 *
 * The Item Design is shared by every placement of it, which is the point of the inspector's split (§8)
 * and of this narrower context: opening one cabinet's detail is not a statement about the other nine.
 */
export function commentsForItemDetail(project: Project, itemDesignId: EntityId, comments: readonly Comment[] = project.comments): Comment[] {
  return comments
    .filter((comment) => {
      const anchor = comment.anchor
      const about =
        anchor.kind === 'project' ||
        (anchor.kind === 'item_design' && anchor.itemDesignId === itemDesignId) ||
        (anchor.kind === 'feature' && anchor.ownerId === itemDesignId)
      if (!about) return false
      const scope = effectiveCommentScope(project, comment)
      return scope.kind === 'all' || scope.kind === 'existing' || (project.designOptions ?? []).some((option) => option.id === scope.designOptionId)
    })
    .sort((left, right) => compareCommentReferences(left.reference, right.reference))
}
