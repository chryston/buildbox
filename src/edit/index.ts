/**
 * The public face of the `edit` module (#20 §2, #47): the only way in from outside this
 * folder. `edit` is pure — no DOM, no React, no state library — and may import only
 * `domain`, `geometry`, `cabinet`, `derive` and `lib`.
 *
 * Everything a user can change in a Project is an Intent: data with a type, a label, a
 * payload and pre-allocated IDs. `applyIntent` turns one into the next Project plus the
 * patches that got there; `previewIntent` says what it would touch and whether it would be
 * refused. This module holds no state, touches no DOM and reads no clock or random source
 * of its own (#42 §3) — it runs in Node, in a worker, or in a test with nothing around it.
 *
 * It is dark until #48 puts history in front of it and #49 builds Intents from UI events.
 */
export { applyIntent, applyPatches, previewIntent } from './apply'
export { createProject, type CreateProjectArgs } from './create'
export { LEGACY_DEFAULT_SETTINGS } from './defaults'
export {
  INTENT_ID_ORDER,
  intentIdCount,
  type AddAccessory,
  type AddDivider,
  type AddPlanFromTemplate,
  type AddPlanObject,
  type AddPlanTemplate,
  type AddShelf,
  type AddUnit,
  type Applied,
  type CabinetIntent,
  type CalibratePlan,
  type ClearPlan,
  type DeleteBoard,
  type DistributeEvenly,
  type Intent,
  type IntentFields,
  type IntentPayloads,
  type IntentType,
  type Locator,
  type PayloadOf,
  type PinNode,
  type PlanIntent,
  type ProjectIntent,
  type RemoveAccessory,
  type RemovePlanObject,
  type RemovePlanTemplate,
  type RemoveUnit,
  type RenameProject,
  type RenameUnit,
  type Rejection,
  type RejectionCode,
  type SetCabinetMaterial,
  type SetDrawerConfig,
  type SetElementType,
  type SetNodeLabel,
  type SetNodeSize,
  type SetPlanImage,
  type SetSplitRatio,
  type UnpinNode,
  type UpdateCabinetSettings,
  type UpdatePlanObject,
} from './intents'
export { INTENT_LABELS, PLAN_REMOVE_IMAGE_LABEL, PLAN_UPDATE_LABELS } from './labels'
export { CUSTOM_PLAN_ENTRY, PLAN_CATALOGUE, type PlanCatalogueEntry } from './planCatalogue'
export { INTENT_TYPES } from './registry'
