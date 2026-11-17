/**
 * The public face of the `domain` module (#20 §2, ADR 0003): the only way in from
 * outside this folder. `domain` is pure — no DOM, no React, no state library — and may
 * import only `geometry` and `lib`.
 *
 * It holds the domain schema v1 types, the strict validator, the version and its
 * migrator chain, the cabinet Item Design payload vocabulary, the Library's Project
 * Summary (#45) and unit conversion. It
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
  DOMAIN_SCHEMA_VERSION,
  MIGRATORS,
  migrateProject,
  runMigrationChain,
  type Migrator,
  type MigrateError,
  type MigrateResult,
} from './migrate'
export type {
  CabinetItemDesign,
  DisplayUnit,
  EntityId,
  ExistingModel,
  Floor,
  GenericItemDesign,
  ItemDesign,
  ItemFootprint,
  PlanImage,
  PlanImageMediaType,
  PlacedItem,
  Point2,
  Project,
  ProjectMeta,
  ProjectPreferences,
  RectangleFootprint,
} from './project'
export {
  MAX_OUTLINE_RECTS,
  referencedAssetHashes,
  summarizeProject,
  type OutlineBounds,
  type OutlineRect,
  type ProjectOutline,
  type ProjectSummary,
} from './summarizeProject'
export { formatDisplay, fromMm, toMm } from './units/unitConversion'
export { validateProject, type ValidateProjectResult } from './validate'
