/**
 * The public face of the `domain` module (#20 §2, ADR 0003): the only way in from
 * outside this folder. `domain` is pure — no DOM, no React, no state library — and may
 * import only `geometry` and `lib`.
 *
 * It holds the domain schema v3 types, the strict validator, the version and its
 * migrator chain, the Item Footprint questions every consumer asks of one (#58), the
 * cabinet Item Design payload vocabulary, the Library's Project Summary (#45), the fresh
 * identity an imported copy takes (#50) and unit conversion. It
 * never creates an ID or reads the clock (#42 §3): IDs and time arrive as data.
 * `src/domain/testing.ts` is the second entry point, for test files only.
 */
export { MAX_TREE_DEPTH } from './cabinetPayload'
export type {
  Accessory,
  AccessoryType,
  CabinetMaterialId,
  CabinetNode,
  Divider,
  DrawerConfig,
  ElementType,
  GlobalSettings,
  SlideType,
  SplitAxis,
  ToeKick,
  Unit,
} from './cabinetPayload'
export { designFootprintSize, designHeight, designOrigin } from './itemDesign'
export {
  footprintArea,
  footprintAsPath,
  footprintBounds,
  footprintCentre,
  footprintIsValid,
  footprintMovedTo,
  footprintPath,
  footprintPerimeter,
  footprintProblems,
  footprintSize,
  rectangleFootprint,
} from './footprint'
export { PRESET_NAMES, convertWarningFor, lostParametersOf } from './convert'
export {
  FLOOR_DEPENDENCY_KINDS,
  floorHasDependencies,
  summarizeFloorDependencies,
  type FloorDependency,
  type FloorDependencyKind,
} from './floorDependencies'
export { defaultPlanView, floorNameTaken, nameKey, nextFloorName, planViewNameTaken } from './floorNames'
export {
  DOMAIN_SCHEMA_VERSION,
  MIGRATORS,
  migrateProject,
  migrateV1toV2,
  migrateV2toV3,
  runMigrationChain,
  type Migrator,
  type MigrateError,
  type MigrateResult,
} from './migrate'
export {
  FixedPreset,
  UnknownPreset,
  defaultPresetFor,
  getPresetEntry,
  getPresetPack,
  listPresetEntries,
  overridableCopyOf,
  presetDisplayName,
  type DefaultableKind,
  type DefaultPresetOf,
  type PresetOf,
} from './presets'
export type {
  DoorPreset,
  DoorValues,
  HeightPreset,
  HeightValues,
  PresetAlternative,
  PresetConfidence,
  PresetEntry,
  PresetKind,
  PresetPack,
  PresetValueMap,
  PresetValues,
  ShelterPreset,
  ShelterValues,
  SourceKey,
  SourceRef,
  ValueConfidence,
  WallPreset,
  WallValues,
  WindowPreset,
  WindowValues,
} from './presets'
export type {
  CabinetItemDesign,
  DisplayUnit,
  EntityId,
  ExistingModel,
  Floor,
  FloorLimits,
  GenericItemDesign,
  ItemDesign,
  ItemFootprint,
  PathItemFootprint,
  PlanImage,
  PlanImageMediaType,
  PlanView,
  PlacedItem,
  Point2,
  PresetItemFootprint,
  Project,
  ProjectMeta,
  ProjectPreferences,
} from './project'
export { remapIds, type IdAllocator } from './remapIds'
export {
  MAX_OUTLINE_RECTS,
  referencedAssetHashes,
  summarizeProject,
  type OutlineBounds,
  type OutlineRect,
  type ProjectOutline,
  type ProjectSummary,
} from './summarizeProject'
export { formatDisplay, formatLength, fromMm, toMm } from './units/unitConversion'
export { formatGeometryProblem } from './formatGeometryProblem'
export type { DisplayFormat } from './formatGeometryProblem'
export { validateProject, type ValidateProjectResult } from './validate'
