export type Unit = 'mm' | 'cm' | 'in'
export type SplitAxis = 'horizontal' | 'vertical'
export type CabinetMaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf'
export type MaterialId = CabinetMaterialId  // alias kept for existing engine compatibility
export type ElementType = 'void' | 'drawer' | 'hanging-space' | 'microwave'
export type SlideType = 'side-mount' | 'undermount'
export type AccessoryType = 'door' | 'drawer-front' | 'pull' | 'hinge'
export type UnitType = 'cabinet' | 'countertop'

export interface ToeKick {
  height: number
  setback: number
}

export interface DrawerConfig {
  slideType: SlideType
  reveal: number
}

export interface GlobalSettings {
  unit: Unit
  height: number
  width: number
  depth: number
  thickness: number
  backThickness: number
  toeKick: ToeKick | null
  defaultMaterial: CabinetMaterialId
}

export interface Accessory {
  id: string
  type: AccessoryType
  label?: string
}

export interface Divider {
  id: string
  materialId: CabinetMaterialId
}

export interface CabinetNode {
  id: string
  splitAxis?: SplitAxis
  splitRatio?: number
  children?: [CabinetNode, CabinetNode]
  fixedSize?: number
  locked?: boolean
  material?: CabinetMaterialId
  elementType?: ElementType
  drawerConfig?: DrawerConfig
  dividers?: Divider[]
  accessories?: Accessory[]
}

// --- Unit types ---

interface UnitBase {
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

export interface Design {
  id: string
  name: string
  units: CabinetUnit[]  // >= 1
}

// --- Layout types ---

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

// Kept for backward-compat with existing tests that call computeLayout(design)
export interface LayoutResult {
  panels: LayoutPanel[]
  voids: LayoutVoid[]
  dividers: LayoutDivider[]
  overConstrainedIds: string[]
}

// --- Cut-list types ---

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

// --- Store slice shapes ---

export interface UIState {
  selectedId: string | null
  snapGrid: number
  activeUnitId: string | null  // not persisted, not in temporal history
}
