/**
 * The public face of the `package` element (#40 §1, #20 §2): the only module outside
 * this folder that may be imported. `package` is pure — no DOM, no React, no state
 * library, no randomness — and imports nothing but `domain` and `lib`.
 *
 * Today it holds the frozen legacy reader and the legacy → domain v1 converter. S2 adds
 * the `.buildbox` package codec beside them.
 */
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
export { convertLegacy, type LegacyConvertOptions } from './legacy/convert'
export {
  attachFloorPlan,
  floorPlanAsProject,
  type AttachFloorPlanOptions,
  type FloorPlanAttachmentResult,
  type FloorPlanProjectOptions,
} from './legacy/attach'
export type {
  IdRegeneration,
  IdRegenerationScope,
  LegacyAsset,
  LegacyConversion,
  LegacyConversionResult,
  LegacyConversionSource,
  LegacyDiscardedSketches,
  LegacyFloorPlanContent,
  LegacyFloorPlanConversion,
  LegacyProjectProposal,
} from './legacy/conversion'
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
