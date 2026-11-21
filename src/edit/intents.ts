/**
 * The Intent vocabulary (#47, #20 §4): every edit a user can make to a Project is data.
 *
 * An Intent carries its `type`, a short `label` for the undo tooltip, a typed `payload`,
 * the `ids` the caller pre-allocated, the `now` the caller read from the clock, and the
 * `resolutions` a later capability will use for dependency review. Nothing here is
 * mutable state: `applyIntent` (#47 `apply.ts`) turns a Project and one Intent into the
 * next Project, or into a Rejection.
 *
 * ID ownership is the rule that makes this reproducible (#20 §4, #42 §3): a handler never
 * calls `crypto.randomUUID()` or `nanoid` itself. `ids` is consumed in a fixed order,
 * stated per Intent in `INTENT_ID_ORDER`, so the same Intent always gives the same
 * Project.
 */
import type { Patch } from 'immer'
import type {
  Accessory,
  CabinetMaterialId,
  DrawerConfig,
  DisplayUnit,
  ElementType,
  EntityId,
  GlobalSettings,
  ItemFootprint,
  HingeSide,
  OpeningDependency,
  OpeningKind,
  OpeningSwing,
  PlanImage,
  Point2,
  PathRoomOutline,
  PresetRoomOutline,
  Project,
  WallClassification,
  WallFaceSide,
  WallJustification,
  WallRefLine,
} from '../domain'
import { roomOutlinePath } from '../domain'
import type { KeepFixed, Pt } from '../geometry'
import { FF_RENOVATION } from '../lib'
import type { ValidationProblem } from '../lib'
import { RENOVATION_INTENT_ID_ORDER } from './handlers/renovationHandlers'

/**
 * Every Intent type the released catalogue answers (#47), one per current store action.
 *
 * This is the S7 set, kept apart from #69's renovation set because the two are registered
 * under different conditions: the handlers, labels and ID orders of `RenovationIntentType`
 * exist only in a `VITE_FF_RENOVATION=true` build, so a production bundle does not carry the
 * strings at all. The types are one union either way — a type is not a byte.
 */
export type S7IntentType =
  | 'project.rename'
  | 'project.setPreferences'
  | 'cabinet.updateSettings'
  | 'cabinet.setMaterial'
  | 'cabinet.addUnit'
  | 'cabinet.removeUnit'
  | 'cabinet.renameUnit'
  | 'cabinet.addShelf'
  | 'cabinet.addDivider'
  | 'cabinet.deleteBoard'
  | 'cabinet.setNodeSize'
  | 'cabinet.pinNode'
  | 'cabinet.unpinNode'
  | 'cabinet.setNodeLabel'
  | 'cabinet.distributeEvenly'
  | 'cabinet.setElementType'
  | 'cabinet.setDrawerConfig'
  | 'cabinet.setSplitRatio'
  | 'cabinet.addAccessory'
  | 'cabinet.removeAccessory'
  | 'plan.addObject'
  | 'plan.placeDesign'
  | 'plan.movePlacement'
  | 'plan.rotatePlacement'
  | 'plan.removeObject'
  | 'plan.addTemplate'
  | 'plan.removeTemplate'
  | 'plan.setImage'
  | 'plan.removeImage'
  | 'plan.calibrate'
  | 'plan.clear'
  | 'plan.copyToFloor'
  | 'plan.moveToFloor'
  | 'wall.createChain'
  | 'wall.dragJunction'
  | 'wall.dragEndpoint'
  | 'wall.dragBody'
  | 'wall.setLength'
  | 'wall.setDirection'
  | 'wall.setArc'
  | 'wall.setThickness'
  | 'wall.offset'
  | 'wall.split'
  | 'wall.merge'
  | 'wall.delete'
  | 'room.create'
  | 'room.rename'
  | 'room.setOutline'
  | 'room.attachFace'
  | 'room.detachFace'
  | 'room.placeShelter'
  | 'opening.create'
  | 'opening.setStart'
  | 'opening.setWidth'
  | 'opening.flipHinge'
  | 'opening.flipSwing'
  | 'opening.rename'
  | 'opening.delete'
  | 'design.update'
  | 'design.setFootprint'
  | 'design.setOrigin'
  | 'design.fork'
  | 'floor.create'
  | 'floor.rename'
  | 'floor.reorder'
  | 'floor.setLimits'
  | 'floor.setDefaultWallHeight'
  | 'floor.delete'
  | 'floor.duplicate'
  | 'view.create'
  | 'view.rename'
  | 'view.delete'
  | 'view.setShowPlanImage'
  | 'warning.acknowledge'
  | 'warning.editNote'

/** The Intents #69 registers only while `VITE_FF_RENOVATION` is on. */
export type RenovationIntentType = 'designOption.create' | 'designOption.rename' | 'designOption.delete'

/** Every Intent type the catalogue can answer: the S7 set, plus the renovation set in a flagged build. */
export type IntentType = S7IntentType | RenovationIntentType

/**
 * Which container an element edit writes into (#69 §7).
 *
 * Every Wall, Opening, Room and Placed Item edit takes one, and the S7 handlers do not read it
 * yet: the container choice is a parameter of the existing Intents rather than a second family of
 * them, so `#70`'s active Option is what turns `wall.setThickness` into an edit of proposed work.
 * `null` — and no `target` at all — is the Existing Model, which is every edit a build without the
 * flag can make.
 */
