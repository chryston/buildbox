/**
 * The four Annotation Intents (#81 §2).
 *
 * An Annotation is drawing content with no Renovation State: it belongs to exactly one saved view,
 * sits on one Drawing Layer or Unlayered, and answers to a never-reused `A-nnn` reference taken from
 * the Project's own counter. The counter is the highest number ever handed out, so the next one is
 * always ahead of everything that came before it, undo included — the same promise the Comment
 * counter makes (#80 §1), for the same reason: a reference has been read out loud on the drawing.
 */
import type {
  Annotation,
  AnnotationEndpoint,
  AnnotationPosition,
  AnnotationStyle,
  AnnotationType,
  EntityId,
  Project,
} from '../../domain'
import {
  ANNOTATION_MARKER_SHAPES,
  ANNOTATION_PALETTE,
  ANNOTATION_SIZES,
  ANNOTATION_TEXT_MAX_LENGTH,
  ANNOTATION_TYPES,
  ANNOTATION_WEIGHTS,
  annotationPositionIsRect,
  annotationTypeHasEndpoint,
  annotationTypeHasTarget,
  designOptionsOf,
  drawingLayersOf,
  formatAnnotationReference,
  isAnnotationScopeAll,
  savedViewsOf,
} from '../../domain'
import type { AnnotationIntent, CreateAnnotation, Locator } from '../intents'
import { anchorResolves } from '../anchoredComments'
import type { Handler, IntentHandler } from './context'
import { refuse, spendIds } from './support'

const annotationPath = (annotationId: EntityId): string => `annotations[${annotationId}]`

/** The Annotation, or a rejection: every Intent about an existing Annotation names one. */
const requireAnnotation = (project: Project, annotationId: EntityId): Annotation => {
  const found = project.annotations.find((annotation) => annotation.id === annotationId)
  if (found === undefined) refuse('unknown-target', annotationPath(annotationId), `No Annotation answers to ${annotationId}.`)
  return found
}

/** The view namespace an Annotation may belong to: the saved views, plus the Item Designs (#81 §1). */
const viewExists = (project: Project, viewId: EntityId): boolean =>
  savedViewsOf(project).some((view) => view.id === viewId) || project.itemDesigns.some((design) => design.id === viewId)

/** The type, or a rejection: the payload's `type` is a string until this says otherwise. */
function requireType(type: string, path: string): AnnotationType {
  if (!(ANNOTATION_TYPES as readonly string[]).includes(type)) {
    refuse('invalid-annotation', path, `Expected one of ${ANNOTATION_TYPES.join(', ')} for the Annotation type.`)
  }
  return type as AnnotationType
}

/** Note text the panel can read: something in it, at most a few lines, no control characters. */
function requireText(text: string, path: string): string {
  if (text.trim() === '') refuse('invalid-annotation', path, 'An Annotation needs text — the mark on the drawing is the text.')
  if (text.length > ANNOTATION_TEXT_MAX_LENGTH) {
    refuse('invalid-annotation', path, `Annotation text is at most ${ANNOTATION_TEXT_MAX_LENGTH} characters; this one is ${text.length}.`)
  }
  // The rule is exactly the control characters that are not a line break or a tab (#81 §10): a stray
  // one would be drawn as a box on the printed plan.
  for (const character of text) {
    const code = character.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      refuse('invalid-annotation', path, 'Annotation text holds a control character that is not a line break or a tab.')
    }
    if (code === 127) refuse('invalid-annotation', path, 'Annotation text holds a control character that is not a line break or a tab.')
  }
  return text
}

/** The layer answer: a real Drawing Layer, or `null` for Unlayered — never a dangling ID (#81 §1). */
function requireLayer(project: Project, layerId: EntityId | null, path: string): EntityId | null {
  if (layerId === null) return null
  if (!drawingLayersOf(project).some((layer) => layer.id === layerId)) {
    refuse('unknown-target', path, `No Drawing Layer answers to ${layerId}.`)
  }
  return layerId
}

