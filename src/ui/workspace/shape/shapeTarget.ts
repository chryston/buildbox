/**
 * The `ShapeTarget` for an Item Design on screen (#58 §6).
 *
 * The controller asks three things of a target — the shape now, how many placements share
 * it, and how the Project writes numbers — and this is where the Project, the Floor and the
 * person's preferences get turned into those three answers. It reads; it never writes, so
 * building a target is free and a component can rebuild one every render.
 */
import { placementCountFor } from '../planModel'
import type { ShapeTarget } from './proposal'
import type { DisplayFormat, ItemDesign, Project } from '../../../domain'

/** How a Project displays numbers, which is all the message formatter needs. */
export const displayFormatOf = (project: Project): DisplayFormat => ({
  unit: project.preferences.displayUnit,
  precision: project.preferences.displayPrecision,
})

/**
 * The shape-editing target for one Item Design, or `null` when there is nothing to edit.
 *
 * A cabinet answers `null` rather than refusing in prose: its footprint, height and Item
 * Origin are derived from its construction (#42 §2), so there is no Item Footprint to
 * propose against. The Shape tab says so in its own words — `Size comes from the cabinet
 * construction` — and stays read-only, which is a different thing to say from "invalid".
 */
export function shapeTarget(project: Project, itemDesignId: string): ShapeTarget | null {
  const design: ItemDesign | undefined = project.itemDesigns.find((candidate) => candidate.id === itemDesignId)
  if (design === undefined || design.kind !== 'generic') return null
  return {
    itemDesignId: design.id,
    current: design.footprint,
    placementCount: placementCountFor(project, design.id),
    format: displayFormatOf(project),
  }
}
