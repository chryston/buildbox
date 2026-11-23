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
  ElevationViewLine,
  ElevationViewSide,
  GlobalSettings,
  ItemFootprint,
  HingeSide,
  Opening,
  OpeningDependency,
  OpeningKind,
  OpeningSwing,
  PlanImage,
  Point2,
  PathRoomOutline,
  PlacedItem,
  PresetRoomOutline,
  Project,
  RenovationDisplay,
  Room,
  Wall,
  WallClassification,
  WallFaceSide,
  WallJustification,
  WallRefLine,
} from '../domain'
import { roomOutlinePath } from '../domain'
import type { KeepFixed, Pt } from '../geometry'

import type { ValidationProblem } from '../lib'
import { RENOVATION_EDIT_INTENT_ID_ORDER } from './handlers/renovationEdits'
import { CORRECTION_INTENT_ID_ORDER } from './handlers/correctionHandlers'
import { RENOVATION_INTENT_ID_ORDER } from './handlers/renovationHandlers'
import { LAYER_INTENT_ID_ORDER } from './handlers/layerHandlers'
import { PASTE_INTENT_ID_ORDER } from './handlers/pasteHandlers'
import { ELEVATION_INTENT_ID_ORDER } from './handlers/elevationHandlers'
import type { CopySet } from './copySet'

/**
 * Every Intent type the released catalogue answers (#47), one per current store action.
 *
 * This is the S7 set, kept apart from #69's renovation set because the two are stated separately:
 * the handlers, labels and ID orders of `RenovationIntentType` live in their own registration
 * (#69 §13), and the two sets together are what `applyIntent` answers. The types are one union
 * either way — a type is not a byte.
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
  | 'plan.setPlacementVerticalExtent'
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
  | 'wall.setVerticalExtent'
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
  | 'opening.setVerticalExtent'
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
  | 'view.setPlanViewRange'
  | 'warning.acknowledge'
  | 'warning.editNote'

/**
 * The Intents #69 and #70 add to the released catalogue.
 *
 * The last two are the saved-view settings of #70 §1. They are renovation Intents rather than S7
 * ones because the thing they change only exists with a Design Option or a Display to change — and
 * because a Display switch is a command the user takes back as one step, which is what an Intent is
 * for.
 */
export type RenovationIntentType =
  | 'designOption.create'
  | 'designOption.rename'
  | 'designOption.delete'
  | 'renovation.placeOpening'
  | 'renovation.knockThrough'
  | 'renovation.demolish'
  | 'renovation.replace'
  | 'renovation.restore'
  | 'renovation.correctExistingModel'
  | 'renovation.moveToDesignOption'
  | 'view.setDesignOption'
  | 'view.setRenovationDisplay'
  | 'layer.add'
  | 'layer.rename'
  | 'layer.setColor'
  | 'layer.move'
  | 'layer.delete'
  | 'view.setLayerSetting'
  | 'view.setLayerOrder'
  | 'view.setActiveLayer'
  | 'view.setSnapToHidden'
  | 'entity.setLayer'
  | 'renovation.pasteFromProject'
  | 'elevationView.create'
  | 'elevationView.edit'
  | 'elevationView.delete'

