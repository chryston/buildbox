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
  ElementType,
  EntityId,
  GlobalSettings,
  PlanImage,
  Project,
} from '../domain'
import type { ValidationProblem } from '../lib'

/** Every Intent type in the #47 catalogue, one per current store action. */
export type IntentType =
  | 'project.rename'
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
  | 'plan.addFromTemplate'
  | 'plan.updateObject'
  | 'plan.removeObject'
  | 'plan.addTemplate'
  | 'plan.removeTemplate'
  | 'plan.setImage'
  | 'plan.calibrate'
  | 'plan.clear'

/** The payload each Intent type carries. */
export interface RenameProject {
  name: string
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
export interface AddPlanFromTemplate {
  floorId: EntityId
  templateItemDesignId: EntityId
}
export interface UpdatePlanObject {
  placedItemId: EntityId
  /** `x`, `y` and `rotation` are Floor-local; `label`, `color`, `w` and `h` are the design's. */
  patch: {
    x?: number
    y?: number
    w?: number
    h?: number
    rotation?: number
    label?: string
    color?: string
  }
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
  /** `null` removes the Plan Image. The bytes are already in the Asset Repository. */
  image: Omit<PlanImage, 'pixelsPerMm'> | null
  /** The upload-confirm path: clear the floor plan in this same transaction first. */
  clearExisting: boolean
}
export interface CalibratePlan {
  floorId: EntityId
  pixelsPerMm: number
}
export interface ClearPlan {
  floorId: EntityId
}

/** `type → payload`, the one place the catalogue's shape is written down. */
export interface IntentPayloads {
  'project.rename': RenameProject
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
  'plan.addFromTemplate': AddPlanFromTemplate
  'plan.updateObject': UpdatePlanObject
  'plan.removeObject': RemovePlanObject
  'plan.addTemplate': AddPlanTemplate
  'plan.removeTemplate': RemovePlanTemplate
  'plan.setImage': SetPlanImage
  'plan.calibrate': CalibratePlan
  'plan.clear': ClearPlan
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
export type ProjectIntent = Intent<'project.rename'>
export type CabinetIntent = Intent<Extract<IntentType, `cabinet.${string}`>>
export type PlanIntent = Intent<Extract<IntentType, `plan.${string}`>>

/**
 * The IDs each Intent consumes, in order — the contract between the caller that
 * allocates and the handler that spends. An empty list means the Intent needs no ID.
 */
export const INTENT_ID_ORDER: Record<IntentType, readonly string[]> = {
  'project.rename': [],
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
  'plan.addFromTemplate': ['itemDesignId', 'placedItemId'],
  'plan.updateObject': [],
  'plan.removeObject': [],
  'plan.addTemplate': ['itemDesignId'],
  'plan.removeTemplate': [],
  'plan.setImage': [],
  'plan.calibrate': [],
  'plan.clear': [],
}

/**
 * How many IDs an Intent spends. An entry ending in `…` stands for a count that depends on
 * the tree the Intent lands in: a split turns one space into two and adds one board, so it
 * spends two however that tree is shaped.
 */
const VARIADIC_ID_COUNT = 2

export function intentIdCount(type: IntentType): number {
  const order = INTENT_ID_ORDER[type]
  return order[order.length - 1]?.endsWith('…') === true ? VARIADIC_ID_COUNT : order.length
}

/** Where an edit landed, so undo can navigate to it (#48). */
export interface Locator {
  /** `null` when the edit belongs to no Floor — a Project or template change. */
  floorId: EntityId | null
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
  /** A plan object below the legacy 10 mm minimum, which the UI clamps before sending. */
  | 'invalid-size'
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
