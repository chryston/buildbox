/**
 * The shared drawing module (#60, #20 §9).
 *
 * One pure description of a drawing, and one pure rendering of it: a display list of
 * millimetre paths, text and images whose colours come from `STYLES` and whose sizes come
 * from `SIZE_ROLES`, turned into an SVG tree and then into bytes. The Plan View and the Item
 * Detail will build lists in a later commit and both surfaces — and #62's export — will draw
 * from the same one, which is the point of the module: two drawings that used to be two
 * copies of the same arithmetic, drifting.
 *
 * `drawing` is pure — no DOM, no React, no state library, no module-level mutable state — and
 * may import only `derive`, `domain`, `geometry`, `cabinet` and `lib` (#20 §2). It never
 * measures the world: it is handed millimetres and returns millimetres, so a test can assert
 * what a drawing looks like without a browser, and #60 criterion 1 keeps it that way.
 */
export { LAYER_ORDER } from './types'
export type {
  DisplayItem,
  DisplayLayer,
  DisplayList,
  DrawOptions,
  LayerKey,
  MissingGlyph,
  OmittedLabel,
  Paint,
  PathCommand,
  RangePaint,
  Rect,
  Ref,
  ResolvedSize,
  SizeRole,
  SizeRow,
  SizeSpec,
  Sizing,
  Style,
  StyleKey,
  TextAnchor,
  TextBaseline,
  TextRole,
} from './types'
export { FONT_STACK, RANGE_FADED_OPACITY, SIZE_ROLES, STYLES, rangeStyle, resolveSize, resolveStyle } from './styles'
export { commandsToPath, lineCommands, pathToCommands, rectCommands, roundedRectCommands } from './path'
export { serializeSvg, toSvgTree } from './svg'
export type { Emphasis, SvgNode, SvgOptions } from './svg'
export { layoutText, measureRect } from './font/layoutText'
export type { TextLayout } from './font/layoutText'
export { placeLabels } from './labels'
export type { LabelPlacement, LabelRequest } from './labels'
export { drawPlanView, drawPlacement, unionRect } from './planView'
export type { DrawnPlacement, PlanPreview, PlanViewInput } from './planView'
export { hatchLines, offsetOutward, renovationOverlays } from './renovation'
export { candidatesAtPoint, drawOrderOf } from './cycleCandidates'
export type { DrawnCandidate, DrawnEntities, DrawnEntity } from './cycleCandidates'
export type { RenovationOutline } from './renovation'
export { drawWalls, wallLabelBoxes } from './walls'
export type { OpeningPreview, WallDrawOptions } from './walls'
export { drawRooms, placeRoomLabel } from './rooms'
export type { RoomDrawOptions, RoomProposal } from './rooms'
export { faceCurveCommands, gapMarkItems, openingItems, pieceCommands, wallOpenings } from './openings'
export type { OpeningStyle, OpeningSymbol, WallOpenings } from './openings'
export { drawSelectionAnnotations } from './annotations'
export type { AnnotationOptions } from './annotations'
export { badgeRadius, displayRects, drawWarningBadges } from './badges'
export type { BadgeOptions, BadgeSubject } from './badges'
export { drawItemDetail } from './itemDetail'
export type { ItemDetailOptions, ItemDetailView } from './itemDetail'
export { drawFloorView } from './floorView'
export type { FloorView, FloorViewEntities, FloorViewOptions, LayerGates } from './floorView'
