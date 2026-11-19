/**
 * Where a Placed Item actually sits (#57, #16).
 *
 * An Item Design owns one Item Footprint in its own local coordinates — a preset with
 * parameters, or a Custom Path (#58) — plus one editable Item Origin inside it.
 * A Placed Item owns placement context only: where that Origin stands on the Floor and how
 * the design is turned about it.
 *
 *     world(p) = translation + R(rotationDeg) · (p − origin)
 *
 * `R` is `geometry`'s clockwise rotation in the +Y-down frame, and this file is the one
 * place the convention is pinned: a `geometry` `Transform` with `pivot = origin` and
 * `translation = translation − origin` evaluates to exactly that line, so the same helper
 * drives `geometry.bounds` and the Floor bounds come out analytically rather than from a
 * box that was itself bounded (#54 §5, #57's 90° fixture).
 *
 * `ui` may not import `geometry` (#20 §2), so everything the Plan View needs in order to
 * draw a rotated placement — world points, Floor bounds, the origin-pick candidates, the
 * D3 translation rewrite — is projected here. Nothing is stored: every value is derived
 * from the Item Design and the Placed Item it came with.
 */
import { applyTransform, bounds, endpoints, midpoints, normaliseDeg, pt, rotate, TOLERANCE_MM } from '../geometry'
import type { Bounds, ClosedPath, Pt, Transform } from '../geometry'
import { designFootprintSize, designOrigin, footprintPath } from '../domain'
import type { EntityId, ItemDesign, PlacedItem } from '../domain'

/** One placement's placement context, spelled shortly for the pure helpers below. */
export interface PlacementContext {
  readonly rotationDeg: number
  readonly translation: Pt
  readonly origin: Pt
}

/**
 * The Item Design's outline: its Item Footprint as a closed path in local coordinates.
 *
 * A generic design's footprint is whatever its preset evaluates to, or the Custom Path it
 * stores (#58) — the same call the Item Design canvas and the Measurements tab make, so the
 * Floor outline and the editor cannot disagree. A cabinet's footprint is still derived from
 * its construction settings, and it is still the rectangle from `(0,0)` to `(width,depth)`.
 *
 * Named for what it takes — an Item Design — because #58 put a `footprintPath` beside it that
 * takes the Item Footprint itself, and a proposal on the way to becoming a design is exactly
 * what the shape editor has to draw.
 */
export function designOutline(design: ItemDesign): ClosedPath {
  if (design.kind === 'generic') return footprintPath(design.footprint)
  const { width, depth } = designFootprintSize(design)
  return {
    start: pt(0, 0),
    segments: [
      { kind: 'line', to: pt(width, 0) },
      { kind: 'line', to: pt(width, depth) },
      { kind: 'line', to: pt(0, depth) },
      { kind: 'line', to: pt(0, 0) },
    ],
  }
}

/**
 * The default Item Origin of one footprint: the centre of its local bounds (#57 D4).
 *
 * A rectangle gives its own centre; a Custom Path — which `domain` v1 cannot store yet
 * (#58) — gets the same rule, which is why the rule is stated over a path and not over a
 * width and a depth.
 */
