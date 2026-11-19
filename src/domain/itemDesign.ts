/**
 * The pure accessors every consumer of an Item Design needs (#42 §2), because they
 * encode the footprint conventions: a cabinet's Item Footprint, height and Item Origin
 * are derived from its `construction.settings` and never stored, and a cabinet's Item
 * Origin in v1 is the footprint centre.
 *
 * Placements never copy, scale or swap design dimensions (#16): read them here instead.
 */
import { footprintSize } from './footprint'
import type { ItemDesign, Point2 } from './project'

/**
 * The Item Footprint size in millimetres.
 *
 * A generic design's size is the size of its local bounds (#58), not a field: a preset has
 * no width to read except the one its parameters evaluate to, and a Custom Path has none at
 * all. A turned shape reports the bounds it draws, which is what the Library outline and the
 * inspector's read-only `Width` / `Depth` rows have to agree with.
 */
export function designFootprintSize(design: ItemDesign): { width: number; depth: number } {
  return design.kind === 'cabinet'
    ? { width: design.construction.settings.width, depth: design.construction.settings.depth }
    : footprintSize(design.footprint)
}

/** The design height in millimetres. */
export function designHeight(design: ItemDesign): number {
  return design.kind === 'cabinet' ? design.construction.settings.height : design.height
}

/** The Item Origin in footprint-local millimetres. */
export function designOrigin(design: ItemDesign): Point2 {
  if (design.kind === 'cabinet') {
    const { width, depth } = design.construction.settings
    return { x: width / 2, y: depth / 2 }
  }
  return design.origin
}
