/**
 * The label table (#47): every Intent `label` in one file, so the banned-word scan (#66)
 * has a single place to read. Labels are short verb phrases — they show in the undo/redo
 * tooltip, where "Undo Change cabinet size" has to read as one sentence.
 */
import { FF_RENOVATION } from '../lib'
import type { IntentType, S7IntentType } from './intents'
import { RENOVATION_EDIT_INTENT_LABELS } from './handlers/renovationEdits'
import { RENOVATION_INTENT_LABELS } from './handlers/renovationHandlers'

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
  'opening.flipHinge': 'Flip hinge',
  'opening.flipSwing': 'Flip opening side',
  'opening.rename': 'Rename opening',
  'opening.delete': 'Delete opening',
  'design.update': 'Edit item design',
  'design.setFootprint': 'Edit item shape',
  'design.setOrigin': 'Move item origin',
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
  'warning.acknowledge': 'Acknowledge warning',
  'warning.editNote': 'Edit warning note',
} as const satisfies Record<S7IntentType, string>

/**
 * The default label of any Intent the catalogue can answer (#69 §2).
 *
 * The renovation half is read under the same flag as its handlers: with the flag off the guard
 * folds away, the import of `./handlers/renovationHandlers` becomes dead, and a released bundle
 * carries neither those labels nor the code that would return them. Reaching this function with
 * a renovation type in a flag-off build answers with the type itself — an Intent nothing
 * registered can be, so the answer is never shown.
 */
const RENOVATION_LABELS: Partial<Record<IntentType, string>> = FF_RENOVATION
  ? { ...RENOVATION_INTENT_LABELS, ...RENOVATION_EDIT_INTENT_LABELS }
  : {}

export function intentLabel(type: IntentType): string {
  const known = INTENT_LABELS as Partial<Record<IntentType, string>>
  const s7 = known[type]
  if (s7 !== undefined) return s7
  return RENOVATION_LABELS[type] ?? type
}
