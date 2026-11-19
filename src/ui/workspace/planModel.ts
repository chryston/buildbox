/**
 * Project → Plan View view-models (#55, #57).
 *
 * Every position here is derived, never stored: the placement maths lives in
 * `derive/placement.ts` — the one pinned reading of Item Origin, rotation and Item
 * Footprint — because `ui` may not import `geometry` (#20 §2). So a `PlanItemView` carries
 * the placement's own `PlacementContext` and the canvas asks it where a local point lands,
 * which is how the drawn footprint, the rotate handle and the dimension lines are all
 * guaranteed to agree with what the Intent will write.
 *
 * The Plan Image is drawn at `widthPx / pixelsPerMm` millimetres — and at raw pixels while
 * it is uncalibrated, because an uncalibrated image is evidence, not a scale.
 *
 * Like `projectUnits` before it, each projection is cached against the Project object it
 * came from: a `useSyncExternalStore` selector that returned a fresh array per call would
 * make React re-render forever, and a commit replaces the Project — exactly the
 * granularity the cache wants.
 */
import { floorBoundsSize, footprintPath, normaliseRotation, placementContext, worldPointOf } from '../../derive'
import type { PlacementContext } from '../../derive'
import { designFootprintSize, designOrigin } from '../../domain'
import type { EntityId, ItemDesign, PlanView, PlacedItem, Point2, Project } from '../../domain'

/**
 * How a cabinet's footprint is drawn: it has no `color` of its own, because a cabinet's
 * appearance is its construction (#42 §2), so every cabinet placement takes this one slate.
 */
export const CABINET_PLAN_COLOR = '#475569'

/** One Placed Item as the Plan View draws it: a footprint outline with a label. */
export interface PlanItemView {
  readonly id: EntityId
  readonly designId: EntityId
  /** The Item Design's name: a Placed Item owns no name of its own (#57 §3). */
  readonly label: string
  /** `#rrggbb`, lowercase — Item Design data, not chrome. */
  readonly color: string
  readonly isCabinet: boolean
  /** The Item Footprint's `Width` and `Depth` in Item Design millimetres. Never swapped. */
  readonly width: number
  readonly depth: number
  /** The Item Origin, footprint-local millimetres. */
  readonly origin: Point2
  /** The Item Origin's Floor position — what `Position X` and `Position Y` read. */
  readonly translation: Point2
  /** Free rotation, degrees clockwise with +Y down, normalised to [0, 360). */
  readonly rotationDeg: number
  /** The placement's own context, so the canvas can project any other local point. */
  readonly context: PlacementContext
  /** The Item Footprint's four corners in Floor millimetres, from local (0, 0). */
  readonly corners: readonly Point2[]
  /** The `Floor bounds` the inspector reads: the box this placement covers on the Floor. */
  readonly boundsWidth: number
  readonly boundsDepth: number
  /** Placements of the same Item Design, on every Floor — the `Affects N placements` N. */
  readonly placementCount: number
}

/** The Floor's Plan Image, ready to draw. `null` when the Floor has none. */
export interface PlanImageView {
  readonly src: string
  /** Drawn size in Floor-local millimetres (raw pixels while uncalibrated). */
  readonly widthMm: number
  readonly heightMm: number
  readonly pixelsPerMm: number | null
}

/**
 * The device-local viewport key of one Plan View (#56 criterion 13).
 *
 * It names the Floor and the view's name rather than the view's id on purpose: opening a
 * record written before the `views` collection migrates it in memory and mints fresh view IDs
 * every time (#26 keeps IDs out of storage), so an id-keyed cache would miss on every reload
 * of exactly the Projects that have a Plan Image to look at. Floor ids and view names are
 * data, and a renamed view starting from `Fit` again is a lost camera, not a lost drawing.
 */
export const planViewKey = (view: PlanView): string => `view:${view.floorId}:${view.name}`

/**
 * The open view of each Floor as the device-local cache stores it: view names, for the same
 * reason `planViewKey` uses them. An id the cache no longer recognises is dropped rather than
 * guessed at.
 */
export function encodeActiveViews(
  project: Project,
  viewsByFloor: Record<string, string>,
): Record<string, string> {
  const names: Record<string, string> = {}
  for (const [floorId, viewId] of Object.entries(viewsByFloor)) {
    const view = project.views.find((candidate) => candidate.id === viewId && candidate.floorId === floorId)
    if (view !== undefined) names[floorId] = view.name
  }
  return names
}

/** …and back to the live IDs, dropping any name this Project no longer has. */
export function decodeActiveViews(
  project: Project,
  namesByFloor: Record<string, string>,
): Record<string, string> {
  const ids: Record<string, string> = {}
  for (const [floorId, name] of Object.entries(namesByFloor)) {
    const view = project.views.find((candidate) => candidate.floorId === floorId && candidate.name === name)
    if (view !== undefined) ids[floorId] = view.id
  }
  return ids
}