export interface IntentTarget {
  target?: { designOptionId: EntityId | null }
}

/** The payload each Intent type carries. */
export interface RenameProject {
  name: string
}
export interface SetProjectPreferences {
  displayUnit: DisplayUnit
  displayPrecision: number
  /** The height a new Wall takes on a Floor that does not set its own (#64 §16). */
  defaultWallHeight: number
}
/** `Default wall height` for one Floor; `null` hands the decision back to the Project. */
export interface SetFloorDefaultWallHeight {
  floorId: EntityId
  defaultWallHeight: number | null
}
export interface UpdateCabinetSettings {
  itemDesignId: EntityId
  patch: Partial<GlobalSettings>
}
export interface SetCabinetMaterial {
  itemDesignId: EntityId
  material: CabinetMaterialId
}
export interface AddUnit {
  /** Copy this design's settings; `null` falls back to the first cabinet, then the defaults. */
  sourceItemDesignId: EntityId | null
}
export interface RemoveUnit {
  itemDesignId: EntityId
}
export interface RenameUnit {
  itemDesignId: EntityId
  name: string
}
export interface AddShelf {
  itemDesignId: EntityId
  nodeId: string
}
export interface AddDivider {
  itemDesignId: EntityId
  nodeId: string
}
export interface DeleteBoard {
  itemDesignId: EntityId
  nodeId: string
}
export interface SetNodeSize {
  itemDesignId: EntityId
  nodeId: string
  sizeMm: number
}
export interface PinNode {
  itemDesignId: EntityId
  nodeId: string
  sizeMm: number
}
export interface UnpinNode {
  itemDesignId: EntityId
  nodeId: string
}
export interface SetNodeLabel {
  itemDesignId: EntityId
  nodeId: string
  label: string
}
export interface DistributeEvenly {
  itemDesignId: EntityId
  columnRootId: string
  evenH: number
}
export interface SetElementType {
  itemDesignId: EntityId
  nodeId: string
  elementType: ElementType
}
export interface SetDrawerConfig {
  itemDesignId: EntityId
  nodeId: string
  config: DrawerConfig
}
export interface SetSplitRatio {
  itemDesignId: EntityId
  /** The split node whose share changes — the node the drag handle belongs to. */
  parentNodeId: string
  ratio: number
}
export interface AddAccessory {
  itemDesignId: EntityId
  nodeId: string
  accessory: Omit<Accessory, 'id'>
}
export interface RemoveAccessory {
  itemDesignId: EntityId
  nodeId: string
  accessoryId: string
}
export interface AddPlanObject {
  floorId: EntityId
  /** A key of the floor-plan catalog, e.g. `bed-king`. */
  catalogKey: string
}
/**
 * Place an Item Design that already exists (#57 behaviour 30, #16).
 *
 * This is reuse, not a copy: the new Placed Item points at the same design every other
 * placement of it points at, which is what the library's `Affects N placements` preview is
 * warning about. It replaces `plan.addFromTemplate`, whose fork-on-place made every placed
 * object its own design and left the library listing nothing but unplaced shapes.
 */
export interface PlacePlanDesign {
  floorId: EntityId
  itemDesignId: EntityId
}
/**
 * Where the Item Origin stands on the Floor (#57 behaviour 33). The Placed Item owns no
 * pivot and no size, so a drag and the `Position X` / `Position Y` fields both land here —
 * the one point the rotation turns about, in Floor-local millimetres.
 */
export interface MovePlanPlacement {
  placedItemId: EntityId
  translation: Point2
}
/**
 * One turn about the Item Origin (#57 behaviour 33): free rotation, clockwise degrees in
 * the +Y-down frame, normalised to `[0, 360)`. The Item Footprint is never re-authored and
 * never mirrored — a 600 × 400 footprint at 90° is still 600 wide and 400 deep locally.
 */
export interface RotatePlanPlacement {
  placedItemId: EntityId
  rotationDeg: number
}
export interface RemovePlanObject {
  placedItemId: EntityId
}
export interface AddPlanTemplate {
  label: string
  w: number
  h: number
  /** `#rrggbb`, lowercase. */
  color: string
}
export interface RemovePlanTemplate {
  itemDesignId: EntityId
}
export interface SetPlanImage {
  floorId: EntityId
  /** The bytes are already in the Asset Repository; `null` is `plan.removeImage`'s job. */
  image: Omit<PlanImage, 'pixelsPerMm'>
}
export interface RemovePlanImage {
  floorId: EntityId
}
export interface CalibratePlan {
  floorId: EntityId
  pixelsPerMm: number
}
export interface ClearPlan {
  floorId: EntityId
}

/**
 * Copy or Move a selection to another Floor (#56). The two share a payload because the
 * preview is the same dialog: the destination X/Y and base elevation arrive as the values
 * the user confirmed for the first selected item, and every other item keeps its offset
 * from that one. Confirming without edits sends the source values, so nothing moves.
 *
 * Copy spends one new ID per Placed Item; Move keeps every ID and changes only `floorId`.
 * Floors share no coordinates (#25), so no alignment is inferred from either Floor.
 */