export const pathOrigin = (path: ClosedPath): Pt => {
  const box = bounds(path)
  return pt((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2)
}

/** The default Item Origin of an Item Design (#57 D4). */
export const designDefaultOrigin = (design: ItemDesign): Pt => pathOrigin(designOutline(design))

/** The placement context of one Placed Item against its Item Design. */
export const placementContext = (design: ItemDesign, placed: PlacedItem): PlacementContext => ({
  rotationDeg: placed.rotationDeg,
  translation: placed.translation,
  origin: designOrigin(design),
})

/**
 * The placement as a `geometry` `Transform`: rotate about the Item Origin, then move the
 * Origin to its Floor position.
 */
const transformOf = ({ rotationDeg, translation, origin }: PlacementContext): Transform => ({
  rotationDeg,
  translation: pt(translation.x - origin.x, translation.y - origin.y),
  pivot: origin,
})

/** The placement of one Placed Item against its Item Design, as a `geometry` Transform. */
export const placementTransform = (design: ItemDesign, placed: PlacedItem): Transform =>
  transformOf(placementContext(design, placed))

/** A local footprint point through a placement context, in Floor coordinates. */
export const worldPointOf = (context: PlacementContext, at: Pt): Pt => applyTransform(at, transformOf(context))

/** A Floor point back through a placement context, in footprint-local coordinates. */
export const localPointOf = (context: PlacementContext, at: Pt): Pt => {
  const turned = rotate(pt(at.x - context.translation.x, at.y - context.translation.y), -context.rotationDeg)
  return pt(turned.x + context.origin.x, turned.y + context.origin.y)
}

/** A local footprint point of one placement, in Floor coordinates. */
export const worldPoint = (design: ItemDesign, placed: PlacedItem, at: Pt): Pt =>
  worldPointOf(placementContext(design, placed), at)

/** The axis-aligned box one placement covers on its Floor (#57 behaviour 32, derived). */
export const floorBounds = (design: ItemDesign, placed: PlacedItem): Bounds =>
  bounds(designOutline(design), placementTransform(design, placed))

/** The `W × D` the `Floor bounds` row reads: the placement's Floor-space size. */
export const floorBoundsSize = (design: ItemDesign, placed: PlacedItem): { width: number; depth: number } => {
  const box = floorBounds(design, placed)
  return { width: box.maxX - box.minX, depth: box.maxY - box.minY }
}

/**
 * Whether a footprint-local point is a legal Item Origin: inside the footprint's bounds,
 * tolerance in. An Origin outside the footprint would put the shape on the far side of the
 * point the user is dragging, which reads as the item jumping.
 */
export const localPointValid = (design: ItemDesign, at: Pt): boolean => {
  const box = bounds(designOutline(design))
  return (
    at.x >= box.minX - TOLERANCE_MM &&
    at.x <= box.maxX + TOLERANCE_MM &&
    at.y >= box.minY - TOLERANCE_MM &&
    at.y <= box.maxY + TOLERANCE_MM
  )
}

/** One placement whose Item Origin is about to move, and where its translation goes. */
export interface OriginMove {
  readonly placedItemId: EntityId
  readonly translation: Pt
}

/**
 * The D3 rewrite (#57 behaviour 31): moving the Item Origin from `from` to `to` keeps every
 * footprint exactly where it is, so each placement's translation takes the same turn the
 * Origin did —
 *
 *     translation′ = translation + R(rotationDeg) · (to − from)
 *
 * Pure and total over the placements it is handed, which is what lets the preview, the
 * `edit` handler and the property test all read the same arithmetic. The placement still
 * owns no pivot: only the point future rotations turn about changes.
 */
export function originMoveTranslations(
  placements: readonly { id: EntityId; translation: Pt; rotationDeg: number }[],
  from: Pt,
  to: Pt,
): OriginMove[] {
  const delta = pt(to.x - from.x, to.y - from.y)
  return placements.map((placed) => {
    const turned = rotate(delta, placed.rotationDeg)
    return {
      placedItemId: placed.id,
      translation: pt(placed.translation.x + turned.x, placed.translation.y + turned.y),
    }
  })
}

/**
 * The points `Pick on canvas` snaps to (#57 behaviour 30): the footprint's vertices, the
 * midpoints of its edges and the centre of its local bounds — `geometry`'s own candidate
 * primitives, so a pick lands on the outline rather than on the polyline that draws it.
 */
export const originCandidates = (design: ItemDesign): Pt[] => {
  const path = designOutline(design)
  return [...endpoints(path), ...midpoints(path), pathOrigin(path)]
}

/** The nearest candidate within `toleranceMm`, or `null` when the pick is on its own. */
export const nearestOriginCandidate = (candidates: readonly Pt[], at: Pt, toleranceMm: number): Pt | null => {
  let best: Pt | null = null
  let bestDistance = toleranceMm
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - at.x, candidate.y - at.y)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** One turn: clockwise degrees normalised to `[0, 360)`. */
/** One turn, clockwise, never `-0`: what `PlacedItem.rotationDeg` is allowed to hold. */
export const normaliseRotation = (rotationDeg: number): number => {
  const turned = normaliseDeg(rotationDeg)
  return turned === 0 ? 0 : turned
}