/** Every Intent type the catalogue can answer: the S7 set plus the renovation set. */
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
  target?: {
    designOptionId: EntityId | null
    /**
     * The saved view the tool was used in, which is what decides the Drawing Layer new content lands
     * on and whether that layer may be edited here at all (#71 §2). Absent means no saved view is in
     * play — a Project-level surface, or a caller that predates layers — and the layer's Project
     * defaults apply: new content still goes to its default layer, and nothing is refused.
     */
    viewId?: EntityId | null
  }
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
 * Which of the three Vertical Extent boxes was committed (#74 §5).
 *
 * One Intent carries the three fields rather than three Intents, because they are one control over
 * one pair of elevations and differ only in which two of the three numbers are held still — the
 * difference is one line of arithmetic in the handler, and a second and third Intent type would
 * multiply the labels, the ID order and the undo menu for no decision the user ever makes.
 */
export type VerticalExtentField = 'base' | 'height' | 'top'
/** The fields a Placed Item has: it owns a base and no height, so there is no `height` box (#74 §5). */
export type PlacementVerticalExtentField = Extract<VerticalExtentField, 'base' | 'top'>
/**
 * One Vertical Extent box of a Placed Item (#74 §5), in millimetres from the Floor Datum.
 *
 * `top` moves the item — the new base is the entered top minus the height its Item Design owns — and
 * writes nothing to the Design. That is the whole of #74 §7's no-per-placement-copy guard: a Placed
 * Item record has no `height` field to write, and this Intent is the only place a top is answered.
 */
export interface SetPlacementVerticalExtent {
  placedItemId: EntityId
  field: PlacementVerticalExtentField
  value: number
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
  /**
   * The view this one was made from (#70 §1). A new Plan View copies the Design Option and the
   * Renovation Display of the view the user was looking at, because "New view" means "the same
   * thing, differently" — a view that arrives back at the Existing Model makes the user re-aim it
   * before they can see what they duplicated. Absent, or a view that no longer exists, is the
   * Floor's default view; with no default either, the Existing Model on the Existing Display.
   */
  fromViewId?: EntityId
}
/**
 * A named Elevation View on a Floor (#75 §1, §3).
 *
 * The record is a view line, a side and a distance — nothing else. The view stores no copy of the
 * world it looks at, so making one changes no Wall, no Opening and no Placed Item, and the same
 * world read from the other side of the line is a second view rather than a second world.
 */
export interface CreateElevationView {
  floorId: EntityId
  /**
   * The view this one takes its Design Option and Renovation Display from, exactly as a new Plan View
   * takes them (#70 §1). Absent, or a view that no longer exists, is the Floor's own Plan View.
   */
  fromViewId?: EntityId
  /** Two places on the Floor the view runs between, in Floor coordinates. */
  line: ElevationViewLine
  /** Which side of that line the view stands on. */
  side: ElevationViewSide
  /** How far in front of the line the view reaches, in millimetres, and always more than zero. */
  depth: number
  /** Blank or absent is filled with the next free `Elevation N` on the Floor, in this same step. */
  name?: string
}
/** One field at a time, and never the Floor the view belongs to (#75 §3). */
export interface EditElevationView {
  viewId: EntityId
  name?: string
  side?: ElevationViewSide
  depth?: number
  line?: ElevationViewLine
}
export interface DeleteElevationView {
  viewId: EntityId
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
 * The Plan View Range of one saved view (#74 §1, §4): the two elevations, from the Floor Datum, that
 * this view draws between.
 *
 * The range belongs to the view and to nothing else, so the payload names the view — the caller sends
 * the one the saved-view card is showing, which is the only view a range change is allowed to touch.
 * Both numbers arrive already in millimetres: the field component holds the display unit and converts
 * what was typed, so the Intent carries the value that gets stored rather than a string plus a unit to
 * read it with.
 */
export interface SetPlanViewRange {
  viewId: EntityId
  lowerMm: number
  upperMm: number
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

/**
 * One Vertical Extent box of a Wall (#74 §5), in millimetres from the Floor Datum.
 *
 * `base` carries the height with it, `height` grows the top off the base it keeps, `top` holds the
 * base and restates the height. Nothing here moves the reference line, so no face, no Junction and
 * no hosted Opening shifts — which is why this Intent is not wrapped in the Wall-fit check every
 * geometry edit of #65 §7 pays.
 */
export interface SetWallVerticalExtent {
  wallId: EntityId
  field: VerticalExtentField
  value: number
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

/**
 * One Vertical Extent box of an Opening (#74 §5), in millimetres from the Floor Datum. `base` is the
 * sill and `top` the head, which are the two numbers the record already keeps.
 *
 * The host is never part of this: an Opening stays in the Wall it was cut into however its elevation
 * moves (#74 §5), and the Wall it stands in is tall enough for the whole storey in every case the
 * inspector offers.
 */
export interface SetOpeningVerticalExtent {
  openingId: EntityId
  field: VerticalExtentField
  value: number
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

/**
 * Cut a new door or window into a Wall **from inside an Option** (#69 §7 row 1). The same fields
 * `opening.create` takes, plus the Option the proposed Opening belongs to: the host is read from
 * what stands in that Option and is never replaced by this Intent.
 */
export interface PlaceOpeningInOption {
  floorId: EntityId
  hostWallId: EntityId
  kind: OpeningKind
  label: string
  start: number
  width: number
  sill: number
  head: number
  swing?: OpeningSwing
  hingeSide?: HingeSide
  /** Always an Option: this Intent has no Existing-Model form, which is `opening.create`. */
  target: { designOptionId: EntityId; viewId?: EntityId | null }
}

/**
 * Knock through part of a wall (#69 §7 row 2): a proposed `removed_section` with sill 0 and head
 * at the host's height, so the gap is the whole of the Wall's Vertical Extent.
 */
export interface KnockThroughInOption {
  floorId: EntityId
  hostWallId: EntityId
  label: string
  start: number
  width: number
  target: { designOptionId: EntityId; viewId?: EntityId | null }
}

/**
 * Mark demolition (#69 §7 rows 3–4): one demolition record per entity, in one Edit Transaction.
 *
 * A Wall takes the Openings its dependency review listed back with it — the answer the user
 * confirmed — and an answer that no longer matches what the Project now says is refused.
 */
export interface DemolishInOption {
  entityId: EntityId
  /** The dependants the review listed, in the order it listed them. */
  dependants?: EntityId[]
  target: { designOptionId: EntityId }
}

/**
 * The fields a successor carries instead of its predecessor's. Everything the edit leaves out is
 * copied, so a replace changes the dimensions the user typed rather than the whole record (#69 §7).
 */
export type ReplaceEdit =
  | Partial<Omit<Wall, 'id' | 'ref' | 'floorId' | 'predecessorIds'>>
  | Partial<Omit<Opening, 'id' | 'floorId' | 'hostWallId' | 'predecessorIds'>>
  | Partial<Omit<Room, 'id' | 'floorId' | 'predecessorIds'>>
  | Partial<Omit<PlacedItem, 'id' | 'floorId' | 'predecessorIds'>>

/**
 * Replace (dimensions) and Replace (identity): the entity comes down and a successor takes its
 * place carrying the edit, named after its predecessor with a prime on the end (#69 §3, §7). The
 * Openings cut into a replaced Wall are carried onto the successor the same way, and the joins that
 * still land on the new geometry are carried as this Option's own Junctions.
 */
export interface ReplaceInOption {
  entityId: EntityId
  edit: ReplaceEdit
  target: { designOptionId: EntityId }
}

/**
 * Restore: put back what stands here (#69 §9). The demolition record goes, and so does everything
 * this Option built out of the entity — its successors, the copies carried onto them, the Junctions
 * and Rooms that followed — which is why the preview lists what is deleted before it is agreed to.
 */
export interface RestoreInOption {
  entityId: EntityId
  target: { designOptionId: EntityId }
}

/**
 * Correct the Existing Model (#69 §12): the baseline edit the user asked for, wrapped so it is
 * previewed against every Design Option and committed as one Edit Transaction.
 *
 * The wrapper carries no field of its own beyond the inner Intent — which is any Existing Model edit
 * the catalogue knows — because the correction is defined by what it wraps, not by a second list of
 * every editable thing.
 */
export interface CorrectExistingModel {
  inner: Intent
}

/**
 * Move to a Design Option (#69 §13): baseline data that was surveyed by mistake becomes the target
 * Option's own work. The IDs are kept, so nothing that refers to these entities has to be rewritten;
 * no demolition record is written anywhere, because nothing comes down.
 */
export interface MoveToDesignOption {
  entityIds: EntityId[]
  targetOptionId: EntityId
}

/**
 * Which Design Option this saved view looks through (#70 §1).
 *
 * `null` is the Existing Model alone, and it is a thing the user chooses — the first card in the
 * Option section — not a missing value. The Display is untouched: the two settings are two commands
 * and two undo steps, because switching Option and switching Display are different questions.
 */
export interface SetViewDesignOption {
  viewId: EntityId
  designOptionId: EntityId | null
}

/** Which Renovation Display this saved view draws (#70 §1). */
export interface SetViewRenovationDisplay {
  viewId: EntityId
  renovationDisplay: RenovationDisplay
}

/**
 * A new Drawing Layer (#71 §2).
 *
 * One ID is spent, and the layer joins the Project order at the front — the end of the array, which
 * is the end a person sees at the top of the list. The colour arrives with the name because the
 * swatch is part of the same row the user is filling in, and a layer created with no colour would
 * have to be given one before it could be recognised on the canvas.
 */
export interface AddDrawingLayer {
  name: string
  color: string
}

/** Rename a Drawing Layer (#71 §2). The colour is left alone. */
export interface RenameDrawingLayer {
  layerId: EntityId
  name: string
}

/** Change a Drawing Layer's colour (#71 §2). The name is left alone. */
export interface SetDrawingLayerColor {
  layerId: EntityId
  color: string
}

/**
 * One step in the Project layer order (#71 §2).
 *
 * `forward` moves a layer toward the front — later in the array, drawn on top — and `back` toward
 * the rear. A layer already at the end cannot go further, which is refused rather than silently
 * doing nothing, because the row the user dragged has to say why it snapped back.
 */
export interface MoveDrawingLayer {
  layerId: EntityId
  direction: 'forward' | 'back'
}

/**
 * Delete a Drawing Layer (#71 §5).
 *
 * `viewId` is the view the dialog is standing in, and it is only there to answer one question of the
 * review — whether the content this delete un-files will still be visible afterwards, which depends
 * on whether the Unlayered row is visible *here*. It changes nothing about what the delete does.
 */
export interface DeleteDrawingLayer {
  layerId: EntityId
  viewId: EntityId | null
}

/**
 * One view's override of one layer's setting (#71 §3).
 *
 * A field set to `null` hands that one answer back to the Project default, and a view that ends up
 * matching the default on all four holds no override at all — the key is dropped, so a view that was
 * toggled back to the way it started is byte-identical to a view that was never touched.
 */
export interface SetViewLayerSetting {
  viewId: EntityId
  /** A layer's ID, or `unlayered` for the row that holds content with no layer of its own. */
  layerKey: string
  setting: {
    visible?: boolean | null
    selectable?: boolean | null
    editable?: boolean | null
    color?: string | null
  }
}

/**
 * This view's own layer order (#71 §3), or `null` to follow the Project's.
 *
 * The whole array, never one move: a partial order could not say where a layer added later sits, and
 * two views disagreeing about half a list is a worse surprise than two views disagreeing about all
 * of it.
 */
export interface SetViewLayerOrder {
  viewId: EntityId
  layerOrder: readonly EntityId[] | null
}

/** The layer new content lands on in this view (#71 §4), or `null` for Unlayered. */
export interface SetViewActiveLayer {
  viewId: EntityId
  layerId: EntityId | null
}

/** Whether this view may snap to content it is not drawing (#71 §3). */
export interface SetViewSnapToHidden {
  viewId: EntityId
  snapToHidden: boolean
}

/**
 * Which layer one record sits on (#71 §5), or `null` to take it off every one.
 *
 * This is presentation, not a change to the record: which layer a Wall is filed on decides whether
 * it is drawn, pickable and editable in a given view, and never what the Wall is. That is why an
 * Existing record can be re-filed while Design Options exist without the correction dialog (#71 §5).
 */
export interface SetEntityLayer {
  entityId: EntityId
  layerId: EntityId | null
}

/**
 * The cross-Project paste (#72 §4, §5).
 *
 * The payload is the by-value snapshot `Copy` took in the other Project — nothing about the
 * destination, because the same clipboard entry pasted into a second Project is a different edit.
 * Where it lands is read off the view it was asked in: its Design Option takes the work, its Floor
 * owns it, and its display decides whether the Existing Model is being corrected (#72 Scope 2).
 *
 * The IDs are pre-allocated like every other Intent's, in the order `PASTE_INTENT_ID_ORDER` states,
 * and the count depends only on this payload: one per copied record, one per Item Design it brings,
 * one per source Layer. A Layer the mapping sends onto an existing one, and an Opening dropped for
 * want of its Wall, leave their slots unspent rather than shifting the ones after them.
 */
export interface PasteFromOtherProject {
  /** The Floor the copy stands on — the Floor of the view it was pasted into. */
  floorId: EntityId
  /** The saved view the paste was asked in: it decides the container and the undo target. */
  viewId: EntityId
  copySet: CopySet
}

/** Where one source Layer's work goes: onto a Layer this Project has, onto a new one, or nowhere. */
export type PasteLayerTarget =
  | { readonly kind: 'existing'; readonly layerId: EntityId }
  | { readonly kind: 'new' }
  | { readonly kind: 'unlayered' }

/** One row of the mapping dialog's answer. */
export interface PasteLayerResolution {
  readonly sourceLayerId: EntityId
  readonly target: PasteLayerTarget
}

/**
 * The mapping the review was answered with (#72 §5). It rides `resolutions` rather than the payload
 * because it is an answer to a question the review asked, and the handler re-checks it the way every
 * other review's answer is re-checked: a paste with a used Layer left unasked is refused, not guessed.
 */
export interface PasteResolutions {
  readonly layers: readonly PasteLayerResolution[]
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
  'plan.setPlacementVerticalExtent': SetPlacementVerticalExtent & IntentTarget
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
  'wall.setVerticalExtent': SetWallVerticalExtent & IntentTarget
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
  'opening.setVerticalExtent': SetOpeningVerticalExtent & IntentTarget
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
  'view.setPlanViewRange': SetPlanViewRange
  'elevationView.create': CreateElevationView
  'elevationView.edit': EditElevationView
  'elevationView.delete': DeleteElevationView
  'warning.acknowledge': AcknowledgeWarning
  'warning.editNote': EditWarningNote
  'designOption.create': CreateDesignOption
  'designOption.rename': RenameDesignOption
  'designOption.delete': DeleteDesignOption
  'renovation.placeOpening': PlaceOpeningInOption
  'renovation.knockThrough': KnockThroughInOption
  'renovation.demolish': DemolishInOption
  'renovation.replace': ReplaceInOption
  'renovation.restore': RestoreInOption
  'renovation.correctExistingModel': CorrectExistingModel
  'renovation.moveToDesignOption': MoveToDesignOption
  'view.setDesignOption': SetViewDesignOption
  'view.setRenovationDisplay': SetViewRenovationDisplay
  'layer.add': AddDrawingLayer
  'layer.rename': RenameDrawingLayer
  'layer.setColor': SetDrawingLayerColor
  'layer.move': MoveDrawingLayer
  'layer.delete': DeleteDrawingLayer
  'view.setLayerSetting': SetViewLayerSetting
  'view.setLayerOrder': SetViewLayerOrder
  'view.setActiveLayer': SetViewActiveLayer
  'view.setSnapToHidden': SetViewSnapToHidden
  'entity.setLayer': SetEntityLayer & IntentTarget
  'renovation.pasteFromProject': PasteFromOtherProject
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
/**
 * The saved-view Intents the `./handlers/floorHandlers` map answers on its own. `S7IntentType`
 * and not `IntentType`, because `view.setDesignOption` and `view.setRenovationDisplay` (#70 §1) live
 * in `./handlers/renovationHandlers` — the same reason `designOption.*` is absent from `DesignIntent`.
 */
export type ViewIntent = Intent<Extract<S7IntentType, `view.${string}`>>
export type WarningIntent = Intent<Extract<IntentType, `warning.${string}`>>

/**
 * The IDs each S7 Intent consumes, in order — the contract between the caller that
 * allocates and the handler that spends. An empty list means the Intent needs no ID.
 *
 * The renovation set carries its own table beside its handlers, so the contract a caller reads is
 * the one the registry it got can answer.
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
  'plan.setPlacementVerticalExtent': [],
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
  'wall.setVerticalExtent': [],
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
  'opening.setVerticalExtent': [],
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
  'view.setPlanViewRange': [],
  'warning.acknowledge': ['acknowledgementId'],
  'warning.editNote': [],
}

/**
 * The lookup `intentIdCount` reads: the S7 table and the renovation table, one map by type.
 */
const ID_ORDER_BY_TYPE: Partial<Record<IntentType, readonly string[]>> = {
  ...INTENT_ID_ORDER,
  ...RENOVATION_INTENT_ID_ORDER,
  ...RENOVATION_EDIT_INTENT_ID_ORDER,
  ...CORRECTION_INTENT_ID_ORDER,
  ...LAYER_INTENT_ID_ORDER,
  ...PASTE_INTENT_ID_ORDER,
  ...ELEVATION_INTENT_ID_ORDER,
}

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

/**
 * How many carries a `renovation.replace` is given IDs for. How many Openings, Junctions and Rooms
 * a replace carries belongs to the Project rather than to the payload, so the caller is handed a
 * generous number and a replace that needs more is refused with `missing-ids`.
 */
export const REPLACE_CARRY_ID_COUNT = 20

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
    case 'renovation.replace':
      return fixed + REPLACE_CARRY_ID_COUNT
    case 'renovation.correctExistingModel': {
      // A correction spends exactly what the edit it wraps spends: it creates nothing of its own,
      // and an Option's aligned successor is re-run with no IDs at all (#69 §12).
      const inner = (payload as CorrectExistingModel).inner
      return intentIdCount(inner.type, inner.payload)
    }
    case 'renovation.pasteFromProject': {
      // One ID per copied record, one per Item Design it brings, one per source Layer (#72 §4).
      // Read straight off the snapshot so the count needs nothing but the payload: a Layer sent
      // onto one this Project already has, and an Opening dropped for want of its Wall, leave
      // their slots unspent rather than shifting the ones after them.
      const pasted = (payload as PasteFromOtherProject).copySet
      const { walls, wallJunctions, openings, rooms, placedItems } = pasted.entities
      return (
        walls.length +
        wallJunctions.length +
        openings.length +
        rooms.length +
        placedItems.length +
        pasted.itemDesigns.length +
        pasted.layers.length
      )
    }
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
  /** Two Walls of the Existing Model, which no renovation merges: the baseline is the record every
   * option is drawn against, so this is a correction of it (#69 §11). */
  | 'baseline-correction-required'
  /** A Drawing Layer this view will not accept: it is read-only here, or it is not a layer the
   * Project has (#71 §4, §5). */
  | 'layer-blocked'
  /** A Vertical Extent or Plan View Range that describes no band of height: a value that is not a
   * number, a height of 0 or less, a top at or below its base, a Lower not below its Upper (#74 §4, §5). */
  | 'invalid-extent'

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
    /**
     * How many saved views were looking through this Option (#70 §1). Deleting the Option sets each
     * of them to no Design Option in the same transaction, so the dialog says so before the user
     * loses the Option they may have been looking at.
     */
    readonly views: number
  }
  /** The affected saved views, by name, in Project order — the rows the dialog lists. */
  readonly viewNames: readonly string[]
  readonly message: string
}

/**
 * `Delete <Layer>?` (#71 §5): what the layer holds, and what the delete does to it.
 *
 * Nothing is destroyed. Every record on the layer is un-filed — it comes back `Unlayered` — and every
 * view's override and order entry for the layer is dropped, so one undo puts the layer, its members
 * and each view's settings back together. What the dialog has to say is therefore about *visibility*:
 * content that was on a visible layer is about to be governed by the Unlayered row instead, and if
 * that row is hidden here the content simply disappears from this view.
 */
export interface DeleteLayerReview {
  readonly kind: 'delete-layer'
  readonly layerId: EntityId
  readonly layerName: string
  readonly counts: {
    /** Model records on the layer — Walls, Openings, Rooms and Placed Items together. */
    readonly model: number
    /**
     * Annotations on the layer. Always zero today: annotations are #72, and the row exists so the
     * dialog already has the line when they arrive rather than changing what a delete promises.
     */
    readonly annotations: number
    /** How many saved views hold an override or an order of their own that this drops. */
    readonly overrides: number
  }
  /** The affected saved views, by name, in Project order. */
  readonly viewNames: readonly string[]
  /** The first eight records that will come back Unlayered, labelled as the canvas labels them. */
  readonly members: readonly DemolitionDependency[]
  /** Whether anything at all is on the layer, which is the case the dialog keeps short. */
  readonly unused: boolean
  /**
   * Whether the Unlayered row is hidden in the view the dialog is standing in — the difference
   * between "it moves to Unlayered" and "it stops being drawn here".
   */
  readonly unlayeredHidden: boolean
  readonly message: string
}

/** One thing a demolition takes with it, named the way the dialog names it. */
export interface DemolitionDependency {
  readonly id: EntityId
  /** `Door 1`. */
  readonly label: string
}

/**
 * `Demolish W-3?` (#69 §8): what goes with the Wall, and what stands in the way. `blockers` empty
 * is what lets the dialog's confirm action answer at all; `applyIntent` re-runs the same question
 * and refuses an answer the Project has moved on from with `dependency-changed`.
 */
export interface DemolitionReview {
  readonly kind: 'demolish'
  readonly entityId: EntityId
  /** `W-3` — the subject of the question. */
  readonly entityRef: string
  /** Every Existing Opening that goes with the Wall, in the order the dialog lists them. */
  readonly willDemolish: readonly DemolitionDependency[]
  /** One sentence each: why the confirm action is disabled. */
  readonly blockers: readonly string[]
  /** `Demolish W-3?` */
  readonly message: string
}

/**
 * `Restore W-3?` (#69 §9): the successors that come down with the restoration, and the demolition
 * records that stay because a merge successor named another entity too.
 */
export interface RestoreReview {
  readonly kind: 'restore'
  readonly entityId: EntityId
  /** `W-3` — the entity that stands again. */
  readonly entityRef: string
  /** Every proposed record this Option loses, in the order the warning lists them. */
  readonly deletes: readonly DemolitionDependency[]
  /** Existing entities that stay demolished, because a merge successor named them as well. */
  readonly keeps: readonly DemolitionDependency[]
  /** `Restore W-3?` */
  readonly message: string
}

/**
 * What one Design Option would do with a correction (#69 §12). The four answers are the whole of
 * the rule: an Option that keeps the entity, an Option that takes it down, and the two kinds of
 * successor — one still standing where the survey put it, which follows the correction, and one the
 * user has given geometry of its own, which does not.
 */
export type CorrectionEffect = 'retains' | 'demolishes' | 'demolishes; successor stays aligned' | 'demolishes; successor keeps its own geometry'

/** One Option's line of a correction preview. */
export interface CorrectionOptionReview {
  readonly optionId: EntityId
  readonly optionName: string
  readonly effect: CorrectionEffect
  /** The Option's own work that moves with the correction: successors, joins, Openings, Room edges. */
  readonly dependants: readonly DemolitionDependency[]
  /** One sentence each, naming this Option: why the correction is refused outright. */
  readonly blockers: readonly string[]
}

/**
 * `Correct Existing Model: W-2` (#69 §12): one line per Option, in option order, so the dialog can
 * show what every alternative does before the baseline moves.
 */
export interface CorrectionReview {
  readonly kind: 'correct-existing-model'
  readonly entityId: EntityId
  /** `W-2` — the entity the correction is about. */
  readonly entityRef: string
  readonly options: readonly CorrectionOptionReview[]
  /** `Correct Existing Model: W-2` — the label of the Edit Transaction this writes. */
  readonly message: string
}

/** One Option's line of a move preview (#69 §13). */
export interface MoveOptionReview {
  readonly optionId: EntityId
  readonly optionName: string
  /** The demolition records this Option drops, because the entity is no longer Existing work. */
  readonly removesDemolitions: readonly DemolitionDependency[]
  /** The Rooms of this Option whose Edge referenced a Wall that is moving. */
  readonly detaches: readonly string[]
  readonly blockers: readonly string[]
}

/**
 * `Move 2 items to Option A?` (#69 §13): what leaves the Existing Model, and what each Option
 * notices when it does.
 */
export interface MoveToOptionReview {
  readonly kind: 'move-to-design-option'
  readonly targetOptionId: EntityId
  readonly targetOptionName: string
  /** Every entity that becomes Proposed, with the entities taken along with it. */
  readonly moves: readonly DemolitionDependency[]
  readonly options: readonly MoveOptionReview[]
  readonly message: string
}

/** Where pasted work would land, per the ownership table of #72 Scope 2. */
export type PasteDestination =
  /** Proposed or Combined display: the work belongs to that Option, and only that Option sees it. */
  | { readonly kind: 'option'; readonly designOptionId: EntityId; readonly designOptionName: string }
  /** Existing display of a Project with no Design Options: the shared baseline takes it, alone. */
  | { readonly kind: 'existing' }
  /**
   * Existing display with Design Options drawn against the baseline: the write is the same one, but
   * it has to travel inside a baseline correction so every Option is reviewed first (#70 §7).
   */
  | { readonly kind: 'correct-existing' }
  /** Demolition display, or a Proposed/Combined display with no Option chosen: nothing is written. */
  | { readonly kind: 'blocked'; readonly reason: string }

/** One source Drawing Layer, and what the destination offers for it (#72 §5). */
export interface PasteLayerRow {
  readonly sourceLayerId: EntityId
  readonly sourceLayerName: string
  readonly sourceLayerColor: string
  /** How many of the pasted entities ride this layer. */
  readonly itemCount: number
  /** The destination layer with the same name, when one has it — a suggestion, never a decision. */
  readonly suggestedLayerId: EntityId | null
  readonly suggestedLayerName: string | null
}

/** One record the paste cannot bring whole: the dialog lists these under its own heading. */
export interface PasteLoss {
  /** `Door 1`, `Kitchen edge 2` — what the person would look for on the drawing. */
  readonly ref: string
  readonly reason: string
}

/** `Paste from “Unit 4 Fitout” — map Drawing Layers`, in data form (#72 §5). */
export interface PasteReview {
  readonly kind: 'paste-from-project'
  readonly sourceProjectId: EntityId
  readonly sourceProjectName: string
  /** The records that come across — the `<n>` of `Paste <n> entities from …`. */
  readonly entityCount: number
  /** The records that ride no layer. They need no row: they stay Unlayered here too. */
  readonly unlayeredCount: number
  /** One row per source layer the pasted entities actually use, in the source's own order. */
  readonly rows: readonly PasteLayerRow[]
  readonly notComingAcross: readonly PasteLoss[]
  readonly detached: readonly PasteLoss[]
  readonly destination: PasteDestination
}

/** What an Intent takes with it, per review family. */
export type DependencyReview =
  | DeleteWallReview
  | DeleteDesignOptionReview
  | DeleteLayerReview
  | DemolitionReview
  | RestoreReview
  | CorrectionReview
  | MoveToOptionReview
  | PasteReview

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
