/**
 * The pure read-only derivations that turn domain data into the shapes the rest of the app
 * consumes (#43, #20 §13.4, #57, #60).
 *
 * Three families live here. `cabinetSceneUnits` is the inverse projection back into the
 * cabinet scene vocabulary; `placement` is where a Placed Item actually sits — the one
 * pinned reading of Item Origin, rotation and Item Footprint, which `ui` can only reach
 * through this module because it may not import `geometry` (#20 §2); and `effective` is the
 * effective model of one Floor or one Item Design, with `cache` the only place its results
 * are remembered. Writing a path out again — as commands, or as the text a browser draws —
 * left for `drawing/path.ts` with #60, so that the flags deciding which arc is drawn are
 * spelled in one file rather than two.
 *
 * `affine` is the one 2×3 matrix in the codebase. It is exported rather than kept private
 * because it is part of what `effective` hands out — a Plan Image's calibration is a matrix,
 * and a renderer that takes a `DerivedFloor` has to be able to read that field.
 *
 * The geometry re-exports at the bottom are the same rule, not a convenience: a component
 * that needs to measure, evaluate or validate a path is asking `geometry` a question, and
 * `ui` is not allowed to ask it directly. Naming each one here is what keeps that boundary
 * honest — the façade carries what the views actually use, and nothing more.
 *
 * `derive` is pure — no DOM, no React, no state library — and may import only `domain`,
 * `geometry`, `cabinet` and `lib` (#20 §2). It never writes anything back: every function
 * here returns a fresh value built from the Project it was handed, and nothing in this
 * module keeps state between calls — memoisation is a `createDeriveCache()` instance, held
 * by `session`, never a module-level map.
 */
