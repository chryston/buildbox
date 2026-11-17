/**
 * Cabinet scene input and output types (#20 §3, ADR 0004).
 *
 * The scene side (`UnitType`…`CabinetUnit`) is what a cabinet Item Design sits inside;
 * the layout side (`LayoutPanel`…`CutListEntry`) is what `layoutEngine` and `cutList`
 * produce from it. Both are exported through `src/cabinet/index.ts` only.
 */
import type {
  Accessory,
  CabinetMaterialId,
  CabinetNode,
  DrawerConfig,
  ElementType,
  GlobalSettings,
  SplitAxis,
  Unit,
} from '../domain'

export type UnitType = 'cabinet' | 'countertop'

export interface UnitBase {
  id: string
  label: string
  x: number  // canvas offset in mm from scene origin (left edge)
  y: number  // canvas offset in mm from scene origin (top edge)
}

export interface CabinetSceneUnit extends UnitBase {
  type: 'cabinet'
  settings: GlobalSettings
  root: CabinetNode
}

// Phase C will add CountertopSceneUnit; forward-compat: CabinetUnit is currently only CabinetSceneUnit
export type CabinetUnit = CabinetSceneUnit

export interface LayoutPanel {
  id: string
  role: 'top' | 'bottom' | 'left' | 'right' | 'shelf' | 'divider' | 'toe-kick-board'
  x: number; y: number; w: number; h: number
  material: CabinetMaterialId
}

export interface LayoutVoid {
  nodeId: string
  x: number; y: number; w: number; h: number
  parentSplitAxis?: SplitAxis
  elementType: ElementType
  drawerConfig?: DrawerConfig
  material: CabinetMaterialId
  accessories: Accessory[]
  // New fields for editability and features:
  heightControlNodeId?: string   // direct child of nearest h-split ancestor (used by handleCommitSize)
  widthControlNodeId?: string    // direct child of nearest v-split ancestor
  columnRootId?: string          // topmost h-split ancestor in current v-scope (used by distributeEvenly)
  spaceLabel?: string            // forwarded from CabinetNode.spaceLabel
  // Note: isPinned is derived inline as `node.locked && node.fixedSize != null` — not stored here
}

export interface LayoutDivider {
  nodeId: string
  parentId: string
  childAId: string
  childBId: string
  x: number; y: number; w: number; h: number
  axis: SplitAxis
  material: CabinetMaterialId
  dividerId?: string
  childABounds: { x: number; y: number; w: number; h: number }
  childBBounds: { x: number; y: number; w: number; h: number }
}

// Enriched per-unit layout — canvas only needs this, never touches CabinetUnit
export interface UnitLayoutResult {
  kind: 'cabinet'
  unitId: string
  label: string        // copy of CabinetUnit.label
  isActive: boolean    // true when this unit is the active unit
  x: number            // copy of CabinetUnit.x
  y: number            // copy of CabinetUnit.y
  w: number            // == settings.width
  h: number            // == settings.height
  unit: Unit           // for DimensionLabels formatting
  panels: LayoutPanel[]
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  overConstrainedIds: string[]
}

export interface SceneLayout {
  units: UnitLayoutResult[]
  boundingBox: { x: number; y: number; w: number; h: number }
}

// What computeUnitLayout returns for one unit: the scene fields without the unit copy.
export interface LayoutResult {
  panels: LayoutPanel[]
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  overConstrainedIds: string[]
}

export interface CutListEntry {
  label: string
  qty: number
  width: number
  height: number
  depth: number
  material: CabinetMaterialId
  unitId: string      // which CabinetUnit this came from
  unitLabel: string   // human-readable, e.g. "Base Left"
  notes?: string
}
