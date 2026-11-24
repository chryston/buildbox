/**
 * Which drawn entities a click lands on (#70 §8).
 *
 * `overlapCycle` orders and walks the candidates; this decides who is one. The rule is the issue's:
 * a candidate is something the Display **drew**, that is **selectable**, and that the `Pick:` filter
 * allows — so this is handed the same filtered geometry the canvas painted from and asks each one
 * whether the clicked Floor point is inside it. Nothing drawn is missed and nothing invisible is
 * offered, which is what makes "every drawn, selectable candidate is reachable by cycling" true
 * rather than hopeful.
 *
 * The tests are the ones the drawing itself uses: a Wall by the winding number of the outline it is
 * filled with (an arc the same way, no special case), a Placed Item by its world path, a Room by its
 * path, and an Opening by the hit area the Wall drawing laid down for it — the same box that answers
 * the pointer on screen. `drawOrder` is the layer the entity is painted in, so the cycle's "top
 * first" is the canvas's own paint order rather than a second opinion of it.
 */
import { distanceToSegment, windingNumber } from '../geometry'
import type { ClosedPath, Pt } from '../geometry'
import { LAYER_ORDER } from './types'
import type { RenovationState } from '../derive'

/**
 * One candidate as the drawing sees it: what was painted, its Renovation State, and where in the
 * paint order it sits. `ui`'s `overlapCycle` walks this shape; it is defined here so the drawing
 * never has to know about the cycle.
 */
export interface DrawnCandidate {
  readonly entityId: string
  readonly renovationState: RenovationState
  readonly drawOrder: number
}

/** One thing the canvas drew, in the shape it drew it in. */
export interface DrawnEntity {
  readonly id: string
  /** The closed outline a click is tested against. */
  readonly outline: ClosedPath
}

/** What the canvas drew, already narrowed to this Renovation Display. */
export interface DrawnEntities {
  readonly walls: readonly DrawnEntity[]
  readonly placements: readonly DrawnEntity[]
  readonly rooms: readonly DrawnEntity[]
  /** The Beams (#77 §3): documentation drawn under the Walls, and cycled in the same order. */
  readonly beams: readonly DrawnEntity[]
  /**
   * The Skirting (#78 §7), one entry per **run**: a strip broken by a door is two places the pointer
   * can land on, and the cycle says the one under it.
   */
  readonly skirtings: readonly DrawnEntity[]
  /**
   * The Services (#79 §6), one entry per Service: a pipe is one thing the pointer means, wherever
   * along it it lands.
   */
  readonly services?: readonly DrawnEntity[]
  /** The Display's state list: an entity absent from it was not drawn. */
  readonly states: ReadonlyMap<string, RenovationState>
}

const layerRank = (layer: (typeof LAYER_ORDER)[number]): number => LAYER_ORDER.indexOf(layer)

/** The layer rank a caller adds a candidate at, so a hand-added one sorts with the rest. */
export const drawOrderOf = (layer: (typeof LAYER_ORDER)[number], index: number): number =>
  layerRank(layer) * 1000 + index

const inside = (at: Pt, outline: ClosedPath): boolean => windingNumber(at, outline) !== 0

/**
 * Whether `at` lies within `reachMm` of the outline — the same test as `inside`, widened.
 *
 * A 15 mm Skirting is a pixel and a half at the zoom a Flat is read at, and the Plan View already
 * says where it may be clicked by stroking an invisible `hit-target` twin of it ten device pixels
 * wide. The click is measured against that width, so the strip answers the pointer where the surface
 * offers itself instead of only where a hairline happens to fall.
 */
const nearRing = (at: Pt, outline: ClosedPath, reachMm: number): boolean => {
  let from = outline.start
  for (const segment of outline.segments) {
    if (distanceToSegment(at, segment, from) <= reachMm) return true
    from = segment.to
  }
  return false
}

function candidate(
  entityId: string,
  renovationState: RenovationState,
  layer: (typeof LAYER_ORDER)[number],
  index: number,
): DrawnCandidate {
  return { entityId, renovationState, drawOrder: layerRank(layer) * 1000 + index }
}

function gather(
  found: DrawnCandidate[],
  entities: readonly DrawnEntity[],
  layer: (typeof LAYER_ORDER)[number],
  states: ReadonlyMap<string, RenovationState>,
  hit: (entity: DrawnEntity) => boolean,
): void {
  for (const entity of entities) {
    const state = states.get(entity.id)
    if (state !== undefined && hit(entity)) found.push(candidate(entity.id, state, layer, found.length))
  }
}

/**
 * The candidates under a clicked Floor point, in no particular order — `cycleOrder` decides that.
 * Two candidates in the same layer and State keep the order they were drawn in, so the list is
 * stable across a re-derive.
 *
 * `skirtingReachMm` is half the width the Plan View paints a Skirting's hit target at, in the list's
 * own millimetres: 0 asks the strip to answer only where its body is, and the canvas passes the
 * screen-pixel width it drew it with so the two agree (#78 §7).
 */
export function candidatesAtPoint(at: Pt, drawn: DrawnEntities, skirtingReachMm = 0): DrawnCandidate[] {
  const found: DrawnCandidate[] = []
  gather(found, drawn.walls, 'walls', drawn.states, (wall) => inside(at, wall.outline))
  gather(found, drawn.placements, 'placed-items', drawn.states, (item) => inside(at, item.outline))
  gather(found, drawn.rooms, 'rooms', drawn.states, (room) => inside(at, room.outline))
  gather(found, drawn.beams, 'beams', drawn.states, (beam) => inside(at, beam.outline))
  gather(found, drawn.skirtings, 'skirtings', drawn.states, (strip) =>
    inside(at, strip.outline) || (skirtingReachMm > 0 && nearRing(at, strip.outline, skirtingReachMm)))
  // A Service is picked the same way a Skirting is: inside its body, or within the reach the canvas
  // strokes its invisible target with, so the cycle answers where the surface offers it (#79 §6).
  gather(found, drawn.services ?? [], 'services', drawn.states, (service) =>
    inside(at, service.outline) || (skirtingReachMm > 0 && nearRing(at, service.outline, skirtingReachMm)))
  return found
}
