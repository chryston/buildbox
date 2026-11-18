/**
 * The label table (#47): every Intent `label` in one file, so the banned-word scan (#66)
 * has a single place to read. Labels are short verb phrases — they show in the undo/redo
 * tooltip, where "Undo Change cabinet size" has to read as one sentence.
 */
import type { IntentType } from './intents'

/** The default label per Intent type, verbatim from the #47 catalogue. */
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
  'plan.addFromTemplate': 'Add item',
  'plan.updateObject': 'Edit item',
  'plan.removeObject': 'Remove item',
  'plan.addTemplate': 'Save custom shape',
  'plan.removeTemplate': 'Remove custom shape',
  'plan.setImage': 'Set plan image',
  'plan.calibrate': 'Calibrate scale',
  'plan.clear': 'Clear floor plan',
} as const satisfies Record<IntentType, string>

/**
 * `plan.updateObject` covers four different gestures, so it takes the label of the field
 * the user actually touched. `Edit item` is the fallback in `INTENT_LABELS`.
 */
export const PLAN_UPDATE_LABELS = {
  move: 'Move item',
  resize: 'Resize item',
  rotate: 'Rotate item',
  edit: 'Edit item',
} as const

/** `plan.setImage` with `image: null` is the removal the toolbar offers. */
export const PLAN_REMOVE_IMAGE_LABEL = 'Remove plan image'