export interface TransferPlanObjectsToFloor {
  placedItemIds: EntityId[]
  toFloorId: EntityId
  /** Floor-local millimetres: where the first selected Item Origin lands. */
  translation: Point2
  /** Millimetres above the destination Floor Datum. */
  baseElevation: number
}
export type CopyPlanObjectsToFloor = TransferPlanObjectsToFloor
export type MovePlanObjectsToFloor = TransferPlanObjectsToFloor

/**
 * The design-level fields the Placed Item inspector edits (#57 behaviour 30): name and
 * colour. Every Placed Item of this Item Design changes with it, which is why the view
 * previews the result and says `Affects N placements` before it commits.
 *
 * The Item Footprint is not one of these fields (#58): a shape is edited in the Item Design
 * editor, where the outline is on screen and the parameters have names, and it goes through
 * `design.setFootprint`. A size edit here would have to guess which parameter a number was
 * meant to be.
 */
export interface UpdateItemDesign {
  itemDesignId: EntityId
  patch: {
    name?: string
    /** `#rrggbb`, lowercase. */
    color?: string
  }
}
/**
 * Restate an Item Design's Item Footprint (#58): a preset with new parameters, or the Custom
 * Path a conversion produced.
 *
 * The footprint arrives whole rather than as a field patch, because a shape is one value —
 * `radius: 1001` on a 2,000 mm side is not a legal design with one illegal number, it is no
 * design at all — and because conversion replaces the footprint outright instead of editing
 * it. The handler refuses a footprint that describes no shape, so no caller can put an
 * invalid outline into the model or into the undo history; the Item Origin is left where it
 * is, since it belongs to the design and not to the shape.
 */
export interface SetItemDesignFootprint {
  itemDesignId: EntityId
  footprint: ItemFootprint
}
/**
 * Move the Item Origin inside the footprint (#57 behaviour 31, D3). Every placement of the
 * design takes the same turn the Origin did —
 *
 *     translation′ = translation + R(rotationDeg) · (origin′ − origin)
 *
 * — so each footprint stays exactly where it is on its Floor and only the point future
 * rotations turn about moves. The placements' rotations are untouched.
 */
export interface SetItemDesignOrigin {
  itemDesignId: EntityId
  /** Footprint-local millimetres; any point, not only a preset. */
  origin: Point2
}
/**
 * Fork one Placed Item onto its own copy of the Item Design (#57 behaviour 30, D11).
 *
 * The copy is deep — footprint, origin, colour, height and, for a cabinet, its whole
 * construction — and only the chosen placement is repointed, so the other placements keep
 * the shared design. The name arrives already de-duplicated by the dialog.
 */
export interface ForkItemDesign {
  placedItemId: EntityId
  name: string
}

/** A new Floor (#56). `name` absent means the next free `Floor N`. */
export interface CreateFloor {
  name?: string
}
export interface RenameFloor {
  floorId: EntityId
  name: string
}
/**
 * Move one Floor to another position in the Project's display order (#56). Array order is
 * the order; no geometry and no reference changes, which is what criterion 2 measures.
 */
export interface ReorderFloor {
  floorId: EntityId
  /** Index in the list the Floor is removed from, so `toIndex` counts the other Floors. */
  toIndex: number
}
/** The Floor's own coordination limits (#56); `null` clears that bound. */
export interface SetFloorLimits {
  floorId: EntityId
  lowerMm: number | null
  upperMm: number | null
}
export interface DeleteFloor {
  floorId: EntityId
}
/**
 * Duplicate a Floor (#56): the preview dialog has decided the name, where the copy sits in
 * the order, which Placed Items come along, and whether the Plan Image is copied. Every
 * copied entity takes a new ID; the copies keep their references to the project-owned Item
 * Designs, which is what makes them reuse rather than forks.
 */
export interface DuplicateFloor {
  floorId: EntityId
  name: string
  /** Position in the display order; the dialog defaults it to just after the source. */
  toIndex: number
  /** The checklist, already resolved to the Placed Items it covers. */
  placedItemIds: EntityId[]
  includePlanImage: boolean
}

/** A named Plan View on a Floor (#56). */
export interface CreatePlanView {
  floorId: EntityId
  name: string
}
export interface RenamePlanView {
  viewId: EntityId
  name: string
}
export interface DeletePlanView {
  viewId: EntityId
}
/** Whether this Plan View draws its Floor's Plan Image (#19 §4). */
export interface SetPlanViewShowsPlanImage {
  viewId: EntityId
  showPlanImage: boolean
}

/**
 * One segment of a chained Wall draw: everything a Wall needs before it has an ID and a `ref`,
 * which the caller pre-allocates (#64 §11).
 */
export interface WallDraft {
  line: WallRefLine
  thickness: number
  justification: WallJustification
  classification?: WallClassification
  constructionLabel?: string
  baseElevation: number
  height: number
}

/**
 * Where one drawn end goes, and so what Junction the gesture creates (#64 §9). A Junction is
 * created only by an explicit target: an end near another end with no target stays free.
 *
 * - `free` — nothing: the end is a free end.
 * - `segment` — another segment of this same gesture. Both sides name each other, which is the
 *   chain link; closing on the chain's first point is the same link back to index 0.
 * - `wall` — an existing Wall's end: `Join to end of W-3`. That end joins the new Junction too.
 * - `host` — an existing Wall's reference line, mid-span: `Attach to W-3`. The end is stored on
 *   the host's line at the projection of the drawn point, and the host is never split.
 */
