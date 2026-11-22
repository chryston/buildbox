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
import { windingNumber } from '../../../geometry'
import type { ClosedPath, Pt } from '../../../geometry'
import { LAYER_ORDER } from '../../../drawing'
import type { RenovationState } from '../../../derive'
import type { CycleCandidate } from './overlapCycle'

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
  /** The Display's state list: an entity absent from it was not drawn. */
  readonly states: ReadonlyMap<string, RenovationState>
}

const layerRank = (layer: (typeof LAYER_ORDER)[number]): number => LAYER_ORDER.indexOf(layer)

/** The layer rank a caller adds a candidate at, so a hand-added one sorts with the rest. */
export const drawOrderOf = (layer: (typeof LAYER_ORDER)[number], index: number): number =>
  layerRank(layer) * 1000 + index

const inside = (at: Pt, outline: ClosedPath): boolean => windingNumber(at, outline) !== 0

function candidate(
  entityId: string,
  renovationState: RenovationState,
  layer: (typeof LAYER_ORDER)[number],
  index: number,
): CycleCandidate {
  return { entityId, renovationState, drawOrder: layerRank(layer) * 1000 + index }
}

function gather(
  found: CycleCandidate[],
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
 */
export function candidatesAtPoint(at: Pt, drawn: DrawnEntities): CycleCandidate[] {
  const found: CycleCandidate[] = []
  gather(found, drawn.walls, 'walls', drawn.states, (wall) => inside(at, wall.outline))
  gather(found, drawn.placements, 'placed-items', drawn.states, (item) => inside(at, item.outline))
  gather(found, drawn.rooms, 'rooms', drawn.states, (room) => inside(at, room.outline))
  return found
}
