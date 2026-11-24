/**
 * The Comment record and its typed Anchor (#80 §1, §2).
 *
 * A Comment is an authorless, structured Project note attached through exactly one stable Anchor.
 * It is Project-level canonical content — it travels in a Backup, it is undoable, and it belongs to
 * no Drawing Layer and no Renovation State — and it carries nothing of a conversation: no author,
 * no assignee, no due date, no reply, no mention, no reaction, no permission. The validator refuses
 * any such field by name, because the single-user boundary is a schema rule rather than a habit.
 *
 * Three things about the record are load-bearing and easy to get wrong later:
 *
 *  - **The reference is never reused.** `C-nnn` comes from a Project-level counter that only moves
 *    forward (#80 §1), so undoing a creation leaves the counter advanced and the next Comment takes
 *    the following number. `commentReferenceNumber` is the only reader of the digits, because
 *    `C-999` sorts before `C-1000` and a plain string comparison says otherwise.
 *  - **The Anchor is one typed pointer, never a coordinate.** A `feature` Anchor stores
 *    `(ownerId, featureId, t?)` and no position: the point is evaluated from canonical geometry on
 *    every read (`derive`), which is what lets a Comment stay on the Kitchen side face of a Wall
 *    that has since been moved.
 *  - **`scope` is stored only where the Anchor cannot say it.** Project, Floor, Item Design and
 *    Floor Point anchors do not determine which Design Option a Comment belongs to, so they carry
 *    one; entity, feature and Design Option anchors inherit their target's ownership and must not
 *    store a second answer that could disagree with it.
 *
 * `domain` never allocates a reference, never reads the clock and never invents an ID (#42 §3): the
 * Intent brings all three.
 */
import type { EntityId, Point2, Project } from './project'

/** Whether a Comment is standing or finished (#80 §1). Two states, and no archive beside them. */
export type CommentStatus = 'open' | 'resolved'

/** Every status, in the order the panel's filter lists them. */
export const COMMENT_STATUSES: readonly CommentStatus[] = Object.freeze(['open', 'resolved'])

/** How much a Comment matters (#80 §1). `normal` is what a new one starts at. */
export type CommentPriority = 'low' | 'normal' | 'high'

/** Every priority, weakest first — the order the editor's select and the filter list them. */
export const COMMENT_PRIORITIES: readonly CommentPriority[] = Object.freeze(['low', 'normal', 'high'])

/** The priority a Comment is created with when nothing says otherwise (#80 §1). */
export const DEFAULT_COMMENT_PRIORITY: CommentPriority = 'normal'

/** The title the `✎ Comment` tool starts a new note with, so a click always leaves a named row. */
export const DEFAULT_COMMENT_TITLE = 'New comment'

/** One line of text. The editor commits on Enter or blur, so a title can never hold a newline. */
export const COMMENT_TITLE_MAX_LENGTH = 120

/** The plain-text body's ceiling (#80 §1). It is a note, not a document, and it is never fetched. */
export const COMMENT_BODY_MAX_LENGTH = 4000

/** The one shape a reference ever takes: `C-` and at least three digits, no more, no less. */
export const COMMENT_REFERENCE_PATTERN = /^C-\d{3,}$/

/** The number of digits a reference is padded to, so `C-001` rather than `C-1`. */
export const COMMENT_REFERENCE_MIN_DIGITS = 3

/** The seven Anchor kinds (#80 §2). */
export type CommentAnchorKind =
  | 'project'
  | 'floor'
  | 'design_option'
  | 'item_design'
  | 'entity'
  | 'feature'
  | 'floor_point'

/** Every Anchor kind, in the order the target-type filter lists its plain label. */
export const COMMENT_ANCHOR_KINDS: readonly CommentAnchorKind[] = Object.freeze([
  'project',
  'floor',
  'design_option',
  'item_design',
  'entity',
  'feature',
  'floor_point',
])

/** A Comment about the Project as a whole. It stores nothing, and it never draws a pin. */
export interface ProjectAnchor {
  kind: 'project'
}

/** A Comment about one Floor, which is in that Floor's views and nowhere else. */
export interface FloorAnchor {
  kind: 'floor'
  floorId: EntityId
}

/** A Comment about one Design Option. Its scope is that Option, inherited and never stored. */
export interface DesignOptionAnchor {
  kind: 'design_option'
  designOptionId: EntityId
}

/**
 * A Comment about an Item Design rather than about any one placement of it (#80 §8). It is the one
 * Anchor whose target is shared across Floors, which is why it renders as one count badge per
 * placement and never as a pin per copy.
 */
export interface ItemDesignAnchor {
  kind: 'item_design'
  itemDesignId: EntityId
}

/** A Comment about exactly one Room, Building Element or Placed Item. */
export interface EntityAnchor {
  kind: 'entity'
  entityId: EntityId
}

/**
 * A Comment about one stable part of one owner (#80 §2): an entity's Wall face, a Beam's underside,
 * a cabinet's space. `featureId` is a `domain`-registered ID, never a coordinate, and `t` is the
 * parametric position along a linear feature — kept through a compatible edit, which is what makes
 * a Comment follow a Wall it is anchored to.
 */
export interface FeatureAnchor {
  kind: 'feature'
  /** The entity or Item Design the feature belongs to. */
  ownerId: EntityId
  featureId: string
  /** Parametric position in [0, 1]; present only for a linear feature. */
  t?: number
}

/**
 * A Comment pinned to one Floor's coordinates (#80 §2). It is the only Anchor with a position that
 * belongs to nothing but the Floor, and there is no cross-Floor version of it.
 */
export interface FloorPointAnchor {
  kind: 'floor_point'
  floorId: EntityId
  /** Floor-local millimetres, the same frame a Placed Item's translation is written in. */
  point: Point2
}