export type WallEndTarget =
  | { kind: 'free' }
  | { kind: 'segment'; index: number; end: 'start' | 'end' }
  | { kind: 'wall'; wallId: EntityId; end: 'start' | 'end' }
  | { kind: 'host'; wallId: EntityId }

export interface CreateWallChain {
  floorId: EntityId
  walls: readonly WallDraft[]
  /** One per segment: where its start attaches. */
  starts: readonly WallEndTarget[]
  /** One per segment: where its end attaches. */
  ends: readonly WallEndTarget[]
}

/** Move a Junction: every member end moves with it, and a hosted Junction slides its host. */
export interface DragWallJunction {
  junctionId: EntityId
  delta: Pt
}

/** Move one free end. An end that belongs to a Junction is moved by dragging the Junction. */
export interface DragWallEndpoint {
  wallId: EntityId
  end: 'start' | 'end'
  to: Pt
}

/** Move a whole Wall: its Junctions move with it and the other members stretch. */
export interface DragWallBody {
  wallId: EntityId
  delta: Pt
}

export interface SetWallLength {
  wallId: EntityId
  /** Millimetres along the reference line. */
  length: number
  /** Which end stays where it is while the other moves. */
  keepFixed: KeepFixed
}

export interface SetWallDirection {
  wallId: EntityId
  /** Degrees clockwise from +X, the reference line's own direction (#64 §10). */
  directionDeg: number
}

export interface SetWallArc {
  wallId: EntityId
  /** Millimetres. Scales the arc about its centre; the sweep is unchanged. */
  radius?: number
  /** Degrees, signed: the direction of travel is the current one. */
  sweepDeg?: number
}

export interface SetWallThickness {
  wallId: EntityId
  thickness: number
}

/** The secondary `Offset wall by … mm`: the reference line moves perpendicular, to a side. */
export interface OffsetWall {
  wallId: EntityId
  /** Millimetres, may be negative. */
  distance: number
  /** Which side of the reference line's own direction it moves toward. */
  side: 'left' | 'right'
}

export interface SplitWall {
  wallId: EntityId
  /** Distance along the reference line, in millimetres. */
  at: number
}

/** Merge two Walls joined by a two-end Junction; the first keeps its ID and `ref` (#64 §10). */
export interface MergeWalls {
  wallIds: readonly [EntityId, EntityId]
}

export interface DeleteWall {
  wallId: EntityId
  /**
   * The Openings the dependency review listed and the homeowner agreed to lose (#65 §8).
   * Absent means the review was never answered, so a Wall that still has Openings in it is
   * refused rather than quietly emptied; a list that no longer matches what the Wall carries
   * is a stale answer and is refused too.
   */
  openings?: readonly EntityId[]
}

/**
 * A Room Outline without its Edge IDs (#67 §1). The IDs come from `ids` like every other ID
 * an Intent creates, so the payload states the shape and the caller states who owns each Edge.
 */
export type RoomOutlineShape =
  | Omit<PresetRoomOutline, 'segmentIds'>
  | Omit<PathRoomOutline, 'segmentIds'>

/** Draw a Room (#67 §4). No `name` takes the lowest unused `Room N`. */
export interface CreateRoom {
  floorId: EntityId
  outline: RoomOutlineShape
  name?: string
}

/** Rename a Room (#67 §4). */
export interface RenameRoom {
  roomId: EntityId
  name: string
}

/**
 * Restate a Room's outline (#67 §7): the Shape tab, a handle drag, a fillet.
 *
 * `ids` carries one ID per Edge of the new outline. An Edge that keeps its identity keeps its
 * ID, which is what lets a reference survive; an Edge whose ID disappears takes its attachment
 * down with it, so the Intent is refused rather than quietly moving a reference onto a
 * different Edge.
 */
export interface SetRoomOutline {
  roomId: EntityId
  outline: RoomOutlineShape
}

/**
 * `Attach to wall face` (#67 §11): the Edge named by `segmentId` is slid onto the face and
 * keeps following it. An Edge already attached elsewhere is reattached by the same Intent —
 * `Detach, reattach` should not be two transactions.
 */
export interface AttachRoomFace {
  roomId: EntityId
  segmentId: EntityId
  wallId: EntityId
  side: WallFaceSide
}

/** `Detach`: the reference goes, the geometry stays exactly where it is (#67 §13). */
export interface DetachRoomFace {
  roomId: EntityId
  segmentId: EntityId
}

/**
 * Place the fixed `Household shelter` pack entry (#67 §17): Room, four Walls, four L
 * junctions, four face references and one door, in one transaction. Every number comes from
 * the pack, so the payload is only where it goes and which way it faces.
 */
export interface PlaceHouseholdShelter {
  floorId: EntityId
  /** Floor millimetres: the centre of the shelter's interior. */
  centre: Point2
  /** Clockwise degrees in the +Y-down frame, set in the Shape tab before commit. */
  orientationDeg: number
}

/**
 * Place an Opening (#65 §5). A preset's values are resolved into this payload by the caller
 * and never linked afterwards: editing the pack afterwards changes nothing already placed.
 */
