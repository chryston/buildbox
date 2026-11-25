/**
 * The words the Annotation surface speaks (#81 §3, §4, §7).
 *
 * They sit apart from `STRINGS` the way the Notes words do (#80): one surface — the five tool rows,
 * the placement hint, the first-Annotation prompt, the editor and the panel's `Annotations` tab —
 * one table. The banned-word scan reads this file the same way it reads the main table.
 *
 * The five tool labels carry their glyph as the first character, as the prototype's tool group drew
 * them: the strip is words, and the glyph is what makes the group scannable at a glance.
 */
import type { AnnotationType } from '../../domain'

/** The type's word, as the hint pill, the row and the editor eyebrow all say it (#81 §3.1). */
export const ANNOTATION_TYPE_LABELS = {
  text: 'Text',
  leader: 'Leader',
  arrow: 'Arrow',
  revision_cloud: 'Revision Cloud',
  reference_marker: 'Reference Marker',
} as const satisfies Record<AnnotationType, string>

export const ANNOTATION_STRINGS = {
  // The five rows, in table order after `✎ Comment` (#81 §3.1).
  toolText: 'T Text',
  toolLeader: '↖T Leader',
  toolArrow: '↗ Arrow',
  toolCloud: '☁ Revision Cloud',
  toolMarker: '◎ Reference Marker',
  // The group's reason while the overlay is off: visible, disabled, explained (#81 §3.2).
  overlayOffTooltip: 'Turn on the Notes overlay to draw Annotations',
  // The placement pill (#81 §3.5). The second sentence belongs to the two tools that anchor —
  // a Text has nothing to anchor to, and saying otherwise would be a lie about the click.
  toolHint: (type: AnnotationType): string =>
    `Click to place ${ANNOTATION_TYPE_LABELS[type]}.`,
  toolAnchorHint: (type: AnnotationType): string =>
    `Click to place ${ANNOTATION_TYPE_LABELS[type]}. Click an entity to anchor it.`,
  cancel: 'Cancel',
  // The text a placement starts with (#81 §3.10): the editor opens with it selected, so the first
  // keystroke replaces it. An Annotation is its text, and the domain refuses an empty one, so the
  // tool hands over a placeholder the way `✎ Comment` titles a fresh note `New comment`.
  defaultText: 'New annotation',
  // The first-Annotation layer prompt (#81 §4.2), with the layer name it speaks of.
  promptTitle: 'First Annotation on this Project',
  promptBody: (layerName: string): string =>
    `No “${layerName}” layer exists. BuildBox creates an ordinary layer you can rename or delete, unless you choose another.`,
  promptCreate: (layerName: string): string => `Create layer “${layerName}”`,
  promptUseExisting: (name: string): string => `Use existing “${name}”`,
  promptUnlayered: 'Unlayered',
  promptPlace: 'Place Annotation',
  // The refusal the layer rule writes when the target layer cannot be changed here (#81 §3.4).
  readOnlyRefusal: (name: string): string => `${name} is read-only in this view`,
  // The Notes panel's tab and rows (#81 §6).
  annotationsTab: 'Annotations',
  // The left inspector for a selected Annotation (#81 §3.3a): its owner is the drawing content.
  ownerDrawingContent: 'View drawing content',
  anyAnnotation: 'Any annotation',
  anyLayer: 'Any layer',
  unlayered: 'Unlayered',
  unlayeredSuffix: ' · Unlayered',
  anchoredSuffix: (label: string): string => ` · anchored ${label}`,
  // The editor (#81 §7).
  editorEyebrow: (reference: string, type: AnnotationType): string =>
    `Annotation ${reference} · ${ANNOTATION_TYPE_LABELS[type]}`,
  fieldView: 'View',
  fieldLayer: 'Layer',
  fieldScope: 'Scope',
  scopeAll: 'All Options',
  scopeActive: (name: string): string => `${name} (active)`,
  fieldTarget: 'Target view',
  goToView: 'Go to view',
  fieldSize: 'Size',
  fieldColor: 'Color',
  fieldLine: 'Line',
  dashedChip: 'dashed',
  fieldArrowhead: 'Arrowhead',
  onChip: 'on',
  fieldFill: 'Fill',
  tintChip: 'tint',
  fieldShape: 'Shape',
  shapeCircle: 'circle',
  shapeHexagon: 'hexagon',
  resetStyle: 'Reset to layer style',
  styleHelper: 'Bounded styles only — no fonts, rich text, freehand, or attachments.',
  delete: 'Delete',
  layerSuffix: (name: string): string => ` · ${name} layer`,
} as const
