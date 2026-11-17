/**
 * Frozen copies of the shapes the legacy reader accepts (#40 §1).
 *
 * These are copied from `src/types/index.ts` at the S1 commit and MUST NOT import it:
 * `src/types` is deleted at the S4 cutover, while `package/legacy` lives until
 * `remove-legacy-reader`. `src/test/legacyTypes.test.ts` asserts the frozen v3 shapes
 * and `src/types` stay mutually assignable while both exist — that test lives outside
 * `package` because the element may import only from itself (#40 §4).
 *
 * Nothing here validates anything. Validation is `validate.ts`.
 */

export type LegacyUnit = 'mm' | 'cm' | 'in'
export type LegacySplitAxis = 'horizontal' | 'vertical'
export type LegacyCabinetMaterialId = 'oak' | 'walnut' | 'white' | 'birch' | 'mdf'
export type LegacyElementType = 'void' | 'drawer' | 'hanging-space' | 'microwave'
export type LegacySlideType = 'side-mount' | 'undermount'
export type LegacyAccessoryType = 'door' | 'drawer-front' | 'pull' | 'hinge'
export type LegacyUnitType = 'cabinet'
export type LegacyAnnotationType = 'wall-hack' | 'tile-zone'

export interface LegacyToeKick {
  height: number
  setback: number
}

export interface LegacyDrawerConfig {
  slideType: LegacySlideType
  reveal: number
}

/** v2 and later: the material lives on the cabinet settings as `material`. */
export interface LegacyGlobalSettings {
  unit: LegacyUnit
  height: number
  width: number
  depth: number
  thickness: number
  backThickness: number
  toeKick: LegacyToeKick | null
  material: LegacyCabinetMaterialId
}

/** v0 and v1, and any workspace file whose Design was never upgraded: same fields, old name. */
export interface LegacyGlobalSettingsV1 {
  unit: LegacyUnit
  height: number
  width: number
  depth: number
  thickness: number
  backThickness: number
  toeKick: LegacyToeKick | null
  defaultMaterial: LegacyCabinetMaterialId
}

export interface LegacyAccessory {
  id: string
  type: LegacyAccessoryType
  label?: string
}

export interface LegacyDivider {
  id: string
  materialId: LegacyCabinetMaterialId
}

export interface LegacyCabinetNode {
  id: string
  splitAxis?: LegacySplitAxis
  splitRatio?: number
  children?: [LegacyCabinetNode, LegacyCabinetNode]
  fixedSize?: number
  locked?: boolean
  spaceLabel?: string
  elementType?: LegacyElementType
  drawerConfig?: LegacyDrawerConfig
  dividers?: LegacyDivider[]
  accessories?: LegacyAccessory[]
  /** Removed in v2 in favour of `LegacyGlobalSettings.material`; old data still carries it. */
  material?: unknown
}

export interface LegacyCabinetSceneUnit {
  type: 'cabinet'
  id: string
  label: string
  x: number
  y: number
  settings: LegacyGlobalSettings
  root: LegacyCabinetNode
}

export type LegacyCabinetUnit = LegacyCabinetSceneUnit

export interface LegacyDesign {
  id: string
  name: string
  units: LegacyCabinetUnit[]
}

/** The pre-`units` Design: what v0 persisted, and what a hand-made file may still hold. */
export interface LegacyDesignV0 {
  id: string
  name: string
  root: LegacyCabinetNode
  globalSettings: LegacyGlobalSettingsV1 | LegacyGlobalSettings
}

// --- Floor plan (v3) ---

export type LegacyFloorPlanObjectType =
  | 'sofa-2' | 'sofa-3' | 'armchair'
  | 'bed-single' | 'bed-double' | 'bed-queen' | 'bed-king'
  | 'fridge' | 'washer' | 'dryer' | 'water-heater' | 'robot-vacuum'
  | 'toilet' | 'basin' | 'bathtub' | 'shower'
  | 'ceiling-fan' | 'light' | 'tv' | 'curtain-rail'
  | 'wardrobe' | 'kitchen-counter' | 'cabinet-unit'
  | 'custom'

export interface LegacyFloorPlanObject {
  id: string
  type: LegacyFloorPlanObjectType
  label: string
  x: number
  y: number
  w: number
  h: number
  rotation: 0 | 90 | 180 | 270
  color: string
  isCustom?: boolean
}

export interface LegacyAnnotation {
  id: string
  type: LegacyAnnotationType
  points: { x: number; y: number }[]
  label?: string
}

export interface LegacyFloorPlanImage {
  dataUrl: string
  widthPx: number
  heightPx: number
}

export interface LegacyCustomTemplate {
  id: string
  label: string
  defaultW: number
  defaultH: number
  color: string
}

export interface LegacyFloorPlanData {
  image: LegacyFloorPlanImage | null
  pixelsPerMm: number | null
  objects: LegacyFloorPlanObject[]
  annotations: LegacyAnnotation[]
  customTemplates: LegacyCustomTemplate[]
}

// --- Persisted envelopes, v0 through v3 ---

export interface LegacyPersistedStateV0 {
  projects: LegacyDesignV0[]
  activeProjectId: string | null
}

export interface LegacyPersistedStateV1 {
  projects: LegacyDesign[]
  activeProjectId: string | null
}

export interface LegacyPersistedStateV2 {
  projects: LegacyDesign[]
  activeProjectId: string | null
}

/** What `localStorage['buildbox-store']` holds at the persist version this app writes. */
export interface LegacyPersistedStateV3 {
  projects: LegacyDesign[]
  activeProjectId: string | null
  floorPlan: LegacyFloorPlanData
}

export interface LegacyPersistedEnvelopeV0 { state: LegacyPersistedStateV0; version: 0 }
export interface LegacyPersistedEnvelopeV1 { state: LegacyPersistedStateV1; version: 1 }
export interface LegacyPersistedEnvelopeV2 { state: LegacyPersistedStateV2; version: 2 }
export interface LegacyPersistedEnvelopeV3 { state: LegacyPersistedStateV3; version: 3 }

/** The downloaded `.buildbox.json` shape. `version` is absent on files the app never wrote. */
export interface LegacyWorkspaceFile {
  version: number
  exportedAt: string
  projects: LegacyDesign[]
  activeProjectId: string | null
}