/** The scope answer: `all`, or one Design Option that exists (#81 §1). */
function requireScope(project: Project, scope: string, path: string): string {
  if (!isAnnotationScopeAll(scope) && !designOptionsOf(project).some((option) => option.id === scope)) {
    refuse('unknown-target', path, `No Design Option answers to ${scope}, and “all” is the other answer.`)
  }
  return scope
}

/** The position the type asks for: a rectangle for a Revision Cloud, one point for everything else. */
function requirePosition(type: AnnotationType, position: AnnotationPosition, path: string): AnnotationPosition {
  const rect = annotationPositionIsRect(position)
  if (type === 'revision_cloud' && !rect) refuse('invalid-annotation', path, 'A Revision Cloud is drawn over a rectangle; this gives one point.')
  if (type !== 'revision_cloud' && rect) refuse('invalid-annotation', path, 'Only a Revision Cloud takes a rectangle; this type takes one point.')
  const corners = rect ? [position.a, position.b] : [position]
  for (const point of corners) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) refuse('invalid-annotation', path, 'A position point has to be two finite numbers.')
  }
  return position
}

/** The endpoint a Leader or Arrow owes, judged as far as the Comment Anchors are judged (#80 §1). */
function requireEndpoint(project: Project, type: AnnotationType, endpoint: AnnotationEndpoint | undefined, path: string): void {
  if (!annotationTypeHasEndpoint(type)) {
    if (endpoint !== undefined) refuse('invalid-annotation', path, `A ${type} draws no line to an endpoint; only a Leader or Arrow does.`)
    return
  }
  if (endpoint === undefined) refuse('invalid-annotation', path, 'A Leader and an Arrow both end somewhere; this one says nowhere.')
  if ('anchor' in endpoint && !anchorResolves(project, endpoint.anchor)) {
    refuse('unknown-target', `${path}.anchor`, 'This endpoint is anchored to something that is not in the Project.')
  }
  if ('free' in endpoint && (!Number.isFinite(endpoint.free.x) || !Number.isFinite(endpoint.free.y))) {
    refuse('invalid-annotation', `${path}.free`, 'A free endpoint has to be two finite numbers.')
  }
}

/** The target a Reference Marker owes: a saved view, never its own (#81 §1). */
function requireTarget(project: Project, type: AnnotationType, viewId: EntityId, targetViewId: string | undefined, path: string): void {
  if (!annotationTypeHasTarget(type)) {
    if (targetViewId !== undefined) refuse('invalid-annotation', path, `A ${type} points at nothing; only a Reference Marker carries a target view.`)
    return
  }
  if (targetViewId === undefined) refuse('invalid-annotation', path, 'A Reference Marker navigates somewhere; this one says nowhere.')
  if (targetViewId === viewId) refuse('invalid-annotation', path, 'A Reference Marker aimed at its own view navigates in place.')
  if (!viewExists(project, targetViewId)) refuse('unknown-target', path, `No saved view answers to ${targetViewId}.`)
}

/** The bounded style: every field an override, every override inside its bounded set (#81 §1). */
function requireStyle(style: AnnotationStyle, path: string): AnnotationStyle {
  if (style.size !== undefined && !(ANNOTATION_SIZES as readonly string[]).includes(style.size)) {
    refuse('invalid-annotation', `${path}.size`, `Expected one of ${ANNOTATION_SIZES.join(', ')} for the size.`)
  }
  if (style.colour !== undefined && !(ANNOTATION_PALETTE as readonly string[]).includes(style.colour)) {
    refuse('invalid-annotation', `${path}.colour`, `A style colour is one of the five: ${ANNOTATION_PALETTE.join(', ')}.`)
  }
  if (style.weight !== undefined && !ANNOTATION_WEIGHTS.includes(style.weight)) {
    refuse('invalid-annotation', `${path}.weight`, 'A line weight is 1, 2 or 3.')
  }
  if (style.markerShape !== undefined && !(ANNOTATION_MARKER_SHAPES as readonly string[]).includes(style.markerShape)) {
    refuse('invalid-annotation', `${path}.markerShape`, 'A marker shape is a circle or a hexagon.')
  }
  for (const field of ['dashed', 'arrowhead', 'cloudTint'] as const) {
    if (style[field] !== undefined && typeof style[field] !== 'boolean') {
      refuse('invalid-annotation', `${path}.${field}`, `“${field}” is a flag: true or false.`)
    }
  }
  return style
}

