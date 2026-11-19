/**
 * The pure read-only derivations that turn domain data into the shapes the rest of the app
 * consumes (#43, #20 §13.4, #57).
 *
 * Two families live here. `cabinetSceneUnits` is the inverse projection back into the
 * cabinet scene vocabulary; `placement` is where a Placed Item actually sits — the one
 * pinned reading of Item Origin, rotation and Item Footprint, which `ui` can only reach
 * through this module because it may not import `geometry` (#20 §2); `svg` writes a closed
 * path as SVG path data, arcs included.
 *
 * The geometry re-exports at the bottom are the same rule, not a convenience: a component
 * that needs to measure, evaluate or validate a path is asking `geometry` a question, and
 * `ui` is not allowed to ask it directly. Naming each one here is what keeps that boundary
 * honest — the façade carries what the views actually use, and nothing more.
 *
 * `derive` is pure — no DOM, no React, no state library — and may import only `domain`,
 * `geometry`, `cabinet` and `lib` (#20 §2). It never writes anything back: every function
 * here returns a fresh value built from the Project it was handed.
 */
export { cabinetSceneUnits } from './cabinetSceneUnits'
export { pathToSvg } from './svg'
export { SNAP_ROW_KINDS, enabledSnapKinds, snapCandidates } from './snapCandidates'
export type { SnapGeometry, SnapSettingKinds, SnapSourceInput, WallFaceSource } from './snapCandidates'
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
  cornerRadiiOf,
  directionDeg,
  distance,
  editArc,
  editEllipticalArc,
  editLineEdge,
  endpoints,
  evaluatePreset,
  fillet,
  isTangentFillet,
  lengthOf,
  midpoints,
  normaliseDeg,
  presetInBox,
  presetParametersValid,
  pt,
  regularPolygonMetrics,
  resolveSnap,
  roundAllCorners,
  segmentStart,
  setFilletRadius,
  toValidationProblems,
  validateLoop,
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
} from '../geometry'
