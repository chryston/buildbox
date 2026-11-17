/**
 * Project → the legacy view-models, memoised (#49, #20 §10).
 *
 * The legacy views take `CabinetUnit[]` and one `FloorPlanData`. Both are rebuilt from the
 * Project, and both are rebuilt *once per Project*: a `useSyncExternalStore` selector that
 * returned a fresh array on every call would make React re-render forever, so each
 * projection is cached against the Project object it came from. A commit replaces the
 * Project, which is exactly the granularity the cache wants — the same Project always gives
 * the same view-model.
 *
 * The floor-plan projection is the exact inverse of what #43's handlers wrote: a placement's
 * Item Origin is its footprint centre, so the legacy top-left is `translation − size / 2`,
 * and a custom shape is an unplaced generic design. Sketch annotations have no home in
 * domain v1 and project to nothing (#49 deviation 1).
 */
import type { CabinetUnit } from '../../cabinet'
import { cabinetSceneUnits } from '../../derive'
import type { EntityId, GenericItemDesign, PlacedItem, Project } from '../../domain'
import type { LibrarySnapshot } from '../../session'
import type { CustomTemplate, FloorPlanData, FloorPlanObject, FloorPlanObjectType } from '../../types'
import type { ProjectTab } from './bindings'

/** The one Floor the legacy views know about; multiple Floors are #55. */
export function firstFloorId(project: Project): EntityId | null {
  return project.floors[0]?.id ?? null
}

const unitsCache = new WeakMap<Project, CabinetUnit[]>()

/** The cabinet scene of Floor 1, stable while `project` is the same object. */
export function projectUnits(project: Project): CabinetUnit[] {
  const cached = unitsCache.get(project)
  if (cached !== undefined) return cached
  const floorId = firstFloorId(project)
  const units = floorId === null ? [] : cabinetSceneUnits(project, floorId)
  unitsCache.set(project, units)
  return units
}

/** `0 ≤ r < 360` to the four rotations the legacy view has. */
function legacyRotation(rotationDeg: number): 0 | 90 | 180 | 270 {
  return ((Math.round(rotationDeg / 90) % 4) * 90) as 0 | 90 | 180 | 270
}

function legacyObject(design: GenericItemDesign, placed: PlacedItem): FloorPlanObject {
  const w = design.footprint.width
  const h = design.footprint.depth
  const object: FloorPlanObject = {
    id: placed.id,
    type: (design.catalogKey as FloorPlanObjectType | undefined) ?? 'custom',
    label: design.name,
    x: placed.translation.x - w / 2,
    y: placed.translation.y - h / 2,
    w,
    h,
    rotation: legacyRotation(placed.rotationDeg),
    color: design.color,
  }
  if (design.isCustom === true) object.isCustom = true
  return object
}

function planData(project: Project, imageSrc: string | null): FloorPlanData {
  const floorId = firstFloorId(project)
  const placedOnFloor = project.existingModel.placedItems.filter(
    (placed) => placed.floorId === floorId,
  )
  const placedDesignIds = new Set(placedOnFloor.map((placed) => placed.itemDesignId))
  const designs = new Map(project.itemDesigns.map((design) => [design.id, design]))

  const objects: FloorPlanObject[] = []
  for (const placed of placedOnFloor) {
    const design = designs.get(placed.itemDesignId)
    if (design?.kind === 'generic') objects.push(legacyObject(design, placed))
  }

  const customTemplates: CustomTemplate[] = []
  for (const design of project.itemDesigns) {
    if (design.kind !== 'generic' || design.isCustom !== true) continue
    if (placedDesignIds.has(design.id)) continue
    customTemplates.push({
      id: design.id,
      label: design.name,
      defaultW: design.footprint.width,
      defaultH: design.footprint.depth,
      color: design.color,
    })
  }

  const planImage = floorId === null ? null : project.floors[0].planImage
  return {
    image: planImage === null || imageSrc === null
      ? null
      : { dataUrl: imageSrc, widthPx: planImage.widthPx, heightPx: planImage.heightPx },
    pixelsPerMm: planImage?.pixelsPerMm ?? null,
    objects,
    annotations: [],
    customTemplates,
  }
}

const planCache = new WeakMap<Project, { src: string | null; data: FloorPlanData }>()

/**
 * The floor plan of Floor 1, stable while the Project and the Plan Image's object URL are.
 *
 * The URL is a second key because it arrives after the Project is read: the asset is in
 * IndexedDB, and an `<img>` can only be pointed at it once the URL exists.
 */
export function projectFloorPlan(project: Project, imageSrc: string | null): FloorPlanData {
  const cached = planCache.get(project)
  if (cached !== undefined && cached.src === imageSrc) return cached.data
  const data = planData(project, imageSrc)
  planCache.set(project, { src: imageSrc, data })
  return data
}

const tabsCache = new WeakMap<LibrarySnapshot['projects'], ProjectTab[]>()

/**
 * The project bar's tabs, stable while the Library's list is the same array.
 *
 * A `LibrarySnapshot` carries a fresh array whenever anything in the Library changed, and a
 * selector that mapped over it inline would hand `useSyncExternalStore` a new value on every
 * render — the one thing that store refuses to tolerate (#49).
 */
export function projectTabs(snapshot: LibrarySnapshot): ProjectTab[] {
  const cached = tabsCache.get(snapshot.projects)
  if (cached !== undefined) return cached
  const tabs = snapshot.projects.map(({ id, name }) => ({ id, name }))
  tabsCache.set(snapshot.projects, tabs)
  return tabs
}