export { cabinetSceneUnits } from './cabinetSceneUnits'
export { SNAP_ROW_KINDS, enabledSnapKinds, snapCandidates } from './snapCandidates'
export type { SnapGeometry, SnapSettingKinds, SnapSourceInput, WallFaceSource } from './snapCandidates'
export { VERTICAL_SNAP_ROW_KINDS, enabledVerticalSnapKinds, verticalSnapCandidates } from './verticalSnapCandidates'
export type { VerticalSnapInput, VerticalSnapRow } from './verticalSnapCandidates'
export { elevationFrameOf, elevationScene } from './elevation'
export type { ElevationRow, ElevationRowKind, ElevationScene } from './elevation'
export { deriveWalls } from './walls'
export type { DerivedCorner, DerivedFace, DerivedWall, FloorWalls } from './walls'
export { deriveRooms, roomFaceCandidates, roomFaceLabel, roomMembershipOf } from './rooms'
export { roomDeleteBlock, roomDeleteBlockFor, roomEdgeName, roomFaceRefList } from './rooms'
export { faceRoomNames } from './rooms'
export type { DerivedRoom, FloorRooms, MeasurableRoom, RoomFaceCandidate, RoomMembership } from './rooms'
export { WARNING_PRODUCERS, compareWarnings, countUnacknowledged, deriveWarnings, warningFloorOf, warningSignature } from './warnings/engine'
export type {
  FloorWarnings,
  Warning,
  WarningCandidate,
  WarningFloor,
  WarningJunction,
  WarningMeasured,
  WarningOpening,
  WarningParams,
  WarningProducer,
  WarningStatus,
  WarningSubject,
  WarningSubjectKind,
  WarningWall,
} from './warnings/types'
export {
  chooseVerticalSubject,
  floorLimitCopy,
  hostRangeCopy,
  verticalOverlap,
  verticalRelationCopy,
  VERTICAL_MESSAGE_KEYS,
} from './warnings/verticalCopy'
export type { VerticalCopy, VerticalExtent, VerticalKind, VerticalSubject } from './warnings/verticalCopy'
export {
  AFFINE_IDENTITY,
  affineApply,
  affineInvert,
  affineMultiply,
  affineRotateDeg,
  affineScale,
  affineToSvg,
  affineTranslate,
} from './affine'
export type { Affine } from './affine'
export { effectiveFloor, effectiveItemDetail, placementLabels } from './effective'
export type {
  DerivedFloor,
  DerivedItemDetail,
  DerivedPlacement,
  DerivedPlanImage,
  Rect,
} from './effective'
export { designOptionName, effectiveModel } from './effectiveModel'
export type { EffectiveEntity, EffectiveModel } from './effectiveModel'
export { displayCounts, displayModel, displayProject, displayRows, displayStates } from './renovationDisplay'
export type { DisplayEntity, DisplayModel } from './renovationDisplay'
export { effectiveLayerOrder, effectiveLayerSetting, entityLayerKeys, layerAccessOf, layerRowsFrontFirst, snapCandidateAllowed } from './drawingLayers'
export { RANGE_RANK, openingExtent, placementExtent, rangeClass, rangeClasses, wallExtent } from './planRange'
export type { RangeClass } from './planRange'
export type { DrawingGates, EffectiveLayerSetting, LayerAccess } from './drawingLayers'
export { DERIVE_CACHE_MAX_ENTRIES, createDeriveCache } from './cache'
export type { DeriveCache } from './cache'
export { isCutListCapable, cutListParts } from './quantities/cutList'
export type { CutListGroup, CutListPart, CutListRow } from './quantities/cutList'
export { itemListRowsForFloor } from './quantities/itemList'
export type { ItemListGroup, ItemListRow } from './quantities/itemList'
export { quantities, quantitiesForFloor } from './quantities/quantities'
export type { FloorQuantities, Quantities } from './quantities/quantities'
export { UNLAYERED_LAYER, tables, warningMessages } from './tables'
export type {
  ElementColumns,
  OpeningsRow,
  PlacedItemsRow,
  RoomRelation,
  RoomsRow,
  TableDeps,
  Tables,
  WallsRow,
  WarningSubjectCode,
  WarningsRow,
} from './tables'
export { RENOVATION_STATES, layerMatches } from './quantities/scope'
export type {
  LayerScope,
  OptionColumns,
  QuantityScope,
  RenovationState,
} from './quantities/scope'
export {
  designDefaultOrigin,
  designOutline,
  floorBounds,
  floorBoundsSize,
  localPointOf,
  localPointValid,
  normaliseRotation,
  originCandidates,
  originMoveTranslations,
  originSnapCandidates,
  pathOrigin,
  placementContext,
  placementTransform,
  worldPoint,
  worldPointOf,
} from './placement'
export type { OriginMove, PlacementContext } from './placement'
export {
  PRESET_KINDS,
  SNAP_ACQUISITION_PX,
  SNAP_PRIORITY,
  TOLERANCE_MM,
  applyTransform,
  cornerRadiiOf,
  directionDeg,
  distance,
  editArc,
  editEllipticalArc,
  editLineEdge,
  endpoints,
  evaluatePreset,
  fillet,
  fitOpening,
  isTangentFillet,
  lengthOf,
  midpoints,
  moveVertex,
  normaliseDeg,
  openingEnd,
  presetInBox,
  presetParametersValid,
  projectElevationOutline,
  pt,
  refDistance,
  refParamAt,
  regularPolygonMetrics,
  resolveSnap,
  roundAllCorners,
  segmentStart,
  setFilletRadius,
  toValidationProblems,
  transformSegment,
  usableIntervals,
  validateLoop,
  verticalBodySnap,
  verticalSnap,
  verticalTolerance,
  vertices,
} from '../geometry'
export type {
  ArcChange,
  ArcSegment,
  Bounds,
  ClosedPath,
  CornerRadii,
  EditResult,
  EllipticalArcChange,
  EllipticalArcSegment,
  ElevationFrame,
  GeometryProblem,
  GeometryProblemCode,
  KeepFixed,
  LineEdgeChange,
  LineSegment,
  Pt,
  Preset,
  PresetKind,
  RoundedRectanglePreset,
  Segment,
  SideName,
  SizeBox,
  Snap,
  SnapCandidate,
  SnapKind,
  Transform,
  UsableGap,
  UsableInterval,
  VerticalBodySnap,
  VerticalEdges,
  VerticalSnap,
  VerticalSnapCandidate,
  VerticalSnapKind,
} from '../geometry'