/** A colour that can be used, or the sentence saying why it cannot — the `layer.add` rule (#71 §2). */
const LAYER_COLOR = /^#[0-9a-fA-F]{6}$/

/** The prompt's layer answer (#81 §4): an ordinary layer, a name nothing answers to, a real colour. */
function requireNewLayer(project: Project, createLayer: { name: string; color: string }, path: string): { name: string; color: string } {
  const name = createLayer.name.trim()
  if (name === '') refuse('invalid-annotation', `${path}.name`, 'A layer needs a name.')
  if (drawingLayersOf(project).some((layer) => layer.name.trim().toLowerCase() === name.toLowerCase())) {
    refuse('layer-blocked', `${path}.name`, `A layer called "${name}" already exists.`)
  }
  if (!LAYER_COLOR.test(createLayer.color)) refuse('invalid-annotation', `${path}.color`, 'A layer colour is six hex digits, like #5fb3ff.')
  return { name, color: createLayer.color }
}

const createAnnotation: Handler<'annotation.create'> = ({ project, draft, intent }) => {
  const { viewId, text, layerId, scope, endpoint, targetViewId, style, createLayer } = intent.payload as CreateAnnotation
  const [id, layerForNew] = spendIds(intent.ids, 2, 'annotation.create')
  const path = annotationPath(id)
  const type = requireType(intent.payload.type, `${path}.type`)
  if (!viewExists(project, viewId)) refuse('unknown-target', `${path}.viewId`, `No saved view answers to ${viewId}.`)
  requirePosition(type, intent.payload.position, `${path}.position`)
  requireEndpoint(project, type, endpoint, `${path}.endpoint`)
  requireTarget(project, type, viewId, targetViewId, `${path}.targetViewId`)
  requireScope(project, scope, `${path}.scope`)
  if (style !== undefined) requireStyle(style, `${path}.style`)
  let storedLayer = requireLayer(project, layerId, `${path}.layerId`)
  if (createLayer !== undefined) {
    const checked = requireNewLayer(project, createLayer, `${path}.createLayer`)
    if (draft.drawingLayers === undefined) draft.drawingLayers = []
    // The end of the array is the front of the drawing and the top of the list (#71 §1), and a view
    // with an order of its own holds a full order, so the new layer joins each at the same place —
    // exactly what `layer.add` does, in the same transaction as the Annotation it was made for (#81 §4).
    draft.drawingLayers.push({ id: layerForNew, name: checked.name, color: checked.color })
    for (const view of savedViewsOf(draft)) if (view.layerOrder !== undefined && view.layerOrder !== null) view.layerOrder.push(layerForNew)
    storedLayer = layerForNew
  }
  const annotation: Annotation = {
    id,
    // The counter is the highest number ever handed out, so this is a number nothing has worn
    // before and nothing will wear again — undo rewinds the Annotation, never the counter (#81 §1).
    reference: formatAnnotationReference(project.annotationReferenceCounter + 1),
    type,
    viewId,
    position: intent.payload.position,
    text: requireText(text, `${path}.text`),
    layerId: storedLayer,
    scope,
  }
  if (endpoint !== undefined) annotation.endpoint = endpoint
  if (targetViewId !== undefined) annotation.targetViewId = targetViewId
  if (style !== undefined) annotation.style = style
  draft.annotations.push(annotation)
  draft.annotationReferenceCounter = project.annotationReferenceCounter + 1
}

