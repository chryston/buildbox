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
export { DEFAULT_WALL_THICKNESS_MM, LEGACY_DEFAULT_SETTINGS, newWallDefaults } from './defaults'
export {
  type AddAccessory,
  type AddDivider,
  type AddPlanObject,
  type AddPlanTemplate,
  type AddShelf,
  type AddUnit,
  type Applied,
  type AttachRoomFace,
  type CabinetIntent,
  type CalibratePlan,
  chainJunctionCount,
  type ClearPlan,
  type CreateOpening,
  type CreateRoom,
  type CreateWallChain,
  type DeleteBoard,
  type DeleteOpening,
  type DeleteWall,
  type DetachRoomFace,
  type DeleteDesignOptionReview,
  type DeleteWallReview,
  type DependencyReview,
  type DesignIntent,
  type DistributeEvenly,
  type DragWallBody,
  type DragWallEndpoint,
  type DragWallJunction,
  type FlipOpeningHinge,
  type FlipOpeningSwing,
  type ForkItemDesign,
  type Intent,
  INTENT_ID_ORDER,
  type IntentFields,
  intentIdCount,
  type IntentPayloads,
  type IntentType,
  type Locator,
  type MergeWalls,
  type MovePlanPlacement,
  type OffsetWall,
  type OpeningIntent,
  type PayloadOf,
  type PinNode,
  type PlaceHouseholdShelter,
  type PlacePlanDesign,
  type PlanIntent,
  type ProjectIntent,
  type Rejection,
  type RejectionCode,
  type RemoveAccessory,
  type RemovePlanObject,
  type RemovePlanTemplate,
  type RemoveUnit,
  type RenameProject,
  type RenameOpening,
  type RenameUnit,
  type RenameRoom,
  type RoomIntent,
  type RoomOutlineShape,
  roomSegmentCount,
  type RotatePlanPlacement,
  type SetCabinetMaterial,
  type SetDrawerConfig,
  type SetElementType,
  type SetItemDesignOrigin,
  type SetNodeLabel,
  type SetNodeSize,
  type SetOpeningStart,
  type SetOpeningWidth,
  type SetPlanImage,
  type SetProjectPreferences,
  type SetRoomOutline,
  type SetSplitRatio,
  type SetWallArc,
  type SetWallDirection,
  type SetWallLength,
  type SetWallThickness,
  SHELTER_ID_COUNT,
  type SplitWall,
  type UnpinNode,
  type UpdateCabinetSettings,
  type UpdateItemDesign,
  type WallDraft,
  type WallEndTarget,
  type WallIntent,
} from './intents'
export { INTENT_LABELS, intentLabel } from './labels'
export { CUSTOM_PLAN_ENTRY, PLAN_CATALOGUE, type PlanCatalogueEntry } from './planCatalogue'
export { INTENT_TYPES } from './registry'
