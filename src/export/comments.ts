/**
 * The Comment Register (#83 §4).
 *
 * One row per Comment the scope admits, in reference order, written by the shared v1.0 CSV writer —
 * so it gets the BOM, the CRLF, the quoting and the formula neutralisation that every other table
 * gets, and a body with a line break stays one cell.
 *
 * Two rules shape this file rather than the writer.
 *
 * The Register is the Comment's content on paper, so it carries the whole body — the pin on a sheet
 * carries only the reference, the title and the status, and the Register is where the rest of it
 * lives. And it carries no author: a Comment is the Project's, not a person's, and an author column
 * would make a row about who wrote it instead of what it says.
 *
 * The row's Floor is the Anchor's, or the subject's, or nothing. A Project, Design Option or Item
 * Design Comment belongs to no Floor and says so with an empty cell rather than borrowing one,
 * because a reader filters the column by Floor and a wrong name there is a row that turns up in the
 * wrong pile.
 */
import type { Comment, CommentAnchor, Project } from '../domain'
import { commentAnchorFloorId, commentIsOpen, compareCommentReferences, designOptionsOf } from '../domain'
import type { QuantityScope } from '../derive'
import { commentAnchorLabel, commentSubjectFloorId, effectiveCommentScope } from '../derive'
import { SCOPE } from './strings'

/** One Register row, keyed by the keys `COMMENTS_TABLE` names. */
export type CommentRegisterRow = {
  readonly reference: string
  readonly title: string
  readonly body: string
  readonly status: string
  readonly priority: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly resolvedAt: string
  readonly scope: string
  readonly floor: string
  readonly designOption: string
  readonly targetType: string
  readonly targetLabel: string
}

/**
 * Whether the Register lists this Comment.
 *
 * Three questions, in the order #83 §4.2 states them: the status the person asked for, the scope
 * the Option choice admits, and the Floor the Anchor lives on.
 *
 * `Existing Model only` excludes Design Option-scoped Comments and keeps everything else, because
 * the Existing Model is in every Register: an `existing_model` scope was chosen (or inherited)
 * against work that stands in all alternatives. A Comment whose subject has gone is kept and given
 * an empty Floor, which is the same answer `effectiveCommentScope` gives — a Comment nobody can
 * place is better listed than lost.
 */
export function commentIsInRegister(
  project: Project,
  comment: Comment,
  scope: QuantityScope,
  includeResolvedComments: boolean,
): boolean {
  if (!includeResolvedComments && !commentIsOpen(comment)) return false
  const effective = effectiveCommentScope(project, comment)
  if (effective.kind === 'option') {
    const wanted = scope.designOptionIds
    if (wanted === 'existing-only' || !wanted.includes(effective.designOptionId)) return false
  }
  const floorId = commentAnchorFloorId(comment.anchor) ?? commentSubjectFloorId(project, comment)
  return floorId === null || scope.floorIds.includes(floorId)
}

/** The Anchor's kind code, published rather than the word the panel shows (#83 §4.4). */
const targetType = (anchor: CommentAnchor): string => anchor.kind

/**
 * The Anchor's label, in the same plain words the Notes panel writes for it.
 *
 * One deviation, asked for by #83 §4.4: a Floor Point reads `Floor Point · Ground Floor`, where the
 * panel writes `Floor Point · Ground Floor point`. The panel has a pin under that label and the
 * second word tells the reader which end of the leader to look at; in a column that already says
 * `floor_point` above its head it only repeats the kind, and the contract lets no coordinates into
 * a table either way.
 */
const targetLabel = (project: Project, anchor: CommentAnchor): string => {
  const label = commentAnchorLabel(project, anchor)
  return anchor.kind === 'floor_point' ? label.replace(/ point$/, '') : label
}

/** The Register's rows, in reference order: `C-999` before `C-1000`. */
export function commentRegisterRows(
  project: Project,
  scope: QuantityScope,
  includeResolvedComments: boolean,
): CommentRegisterRow[] {
  return (project.comments ?? [])
    .filter((comment) => commentIsInRegister(project, comment, scope, includeResolvedComments))
    .sort((left, right) => compareCommentReferences(left.reference, right.reference))
    .map((comment) => rowOf(project, comment))
}

/** One Comment as one row. */
function rowOf(project: Project, comment: Comment): CommentRegisterRow {
  const anchor = comment.anchor
  const effective = effectiveCommentScope(project, comment)
  const floorId = commentAnchorFloorId(anchor) ?? commentSubjectFloorId(project, comment)
  // The Option column names the alternative the row is read under: the one the scope chose, or the
  // one the Anchor itself points at. An `existing_model` scope has no Option to name.
  const optionId = effective.kind === 'option'
    ? effective.designOptionId
    : anchor.kind === 'design_option'
      ? anchor.designOptionId
      : null
  return {
    reference: comment.reference,
    title: comment.title,
    body: comment.body,
    status: comment.status,
    priority: comment.priority,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    resolvedAt: comment.status === 'resolved' ? comment.resolvedAt ?? '' : '',
    scope: effective.kind === 'all' ? 'all_options' : effective.kind === 'existing' ? 'existing_model' : 'design_option',
    floor: floorId === null ? '' : project.floors.find((floor) => floor.id === floorId)?.name ?? '',
    designOption: optionId === null ? '' : designOptionsOf(project).find((option) => option.id === optionId)?.name ?? '',
    targetType: targetType(anchor),
    targetLabel: targetLabel(project, anchor),
  }
}

/**
 * The Register's scope in one plain line (#83 §4.2): Floors · Design Options · status.
 *
 * Not `describeScope`: Renovation States and Drawing Layers do not filter a Comment, and a sentence
 * that named them would promise a filter the Register does not apply.
 */
export function commentScopeStatement(project: Project, scope: QuantityScope, includeResolvedComments: boolean): string {
  const names = scope.floorIds
    .map((floorId) => project.floors.find((floor) => floor.id === floorId)?.name)
    .filter((name): name is string => name !== undefined)
  const floors =
    project.floors.length > 0 && names.length >= project.floors.length ? SCOPE.allFloors : names.join(SCOPE.join)
  const options = scope.designOptionIds === 'existing-only'
    ? SCOPE.existingModelOnly
    : scope.designOptionIds
      .map((optionId) => designOptionsOf(project).find((option) => option.id === optionId)?.name ?? optionId)
      .join(SCOPE.join)
  const status = includeResolvedComments ? SCOPE.openAndResolvedComments : SCOPE.openComments
  return [floors, options, status].filter((part) => part !== '').join(SCOPE.separator)
}
