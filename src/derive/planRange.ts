/**
 * Which side of a Plan View's Vertical Range an entity sits on (#74 §3).
 *
 * A Plan View draws the world between two elevations, and every entity of a Floor has a Vertical
 * Extent — the two elevations it occupies — except the kinds that lie flat: a Room is a floor area
 * and an Annotation is a mark on the sheet, so neither has an extent and neither can be anything but
 * In range. Between the two, an entity is In range, Above range or Below range, and that is the whole
 * vocabulary: it decides the styling the drawing lays down and the order a click cycles through, and
 * nothing else. It is never stored. It is a reading of the entity against the one range of the one
 * view being drawn, which is why it lives here rather than on any record.
 *
 * The comparison is the 0.01 mm geometry tolerance, and touching a boundary is not an intersection: a
 * cabinet whose sole sits exactly on the upper limit is Above range, not In range, because the drawing
 * would otherwise show a sliver of it that is not really there. `TOLERANCE_MM` is the same epsilon the
 * corner radii and the Wall junctions are measured with, so a person who sets the limit to where a
 * Wall's top exactly is does not get a Wall drawn twice.
 */
import { beamTop, designHeight } from '../domain'
import type { Beam, EntityId, ItemDesign, Opening, PlanViewRange, PlacedItem, Wall } from '../domain'
import { interval, type Interval } from '../geometry'
import { TOLERANCE_MM } from '../geometry'
import type { EffectiveModel } from './effectiveModel'

/** The three answers a Plan View Range gives about one entity. */
export type RangeClass = 'below' | 'in' | 'above'

/**
 * The order the three answers paint and cycle in: what is under the Floor first, then what the view is
 * really drawn for, then what is over it (#74 §3, §5).
 */
export const RANGE_RANK: Record<RangeClass, number> = { below: 0, in: 1, above: 2 }

/** The Vertical Extent of a Wall: its structural level, and the soffit its height reaches. */
export const wallExtent = (wall: Wall): Interval => interval(wall.baseElevation, wall.baseElevation + wall.height)

/** The Vertical Extent of an Opening: the foot of its sill, the head of its head. */
export const openingExtent = (opening: Opening): Interval => interval(opening.sill, opening.head)

/**
 * The Vertical Extent of a Beam: the Underside it stores and the Top its Depth reaches (#77 §1).
 *
 * A Beam is classified like every other piece of fabric, which is what makes an out-of-range Beam
 * draw dashed and stay selectable (#74 §3, §5) rather than vanish — the one thing a coordination
 * record must never do is hide itself.
 */
export const beamExtent = (beam: Beam): Interval => interval(beam.underside, beamTop(beam))

/**
 * The Vertical Extent of a Placed Item: where it stands, and the height its Item Design gives it.
 *
 * A Placed Item stores no height of its own — the Design has it, which is the whole reason a change to
 * a Design reaches every copy of it — so the extent is always read through the Design (#74 §1).
 */
export const placementExtent = (design: ItemDesign, placed: PlacedItem): Interval =>
  interval(placed.baseElevation, placed.baseElevation + designHeight(design))

/**
 * Which side of `range` one extent falls on.
 *
 * `null` is the extent of a kind that has none — a Room, an Annotation — and such a thing is always In
 * range: there is nothing to compare, and a range that dropped a Room would be a range hiding an
 * entity, which #74 §3 forbids.
 */
export function rangeClass(extent: Interval | null, range: PlanViewRange): RangeClass {
  if (extent === null) return 'in'
  // `bottom >= Upper` is Above and `top <= Lower` is Below, each with the tolerance folded in so a
  // value that merely touches a boundary counts as touching it. Everything left over intersects the
  // range, which is what In range means.
  if (extent.lo >= range.upperMm - TOLERANCE_MM) return 'above'
  if (extent.hi <= range.lowerMm + TOLERANCE_MM) return 'below'
  return 'in'
}

/**
 * The class of every entity one Floor draws, keyed by entity ID (#74 §3).
 *
 * The Effective Model is what is read, so a Proposed Wall is classified by the extent it will have and
 * a Demolition one by the extent it still has — the Renovation Display decides how each is drawn on
 * top of that, never instead of it. Entities with no Vertical Extent are absent from the map:
 * `rangeClass(null, …)` already says In range, and a map that listed every Room in the Project would
 * only invite a reader to treat its absence as a bug.
 */
export function rangeClasses(
  model: EffectiveModel,
  designs: readonly ItemDesign[],
  range: PlanViewRange,
): Map<EntityId, RangeClass> {
  const designOf = new Map(designs.map((design) => [design.id, design]))
  const classes = new Map<EntityId, RangeClass>()
  for (const { entity } of model.walls) classes.set(entity.id, rangeClass(wallExtent(entity), range))
  for (const { entity } of model.openings) classes.set(entity.id, rangeClass(openingExtent(entity), range))
  for (const { entity } of model.placedItems) {
    const design = designOf.get(entity.itemDesignId)
    // A Placed Item whose Design has gone missing is a broken Project the validator already refuses;
    // there is no height to read, so there is no extent, and it is In range the way a Room is.
    classes.set(entity.id, rangeClass(design === undefined ? null : placementExtent(design, entity), range))
  }
  for (const { entity } of model.beams) classes.set(entity.id, rangeClass(beamExtent(entity), range))
  return classes
}
