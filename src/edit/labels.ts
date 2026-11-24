/**
 * The label table (#47): every Intent `label` in one file, so the banned-word scan (#66)
 * has a single place to read. Labels are short verb phrases — they show in the undo/redo
 * tooltip, where "Undo Change cabinet size" has to read as one sentence.
 */

import type { IntentType, S7IntentType } from './intents'
import { RENOVATION_EDIT_INTENT_LABELS } from './handlers/renovationEdits'
import { CORRECTION_INTENT_LABELS } from './handlers/correctionHandlers'
import { RENOVATION_INTENT_LABELS } from './handlers/renovationHandlers'
import { LAYER_INTENT_LABELS } from './handlers/layerHandlers'
import { PASTE_INTENT_LABELS } from './handlers/pasteHandlers'
import { ELEVATION_INTENT_LABELS } from './handlers/elevationHandlers'

/** The default label per S7 Intent type, verbatim from the #47 catalogue. */
export const INTENT_LABELS = {
  'project.rename': 'Rename Project',
  'project.setPreferences': 'Change display settings',
  'cabinet.updateSettings': 'Change cabinet size',
  'cabinet.setMaterial': 'Change material',
  'cabinet.addUnit': 'Add unit',
  'cabinet.removeUnit': 'Remove unit',
  'cabinet.renameUnit': 'Rename unit',
  'cabinet.addShelf': 'Add shelf',
  'cabinet.addDivider': 'Add divider',
  'cabinet.deleteBoard': 'Delete board',
  'cabinet.setNodeSize': 'Set size',
  'cabinet.pinNode': 'Lock size',
  'cabinet.unpinNode': 'Unlock size',
  'cabinet.setNodeLabel': 'Rename space',
  'cabinet.distributeEvenly': 'Distribute evenly',
  'cabinet.setElementType': 'Change space type',
  'cabinet.setDrawerConfig': 'Change drawer',
  'cabinet.setSplitRatio': 'Resize section',
  'cabinet.addAccessory': 'Add accessory',
  'cabinet.removeAccessory': 'Remove accessory',
  'plan.addObject': 'Add item',
  'plan.placeDesign': 'Add item',
  'plan.movePlacement': 'Move item',
  'plan.setPlacementVerticalExtent': 'Change item vertical extent',
  'plan.rotatePlacement': 'Rotate item',
  'plan.removeObject': 'Remove item',
  'plan.addTemplate': 'Save custom shape',
  'plan.removeTemplate': 'Remove custom shape',
  'plan.setImage': 'Set plan image',
  'plan.removeImage': 'Remove plan image',
  'plan.calibrate': 'Calibrate scale',
  'plan.clear': 'Clear floor plan',
  'plan.copyToFloor': 'Copy to floor',
  'plan.moveToFloor': 'Move to floor',
  'wall.createChain': 'Draw wall',
  'wall.dragJunction': 'Move wall junction',
  'wall.dragEndpoint': 'Move wall end',
  'wall.dragBody': 'Move wall',
  'wall.setLength': 'Change wall length',
  'wall.setDirection': 'Change wall direction',
  'wall.setArc': 'Change wall curve',
  'wall.setThickness': 'Change wall thickness',
  'wall.setVerticalExtent': 'Change wall vertical extent',
  'wall.offset': 'Offset wall',
  'wall.split': 'Split wall',
  'wall.merge': 'Merge walls',
  'wall.delete': 'Delete wall',
  'room.create': 'Draw room',
  'room.rename': 'Rename room',
  'room.setOutline': 'Change room shape',
  'room.attachFace': 'Attach to wall face',
  'room.detachFace': 'Detach from wall face',
  'room.placeShelter': 'Place household shelter',
  'opening.create': 'Place opening',
  'opening.setStart': 'Move opening',
  'opening.setWidth': 'Resize opening',
  'opening.setVerticalExtent': 'Change opening vertical extent',
  'opening.flipHinge': 'Flip hinge',
  'opening.flipSwing': 'Flip opening side',
  'opening.rename': 'Rename opening',
  'opening.delete': 'Delete opening',
  'beam.create': 'Draw beam',
  'beam.dragEndpoint': 'Move beam end',
  'beam.dragBody': 'Move beam',
  'beam.setLength': 'Change beam length',
  'beam.setWidth': 'Change beam width',
  'beam.setJustification': 'Change beam justification',
  'beam.rename': 'Rename beam',
  'beam.setVerticalExtent': 'Change beam vertical extent',
  'beam.delete': 'Delete beam',
  'service.create': 'Draw service',
  'service.dragEndpoint': 'Move service end',
  'service.dragBody': 'Move service',
  'service.setLength': 'Change service length',
  'service.setKind': 'Change service kind',
  'service.setSection': 'Change service section',
  'service.setOutsideDiameter': 'Change service diameter',
  'service.setWidth': 'Change service width',
  'service.setDepth': 'Change service depth',
  'service.setVerticalExtent': 'Change service vertical extent',
  'service.rename': 'Rename service',
  'service.delete': 'Delete service',
  'skirting.create': 'Add skirting',
  'skirting.dragEndpoint': 'Move skirting end',
  'skirting.setRange': 'Change skirting range',
  'skirting.flipSide': 'Flip skirting side',
  'skirting.duplicateOtherSide': 'Duplicate skirting to other side',
  'skirting.setBottom': 'Change skirting bottom',
  'skirting.setHeight': 'Change skirting height',
  'skirting.setThickness': 'Change skirting thickness',
  'skirting.setVerticalExtent': 'Change skirting vertical extent',
  'skirting.rename': 'Rename skirting',
  'skirting.delete': 'Delete skirting',
  'design.update': 'Edit item design',
  'design.setFootprint': 'Edit item shape',
  'design.setOrigin': 'Move item origin',
  'design.setHeight': 'Change design height',
  'design.setClearanceEnvelope': 'Change clearance envelope',
  'design.removeClearanceEnvelope': 'Remove clearance envelope',
  'design.fork': 'Fork design',
  'floor.create': 'Add floor',
  'floor.rename': 'Rename floor',
  'floor.reorder': 'Reorder floors',
  'floor.setLimits': 'Set floor limits',
  'floor.setDefaultWallHeight': 'Set default wall height',
  'floor.delete': 'Delete floor',
  'floor.duplicate': 'Duplicate floor',
  'view.create': 'Add view',
  'view.rename': 'Rename view',
  'view.delete': 'Delete view',
  'view.setShowPlanImage': 'Show plan image',
  'view.setPlanViewRange': 'Change Plan View Range',
  'warning.acknowledge': 'Acknowledge warning',
  'warning.editNote': 'Edit warning note',
} as const satisfies Record<S7IntentType, string>

/**
 * The default label of any Intent the catalogue can answer (#69 §2).
 *
 * The renovation half sits beside the handlers it names, in the module that owns both, so a label
 * and the Transaction it describes cannot drift apart. Reaching this function with a type the
 * catalogue does not hold answers with the type itself — an Intent nothing registered can be, so
 * the answer is never shown.
 */
const RENOVATION_LABELS: Partial<Record<IntentType, string>> = {
  ...RENOVATION_INTENT_LABELS,
  ...RENOVATION_EDIT_INTENT_LABELS,
  ...CORRECTION_INTENT_LABELS,
  ...LAYER_INTENT_LABELS,
  ...PASTE_INTENT_LABELS,
  ...ELEVATION_INTENT_LABELS,
}

export function intentLabel(type: IntentType): string {
  const known = INTENT_LABELS as Partial<Record<IntentType, string>>
  const s7 = known[type]
  if (s7 !== undefined) return s7
  return RENOVATION_LABELS[type] ?? type
}