export interface CreateOpening {
  floorId: EntityId
  /** The one Wall this Opening is an absence in. */
  hostWallId: EntityId
  kind: OpeningKind
  /** `Door 1` — the next free number of its kind, unless the caller renamed it first. */
  label: string
  /** Millimetres along the host's reference line to the near jamb; arc length on a curve. */
  start: number
  /** Millimetres, measured as the chord (#65 §2). */
  width: number
  /** Millimetres above the Floor Datum. */
  sill: number
  /** Millimetres above the Floor Datum, more than `sill`. */
  head: number
  /** Doors only. `sliding` carries no `hingeSide` (#65 §1). */
  swing?: OpeningSwing
  hingeSide?: HingeSide
}

/** Move along the host: a typed distance from either end, or a drag along the face (#65 §6). */
export interface SetOpeningStart {
  openingId: EntityId
  start: number
}

/** Resize the width (#65 §6). `start` comes along only when the drag is symmetric and moves
 * both jambs; a typed width leaves the near jamb where it is. */
export interface SetOpeningWidth {
  openingId: EntityId
  width: number
  start?: number
}

/** `Flip hinge`: the leaf hangs on the other jamb. A hinged door only (#65 §6). */
export interface FlipOpeningHinge {
  openingId: EntityId
}

/** `Flip opening side`: the leaf opens toward the other face of the host. A hinged door only. */
export interface FlipOpeningSwing {
  openingId: EntityId
}

export interface RenameOpening {
  openingId: EntityId
  label: string
}

/** Delete one Opening. The Wall it was cut into stays. */
export interface DeleteOpening {
  openingId: EntityId
}

/**
 * `Acknowledge warning` (#66 §4): the user's decision about one warning, recorded with the
 * note they gave for it.
 *
 * The key is deliberately not sent. An Entity ID may contain a comma (#42 §3), so a key can
 * never be parsed back into its parts; the four inputs the key was built from travel beside
 * it and the handler rebuilds it, which is what guarantees an acknowledgement always lands
 * under the key the engine computes for the same warning.
 */
export interface AcknowledgeWarning {
  warningType: string
  subjectIds: EntityId[]
  designOptionId: EntityId | null
  /** The signature as it stood when the user decided; reopening is judged against this. */
  signature: string
  note: string
}

/** `Edit note`: the decision stands, only what the user wrote about it changes (#66 §4). */
export interface EditWarningNote {
  warningType: string
  subjectIds: EntityId[]
  designOptionId: EntityId | null
  note: string
}

/**
 * `New Design Option` (#69 §2): one Option, named, holding nothing. It starts as a copy of
 * nothing — the Existing Model is what every Option starts from, so an Option with no records
 * is not an empty Project but the whole of the model.
 */
export interface CreateDesignOption {
  name: string
}

/** `Rename`: the name moves and every record stays where it was (#69 §2). */
export interface RenameDesignOption {
  optionId: EntityId
  name: string
}

/** `Delete`: the Option, its records and its acknowledgements — and nothing else (#69 §2). */
export interface DeleteDesignOption {
  optionId: EntityId
}

/** `type → payload`, the one place the catalogue's shape is written down. */
export interface IntentPayloads {
  'project.rename': RenameProject
  'project.setPreferences': SetProjectPreferences
  'cabinet.updateSettings': UpdateCabinetSettings
  'cabinet.setMaterial': SetCabinetMaterial
  'cabinet.addUnit': AddUnit
  'cabinet.removeUnit': RemoveUnit
  'cabinet.renameUnit': RenameUnit
  'cabinet.addShelf': AddShelf
  'cabinet.addDivider': AddDivider
  'cabinet.deleteBoard': DeleteBoard
  'cabinet.setNodeSize': SetNodeSize
  'cabinet.pinNode': PinNode
  'cabinet.unpinNode': UnpinNode
  'cabinet.setNodeLabel': SetNodeLabel
  'cabinet.distributeEvenly': DistributeEvenly
  'cabinet.setElementType': SetElementType
  'cabinet.setDrawerConfig': SetDrawerConfig
  'cabinet.setSplitRatio': SetSplitRatio
  'cabinet.addAccessory': AddAccessory
  'cabinet.removeAccessory': RemoveAccessory
  'plan.addObject': AddPlanObject & IntentTarget
  'plan.placeDesign': PlacePlanDesign & IntentTarget
  'plan.movePlacement': MovePlanPlacement & IntentTarget
  'plan.rotatePlacement': RotatePlanPlacement & IntentTarget
  'plan.removeObject': RemovePlanObject & IntentTarget
  'plan.addTemplate': AddPlanTemplate
  'plan.removeTemplate': RemovePlanTemplate
  'plan.setImage': SetPlanImage
  'plan.removeImage': RemovePlanImage
  'plan.calibrate': CalibratePlan
  'plan.clear': ClearPlan
  'plan.copyToFloor': CopyPlanObjectsToFloor
  'plan.moveToFloor': MovePlanObjectsToFloor
  'wall.createChain': CreateWallChain & IntentTarget
  'wall.dragJunction': DragWallJunction & IntentTarget
  'wall.dragEndpoint': DragWallEndpoint & IntentTarget
  'wall.dragBody': DragWallBody & IntentTarget
  'wall.setLength': SetWallLength & IntentTarget
  'wall.setDirection': SetWallDirection & IntentTarget
  'wall.setArc': SetWallArc & IntentTarget
  'wall.setThickness': SetWallThickness & IntentTarget
  'wall.offset': OffsetWall & IntentTarget
  'wall.split': SplitWall & IntentTarget
  'wall.merge': MergeWalls & IntentTarget
  'wall.delete': DeleteWall & IntentTarget
  'room.create': CreateRoom & IntentTarget
  'room.rename': RenameRoom & IntentTarget
  'room.setOutline': SetRoomOutline & IntentTarget
  'room.attachFace': AttachRoomFace & IntentTarget
  'room.detachFace': DetachRoomFace & IntentTarget
  'room.placeShelter': PlaceHouseholdShelter & IntentTarget
  'opening.create': CreateOpening & IntentTarget
  'opening.setStart': SetOpeningStart & IntentTarget
  'opening.setWidth': SetOpeningWidth & IntentTarget
  'opening.flipHinge': FlipOpeningHinge & IntentTarget
  'opening.flipSwing': FlipOpeningSwing & IntentTarget
  'opening.rename': RenameOpening & IntentTarget
  'opening.delete': DeleteOpening & IntentTarget
  'design.update': UpdateItemDesign
  'design.setFootprint': SetItemDesignFootprint
  'design.setOrigin': SetItemDesignOrigin
  'design.fork': ForkItemDesign
  'floor.create': CreateFloor
  'floor.rename': RenameFloor
  'floor.reorder': ReorderFloor
  'floor.setLimits': SetFloorLimits
  'floor.setDefaultWallHeight': SetFloorDefaultWallHeight
  'floor.delete': DeleteFloor
  'floor.duplicate': DuplicateFloor
  'view.create': CreatePlanView
  'view.rename': RenamePlanView
  'view.delete': DeletePlanView
  'view.setShowPlanImage': SetPlanViewShowsPlanImage
  'warning.acknowledge': AcknowledgeWarning
  'warning.editNote': EditWarningNote
  'designOption.create': CreateDesignOption
  'designOption.rename': RenameDesignOption
  'designOption.delete': DeleteDesignOption
}