/** The one Anchor a Comment has. Exactly one, always resolvable, and never a copy of a position. */
export type CommentAnchor =
  | ProjectAnchor
  | FloorAnchor
  | DesignOptionAnchor
  | ItemDesignAnchor
  | EntityAnchor
  | FeatureAnchor
  | FloorPointAnchor

/**
 * The scope a choosing Anchor stores: `COMMENT_SCOPE_ALL` or one Design Option ID.
 *
 * It is a plain string because a Design Option ID is one — `EntityId` is `string`, so a narrower
 * type would be a lie the compiler could not check. `isCommentScopeAll` is the test.
 */
export type CommentScope = string

/** The scope that says "every Design Option, and none of them in particular" (#80 §1). */
export const COMMENT_SCOPE_ALL = 'all'

/** Whether a scope value is the All Options answer rather than a Design Option ID. */
export const isCommentScopeAll = (scope: CommentScope): boolean => scope === COMMENT_SCOPE_ALL

/**
 * The Anchor kinds that choose their own scope (#80 §1): Project, Floor, Item Design, Floor Point.
 *
 * The other three name something that already belongs to an Option or to the Existing Model, so
 * storing a scope beside them would put two answers to "which Option?" in one record.
 */
export const CHOOSING_ANCHOR_KINDS: readonly CommentAnchorKind[] = Object.freeze([
  'project',
  'floor',
  'item_design',
  'floor_point',
])

/** Whether an Anchor of this kind stores its own scope, as opposed to inheriting one. */
export const anchorChoosesScope = (kind: CommentAnchorKind): boolean =>
  CHOOSING_ANCHOR_KINDS.includes(kind)

/** What a Comment records about the Warning it was created from (#80 §11). */
export interface CommentWarningLink {
  /** The Warning's key: type, sorted subject IDs and Design Option, exactly as `warningKey` writes it. */
  key: string
  /** The message text as it read at creation, kept because the Warning's copy may be reworded. */
  message: string
}

/**
 * One Comment (#80 §1).
 *
 * `resolvedAt` is present exactly while the Comment is Resolved, and `scope` exactly when the Anchor
 * chooses one; both rules are validator-enforced rather than type-enforced, because the discriminator
 * that decides them sits one level down inside `anchor`.
 */
export interface Comment {
  /** Immutable and Project-unique, pre-allocated in the Intent (#42 §3). */
  id: EntityId
  /** Immutable `C-nnn`, allocated from the Project's counter and never reused (#80 §1). */
  reference: string
  /** One line. */
  title: string
  /** Plain text. A URL may be shown as a link and is never fetched (#80 §1). */
  body: string
  anchor: CommentAnchor
  status: CommentStatus
  priority: CommentPriority
  /** ISO 8601, read from the caller's clock when the Intent was made (#42 §3). */
  createdAt: string
  /** ISO 8601; every edit that changes a field moves this. */
  updatedAt: string
  /** ISO 8601; present exactly while `status` is `resolved`. */
  resolvedAt?: string
  /** `COMMENT_SCOPE_ALL` or one Design Option ID; present exactly for a choosing Anchor. */
  scope?: CommentScope
  /** Set only by the Warning strip's `Create linked Comment` (#80 §11). */
  linkedWarning?: CommentWarningLink
}

/** The digits of a reference as a number, or `null` for text that is not one. */
export function commentReferenceNumber(reference: string): number | null {
  if (!COMMENT_REFERENCE_PATTERN.test(reference)) return null
  return Number(reference.slice(2))
}

/** The reference for a number: `C-001`, `C-999`, `C-1000`. */
export function formatCommentReference(value: number): string {
  return `C-${String(value).padStart(COMMENT_REFERENCE_MIN_DIGITS, '0')}`
}

/**
 * Reference order, numerically (#80 Notes): `C-999` before `C-1000`.
 *
 * A text that is not a reference sorts last and after each other such text, so a broken record
 * cannot shuffle the well-formed ones around it.
 */
export function compareCommentReferences(a: string, b: string): number {
  const left = commentReferenceNumber(a)
  const right = commentReferenceNumber(b)
  if (left === null && right === null) return a < b ? -1 : a > b ? 1 : 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

/** The Floor an Anchor sits on, or `null` for an Anchor that names no Floor. */
export const commentAnchorFloorId = (anchor: CommentAnchor): EntityId | null =>
  anchor.kind === 'floor' || anchor.kind === 'floor_point' ? anchor.floorId : null

/** Whether a Comment is Open, which is the only thing the overlay and the badges count (#80 §7). */
export const commentIsOpen = (comment: Comment): boolean => comment.status === 'open'

/** The Open Comments of a Project, in the order the Project lists them. */
export const openComments = (comments: readonly Comment[]): Comment[] => comments.filter(commentIsOpen)

/**
 * The Comments a duplicated Floor can take with it (#80 §13): the ones anchored to the Floor itself or
 * to one of the Placed Items being copied.
 *
 * A note about a shared Item Design is deliberately absent — the Item Design is shared and the note is
 * about it, so copying the placement copies the thing the note was already pointing at. A note about
 * the Project or one of its Design Options is left behind for the same reason: the duplicate is in the
 * same Project and, usually, the same Option, and a second copy of the note would only double the list.
 */
export function duplicateCommentIds(project: Project, floorId: EntityId, placedItemIds: readonly EntityId[]): EntityId[] {
  const copied = new Set<EntityId>(placedItemIds)
  return project.comments
    .filter((comment) => {
      const anchor = comment.anchor
      if (anchor.kind === 'floor' || anchor.kind === 'floor_point') return anchor.floorId === floorId
      if (anchor.kind === 'entity') return copied.has(anchor.entityId)
      return false
    })
    .map((comment) => comment.id)
}
