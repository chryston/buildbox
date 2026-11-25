/**
 * The five Comment Intents (#80 §3).
 *
 * A Comment is one record with one Anchor, and the panel edits one field at a time: a title committed
 * on Enter is one Edit Transaction and one undo step, never one per keystroke. Nothing here reads the
 * clock — every payload carries the instant the user committed (#42 §3) — and nothing here allocates a
 * reference by counting: `commentReferenceCounter` is the highest number the Project has ever handed
 * out, so the next one is always ahead of everything that came before it, undo included.
 */
import type { Comment, CommentAnchor, EntityId, Project } from '../../domain'
import {
  anchorChoosesScope,
  COMMENT_PRIORITIES,
  COMMENT_TITLE_MAX_LENGTH,
  commentAnchorFloorId,
  designOptionsOf,
  formatCommentReference,
  isCommentScopeAll,
} from '../../domain'
import type { CommentIntent, CreateComment, EditComment, Locator } from '../intents'
import { anchorResolves } from '../anchoredComments'
import type { Handler, IntentHandler } from './context'
import { refuse, spendIds } from './support'

const commentPath = (commentId: EntityId): string => `comments[${commentId}]`

/** The Comment, or a rejection: every Intent about an existing Comment names one. */
const requireComment = (project: Project, commentId: EntityId): Comment => {
  const found = project.comments.find((comment) => comment.id === commentId)
  if (found === undefined) refuse('unknown-target', commentPath(commentId), `No Comment answers to ${commentId}.`)
  return found
}

/**
 * The scope a Comment may carry, checked against the Anchor that has to answer for it (#80 §1).
 *
 * An Anchor that names a Design Option, an entity or a feature already says which Option the note
 * belongs to, and a second answer beside it is a row that reads one thing in the panel and draws
 * another on the canvas. An Anchor that names nothing of the kind has to be told, or the row belongs to
 * every Option at once — which is a real answer, and has to be written down as one.
 */
function scopeFor(project: Project, anchor: CommentAnchor, scope: string | undefined, path: string): string | undefined {
  if (anchorChoosesScope(anchor.kind)) {
    if (scope === undefined) {
      refuse('invalid-comment', path, 'This Comment is not anchored to one Design Option, so it has to say which Option it applies to — or “All”.')
    }
    if (!isCommentScopeAll(scope) && !designOptionsOf(project).some((option) => option.id === scope)) {
      refuse('unknown-target', path, `No Design Option answers to ${scope}.`)
    }
    return scope
  }
  if (scope !== undefined) {
    refuse('invalid-comment', path, 'This Comment takes its Design Option from what it is anchored to, so it does not store a scope of its own.')
  }
  return undefined
}

/** A title the panel can read and the row can fit. */
function requireTitle(title: string, path: string): string {
  const trimmed = title.trim()
  if (trimmed === '') refuse('invalid-comment', path, 'A Comment needs a title — the row in the panel is the title.')
  if (trimmed.length > COMMENT_TITLE_MAX_LENGTH) {
    refuse('invalid-comment', path, `A Comment title is at most ${COMMENT_TITLE_MAX_LENGTH} characters; this one is ${trimmed.length}.`)
  }
  return trimmed
}

/** The priority, or a rejection: the payload's `priority` is a string until this says otherwise. */
function requirePriority(priority: string, path: string): 'high' | 'normal' | 'low' {
  if (!(COMMENT_PRIORITIES as readonly string[]).includes(priority)) {
    refuse('invalid-comment', path, `Expected one of ${COMMENT_PRIORITIES.join(', ')} for the priority.`)
  }
  return priority as 'high' | 'normal' | 'low'
}

const createComment: Handler<'comment.create'> = ({ project, draft, intent }) => {
  const { anchor, title, body, priority, scope, linkedWarning, at } = intent.payload as CreateComment
  const [id] = spendIds(intent.ids, 1, 'comment.create')
  const anchorPath = `${commentPath(id)}.anchor`
  if (!anchorResolves(project, anchor)) {
    refuse('unknown-target', anchorPath, 'This Comment is anchored to something that is not in the Project.')
  }
  const comment: Comment = {
    id,
    // The counter is the highest number ever handed out, so this is a number nothing has worn before
    // and nothing will wear again — undo rewinds the Comment, never the counter (#80 §1).
    reference: formatCommentReference(project.commentReferenceCounter + 1),
    title: requireTitle(title, `${commentPath(id)}.title`),
    body,
    anchor,
    status: 'open',
    priority: requirePriority(priority, `${commentPath(id)}.priority`),
    createdAt: at,
    updatedAt: at,
  }
  const stored = scopeFor(project, anchor, scope, `${commentPath(id)}.scope`)
  if (stored !== undefined) comment.scope = stored
  if (linkedWarning !== undefined) comment.linkedWarning = linkedWarning
  draft.comments.push(comment)
  draft.commentReferenceCounter = project.commentReferenceCounter + 1
}