export type PayloadOf<T extends IntentType = IntentType> = IntentPayloads[T]

/** The fields every Intent shares. */
export interface IntentFields {
  /** Shows in the undo/redo tooltip; taken from `labels.ts` (#66 scans it). */
  label: string
  /**
   * Pre-allocated by the caller (`crypto.randomUUID()` in the UI) and consumed in the
   * order `INTENT_ID_ORDER` states. Never generated inside a handler (#20 §4).
   */
  ids: string[]
  /** ISO timestamp read by the caller; v1 Intents store no timestamp of their own. */
  now: string
  /** Dependency-review choices (#20 §4). No v1 Intent reads it. */
  resolutions?: unknown
}

/**
 * One Intent. `Intent` is the whole catalogue as a discriminated union, so `switch
 * (intent.type)` narrows `payload`; `Intent<'cabinet.addShelf'>` is one member of it.
 */
export type Intent<T extends IntentType = IntentType> = {
  [K in T]: IntentFields & { type: K; payload: PayloadOf<K> }
}[T]

/**
 * The Intents of one family, so a locator can switch over its own types once instead of
 * repeating itself per Intent.
 */
export type ProjectIntent = Intent<'project.rename' | 'project.setPreferences'>
export type CabinetIntent = Intent<Extract<IntentType, `cabinet.${string}`>>
export type PlanIntent = Intent<Extract<IntentType, `plan.${string}`>>
export type WallIntent = Intent<Extract<IntentType, `wall.${string}`>>
export type RoomIntent = Intent<Extract<IntentType, `room.${string}`>>
export type OpeningIntent = Intent<Extract<IntentType, `opening.${string}`>>
export type DesignIntent = Intent<Extract<IntentType, `design.${string}`>>
export type FloorIntent = Intent<Extract<IntentType, `floor.${string}`>>
export type ViewIntent = Intent<Extract<IntentType, `view.${string}`>>
export type WarningIntent = Intent<Extract<IntentType, `warning.${string}`>>

/**
 * The IDs each S7 Intent consumes, in order — the contract between the caller that
 * allocates and the handler that spends. An empty list means the Intent needs no ID.
 *
 * The renovation set carries its own table beside its handlers, so a build without the flag
 * does not read a contract it cannot answer.
 */
