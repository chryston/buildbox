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
  PlanImage,
  Point2,
  Project,
} from '../domain'
import type { ValidationProblem } from '../lib'

/** Every Intent type in the #47 catalogue, one per current store action. */
export type IntentType =
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
  | 'design.update'
  | 'design.setOrigin'
  | 'design.fork'
  | 'floor.create'
  | 'floor.rename'
  | 'floor.reorder'
  | 'floor.setLimits'
  | 'floor.delete'
  | 'floor.duplicate'
  | 'view.create'
  | 'view.rename'
  | 'view.delete'
  | 'view.setShowPlanImage'

/** The payload each Intent type carries. */
export interface RenameProject {
  name: string
}
export interface SetProjectPreferences {
  displayUnit: DisplayUnit
  displayPrecision: number
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
 * The design-level half of the inspector (#57 behaviour 30): name, colour and, for a
 * rectangle footprint, size. Every Placed Item of this Item Design changes with it, which
 * is why the view previews the result and says `Affects N placements` before it commits.
 *
 * A size change keeps the Item Origin where it is — the footprint grows about the point the
 * placement is pinned to — unless the Origin sat at the old footprint's centre, in which
 * case it follows the new one so `Centre` keeps meaning centre.
 */
export interface UpdateItemDesign {
  itemDesignId: EntityId
  patch: {
    name?: string
    /** `#rrggbb`, lowercase. */
    color?: string
    width?: number
    depth?: number
  }
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
  'plan.addObject': AddPlanObject
  'plan.placeDesign': PlacePlanDesign
  'plan.movePlacement': MovePlanPlacement
  'plan.rotatePlacement': RotatePlanPlacement
  'plan.removeObject': RemovePlanObject
  'plan.addTemplate': AddPlanTemplate
  'plan.removeTemplate': RemovePlanTemplate
  'plan.setImage': SetPlanImage
  'plan.removeImage': RemovePlanImage
  'plan.calibrate': CalibratePlan
  'plan.clear': ClearPlan
  'plan.copyToFloor': CopyPlanObjectsToFloor
  'plan.moveToFloor': MovePlanObjectsToFloor
  'design.update': UpdateItemDesign
  'design.setOrigin': SetItemDesignOrigin
  'design.fork': ForkItemDesign
  'floor.create': CreateFloor
  'floor.rename': RenameFloor
  'floor.reorder': ReorderFloor
  'floor.setLimits': SetFloorLimits
  'floor.delete': DeleteFloor
  'floor.duplicate': DuplicateFloor
  'view.create': CreatePlanView
  'view.rename': RenamePlanView
  'view.delete': DeletePlanView
  'view.setShowPlanImage': SetPlanViewShowsPlanImage
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
export type DesignIntent = Intent<Extract<IntentType, `design.${string}`>>
export type FloorIntent = Intent<Extract<IntentType, `floor.${string}`>>
export type ViewIntent = Intent<Extract<IntentType, `view.${string}`>>

/**
 * The IDs each Intent consumes, in order — the contract between the caller that
 * allocates and the handler that spends. An empty list means the Intent needs no ID.
 */
export const INTENT_ID_ORDER: Record<IntentType, readonly string[]> = {
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
  'design.update': [],
  'design.setOrigin': [],
  'design.fork': ['itemDesignId'],
  'floor.create': ['floorId', 'viewId'],
  'floor.rename': [],
  'floor.reorder': [],
  'floor.setLimits': [],
  'floor.delete': [],
  'floor.duplicate': ['floorId', 'viewId', 'placedItemId…'],
  'view.create': ['viewId'],
  'view.rename': [],
  'view.delete': [],
  'view.setShowPlanImage': [],
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

export function intentIdCount(type: IntentType, payload?: PayloadOf): number {
  const order = INTENT_ID_ORDER[type]
  if (order[order.length - 1]?.endsWith('…') !== true) return order.length
  const fixed = order.length - 1
  if (payload === undefined) return fixed + VARIADIC_ID_COUNT
  switch (type) {
    case 'floor.duplicate':
      return fixed + (payload as DuplicateFloor).placedItemIds.length
    case 'plan.copyToFloor':
      return (payload as CopyPlanObjectsToFloor).placedItemIds.length
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
  /** `cabinet` refused the tree operation: an already split or over-deep space. */
  | 'invalid-tree'

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
