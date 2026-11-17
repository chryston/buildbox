/**
 * The public face of the `package` element (#40 §1, #44 §1, #20 §2): the only module
 * outside this folder that may be imported. `package` is pure — no DOM, no React, no
 * state library, no randomness — and imports nothing but `domain` and `lib`.
 *
 * It holds the frozen legacy reader, the legacy → domain v1 converter, and the
 * `.buildbox` codec: `encodeProject` writes one deterministic Project Backup,
 * `stageImport` reads an untrusted one as far as a staged Project (#44 steps 1–6). The
 * codec is dark until #50 wires it into Download Backup and Restore Backup.
 */
export { PACKAGE_FORMAT_VERSION, PACKAGE_LIMITS } from './constants'
export { encodeProject, type AssetSource, type PackageMeta } from './encode'
export {
  stageImport,
  type StageImportContext,
  type StageImportResult,
  type StagedAsset,
  type StagedPackage,
} from './import'
export {
  parseManifest,
  type ManifestRead,
  type PackageManifest,
  type PackageManifestEntry,
} from './manifest'
export {
  PACKAGE_PROBLEM_CODES,
  type PackageProblem,
  type PackageProblemCode,
} from './problems'
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
