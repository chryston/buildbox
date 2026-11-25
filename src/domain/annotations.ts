/**
 * The Annotation record, its bounded styles and its reference (#81 §1).
 *
 * An Annotation is authored presentation content — a Text, Leader, Arrow, Revision Cloud or
 * Reference Marker — placed in exactly one saved view and drawn over the model there. It is not a
 * Building Element, Room, Comment or Warning: it carries no Renovation State, appears in no table,
 * and is demolished by no Design Option. Only its owning view, its Drawing Layer and its scope say
 * where it shows.
 *
 * The endpoint of a Leader or Arrow reuses the Comment Anchor types (#80 §2) rather than inventing a
 * second anchor model: an anchored endpoint names an entity or a registered feature, so it follows
 * compatible target movement while the label or tail stays where it was composed.
 */
import type { EntityAnchor, FeatureAnchor } from './comments'
import type { EntityId, Point2, Project } from './project'

/** The five kinds of Annotation (#81 §1). */
export type AnnotationType = 'text' | 'leader' | 'arrow' | 'revision_cloud' | 'reference_marker'

/** Every type, in the order the tool strip and the panel filter list them. */
export const ANNOTATION_TYPES: readonly AnnotationType[] = Object.freeze([
  'text',
  'leader',
  'arrow',
  'revision_cloud',
  'reference_marker',
])

/** The three bounded text sizes (#81 §1). No font, no arbitrary point size — these are the set. */
export type AnnotationSize = 'S' | 'M' | 'L'

export const ANNOTATION_SIZES: readonly AnnotationSize[] = Object.freeze(['S', 'M', 'L'])

/** The three bounded line weights (#81 §1). */
export const ANNOTATION_WEIGHTS: readonly number[] = Object.freeze([1, 2, 3])

/** The two Reference Marker shapes (#81 §1). */
export type AnnotationMarkerShape = 'circle' | 'hexagon'

export const ANNOTATION_MARKER_SHAPES: readonly AnnotationMarkerShape[] = Object.freeze(['circle', 'hexagon'])

/**
 * The five-colour palette (#81 §1). These are Annotation content data, not UI tokens: a stored
 * colour outside this set is refused by the validator, never snapped to the nearest one.
 */
export const ANNOTATION_PALETTE: readonly string[] = Object.freeze([
  '#ffb547',
  '#ff6b6b',
  '#6eb7ff',
  '#74d99f',
  '#d9a6ff',
])

/** The one shape a reference ever takes: `A-` and at least three digits. */
export const ANNOTATION_REFERENCE_PATTERN = /^A-\d{3,}$/

/** The number of digits a reference is padded to, so `A-001` rather than `A-1`. */
export const ANNOTATION_REFERENCE_MIN_DIGITS = 3

/** The plain-text ceiling. A few lines of note, never a document and never rich text (#81 §1). */
export const ANNOTATION_TEXT_MAX_LENGTH = 500

/** The cloud a plain click leaves behind, in view millimetres (#81 §3.8). */
export const DEFAULT_REVISION_CLOUD_WIDTH_MM = 1200
export const DEFAULT_REVISION_CLOUD_HEIGHT_MM = 600

/** The layer each type asks for first (#81 §4.1): `Notes`, except the cloud's `Revisions`. */
export const ANNOTATION_DEFAULT_LAYER_NAME = 'Notes'
export const REVISION_CLOUD_DEFAULT_LAYER_NAME = 'Revisions'

/** The colour the prompt-created layer carries (#81 §4.3): the prototype's amber and red. */
export const NOTES_LAYER_DEFAULT_COLOR = '#ffb547'
export const REVISIONS_LAYER_DEFAULT_COLOR = '#ff6b6b'

/** The two corners of a Revision Cloud's rectangle, in the owning view's coordinates (#81 §1). */
export interface AnnotationRect {
  a: Point2
  b: Point2
}

/**
 * Where an Annotation sits in its owning view (#81 §1), in that view's own millimetres:
 * floor-local plan coordinates for a Plan View, along-line and floor-relative elevation for an
 * Elevation View, Item Design local coordinates for an Item Detail View. A point is the text or
 * label point, the tail point of a Leader or Arrow, or the marker centre; a rect is the cloud.
 */
export type AnnotationPosition = Point2 | AnnotationRect

/** Whether a position value is the cloud's two corners rather than one point. */
export const annotationPositionIsRect = (position: AnnotationPosition): position is AnnotationRect =>
  'a' in position && 'b' in position

/**
 * The Leader or Arrow endpoint (#81 §1): anchored to an entity or a registered feature — reusing
 * the Comment Anchor types so one movement rule serves both — or free at a point that never moves.
 */
export type AnnotationEndpoint = { anchor: EntityAnchor | FeatureAnchor } | { free: Point2 }

/** Whether an endpoint follows its target or stands where it was placed. */
export const endpointIsAnchored = (endpoint: AnnotationEndpoint): endpoint is { anchor: EntityAnchor | FeatureAnchor } =>
  'anchor' in endpoint

