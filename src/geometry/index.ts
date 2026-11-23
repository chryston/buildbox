/**
 * The public face of the `geometry` module (#20 §2, ADR 0003): the only way in from
 * outside this folder. `geometry` is pure — no DOM, no React, no state library — and may
 * import only `lib`.
 *
 * The geometry kernel v1 (#54): float64 millimetre closed paths of line, circular-arc and
 * elliptical-arc segments, with one topology tolerance of 0.01 mm and analytic curves.
 * Every index in this API is the 1-based edge or vertex number the user-facing messages
 * use (#54 §1); `segments` is the code word, "Edges" the UI word.
 *
 * `src/geometry/testing.ts` is the second entry point, for test files only.
 */
export { area, applyTransform, arcExtrema, bounds, evaluate, evaluateSegment, flatten, flattenSegment, normaliseOrientation, perimeter, reverse, signedArea, signedAreaOf, transformSegment, vertices } from './measure'
export type { Bounds, EvaluatedSegment } from './measure'
export {
  CORNER_ORDER,
  PRESET_KINDS,
  cornerRadiiOf,
  evaluatePreset,
  presetArea,
  presetInBox,
  presetParametersValid,
  presetPerimeter,
  ramanujanPerimeter,
  regularPolygonMetrics,
  roundedRectangleOverlap,
} from './presets'
export type {
  CapsulePreset,
  CirclePreset,
  CornerRadii,
  EllipsePreset,
  Placement,
  Preset,
  PresetKind,
  RectanglePreset,
  RegularPolygonPreset,
  RoundedRectanglePreset,
  SizeBox,
  SquarePreset,
  TrianglePreset,
} from './presets'
export {
  DEG,
  centre,
  directionDeg,
  distance,
  equalPts,
  lengthOf,
  midpoint,
  normaliseDeg,
  rotate,
  segmentEnd,
  segmentPairs,
  segmentStart,
  tangentDeg,
} from './segment'
export {
  distanceBetweenSegments,
  intersectSegments,
  nearestOnSegment,
  paramForPoint,
  pointOn,
  spanOf,
  windingNumber,
} from './curve'
export type { SegmentIntersections, SegmentMeeting, Span } from './curve'
export { classifyPoint, containment, intersect, isBoundary, overlap } from './intersect'
export type { Overlap, OverlapInterval, PathIntersections } from './intersect'
export { fillet, isTangentFillet, roundAllCorners, setFilletRadius, tangentAt } from './fillet'
export type { EditResult } from './fillet'
export { editArc, editEllipticalArc, editLineEdge, moveVertex } from './editPath'
export type { ArcChange, EllipticalArcChange, KeepFixed, LineEdgeChange } from './editPath'
export { linearElement, offset } from './offset'
export type { LinearElement } from './offset'
export { edgeToFace, faceCurve, faceOffsetOf, ontoFaceVector } from './face'
export type { FaceCurve, FaceRelation } from './face'
export { LABEL_PRECISION_MM, distanceToOutline, labelAnchor } from './label'
export { slideLineEdge } from './slide'
export { arcFromThrough, offsetRefLine, refDistance, refLength, refParamAt, refPointAt, refSegment, refTangentDeg } from './wall'
export type { ArcThrough, WallRefLine } from './wall'
export { faceOffsets, joinWalls } from './joinWalls'
export type {
  JoinEnd,
  JoinJunction,
  JoinedFace,
  JoinedWall,
  JoinWall,
  WallJustification,
  WallSide,
} from './joinWalls'
export {
  arcLengthOfChord,
  chordOfArcLength,
  faceCurveBetween,
  facePointAt,
  fitOpening,
  gapChord,
  openingChord,
  openingEnd,
  refRadius,
  refTangentAt,
  usableIntervals,
  wallPieces,
} from './openings'
export type {
  BlockCause,
  FaceOffsets,
  OpeningFit,
  UsableBlock,
  UsableGap,
  UsableInterval,
  WallPiece,
} from './openings'
export { classify, interval, overlapLength } from './interval'
export type { Interval } from './interval'
export {
  SNAP_ACQUISITION_PX,
  SNAP_PRIORITY,
  centres,
  endpoints,
  intersections,
  midpoints,
  perpendicularFoot,
  resolveSnap,
  tangentPoints,
} from './snap'
export type { Snap, SnapCandidate, SnapKind } from './snap'
export { alongElevation, elevationCoords, elevationDistance, elevationFrame, insideElevationBand, openingBodyOutline, projectElevationOutline, wallBodyOutline } from './elevation'
export type { ElevationFrame, ElevationLine, ElevationProjection, ElevationSide } from './elevation'
export { movedEdges, VERTICAL_SNAP_PX, verticalBodySnap, verticalSnap, verticalTolerance } from './verticalSnap'
export type { VerticalBodySnap, VerticalEdges, VerticalSnap, VerticalSnapCandidate, VerticalSnapKind } from './verticalSnap'
export { toValidationProblems, validateLoop } from './validate'
export type { LoopInput } from './validate'
export { geometryProblem, pt, TOLERANCE_MM } from './types'
export type {
  ArcSegment,
  ClosedPath,
  EllipticalArcSegment,
  GeometryProblem,
  GeometryProblemCode,
  LineSegment,
  ProblemDetail,
  Pt,
  Segment,
  SideName,
  Transform,
} from './types'