export const INTENT_ID_ORDER: Record<S7IntentType, readonly string[]> = {
  'project.rename': [],
  'project.setPreferences': [],
  'cabinet.updateSettings': [],
  'cabinet.setMaterial': [],
  'cabinet.addUnit': ['itemDesignId', 'placedItemId', 'rootNodeId'],
  'cabinet.removeUnit': [],
  'cabinet.renameUnit': [],
  'cabinet.addShelf': ['nodeId…'],
  'cabinet.addDivider': ['nodeId…'],
  'cabinet.deleteBoard': [],
  'cabinet.setNodeSize': [],
  'cabinet.pinNode': [],
  'cabinet.unpinNode': [],
  'cabinet.setNodeLabel': [],
  'cabinet.distributeEvenly': [],
  'cabinet.setElementType': [],
  'cabinet.setDrawerConfig': [],
  'cabinet.setSplitRatio': [],
  'cabinet.addAccessory': ['accessoryId'],
  'cabinet.removeAccessory': [],
  'plan.addObject': ['itemDesignId', 'placedItemId'],
  'plan.placeDesign': ['placedItemId'],
  'plan.movePlacement': [],
  'plan.rotatePlacement': [],
  'plan.removeObject': [],
  'plan.addTemplate': ['itemDesignId'],
  'plan.removeTemplate': [],
  'plan.setImage': [],
  'plan.removeImage': [],
  'plan.calibrate': [],
  'plan.clear': [],
  'plan.copyToFloor': ['placedItemId…'],
  'plan.moveToFloor': [],
  'wall.createChain': ['wallId…', 'junctionId…'],
  'wall.dragJunction': [],
  'wall.dragEndpoint': [],
  'wall.dragBody': [],
  'wall.setLength': [],
  'wall.setDirection': [],
  'wall.setArc': [],
  'wall.setThickness': [],
  'wall.offset': [],
  'wall.split': ['wallId', 'junctionId'],
  'wall.merge': [],
  'wall.delete': [],
  'room.create': ['roomId', 'segmentId…'],
  'room.rename': [],
  'room.setOutline': ['segmentId…'],
  'room.attachFace': [],
  'room.detachFace': [],
  'room.placeShelter': ['roomId', 'openingId', 'wallId…', 'junctionId…', 'segmentId…'],
  'opening.create': ['openingId'],
  'opening.setStart': [],
  'opening.setWidth': [],
  'opening.flipHinge': [],
  'opening.flipSwing': [],
  'opening.rename': [],
  'opening.delete': [],
  'design.update': [],
  'design.setFootprint': [],
  'design.setOrigin': [],
  'design.fork': ['itemDesignId'],
  'floor.create': ['floorId', 'viewId'],
  'floor.rename': [],
  'floor.reorder': [],
  'floor.setLimits': [],
  'floor.setDefaultWallHeight': [],
  'floor.delete': [],
  'floor.duplicate': ['floorId', 'viewId', 'placedItemId…'],
  'view.create': ['viewId'],
  'view.rename': [],
  'view.delete': [],
  'view.setShowPlanImage': [],
  'warning.acknowledge': ['acknowledgementId'],
  'warning.editNote': [],
}

/**
 * The lookup `intentIdCount` reads: the S7 table, plus the renovation one in a build that
 * registers those handlers. With the flag off the ternary folds to the S7 table alone and the
 * import of the renovation module becomes dead, so a released bundle carries neither table.
 */
const ID_ORDER_BY_TYPE: Partial<Record<IntentType, readonly string[]>> = FF_RENOVATION
  ? { ...INTENT_ID_ORDER, ...RENOVATION_INTENT_ID_ORDER }
  : INTENT_ID_ORDER

/**
 * How many IDs an Intent spends. An entry ending in `…` stands for a count that depends on
 * the payload: a split turns one space into two and adds one board, so it spends two
 * however that tree is shaped, while duplicating a Floor spends one ID per copied Placed
 * Item on top of the Floor and its default view. Pass the payload to get the exact number;
 * without one a variadic entry is read as the tree-shaped two, which is every case that
 * predates #56.
 */
const VARIADIC_ID_COUNT = 2

/**
 * The Junction one drawn end takes part in, in the caller's vocabulary. Two ends share a
 * Junction exactly when their keys match: a chain link names the pair of ends in a fixed order,
 * a join to an existing end names that end, and a T-attach is its own Junction — two branches
 * butting the same host at the same point are two Junctions, because each has its own host
 * distance (#64 §9).
 */
export function wallEndKey(target: WallEndTarget, index: number, end: 'start' | 'end'): string {
  if (target.kind === 'free') return ''
  if (target.kind === 'segment') {
    return `s:${[`${target.index}:${target.end}`, `${index}:${end}`].sort().join('+')}`
  }
  if (target.kind === 'wall') return `w:${target.wallId}:${target.end}`
  return `h:${target.wallId}:${index}:${end}`
}

/** How many Junctions one chained draw creates: every distinct target its ends name. */
export function chainJunctionCount(payload: CreateWallChain): number {
  const keys = new Set<string>()
  payload.starts.forEach((target, index) => keys.add(wallEndKey(target, index, 'start')))
  payload.ends.forEach((target, index) => keys.add(wallEndKey(target, index, 'end')))
  keys.delete('')
  return keys.size
}

/** How many Edges a Room Outline shape has, and so how many Edge IDs it needs (#67 §1). */
export function roomSegmentCount(outline: RoomOutlineShape): number {
  return roomOutlinePath({ ...outline, segmentIds: [] }).segments.length
}

/** The IDs `room.placeShelter` spends: Room, door, 4 Walls, 4 junctions, 4 Edges (#67 §17). */
export const SHELTER_ID_COUNT = 14

export function intentIdCount(type: IntentType, payload?: PayloadOf): number {
  const order = ID_ORDER_BY_TYPE[type] ?? []
  if (order[order.length - 1]?.endsWith('…') !== true) return order.length
  const fixed = order.length - 1
  if (payload === undefined) return fixed + VARIADIC_ID_COUNT
  switch (type) {
    case 'floor.duplicate':
      return fixed + (payload as DuplicateFloor).placedItemIds.length
    case 'plan.copyToFloor':
      return (payload as CopyPlanObjectsToFloor).placedItemIds.length
    case 'wall.createChain': {
      const chain = payload as CreateWallChain
      return chain.walls.length + chainJunctionCount(chain)
    }
    case 'room.create':
      return 1 + roomSegmentCount((payload as CreateRoom).outline)
    case 'room.setOutline':
      return roomSegmentCount((payload as SetRoomOutline).outline)
    case 'room.placeShelter':
      // One Room, one door, four Walls, four junctions and the four Edges of the shelter's
      // Rectangle outline — fixed numbers, because the pack entry is fixed.
      return SHELTER_ID_COUNT
    default:
      return fixed + VARIADIC_ID_COUNT
  }
}

