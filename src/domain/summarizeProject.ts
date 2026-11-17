/**
 * The Library's derived view of a Project (#45).
 *
 * The Library lists every Project — name, size, when it was saved, a thumbnail — without
 * loading any of them, so the fields it needs are derived once at commit time and stored
 * beside the record. `summarizeProject` is that derivation: pure, synchronous, total over
 * any `Project` value, and it never reads the clock or makes an ID (#42 §3).
 *
 * The outline is geometry the Library draws as an SVG: one rectangle per Placed Item of
 * the first Floor, in placement order, capped so a huge Project cannot bloat the Library
 * record. Rects and bounds are Floor-local millimetres rounded to 1/1000 mm — far below
 * drawing precision, and enough to keep the same Project's summary byte-stable instead of
 * carrying `Math.cos(Math.PI / 2)` noise.
 */
import { designFootprintSize, designOrigin } from './itemDesign'
import type { ItemDesign, PlacedItem, Project } from './project'

/** How many outline rects a summary carries: the first 200 Placed Items of the first Floor. */
export const MAX_OUTLINE_RECTS = 200

/** `[minX, minY, maxX, maxY]` in Floor-local millimetres; `[0, 0, 0, 0]` when there is nothing to draw. */
export type OutlineBounds = [number, number, number, number]

/** One Placed Item as `[centreX, centreY, width, depth, rotationDeg]` in Floor-local millimetres. */
export type OutlineRect = [number, number, number, number, number]

/** The axis-aligned frame of `rects`, so the Library can size a thumbnail in one step. */
export interface ProjectOutline {
  bounds: OutlineBounds
  rects: OutlineRect[]
}

/**
 * What the Library stores instead of a Project (#45). `designOptionCount` is always 0 in
 * domain v1: Design Options have not shipped, and the field exists so the Library record
 * shape never has to change when they do.
 */
export interface ProjectSummary {
  floorCount: number
  designOptionCount: number
  /** Every Placed Item in the Project, on any Floor. */
  itemCount: number
  /** The first Floor's Plan Image asset hash, or `null` when that Floor has none. */
  previewAssetHash: string | null
  previewOutline: ProjectOutline
}

const RADIANS_PER_DEGREE = Math.PI / 180

/** Millimetre arithmetic rounded to 1/1000 mm, which keeps float noise out of stored records. */
const mm = (value: number): number => Math.round(value * 1000) / 1000

/**
 * The asset hashes a Project references. In domain v1 that is every Floor's Plan Image
 * and nothing else; it is the mark phase of asset garbage collection (#45, #46) and the
 * denominator of a Library record's `sizeBytes`.
 */
export function referencedAssetHashes(project: Project): Set<string> {
  const hashes = new Set<string>()
  for (const floor of project.floors) {
    if (floor.planImage !== null) hashes.add(floor.planImage.assetHash)
  }
  return hashes
}

/** The summary the Library record is built from. The input is never mutated. */
export function summarizeProject(project: Project): ProjectSummary {
  const first = project.floors[0]
  const designs = new Map<string, ItemDesign>()
  for (const design of project.itemDesigns) designs.set(design.id, design)

  const rects: OutlineRect[] = []
  const bounds: OutlineBounds = [0, 0, 0, 0]
  if (first !== undefined) {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const item of project.existingModel.placedItems) {
      if (rects.length >= MAX_OUTLINE_RECTS) break
      if (item.floorId !== first.id) continue
      const design = designs.get(item.itemDesignId)
      // A dangling reference is invalid data the strict validator rejects (#42 §4); a
      // summary of it draws nothing rather than guessing a footprint.
      if (design === undefined) continue
      const rect = outlineRect(item, design)
      rects.push(rect)
      for (const corner of rectCorners(rect)) {
        minX = Math.min(minX, corner[0])
        minY = Math.min(minY, corner[1])
        maxX = Math.max(maxX, corner[0])
        maxY = Math.max(maxY, corner[1])
      }
    }
    if (rects.length > 0) {
      bounds[0] = minX
      bounds[1] = minY
      bounds[2] = maxX
      bounds[3] = maxY
    }
  }

  return {
    floorCount: project.floors.length,
    designOptionCount: 0,
    itemCount: project.existingModel.placedItems.length,
    previewAssetHash: first?.planImage?.assetHash ?? null,
    previewOutline: { bounds, rects },
  }
}

/**
 * The rect of one placement: the Item Origin sits at `translation`, the design's Item
 * Origin is `designOrigin` in footprint-local coordinates, and `rotationDeg` turns the
 * footprint clockwise about the Item Origin in the +X right / +Y down frame.
 */
function outlineRect(item: PlacedItem, design: ItemDesign): OutlineRect {
  const { width, depth } = designFootprintSize(design)
  const origin = designOrigin(design)
  const rad = item.rotationDeg * RADIANS_PER_DEGREE
  const centre = rotate(width / 2 - origin.x, depth / 2 - origin.y, rad)
  return [
    mm(item.translation.x + centre.x),
    mm(item.translation.y + centre.y),
    mm(width),
    mm(depth),
    item.rotationDeg,
  ]
}

/** The four rotated corners of a rect, used only to widen `bounds`. */
function rectCorners(rect: OutlineRect): Array<[number, number]> {
  const [centreX, centreY, width, depth, rotationDeg] = rect
  const rad = rotationDeg * RADIANS_PER_DEGREE
  const halfWidth = width / 2
  const halfDepth = depth / 2
  return [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ].map(([dx, dy]) => {
    const rotated = rotate(dx, dy, rad)
    return [mm(centreX + rotated.x), mm(centreY + rotated.y)]
  })
}

/** A clockwise turn by `rad` in a y-down frame: the screen-space rotation matrix. */
function rotate(dx: number, dy: number, rad: number): { x: number; y: number } {
  if (rad === 0) return { x: dx, y: dy }
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
}
