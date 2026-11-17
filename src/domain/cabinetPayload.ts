/**
 * Cabinet Item Design payload vocabulary (#20 §3, ADR 0004).
 *
 * These are the shapes the cabinet editor stores inside an Item Design's
 * `construction: {settings, root}`. Nothing outside `domain` and `cabinet` is meant to
 * interpret them: `cabinet` reads them, everything else treats the payload as opaque.
 * `GlobalSettings.unit` is the cabinet editor unit and stays in the payload
 * (#20 §15.3).
 */
export type Unit = 'mm' | 'cm' | 'in'
export type SplitAxis = 'horizontal' | 'vertical'
export type CabinetMaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf'
export type ElementType = 'void' | 'drawer' | 'hanging-space' | 'microwave'
export type SlideType = 'side-mount' | 'undermount'
export type AccessoryType = 'door' | 'drawer-front' | 'pull' | 'hinge'

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
  material: CabinetMaterialId  // was material
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
  // material removed — now a cabinet-level GlobalSettings field
  spaceLabel?: string            // user-defined label for this void space
  elementType?: ElementType
  drawerConfig?: DrawerConfig
  dividers?: Divider[]
  accessories?: Accessory[]
}
