/**
 * What an Elevation View holds, and where it lands (#75 §4, criteria 9–13).
 *
 * The prism is the closed set `{ p : 0 ≤ (p − start)·u ≤ L, 0 ≤ (p − start)·n ≤ depth }` — the far
 * edge included, both ends included — and everything in it is projected orthographically: the
 * horizontal coordinate is `(p − start)·u`, the vertical one is the floor-relative Z. This module
 * answers the two questions a drawing pass cannot answer for itself, because they need the Project:
 * which entities of the displayed model are inside the prism at all, and what band each one covers.
 *
 * **Each entity is drawn whole in depth.** Its full Vertical Extent and its full extent along `u` are
 * projected, and only the extent beyond the view's ends is clipped — a Wall that runs past the end of
 * the view line is drawn up to that end and no further, which is what "clipped at the view edge"
 * means (#75 criterion 10). Nothing here clips in Z: content above the Floor's Vertical Extent is
 * still drawn, because the Vertical Extent is a property of the Floor and not a section plane.
 *
 * **Rooms are not here, and neither is the Plan Image.** A Room has no Vertical Extent, so it has
 * nothing to project (decision 3); the Plan Image is a raster of the plan and is never drawn in an
 * Elevation View, on screen or on a sheet (criterion 11).
 *
 * The Renovation Display decides which rows exist, exactly as it does for a Plan View, because the
 * rows come from `displayModel`. The Drawing Layers do *not* filter here: they are gates the drawing
 * pass applies through the same `LayerGates` a Plan View is painted with, so that a hidden Wall is
 * hidden by one answer and not by two that can disagree (#71 §4).
 */
import type { ElevationView, EntityId, Floor, Opening, PlacedItem, Project, Wall } from '../domain'
import { UNLAYERED_LAYER_KEY, designHeight, viewDesignOptionId, viewRenovationDisplay } from '../domain'
import type { ClosedPath, ElevationFrame, Pt } from '../geometry'
import { elevationFrame, faceOffsets, openingBodyOutline, projectElevationOutline, wallBodyOutline } from '../geometry'
import { entityLayerKeys } from './drawingLayers'
import { derivePlacement, placementLabels } from './effective'
import { effectiveModel } from './effectiveModel'
import { designOutline, placementContext, worldPointOf } from './placement'
import { displayModel } from './renovationDisplay'

/** Which family an Elevation View draws a row as, which decides its style and its handles. */
export type ElevationRowKind = 'wall' | 'opening' | 'item'

/**
 * One entity's place in one Elevation View: the band it covers and the height it stands at.
 *
 * `sMin`/`sMax` are millimetres along the view line, already clipped to `[0, L]`; `zMin`/`zMax` are
 * millimetres above the Floor Datum, unclipped. `distance` is the nearest the entity comes to the
 * view line, which is the number painter's order sorts by and the number click-to-cycle is fed
 * (#74's nearest-first ordering, one axis wider). `crossesLine` says the view line runs through the
 * entity's own body, which is the content drawn with the heavier outline.
 */
export interface ElevationRow {
  readonly id: EntityId
  readonly kind: ElevationRowKind
  /** What the rest of the product calls this entity: `W-1`, `Window 1`, `Base cabinet #1`. */
  readonly name: string
  readonly sMin: number
  readonly sMax: number
  readonly zMin: number
  readonly zMax: number
  readonly distance: number
  readonly crossesLine: boolean
  /** The Wall an Opening is cut in, or `null`: an Opening is drawn inside its host, never over it. */
  readonly hostWallId: EntityId | null
  /** The Drawing Layer it stands on, which is the painter's tie-break after distance. */
  readonly layerKey: EntityId
}

/** One Elevation View's worth of projection: the frame, the Floor it stands on, and the rows. */
export interface ElevationScene {
  readonly frame: ElevationFrame
  /** The view line's own length, which is the width of the drawing area. */
  readonly length: number
  /** The Floor the view is drawn across: its Datum and Vertical Extent are what get labelled. */
  readonly floor: Floor | null
  /** Every displayed entity inside the prism, in no particular order — the painter decides that. */
  readonly rows: readonly ElevationRow[]
}

/** The frame one Elevation View projects into: its unit direction, its normal and its depth. */
export const elevationFrameOf = (view: ElevationView): ElevationFrame => elevationFrame(view.line, view.side, view.depth)

/** The ring of a footprint, in the same convention the Wall joins and the slider use. */
const ringOf = (path: ClosedPath): Pt[] => [path.start, ...path.segments.map((segment) => segment.to)]

/**
 * Everything one Elevation View shows.
 *
 * The rows are the displayed model of the view's own Floor and Design Option, projected through the
 * frame and left with only what the prism holds. An entity whose whole footprint lies beyond the
 * prism is absent, and one that straddles an end of the view line is present and clipped.
 */
export function elevationScene(project: Project, view: ElevationView): ElevationScene {
  const frame = elevationFrameOf(view)
  const optionId = viewDesignOptionId(view)
  const model = effectiveModel(project, view.floorId, optionId)
  const display = displayModel(model, viewRenovationDisplay(view))
  const layers = entityLayerKeys(project, view.floorId, optionId)
  const floor = project.floors.find((candidate) => candidate.id === view.floorId) ?? null
  const rows: ElevationRow[] = []

  /** One projected body, or nothing when the prism holds none of it. */
  const add = (
    entity: Wall | Opening | PlacedItem,
    kind: ElevationRowKind,
    name: string,
    outline: readonly Pt[],
    zMin: number,
    zMax: number,
    hostWallId: EntityId | null = null,
  ): void => {
    const band = projectElevationOutline(frame, outline)
    if (!band.inside) return
    rows.push({
      id: entity.id,
      kind,
      name,
      sMin: band.sMin,
      sMax: band.sMax,
      zMin,
      zMax,
      distance: band.distance,
      crossesLine: band.crossesLine,
      hostWallId,
      layerKey: layers.get(entity.id) ?? UNLAYERED_LAYER_KEY,
    })
  }

  const wallBody = new Map<EntityId, { readonly line: Wall['line']; readonly offsets: readonly [number, number] }>()
  for (const { entity } of display.walls) {
    const offsets = faceOffsets(entity.thickness, entity.justification)
    wallBody.set(entity.id, { line: entity.line, offsets })
    add(entity, 'wall', entity.ref, wallBodyOutline(entity.line, offsets), entity.baseElevation, entity.baseElevation + entity.height)
  }
  for (const { entity } of display.openings) {
    const host = wallBody.get(entity.hostWallId)
    if (host === undefined) continue
    add(
      entity,
      'opening',
      entity.label,
      openingBodyOutline(host.line, entity.start, entity.start + entity.width, host.offsets),
      entity.sill,
      entity.head,
      entity.hostWallId,
    )
  }
  // The names come from the one labeller every table and warning reads, so `Base cabinet #1` means
  // the same Placement here, in the inspector and in the Warnings List.
  const placements = display.placedItems.flatMap(({ entity }) => {
    const design = project.itemDesigns.find((candidate) => candidate.id === entity.itemDesignId)
    return design === undefined ? [] : [{ entity, placement: derivePlacement(design, entity), design }]
  })
  const names = placementLabels(placements.map((row) => row.placement))
  for (const { entity, design } of placements) {
    const context = placementContext(design, entity)
    const outline = ringOf(designOutline(design)).map((at) => worldPointOf(context, at))
    add(entity, 'item', names.get(entity.id) ?? design.name, outline, entity.baseElevation, entity.baseElevation + designHeight(design))
  }

  return { frame, length: frame.length, floor, rows }
}
