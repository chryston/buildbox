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
  defaultOpeningLabel,
  nextOpeningLabel,
  openingDependencies,
  openingHeight,
  openingNoun,
  openingSpan,
  openingsOfFloor,
  openingsOfWall,
  wallHasOpenings,
  fitProblem,
  type FitFailure,
  type OpeningDependency,
  type OpeningSpan,
} from './openings'
export {
  MIN_ROOM_OVERLAP_MM2,
  nextRoomName,
  roomArea,
  roomBounds,
  roomFaceCurve,
  roomFaceRelation,
  roomLabelAnchor,
  roomOutlineAfterSlide,
  roomOutlinePath,
  roomOutlineProblems,
  roomOverlapWith,
  roomOverlaps,
  roomPerimeter,
  roomSegmentOf,
  roomSegments,
  type RoomOverlap,
  type RoomSegment,
  type WallFaceOwner,
} from './rooms'
export {
  DEFAULT_WALL_HEIGHT_MM,
  DOMAIN_SCHEMA_VERSION,
  MIGRATORS,
  migrateProject,
  migrateV1toV2,
  migrateV2toV3,
  migrateV3toV4,
  migrateV4toV5,
  migrateV7toV8,
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
  Acknowledgement,
  CabinetItemDesign,
  DesignOption,
  DisplayUnit,
  EntityId,
  ExistingModel,
  Floor,
  FloorLimits,
  GenericItemDesign,
  HingeSide,
  ItemDesign,
  ItemFootprint,
  Opening,
  OpeningKind,
  OpeningSwing,
  PathItemFootprint,
  PathRoomOutline,
  PlanImage,
  PlanImageMediaType,
  PlanView,
  PlacedItem,
  Point2,
  PredecessorIds,
  PresetItemFootprint,
  PresetRoomOutline,
  Project,
  ProjectMeta,
  ProjectPreferences,
  ProposedModel,
  RenovationDisplay,
  Room,
  RoomOutline,
  RoomWallFaceRef,
  Wall,
  WallClassification,
  WallEnd,
  WallFaceSide,
  WallJustification,
  WallJunction,
  WallJunctionEnd,
  WallRefLine,
} from './project'
export type { PlanViewRange } from './planViewRange'
export { DEFAULT_PLAN_VIEW_RANGE, defaultPlanViewRange } from './planViewRange'
export {
  DEFAULT_DRAWING_LAYERS,
  DEFAULT_LAYER_NAMES,
  DEFAULT_LAYER_SETTING,
  NEW_LAYER_COLOR,
  RENOVATION_DISPLAYS,
  UNLAYERED_LAYER_KEY,
  designOptionsOf,
  drawingLayerById,
  drawingLayerByName,
  drawingLayersOf,
  entityLayerId,
  viewActiveLayerId,
  viewDesignOptionId,
  viewLayerOrder,
  viewLayerSettingOverride,
  viewRenovationDisplay,
  viewSnapToHidden,
} from './project'
export type {
  CreationSubtype,
  DrawingLayer,
  LayerSetting,
} from './project'
export { remapEntities, remapIds, type IdAllocator, type IdReplacement } from './remapIds'
export { ACKNOWLEDGEMENT_NOTE_MAX_LENGTH, warningKey } from './warnings'
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
export { validateProject, type ValidateProjectResult, type ValidationScope } from './validate'
