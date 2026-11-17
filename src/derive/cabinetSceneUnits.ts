/**
 * Rebuilding the cabinet scene from a Project (#43).
 *
 * A migrated cabinet lives in two places: an Item Design holds `construction`
 * (`settings` + `root`, ADR 0004) and one Placed Item in the Existing Model says where it
 * stands. `cabinetSceneUnits` joins them again into the `CabinetSceneUnit` the layout
 * engine and the cut list already take, so the migrated project can be laid out exactly
 * as the legacy `Design` was — which is what makes #20 §13.4 and §13.5 parity testable,
 * and what #49 reuses to drive `computeSceneLayout`.
 *
 * The translation convention is #20's pinned one: a cabinet's Item Origin is its
 * footprint centre, so the front sits on plan Y = 0 and the legacy top-edge offset is
 * carried as `baseElevation`. Inverting it is therefore `x = tx − width/2`,
 * `y = baseElevation` — no rotation term, because a migrated cabinet is placed with
 * `rotationDeg: 0`.
 */
import type { CabinetSceneUnit } from '../cabinet'
import type { CabinetItemDesign, EntityId, Project } from '../domain'

/**
 * Every cabinet placed on `floorId`, in placement order.
 *
 * Placements of anything else, and placements that point at no Item Design, are simply
 * not part of the cabinet scene; the Project that produced them is validated elsewhere.
 */
export function cabinetSceneUnits(project: Project, floorId: EntityId): CabinetSceneUnit[] {
  const designs = new Map<string, CabinetItemDesign>()
  for (const design of project.itemDesigns) {
    if (design.kind === 'cabinet') designs.set(design.id, design)
  }

  const units: CabinetSceneUnit[] = []
  for (const placed of project.existingModel.placedItems) {
    if (placed.floorId !== floorId) continue
    const design = designs.get(placed.itemDesignId)
    if (design === undefined) continue
    const { settings, root } = design.construction
    units.push({
      type: 'cabinet',
      id: design.id,
      label: design.name,
      x: placed.translation.x - settings.width / 2,
      y: placed.baseElevation,
      settings,
      root,
    })
  }
  return units
}
