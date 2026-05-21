export type Unit = 'mm' | 'cm' | 'in'
export type SplitAxis = 'horizontal' | 'vertical'
export type MaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf'
export type ElementType = 'void' | 'drawer' | 'hanging-space'
export type SlideType = 'side-mount' | 'undermount'
export type AccessoryType = 'door' | 'drawer-front' | 'pull' | 'hinge'

export interface ToeKick {
  height: number   // mm
  setback: number  // mm
}

export interface DrawerConfig {
  slideType: SlideType
  reveal: number   // mm gap between drawer faces
}

export interface GlobalSettings {
  unit: Unit
  height: number        // mm  external
  width: number         // mm  external
  depth: number         // mm  external
  thickness: number     // mm  material thickness
  backThickness: number // mm  back panel thickness (default 6)
  toeKick: ToeKick | null
  defaultMaterial: MaterialId
}

export interface Accessory {
  id: string
  type: AccessoryType
  label?: string
}

export interface Divider {
  id: string
  materialId: MaterialId
}

export interface CabinetNode {
  id: string
  splitAxis?: SplitAxis          // undefined → leaf (void)
  splitRatio?: number            // 0–1, default 0.5; used for proportional drag
  children?: [CabinetNode, CabinetNode]  // binary split — TypeScript enforces exactly 2
  fixedSize?: number             // mm; set by user typing
  locked?: boolean               // true → engine never adjusts fixedSize
  material?: MaterialId          // overrides globalSettings.defaultMaterial
  elementType?: ElementType      // leaf annotation (default: 'void')
  drawerConfig?: DrawerConfig    // only when elementType === 'drawer'
  dividers?: Divider[]           // one per binary split, carries its own id and materialId
  accessories?: Accessory[]
}

export interface Design {
  id: string
  name: string
  globalSettings: GlobalSettings
  root: CabinetNode
}

// --- Layout types (output of computeLayout) ---

export interface LayoutPanel {
  id: string
  role: 'top' | 'bottom' | 'left' | 'right' | 'shelf' | 'divider' | 'toe-kick-board'
  x: number; y: number; w: number; h: number   // SVG coords in mm
  material: MaterialId
}

export interface LayoutVoid {
  nodeId: string
  x: number; y: number; w: number; h: number
  parentSplitAxis?: SplitAxis
  elementType: ElementType
  drawerConfig?: DrawerConfig
  material: MaterialId
  accessories: Accessory[]
}

export interface LayoutDivider {
  nodeId: string          // synthesised ID for the divider rect
  parentId: string        // CabinetNode ID of the split parent
  childAId: string        // actual CabinetNode ID of child A
  childBId: string        // actual CabinetNode ID of child B
  x: number; y: number; w: number; h: number
  axis: SplitAxis         // which axis this divider cuts
  material: MaterialId
  dividerId?: string      // from CabinetNode.dividers[n].id
  childABounds: { x: number; y: number; w: number; h: number }
  childBBounds: { x: number; y: number; w: number; h: number }
}

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
  width: number    // mm
  height: number   // mm
  depth: number    // mm
  material: MaterialId
  notes?: string
}

// --- Store slice shapes ---

export interface UIState {
  selectedId: string | null
  snapGrid: number          // mm; 0 = off
}
