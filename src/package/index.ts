/**
 * The public face of the `package` element (#40 §1, #20 §2): the only module outside
 * this folder that may be imported. `package` is pure — no DOM, no React, no state
 * library, no randomness — and imports nothing but itself.
 *
 * Today it holds the frozen legacy reader only. S2 adds the `.buildbox` package codec
 * and the legacy → domain converter beside it.
 */
export { ROOT_PATH, type ValidationProblem } from './legacy/problems'
export {
  MAX_TREE_DEPTH,
  validateLegacyDesigns,
  validateLegacyFloorPlan,
  validateLegacyPersistedState,
} from './legacy/validate'
export { migrateLegacyState, upgradeLegacyDesign } from './legacy/migrate'
export {
  MAX_PERSIST_VERSION,
  WORKSPACE_FILE_VERSION,
  checkLegacyStore,
  readLegacyWorkspaceFile,
  type LegacyStoreCheck,
  type LegacyWorkspaceRead,
} from './legacy/read'
export type {
  LegacyAccessory,
  LegacyAccessoryType,
  LegacyAnnotation,
  LegacyAnnotationType,
  LegacyCabinetMaterialId,
  LegacyCabinetNode,
  LegacyCabinetSceneUnit,
  LegacyCabinetUnit,
  LegacyCustomTemplate,
  LegacyDesign,
  LegacyDesignV0,
  LegacyDivider,
  LegacyDrawerConfig,
  LegacyElementType,
  LegacyFloorPlanData,
  LegacyFloorPlanImage,
  LegacyFloorPlanObject,
  LegacyFloorPlanObjectType,
  LegacyGlobalSettings,
  LegacyGlobalSettingsV1,
  LegacyPersistedEnvelopeV0,
  LegacyPersistedEnvelopeV1,
  LegacyPersistedEnvelopeV2,
  LegacyPersistedEnvelopeV3,
  LegacyPersistedStateV0,
  LegacyPersistedStateV1,
  LegacyPersistedStateV2,
  LegacyPersistedStateV3,
  LegacySlideType,
  LegacySplitAxis,
  LegacyToeKick,
  LegacyUnit,
  LegacyUnitType,
  LegacyWorkspaceFile,
} from './legacy/types'
