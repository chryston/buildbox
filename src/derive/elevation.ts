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
import type { Beam, ElevationView, EntityId, Floor, Opening, PlacedItem, Project, Service, Skirting, Wall } from '../domain'
import { UNLAYERED_LAYER_KEY, beamLabel, beamTop, designHeight, serviceBottom, servicePlanLabel, serviceTop, skirtingLabel, skirtingTop, viewDesignOptionId, viewRenovationDisplay } from '../domain'
import type { ClosedPath, ElevationFrame, Pt } from '../geometry'
import { elevationFrame, faceOffsets, linearElement, openingBodyOutline, projectElevationOutline, wallBodyOutline } from '../geometry'
import { entityLayerKeys } from './drawingLayers'
import { derivePlacement, placementLabels } from './effective'
import { effectiveModel } from './effectiveModel'
import { designOutline, placementContext, worldPointOf } from './placement'
import { displayModel } from './renovationDisplay'
import { deriveSkirting } from './skirting'
import { deriveServices, serviceHitOutline } from './services'

/** Which family an Elevation View draws a row as, which decides its style and its handles. */
export type ElevationRowKind = 'wall' | 'opening' | 'item' | 'beam' | 'skirting' | 'service'

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
  /** The entity's own colour, or `null` where it has none: a Placed Item's fill is its own (#20 §4). */
  readonly color: string | null
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
 * The depth at which one row is seen, in millimetres from the view line.
 *
 * A Skirting is a finish on a face, not a thing standing in the band: its own `distance` is the host
 * face's, a few tens of millimetres in front of the cut through the Wall. Ordering rows by that alone
 * — which is what both painting and picking do — buries the strip inside the Wall it is skirted to,
 * so it is neither seen nor reachable by the pointer. A finish takes the depth of the thing it is a
 * finish on, and the kind rank in the drawing lifts it above that Wall.
 */
export const elevationRowDepth = (rows: readonly ElevationRow[]) => {
  const walls = new Map(rows.filter((row) => row.kind === 'wall').map((row) => [row.id, row.distance]))
  return (row: ElevationRow): number =>
    row.kind === 'skirting' && row.hostWallId !== null ? walls.get(row.hostWallId) ?? row.distance : row.distance
}

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
    entity: Wall | Opening | PlacedItem | Beam | Skirting | Service,
    kind: ElevationRowKind,
    name: string,
    outline: readonly Pt[],
    zMin: number,
    zMax: number,
    hostWallId: EntityId | null = null,
    color: string | null = null,
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
      color,
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
  for (const { entity, placement, design } of placements) {
    const context = placementContext(design, entity)
    const outline = ringOf(designOutline(design)).map((at) => worldPointOf(context, at))
    add(
      entity,
      'item',
      names.get(entity.id) ?? design.name,
      outline,
      entity.baseElevation,
      entity.baseElevation + designHeight(design),
      null,
      placement.color,
    )
  }

  // A Beam owns its own height, so its band is Underside to Top and its plan body is the outline
  // `deriveBeams` builds from the same primitive a Wall body comes from. It is documentation drawn
  // under the Walls, and the painter's order keeps it behind them by distance like anything else.
  for (const { entity } of display.beams) {
    add(
      entity,
      'beam',
      beamLabel(entity),
      ringOf(linearElement({ kind: 'line', to: entity.line.end }, entity.line.start, entity.width, entity.justification).outline),
      entity.underside,
      beamTop(entity),
    )
  }

  // A Skirting owns its height too, so its band is Bottom to Top. It is drawn as one row per run:
  // the gaps `deriveSkirting` cuts for an Opening, a branch Wall and a corner are the same holes the
  // Plan View paints and the same ones `net_length_mm` counts, so an Elevation View of a Wall with a
  // door in it shows a strip broken at the door and nothing else.
  const derivedSkirting = deriveSkirting(project, view.floorId, optionId, viewRenovationDisplay(view))
  const derivedServices = deriveServices(project, view.floorId, optionId)
  for (const { entity } of display.skirting) {
    const body = derivedSkirting.byId.get(entity.id)
    if (body === undefined) continue
    for (const run of body.runs) {
      add(entity, 'skirting', skirtingLabel(entity), ringOf(run.outline), body.bottom, skirtingTop(entity), entity.hostWallId)
    }
  }

  // A Service is documentation with a Vertical Extent of its own, so it projects whole in depth like
  // anything else: a Run's band is its plan body between Bottom and Top, and a Riser is a column as
  // wide as its diameter standing from Bottom to Top. The plan body of both is the outline the
  // pointer picks it by in the Plan View, so the two views agree on where the thing is (#79 §6).
  for (const { entity } of display.services) {
    const body = derivedServices.byId.get(entity.id)
    if (body === undefined) continue
    add(
      entity,
      'service',
      servicePlanLabel(entity),
      ringOf(serviceHitOutline(body)),
      serviceBottom(entity),
      serviceTop(entity),
    )
  }

  return { frame, length: frame.length, floor, rows }
}
