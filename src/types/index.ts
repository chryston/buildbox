/**
 * Legacy-only types (#41). Everything the target modules own has moved to `domain`
 * (cabinet payload) and `cabinet` (scene and layout output); this file keeps what only
 * the pre-S4 app still uses — `Design`, the floor-plan shapes and the store slice types
 * — and shrinks to nothing at the S4 cutover.
 *
 * It imports `CabinetUnit` through the `cabinet` entry point and deliberately does not
 * re-export it: callers that want a cabinet type import `src/cabinet` themselves.
 */
import type { CabinetUnit } from '../cabinet'

export interface Design {
  id: string
  name: string
  units: CabinetUnit[]  // >= 1
}

// --- Store slice shapes ---

export interface UIState {
  selectedId: string | null
  snapGrid: number
  activeUnitId: string | null  // not persisted, not in temporal history
}

export type AppModule = 'cabinet' | 'floorplan'

// --- Floor Plan types ---

export type FloorPlanObjectType =
  | 'sofa-2' | 'sofa-3' | 'armchair'
  | 'bed-single' | 'bed-double' | 'bed-queen' | 'bed-king'
  | 'fridge' | 'washer' | 'dryer' | 'water-heater' | 'robot-vacuum'
  | 'toilet' | 'basin' | 'bathtub' | 'shower'
  | 'ceiling-fan' | 'light' | 'tv' | 'curtain-rail'
  | 'wardrobe' | 'kitchen-counter' | 'cabinet-unit'
  | 'custom'

export type AnnotationType = 'wall-hack' | 'tile-zone'

export interface FloorPlanObject {
  id: string
  type: FloorPlanObjectType
  label: string
  x: number
  y: number
  w: number
  h: number
  rotation: 0 | 90 | 180 | 270
  color: string
  isCustom?: boolean
}

export interface Annotation {
  id: string
  type: AnnotationType
  points: { x: number; y: number }[]
  label?: string
}

export interface FloorPlanImage {
  dataUrl: string
  widthPx: number
  heightPx: number
}

export interface CustomTemplate {
  id: string
  label: string
  defaultW: number
  defaultH: number
  color: string
}

export interface FloorPlanData {
  image: FloorPlanImage | null
  pixelsPerMm: number | null
  objects: FloorPlanObject[]
  annotations: Annotation[]
  customTemplates: CustomTemplate[]
}
