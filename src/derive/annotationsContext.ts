/**
 * Which Annotations belong to the view a person is looking at, and how they draw (#81 §1, §5).
 *
 * The three visibility rules of §5.3 split in two: the overlay, the focused row and the export
 * promise are Display state the canvas already holds, and they gate the whole group at once. What
 * this module answers is the two rules that are about the Project and the saved view — the Layer's
 * answer and the scope's — plus the style the record ends up drawing with once the Layer's graphics
 * fill in every field the Annotation left unset.
 */
import { effectiveLayerSetting } from './drawingLayers'
import { ANNOTATION_SCOPE_ALL, UNLAYERED_LAYER_KEY, compareAnnotationReferences, viewDesignOptionId } from '../domain'
import type { Annotation, AnnotationMarkerShape, AnnotationSize, EntityId, Project, SavedViewSettings } from '../domain'

/** The ink an Unlayered Annotation draws in when nothing else speaks (#81 §1: the view answers). */
export const ANNOTATION_UNLAYERED_INK = '#3f3f46'

/** Every style field resolved: what the glyph actually draws with. */
export interface EffectiveAnnotationStyle {
  readonly size: AnnotationSize
  readonly colour: string
  readonly weight: number
  readonly dashed: boolean
  /** Leader and Arrow only. */
  readonly arrowhead: boolean
  /** Revision Cloud only. */
  readonly cloudTint: boolean
  /** Reference Marker only. */
  readonly markerShape: AnnotationMarkerShape
}

/**
 * Whether an Annotation belongs to the view (#81 §5.3), the two Project-shaped rules:
 * its Drawing Layer (or Unlayered) is visible in the view, and its scope is All Options or the
 * view's active Option. The overlay and the focused row are the caller's Display state.
 */
export function annotationIsInContext(project: Project, view: SavedViewSettings, annotation: Annotation): boolean {
  const layerKey = annotation.layerId ?? UNLAYERED_LAYER_KEY
  if (!effectiveLayerSetting(project, view, layerKey).visible) return false
  return annotation.scope === ANNOTATION_SCOPE_ALL || annotation.scope === viewDesignOptionId(view)
}

/**
 * The three answers of §5.4 for one Annotation: a hidden Layer hides its Annotations, a
 * non-selectable Layer's Annotations cannot be picked, and a read-only Layer's can be selected and
 * inspected but not changed.
 */
export function annotationLayerAccess(project: Project, view: SavedViewSettings, annotation: Annotation): {
  readonly drawn: boolean
  readonly pickable: boolean
  readonly modifiable: boolean
} {
  const setting = effectiveLayerSetting(project, view, annotation.layerId ?? UNLAYERED_LAYER_KEY)
  return { drawn: setting.visible, pickable: setting.selectable, modifiable: setting.editable }
}

/**
 * The style an Annotation draws with (#81 §1): every field the record left unset takes the Layer's
 * answer — the colour the view shows the Layer in — and the bounded defaults fill the rest.
 */
export function effectiveAnnotationStyle(project: Project, view: SavedViewSettings, annotation: Annotation): EffectiveAnnotationStyle {
  const style = annotation.style ?? {}
  const layerKey = annotation.layerId ?? UNLAYERED_LAYER_KEY
  return {
    size: style.size ?? 'M',
    colour: style.colour ?? effectiveLayerSetting(project, view, layerKey).color ?? ANNOTATION_UNLAYERED_INK,
    weight: style.weight ?? 1,
    dashed: style.dashed ?? false,
    arrowhead: style.arrowhead ?? true,
    cloudTint: style.cloudTint ?? false,
    markerShape: style.markerShape ?? 'circle',
  }
}

/**
 * The Annotations the view draws (#81 §5.1: only its own, never a copy of another view's), in
 * reference order — the order the Notes panel's Annotations tab lists them in too (#81 §6).
 */
export function annotationsForView(
  project: Project,
  view: SavedViewSettings & { id: EntityId },
  annotations: readonly Annotation[] = project.annotations,
): Annotation[] {
  return annotations
    .filter((annotation) => annotation.viewId === view.id && annotationIsInContext(project, view, annotation))
    .sort((a, b) => compareAnnotationReferences(a.reference, b.reference))
}

/** The owning view of an Annotation, across Plan Views, Elevation Views and Item Details, or `null`. */
export function annotationOwner(project: Project, annotation: Annotation): { readonly kind: 'view' | 'itemDesign'; readonly id: EntityId } | null {
  if (project.views.some((view) => view.id === annotation.viewId)) return { kind: 'view', id: annotation.viewId }
  if (project.elevationViews !== undefined && project.elevationViews.some((view) => view.id === annotation.viewId)) {
    return { kind: 'view', id: annotation.viewId }
  }
  if (project.itemDesigns.some((design) => design.id === annotation.viewId)) return { kind: 'itemDesign', id: annotation.viewId }
  return null
}
