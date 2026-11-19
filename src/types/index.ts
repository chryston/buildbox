/**
 * The legacy view's own vocabulary (#41, #53). Everything the target modules own lives in
 * `domain` (cabinet payload) and `cabinet` (scene and layout output); what is left here is
 * the shape the pre-S4 components draw — the floor-plan view-models.
 *
 * The persisted shapes are gone with the S4 cutover: `Design` and the store slice types had
 * no reader once the Project Library held the work, and `package/legacy` keeps its own
 * frozen copies of whatever it reads (#20 §10). Nothing re-exports a removed type.
 */

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