/** The file input names the three formats a Plan Image may be (#49 deviation 4). */
export const PLAN_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

/**
 * The Plan Views of one Floor, in the order the switcher lists them: the Floor's own
 * default view first, then the named ones by name (#56).
 */
export function planViewsForFloor(project: Project, floorId: EntityId | null): readonly PlanView[] {
  if (floorId === null) return EMPTY_VIEWS
  const views = project.views.filter((view) => view.floorId === floorId)
  return views.length === 0
    ? EMPTY_VIEWS
    : [...views].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
}

const EMPTY_VIEWS: readonly PlanView[] = []

/** The Floor's own Plan View — the one that comes with it and goes with it. */
export const defaultPlanViewOf = (project: Project, floorId: EntityId | null): PlanView | null =>
  floorId === null
    ? null
    : project.views.find((view) => view.floorId === floorId && view.isDefault) ?? null

/**
 * The view to show when a Floor is opened: the last one used on this device when it still
 * belongs to that Floor, otherwise the Floor's default (#56).
 */
export const resolvePlanView = (
  project: Project,
  floorId: EntityId | null,
  preferredViewId: string | null,
): PlanView | null => {
  if (floorId === null) return null
  const preferred = preferredViewId === null
    ? null
    : project.views.find((view) => view.id === preferredViewId && view.floorId === floorId) ?? null
  return preferred ?? defaultPlanViewOf(project, floorId)
}

/**
 * Where a Placed Item actually sits on its Floor, for the copy/move preview (#56).
 *
 * The Intent speaks Item Origin and base elevation, so the preview reads the placement
 * rather than the projection.
 */
export function placedOrigin(
  project: Project,
  placedItemId: EntityId | null,
): { x: number; y: number; baseElevation: number } | null {
  if (placedItemId === null) return null
  const placed = project.existingModel.placedItems.find((item) => item.id === placedItemId)
  if (placed === undefined) return null
  return {
    x: placed.translation.x,
    y: placed.translation.y,
    baseElevation: placed.baseElevation,
  }
}

/** The four footprint corners of one design, local millimetres, from local (0, 0). */
function localCorners(design: ItemDesign): readonly Point2[] {
  const path = footprintPath(design)
  // The ring from (0, 0): the path's start, then every segment end but the closing one.
  return [path.start, ...path.segments.slice(0, -1).map((segment) => segment.to)]
}

function itemView(design: ItemDesign, placed: PlacedItem, placementCount: number): PlanItemView {
  const { width, depth } = designFootprintSize(design)
  const context = placementContext(design, placed)
  const box = floorBoundsSize(design, placed)
  return {
    id: placed.id,
    designId: design.id,
    label: design.name,
    color: design.kind === 'cabinet' ? CABINET_PLAN_COLOR : design.color,
    isCabinet: design.kind === 'cabinet',
    width,
    depth,
    origin: designOrigin(design),
    translation: placed.translation,
    rotationDeg: normaliseRotation(placed.rotationDeg),
    context,
    corners: localCorners(design).map((corner) => worldPointOf(context, corner)),
    boundsWidth: box.width,
    boundsDepth: box.depth,
    placementCount,
  }
}

const itemsCache = new WeakMap<Project, Map<EntityId | null, readonly PlanItemView[]>>()

/**
 * Every Placed Item of one Floor, stable while the Project object is.
 *
 * Cabinet designs are drawn here too: a migrated legacy Design is an Item Design like any
 * other, and its units are positioned and turned on the Floor on their own (#11-5).
 */
export function planItemsForFloor(project: Project, floorId: EntityId | null): readonly PlanItemView[] {
  let byFloor = itemsCache.get(project)
  if (byFloor === undefined) {
    byFloor = new Map()
    itemsCache.set(project, byFloor)
  }
  const cached = byFloor.get(floorId)
  if (cached !== undefined) return cached
  const designs = new Map(project.itemDesigns.map((design) => [design.id, design]))
  const counts = placementCounts(project)
  const items: PlanItemView[] = []
  for (const placed of project.existingModel.placedItems) {
    if (placed.floorId !== floorId) continue
    const design = designs.get(placed.itemDesignId)
    if (design === undefined) continue
    items.push(itemView(design, placed, counts.get(design.id) ?? 0))
  }
  byFloor.set(floorId, items)
  return items
}

const countsCache = new WeakMap<Project, Map<EntityId, number>>()