const editComment: Handler<'comment.edit'> = ({ project, draft, intent }) => {
  const { commentId, title, body, priority, scope, at } = intent.payload as EditComment
  const comment = requireComment(project, commentId)
  const next = draft.comments.find((each) => each.id === commentId)!
  if (title !== undefined) next.title = requireTitle(title, `${commentPath(commentId)}.title`)
  if (body !== undefined) next.body = body
  if (priority !== undefined) next.priority = requirePriority(priority, `${commentPath(commentId)}.priority`)
  if (scope !== undefined) {
    const stored = scopeFor(project, comment.anchor, scope, `${commentPath(commentId)}.scope`)
    if (stored !== undefined) next.scope = stored
  }
  next.updatedAt = at
}

const resolveComment: Handler<'comment.resolve'> = ({ project, draft, intent }) => {
  const { commentId, at } = intent.payload
  const comment = requireComment(project, commentId)
  if (comment.status === 'resolved') {
    refuse('no-change', `${commentPath(commentId)}.status`, `${comment.reference} is already resolved.`)
  }
  const next = draft.comments.find((each) => each.id === commentId)!
  next.status = 'resolved'
  next.resolvedAt = at
  next.updatedAt = at
}

const reopenComment: Handler<'comment.reopen'> = ({ project, draft, intent }) => {
  const { commentId, at } = intent.payload
  const comment = requireComment(project, commentId)
  if (comment.status === 'open') {
    refuse('no-change', `${commentPath(commentId)}.status`, `${comment.reference} is already open.`)
  }
  const next = draft.comments.find((each) => each.id === commentId)!
  next.status = 'open'
  // `resolvedAt` and `status` disagree with each other the moment one of them survives the other, and
  // the validator refuses the pair (#80 §15) — so reopening has to clear it, not leave it behind.
  delete next.resolvedAt
  next.updatedAt = at
}

const deleteComment: Handler<'comment.delete'> = ({ project, draft, intent }) => {
  const { commentId } = intent.payload
  requireComment(project, commentId)
  draft.comments = draft.comments.filter((comment) => comment.id !== commentId)
}

/**
 * Where a Comment lives, for the highlight #48 wants even on a rejection.
 *
 * A Comment about the Project has no Floor to open; anything else names one, directly or through the
 * entity it is anchored to, and the panel switches to that Floor when the row is clicked.
 */
const locateComment = (project: Project, anchor: CommentAnchor): Locator => ({
  floorId: commentAnchorFloorId(anchor),
  viewId: null,
  view: 'plan',
  itemDesignIds: anchor.kind === 'item_design' ? [anchor.itemDesignId] : [],
  placedItemIds: anchor.kind === 'entity' ? [anchor.entityId] : [],
})

const anchorOf = (project: Project, commentId: EntityId): CommentAnchor | null =>
  project.comments.find((comment) => comment.id === commentId)?.anchor ?? null

/** A Comment that has gone missing still gets a best-effort Locator, because `locate` never throws. */
const locateExisting = (project: Project, commentId: EntityId): Locator => {
  const anchor = anchorOf(project, commentId)
  return anchor === null ? { floorId: null, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] } : locateComment(project, anchor)
}

type CommentHandlers = { [T in CommentIntent['type']]: IntentHandler<T> }

export const COMMENT_HANDLERS: CommentHandlers = {
  'comment.create': {
    run: createComment,
    locate: (project, intent) => locateComment(project, intent.payload.anchor),
  },
  'comment.edit': { run: editComment, locate: (project, intent) => locateExisting(project, intent.payload.commentId) },
  'comment.resolve': {
    run: resolveComment,
    locate: (project, intent) => locateExisting(project, intent.payload.commentId),
  },
  'comment.reopen': { run: reopenComment, locate: (project, intent) => locateExisting(project, intent.payload.commentId) },
  'comment.delete': { run: deleteComment, locate: (project, intent) => locateExisting(project, intent.payload.commentId) },
}