const editAnnotation: Handler<'annotation.edit'> = ({ project, draft, intent }) => {
  const { annotationId, text, layerId, scope, targetViewId, style, position, endpoint } = intent.payload
  const annotation = requireAnnotation(project, annotationId)
  const next = draft.annotations.find((each) => each.id === annotationId)!
  const path = annotationPath(annotationId)
  if (text !== undefined) next.text = requireText(text, `${path}.text`)
  if (layerId !== undefined) requireLayer(draft, layerId, `${path}.layerId`)
  if (scope !== undefined) requireScope(draft, scope, `${path}.scope`)
  if (targetViewId !== undefined) requireTarget(draft, annotation.type, annotation.viewId, targetViewId, `${path}.targetViewId`)
  if (position !== undefined) requirePosition(annotation.type, position, `${path}.position`)
  if (endpoint !== undefined) requireEndpoint(draft, annotation.type, endpoint, `${path}.endpoint`)
  if (layerId !== undefined) next.layerId = layerId
  if (scope !== undefined) next.scope = scope
  if (targetViewId !== undefined) next.targetViewId = targetViewId
  if (position !== undefined) next.position = position
  if (endpoint !== undefined) next.endpoint = endpoint
  if (style === null) {
    // `Reset to layer style` (#81 §7 criterion 21): every override goes, and the Annotation takes
    // the layer's graphics. An empty object would be the same answer stored the long way round.
    delete next.style
  } else if (style !== undefined) {
    next.style = requireStyle(style, `${path}.style`)
  }
}

const moveAnnotation: Handler<'annotation.move'> = ({ project, draft, intent }) => {
  const { annotationId, position, endpoint } = intent.payload
  const annotation = requireAnnotation(project, annotationId)
  const path = annotationPath(annotationId)
  requirePosition(annotation.type, position, `${path}.position`)
  if (endpoint !== undefined) requireEndpoint(draft, annotation.type, endpoint, `${path}.endpoint`)
  const next = draft.annotations.find((each) => each.id === annotationId)!
  next.position = position
  if (endpoint !== undefined) next.endpoint = endpoint
}

const deleteAnnotation: Handler<'annotation.delete'> = ({ project, draft, intent }) => {
  const { annotationId } = intent.payload
  requireAnnotation(project, annotationId)
  draft.annotations = draft.annotations.filter((annotation) => annotation.id !== annotationId)
}

/**
 * Where an Annotation lives, for the highlight #48 wants even on a rejection.
 *
 * An Annotation draws in exactly one saved view (#81 §5.1), so the Locator names that view and the
 * Floor that owns it; an Item Detail is addressed by its Item Design, which has no Floor of its own.
 */
const locateAnnotation = (project: Project, viewId: EntityId): Locator => {
  const view = savedViewsOf(project).find((candidate) => candidate.id === viewId)
  return {
    floorId: view?.floorId ?? null,
    viewId: view === undefined ? null : viewId,
    view: 'plan',
    itemDesignIds: view === undefined && project.itemDesigns.some((design) => design.id === viewId) ? [viewId] : [],
    placedItemIds: [],
  }
}

/** An Annotation that has gone missing still gets a best-effort Locator, because `locate` never throws. */
const locateExisting = (project: Project, annotationId: EntityId): Locator => {
  const viewId = project.annotations.find((annotation) => annotation.id === annotationId)?.viewId
  return viewId === undefined
    ? { floorId: null, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] }
    : locateAnnotation(project, viewId)
}

type AnnotationHandlers = { [T in AnnotationIntent['type']]: IntentHandler<T> }

export const ANNOTATION_HANDLERS: AnnotationHandlers = {
  'annotation.create': {
    run: createAnnotation,
    locate: (project, intent) => locateAnnotation(project, intent.payload.viewId),
  },
  'annotation.edit': { run: editAnnotation, locate: (project, intent) => locateExisting(project, intent.payload.annotationId) },
  'annotation.move': { run: moveAnnotation, locate: (project, intent) => locateExisting(project, intent.payload.annotationId) },
  'annotation.delete': { run: deleteAnnotation, locate: (project, intent) => locateExisting(project, intent.payload.annotationId) },
}
