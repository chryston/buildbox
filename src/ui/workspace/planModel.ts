/**
 * Project → Plan View view-models (#55).
 *
 * The projection is the exact inverse of what #43's handlers wrote, the same one the S4
 * adapter drew: a placement's Item Origin is its footprint centre, so the drawn top-left
 * is `translation − size / 2`, and the Plan View has only ever offered the four quarter
 * rotations (#57 adds free rotation). The Plan Image is drawn at `widthPx / pixelsPerMm`
 * millimetres — and at raw pixels while it is uncalibrated, because an uncalibrated image
 * is evidence, not a scale.
 *
 * Like `projectUnits` before it, each projection is cached against the Project object it
 * came from: a `useSyncExternalStore` selector that returned a fresh array per call would
 * make React re-render forever, and a commit replaces the Project — exactly the
 * granularity the cache wants.
 */
import type { EntityId, GenericItemDesign, PlacedItem, Project } from '../../domain'

/** One Placed Item as the Plan View draws it: a footprint outline with a label. */
export interface PlanItemView {
  readonly id: EntityId
  readonly label: string
  /** Top-left in Floor-local millimetres, before the quarter-turn. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly rotationDeg: 0 | 90 | 180 | 270
  /** `#rrggbb`, lowercase — Item Design data, not chrome. */
  readonly color: string
}

/** The Floor's Plan Image, ready to draw. `null` when the Floor has none. */
export interface PlanImageView {
  readonly src: string
  /** Drawn size in Floor-local millimetres (raw pixels while uncalibrated). */
  readonly widthMm: number
  readonly heightMm: number
  readonly pixelsPerMm: number | null
}

/** The device-local cache key of a Floor's default Plan View (#55 criterion 4). */
export const planViewKey = (floorId: EntityId): string => `plan:${floorId}`

/** The one Floor the Plan View shows until #56 adds the Floor switcher. */
export function firstFloorId(project: Project): EntityId | null {
  return project.floors[0]?.id ?? null
}

/** `0 ≤ r < 360` to the four rotations the Plan View has. */
function quarterTurn(rotationDeg: number): 0 | 90 | 180 | 270 {
  return ((Math.round(rotationDeg / 90) % 4) * 90) as 0 | 90 | 180 | 270
}

function itemView(design: GenericItemDesign, placed: PlacedItem): PlanItemView {
  const w = design.footprint.width
  const h = design.footprint.depth
  return {
    id: placed.id,
    label: design.name,
    x: placed.translation.x - w / 2,
    y: placed.translation.y - h / 2,
    w,
    h,
    rotationDeg: quarterTurn(placed.rotationDeg),
    color: design.color,
  }
}

const itemsCache = new WeakMap<Project, Map<EntityId | null, readonly PlanItemView[]>>()

/** The generic Placed Items of one Floor, stable while the Project object is. */
export function planItemsForFloor(project: Project, floorId: EntityId | null): readonly PlanItemView[] {
  let byFloor = itemsCache.get(project)
  if (byFloor === undefined) {
    byFloor = new Map()
    itemsCache.set(project, byFloor)
  }
  const cached = byFloor.get(floorId)
  if (cached !== undefined) return cached
  const designs = new Map(project.itemDesigns.map((design) => [design.id, design]))
  const items: PlanItemView[] = []
  for (const placed of project.existingModel.placedItems) {
    if (placed.floorId !== floorId) continue
    const design = designs.get(placed.itemDesignId)
    if (design?.kind === 'generic') items.push(itemView(design, placed))
  }
  byFloor.set(floorId, items)
  return items
}

const imageCache = new WeakMap<Project, { src: string | null; key: string | null; view: PlanImageView | null }>()

/**
 * The Floor's Plan Image, stable while the Project and the image's object URL are.
 *
 * The URL is a second key because it arrives after the Project is read: the bytes are in
 * IndexedDB, and an `<image>` can only be pointed at them once the URL exists.
 */
export function planImageForFloor(
  project: Project,
  floorId: EntityId | null,
  imageSrc: string | null,
): PlanImageView | null {
  const planImage = project.floors.find((floor) => floor.id === floorId)?.planImage ?? null
  const cached = imageCache.get(project)
  if (cached !== undefined && cached.src === imageSrc && cached.key === floorId) return cached.view
  const view = planImage === null || imageSrc === null
    ? null
    : {
      src: imageSrc,
      widthMm: planImage.pixelsPerMm === null ? planImage.widthPx : planImage.widthPx / planImage.pixelsPerMm,
      heightMm: planImage.pixelsPerMm === null ? planImage.heightPx : planImage.heightPx / planImage.pixelsPerMm,
      pixelsPerMm: planImage.pixelsPerMm,
    }
  imageCache.set(project, { src: imageSrc, key: floorId, view })
  return view
}

/** A custom shape that is placed nowhere: placeable again from `Add item ▾`. */
export interface CustomTemplateView {
  readonly itemDesignId: EntityId
  readonly label: string
}

const templatesCache = new WeakMap<Project, readonly CustomTemplateView[]>()

export function customTemplates(project: Project): readonly CustomTemplateView[] {
  const cached = templatesCache.get(project)
  if (cached !== undefined) return cached
  const placed = new Set(project.existingModel.placedItems.map((item) => item.itemDesignId))
  const templates = project.itemDesigns
    .filter((design) => design.kind === 'generic' && design.isCustom === true && !placed.has(design.id))
    .map((design) => ({ itemDesignId: design.id, label: design.name }))
  templatesCache.set(project, templates)
  return templates
}