/** How many Placed Items reference each Item Design, across every Floor. */
function placementCounts(project: Project): Map<EntityId, number> {
  const cached = countsCache.get(project)
  if (cached !== undefined) return cached
  const counts = new Map<EntityId, number>()
  for (const placed of project.existingModel.placedItems) {
    counts.set(placed.itemDesignId, (counts.get(placed.itemDesignId) ?? 0) + 1)
  }
  countsCache.set(project, counts)
  return counts
}

/** How many Placed Items share this Item Design, on every Floor (#57 §2, D3). */
export function placementCountFor(project: Project, itemDesignId: EntityId): number {
  return placementCounts(project).get(itemDesignId) ?? 0
}

const imageCache = new WeakMap<Project, { src: string | null; key: string | null; view: PlanImageView | null }>()

/**
 * The Plan View's Plan Image, ready to draw, stable while the Project and the image's
 * object URL are.
 *
 * The URL is a second key because it arrives after the Project is read: the bytes are in
 * IndexedDB, and an `<image>` can only be pointed at them once the URL exists. A view that
 * has `Show Plan Image` off draws nothing, which is the visibility #19 §4 says the drawing
 * follows — the Floor still has the image, this view simply is not showing it.
 */
export function planImageForView(
  project: Project,
  view: PlanView | null,
  imageSrc: string | null,
): PlanImageView | null {
  const planImage = view === null
    ? null
    : view.showPlanImage
      ? project.floors.find((floor) => floor.id === view.floorId)?.planImage ?? null
      : null
  const key = view === null ? null : `${view.id}:${String(view.showPlanImage)}`
  const cached = imageCache.get(project)
  if (cached !== undefined && cached.src === imageSrc && cached.key === key) return cached.view
  const drawn = planImage === null || imageSrc === null
    ? null
    : {
      src: imageSrc,
      widthMm: planImage.pixelsPerMm === null ? planImage.widthPx : planImage.widthPx / planImage.pixelsPerMm,
      heightMm: planImage.pixelsPerMm === null ? planImage.heightPx : planImage.heightPx / planImage.pixelsPerMm,
      pixelsPerMm: planImage.pixelsPerMm,
    }
  imageCache.set(project, { src: imageSrc, key, view: drawn })
  return drawn
}

/**
 * One Item Design as the library popover lists it (#57 §2): name, size and how many
 * Placed Items already use it. Placing one of these reuses it — no design is created.
 */
export interface ItemLibraryEntry {
  readonly itemDesignId: EntityId
  readonly label: string
  readonly width: number
  readonly depth: number
  readonly placementCount: number
  readonly color: string
  readonly isCabinet: boolean
}

const libraryCache = new WeakMap<Project, readonly ItemLibraryEntry[]>()

export function itemLibrary(project: Project): readonly ItemLibraryEntry[] {
  const cached = libraryCache.get(project)
  if (cached !== undefined) return cached
  const counts = placementCounts(project)
  const library = project.itemDesigns.map((design) => {
    const { width, depth } = designFootprintSize(design)
    return {
      itemDesignId: design.id,
      label: design.name,
      width,
      depth,
      placementCount: counts.get(design.id) ?? 0,
      color: design.kind === 'cabinet' ? CABINET_PLAN_COLOR : design.color,
      isCabinet: design.kind === 'cabinet',
    }
  })
  libraryCache.set(project, library)
  return library
}

/** The Placed Items of one Item Design, grouped by the Floor they sit on (#57 §6). */
export interface PlacementGroup {
  readonly floorId: EntityId
  readonly floorName: string
  readonly items: readonly { id: EntityId; label: string }[]
}

const groupsCache = new WeakMap<Project, Map<EntityId, readonly PlacementGroup[]>>()

export function placementGroups(project: Project, itemDesignId: EntityId): readonly PlacementGroup[] {
  let byDesign = groupsCache.get(project)
  if (byDesign === undefined) {
    byDesign = new Map()
    groupsCache.set(project, byDesign)
  }
  const cached = byDesign.get(itemDesignId)
  if (cached !== undefined) return cached
  const name = project.itemDesigns.find((design) => design.id === itemDesignId)?.name ?? ''
  const byFloor = new Map<EntityId, { id: EntityId; label: string }[]>()
  for (const placed of project.existingModel.placedItems) {
    if (placed.itemDesignId !== itemDesignId) continue
    const group = byFloor.get(placed.floorId) ?? []
    group.push({ id: placed.id, label: name })
    byFloor.set(placed.floorId, group)
  }
  // Floors in Project order, so the list reads the way the Floor switcher does.
  const groups: PlacementGroup[] = []
  for (const floor of project.floors) {
    const items = byFloor.get(floor.id)
    if (items !== undefined && items.length > 0) {
      groups.push({ floorId: floor.id, floorName: floor.name, items })
    }
  }
  byDesign.set(itemDesignId, groups)
  return groups
}