/**
 * The optional style overrides (#81 §1). Every field is an override: an unset field takes the
 * owning view's effective layer graphics, which is why `Reset to layer style` clears them all.
 */
export interface AnnotationStyle {
  size?: AnnotationSize
  colour?: string
  weight?: number
  dashed?: boolean
  /** Leader and Arrow only; absent for every other type. */
  arrowhead?: boolean
  /** Revision Cloud only. */
  cloudTint?: boolean
  /** Reference Marker only. */
  markerShape?: AnnotationMarkerShape
}

/** The scope an Annotation stores: `ANNOTATION_SCOPE_ALL` or one Design Option ID (#81 §1). */
export type AnnotationScope = string

/** The scope that says "every Design Option" — the same word the Comment scope uses (#80 §1). */
export const ANNOTATION_SCOPE_ALL = 'all'

/** Whether a scope value is the All Options answer rather than a Design Option ID. */
export const isAnnotationScopeAll = (scope: AnnotationScope): boolean => scope === ANNOTATION_SCOPE_ALL

/**
 * One Annotation (#81 §1).
 *
 * `endpoint` exists exactly for a Leader or Arrow, and `targetViewId` exactly for a Reference
 * Marker; both rules are validator-enforced rather than type-enforced because the discriminator
 * that decides them is `type`, one field away. `layerId` is a Drawing Layer ID or `null` for
 * Unlayered — the absence is written down, never left as a missing field.
 */
export interface Annotation {
  /** Immutable and Project-unique, pre-allocated in the Intent (#42 §3). */
  id: EntityId
  /** Immutable `A-nnn`, allocated from the Project's counter and never reused (#81 §1). */
  reference: string
  type: AnnotationType
  /** The one owning saved view: a Plan View, Elevation View or Item Detail (#81 §1). */
  viewId: EntityId
  position: AnnotationPosition
  /** Present exactly for a Leader or Arrow. */
  endpoint?: AnnotationEndpoint
  /** Plain text; for a Reference Marker this is the user label (#81 §1). */
  text: string
  /** Reference Marker only: another saved view, never the owning one (#81 §1). */
  targetViewId?: EntityId
  /** A Drawing Layer ID, or `null` for Unlayered — always written, never absent. */
  layerId: EntityId | null
  /** `ANNOTATION_SCOPE_ALL` or one Design Option ID; always written (#81 §1). */
  scope: AnnotationScope
  /** Optional overrides; an absent field takes the layer's graphics (#81 §1). */
  style?: AnnotationStyle
}

/** The digits of a reference as a number, or `null` for text that is not one. */
export function annotationReferenceNumber(reference: string): number | null {
  if (!ANNOTATION_REFERENCE_PATTERN.test(reference)) return null
  return Number(reference.slice(2))
}

/** The reference for a number: `A-001`, `A-999`, `A-1000`. */
export function formatAnnotationReference(value: number): string {
  return `A-${String(value).padStart(ANNOTATION_REFERENCE_MIN_DIGITS, '0')}`
}

/**
 * Reference order, numerically: `A-999` before `A-1000`. A text that is not a reference sorts last
 * and after each other such text, so a broken record cannot shuffle the well-formed ones.
 */
export function compareAnnotationReferences(a: string, b: string): number {
  const left = annotationReferenceNumber(a)
  const right = annotationReferenceNumber(b)
  if (left === null && right === null) return a < b ? -1 : a > b ? 1 : 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

/** The layer name this type asks for when the Project has no Annotations yet (#81 §4.1). */
export const annotationDefaultLayerName = (type: AnnotationType): string =>
  type === 'revision_cloud' ? REVISION_CLOUD_DEFAULT_LAYER_NAME : ANNOTATION_DEFAULT_LAYER_NAME

/** The colour the prompt creates that layer with (#81 §4.3). */
export const annotationDefaultLayerColor = (type: AnnotationType): string =>
  type === 'revision_cloud' ? REVISIONS_LAYER_DEFAULT_COLOR : NOTES_LAYER_DEFAULT_COLOR

/** Whether this type carries an endpoint at all (#81 §1). */
export const annotationTypeHasEndpoint = (type: AnnotationType): boolean =>
  type === 'leader' || type === 'arrow'

/** Whether this type names a target view (#81 §1). */
export const annotationTypeHasTarget = (type: AnnotationType): boolean => type === 'reference_marker'

/**
 * The Annotations a duplicated Floor can take with it (#81 §9): the ones owned by the Floor's own
 * saved views. An Item Detail–owned Annotation is absent — the Item Design is shared across Floors,
 * and a copy of the note about the same design would only double the list.
 */
export function duplicateAnnotationIds(project: Project, floorViewIds: readonly EntityId[]): EntityId[] {
  const owned = new Set<EntityId>(floorViewIds)
  return project.annotations.filter((annotation) => owned.has(annotation.viewId)).map((annotation) => annotation.id)
}
