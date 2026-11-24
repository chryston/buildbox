/**
 * The screen-only dashed outlines of #76 §1 and §4.
 *
 * Two families live here, and neither is ever exported with a drawing:
 *
 * - the **height preview**: while the shared-height panel holds a valid number, every placement
 *   of that design shows a dashed outline of what it would become — the footprint in the Plan
 *   View (the footprint does not move; the outline says *this one is affected*), and the
 *   projected new-top/bottom rectangle in each open Elevation View;
 * - the **Clearance Envelope**: dashed in the Clearance token for the selected Placed Item and
 *   for every envelope an open warning names, in plan and as the projected band in Elevation.
 *
 * The envelope always arrives through `placementTransform` — the very transform the footprint
 * arrived by — which is the warnings engine's rule (#76 §4), so the drawn region and the
 * measured region cannot disagree. Nothing here enters a Display List, so nothing here can
 * reach a drawing export.
 */
import type { ClosedPath, ElevationFrame, Transform } from '../../derive'
import { applyTransform, projectElevationOutline, transformSegment } from '../../derive'
import type { DerivedFloor, ElevationScene } from '../../derive'
import { effectiveModel, placementTransform } from '../../derive'
import type { Project } from '../../domain'

/** A dashed rectangle in one Elevation View's own millimetres: along the line, above the Datum. */
export interface PreviewBand {
  readonly id: string
  readonly sMin: number
  readonly sMax: number
  readonly zLo: number
  readonly zHi: number
}

/** The envelope of one design, taken through the placement's own transform. */
export const envelopeWorldPath = (path: ClosedPath, transform: Transform): ClosedPath => ({
  start: applyTransform(path.start, transform),
  segments: path.segments.map((segment) => transformSegment(segment, transform)),
})

/**
 * The dashed footprints of the height preview: every placement of `itemDesignId` the displayed
 * Floor holds, as its world footprint. A height changes no plan geometry, so the outline is the
 * footprint itself — the preview token around it is what says *this one is about to change*.
 */
export function heightPreviewOutlines(
  floor: DerivedFloor | null,
  itemDesignId: string | null,
): readonly ClosedPath[] {
  if (floor === null || itemDesignId === null) return []
  return floor.placements
    .filter((placement) => placement.designId === itemDesignId)
    .map((placement) => placement.worldPath)
}

/**
 * The dashed Clearance Envelopes of the placements named, in plan. A placement whose design has
 * no envelope contributes nothing; the set is the caller's (the selection, the open warnings).
 */
export function envelopePlanOutlines(
  project: Project,
  floorId: string,
  optionId: string | null,
  placementIds: ReadonlySet<string>,
): readonly ClosedPath[] {
  return envelopeOutlinesFor(project, floorId, optionId, placementIds)
}

/** Shared body: every standing placement named, its envelope through its own transform. */
function envelopeOutlinesFor(
  project: Project,
  floorId: string,
  optionId: string | null,
  placementIds: ReadonlySet<string>,
): readonly ClosedPath[] {
  const out: ClosedPath[] = []
  for (const placed of effectiveModel(project, floorId, optionId).standingPlacedItems) {
    if (!placementIds.has(placed.id)) continue
    const design = project.itemDesigns.find((candidate) => candidate.id === placed.itemDesignId)
    const envelope = design?.clearanceEnvelope ?? null
    if (design === undefined || envelope === null) continue
    out.push(envelopeWorldPath(envelope.path, placementTransform(design, placed)))
  }
  return out
}

/**
 * The projected new-top/bottom rectangles of the height preview, in one Elevation View: the
 * placement's own band along the view line, from its Base to the height the panel holds. The
 * rows come from the scene, so a placement the prism does not hold has no row and no outline.
 */
export function elevationHeightBands(
  scene: ElevationScene,
  placementIds: ReadonlySet<string>,
  heightMm: number,
): readonly PreviewBand[] {
  const bands: PreviewBand[] = []
  for (const row of scene.rows) {
    if (row.kind !== 'item' || !placementIds.has(row.id)) continue
    const base = Math.min(row.zMin, row.zMax)
    bands.push({ id: row.id, sMin: row.sMin, sMax: row.sMax, zLo: base, zHi: base + heightMm })
  }
  return bands
}

/**
 * The projected Clearance Envelope bands of the placements named, in one Elevation View: the
 * envelope's own footprint through the view's frame, and the vertical interval the envelope
 * states — `bottomOffset` above the placement's Base, up to its height.
 */
export function elevationEnvelopeBands(
  project: Project,
  frame: ElevationFrame,
  floorId: string,
  optionId: string | null,
  placementIds: ReadonlySet<string>,
): readonly PreviewBand[] {
  if (placementIds.size === 0) return []
  const bands: PreviewBand[] = []
  for (const placed of effectiveModel(project, floorId, optionId).standingPlacedItems) {
    if (!placementIds.has(placed.id)) continue
    const design = project.itemDesigns.find((candidate) => candidate.id === placed.itemDesignId)
    const envelope = design?.clearanceEnvelope ?? null
    if (design === undefined || envelope === null) continue
    const world = envelopeWorldPath(envelope.path, placementTransform(design, placed))
    const projection = projectElevationOutline(frame, [world.start, ...world.segments.map((segment) => segment.to)])
    if (projection.sMin > projection.sMax) continue
    const base = placed.baseElevation
    bands.push({
      id: placed.id,
      sMin: projection.sMin,
      sMax: projection.sMax,
      zLo: base + envelope.bottomOffset,
      zHi: base + envelope.bottomOffset + envelope.height,
    })
  }
  return bands
}