/** Where an edit landed, so undo can navigate to it (#48, #56). */
export interface Locator {
  /** `null` when the edit belongs to no Floor — a Project or template change. */
  floorId: EntityId | null
  /**
   * The saved Plan View the edit is about, when it is about one (#56). `null` means the
   * edit is not a view's own — the reader stays in whatever view of that Floor it is in.
   */
  viewId: EntityId | null
  view: 'cabinet' | 'plan'
  itemDesignIds: EntityId[]
  placedItemIds: EntityId[]
}

/** Every way an Intent can be refused. */
export type RejectionCode =
  /** The Intent changed nothing, so history would record an empty step. */
  | 'no-change'
  | 'unknown-target'
  /** `ids` held fewer IDs than the Intent spends. */
  | 'missing-ids'
  /** The whole Project failed the strict validator after the handler ran. */
  | 'invalid-project'
  /** The last cabinet on Floor 1, which the legacy store also refuses to remove. */
  | 'last-unit'
  /** A Floor still has things on it, and nothing here deletes them implicitly (#56). */
  | 'has-dependants'
  /** A Floor's own default Plan View, which goes only with the Floor (#56). */
  | 'default-view'
  /** A plan object below the legacy 10 mm minimum, which the UI clamps before sending. */
  | 'invalid-size'
  /** An Item Origin outside the Item Footprint, which the canvas never offers (#57). */
  | 'invalid-origin'
  /** An Item Footprint that describes no shape — overlapping radii, a zero side (#58). */
  | 'invalid-shape'
  /** `cabinet` refused the tree operation: an already split or over-deep space. */
  | 'invalid-tree'
  /** A Wall edit the model cannot represent: a hosted end dragged off its host, a Junction
   * whose chain link does not name itself back, a length that leaves nothing behind (#64). */
  | 'invalid-wall'
  /** Two Walls that do not match well enough to become one; the message says what differs (#64 §10). */
  | 'merge-mismatch'
  /** A split point too close to a hosted Junction, where the host's `at` would go out of range (#64 §10). */
  | 'split-blocked'
  /** An Opening — or a Wall edit that would leave one — outside its host's usable interval (#65 §3, §7). */
  | 'opening-blocked'
  /** A dependency review answered against a Project that has changed since it was shown (#65 §8). */
  | 'dependency-changed'
  /** An Opening edit this Opening cannot represent: a window has no hinge, a sliding door no side (#65 §6). */
  | 'invalid-opening'
  /** A Room proposal that overlaps another Room, or a Wall edit a referenced Room edge cannot follow (#67 §7, §12). */
  | 'room-blocked'
  /** A Design Option the Project cannot hold: a name another Option already answers to (#69 §2). */
  | 'option-blocked'

/**
 * What an Intent takes with it, listed before it runs (#20 §4, #65 §8).
 *
 * `previewIntent` builds the report, the UI turns the answer into resolutions inside the
 * Intent, and the handler re-checks them. One shape for every review the catalogue has, so
 * a second dialog framework is never needed.
 */
export interface DeleteWallReview {
  /** Which review this is, so the dialog knows how to word its buttons. */
  readonly kind: 'delete-wall'
  readonly wallId: EntityId
  /** `W-3` — the Wall that is about to go. */
  readonly wallRef: string
  /** Every Opening that goes with it, in the order the dialog lists them. */
  readonly openings: readonly OpeningDependency[]
  /** `Delete W-3 and its openings?` — the question the dialog asks. */
  readonly message: string
}

/**
 * `Delete <Option>?` (#69 §2, criterion 9): what the Option holds, so the dialog can name the
 * counts before the user loses them. Deleting an Option removes its own records and its
 * acknowledgements and nothing else — the Existing Model and every other Option come through
 * byte-identical — and one undo brings the whole Option back.
 */
export interface DeleteDesignOptionReview {
  readonly kind: 'delete-design-option'
  readonly optionId: EntityId
  readonly optionName: string
  /** How many records of each kind the Option owns. */
  readonly counts: {
    readonly walls: number
    readonly wallJunctions: number
    readonly openings: number
    readonly rooms: number
    readonly placedItems: number
    /** Existing entities this Option removes, which go back to standing when it is deleted. */
    readonly demolished: number
    readonly acknowledgements: number
  }
  readonly message: string
}

/** What an Intent would take with it, per review family. */
export type DependencyReview = DeleteWallReview | DeleteDesignOptionReview

export interface Applied {
  ok: true
  project: Project
  patches: Patch[]
  inversePatches: Patch[]
  affected: Locator
}

export interface Rejection {
  ok: false
  code: RejectionCode
  /** The validator's problems, or one problem naming what the handler refused. */
  problems: ValidationProblem[]
}
