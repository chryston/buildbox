/**
 * Which entities a Renovation Display draws, and in what order (#70 §4, criteria 7–9).
 *
 * `effectiveModel` answers *what the Floor holds under this Option* and tags each entity with its
 * Renovation State. A Display answers the next question — *how much of that am I looking at right
 * now* — and it is a view of the same model, never a second copy of it: one Option, four Displays,
 * one set of entities. So everything here is a filter and a re-tag over `EffectiveEntity` rows.
 *
 * | Display    | Existing (kept) | Existing (demolished by the Option) | Proposed |
 * | ---------- | --------------- | ----------------------------------- | -------- |
 * | Existing   | Existing        | **Existing** — drawn as it is today | —        |
 * | Demolition | Existing        | Demolition                          | —        |
 * | Proposed   | Existing        | —                                   | Proposed |
 * | Combined   | Existing        | Demolition                          | Proposed |
 *
 * The Existing row is the one that looks like a mistake and is not: an entity the Option knocks out
 * is still part of the Existing Model, so the Existing Display draws it with no strike-through.
 * That Display is the answer to "what is there today", and the Option's opinion about it belongs to
 * the other three.
 *
 * **A Display with no Design Option** needs no special case. `effectiveModel` with `optionId` of
 * `null` holds only Existing-Model entities, all tagged Existing, so the table above already draws
 * the Existing Model as Existing and nothing from any Option — which is what criterion 9 asks for,
 * and why the error state §6 banners about is a *drawing* decision and not a broken model.
 *
 * Draw order is Existing, then Demolition, then Proposed, and within a State the order the model
 * already holds: the canvas paints a layer at a time, and a re-derive must never reshuffle what the
 * user has been clicking on.
 */
import type { EntityId, Opening, PlacedItem, RenovationDisplay, Room, Wall, WallJunction } from '../domain'
import type { EffectiveEntity, EffectiveModel } from './effectiveModel'
import type { RenovationState } from './quantities/scope'

/** One entity a Display draws, and the State it is drawn *as* — which is not always its own. */
export interface DisplayEntity<T> {
  readonly entity: T
  readonly renovationState: RenovationState
}

/** The five collections a Display draws, in paint order. */
export interface DisplayModel {
  readonly optionId: EntityId | null
  readonly display: RenovationDisplay
  readonly walls: readonly DisplayEntity<Wall>[]
  readonly wallJunctions: readonly DisplayEntity<WallJunction>[]
  readonly openings: readonly DisplayEntity<Opening>[]
  readonly rooms: readonly DisplayEntity<Room>[]
  readonly placedItems: readonly DisplayEntity<PlacedItem>[]
}

/** Paint order: the layer a Display draws first is the one underneath. */
const STATE_RANK: { [S in RenovationState]: number } = { existing: 0, demolition: 1, proposed: 2 }

/**
 * The table above, as data: the State an entity of each State is drawn as on each Display, or
 * `null` when the Display leaves it out. Adding a fifth Display is one row here and nothing else.
 */
const DRAWN_AS: { [D in RenovationDisplay]: { [S in RenovationState]: RenovationState | null } } = {
  existing: { existing: 'existing', demolition: 'existing', proposed: null },
  demolition: { existing: 'existing', demolition: 'demolition', proposed: null },
  proposed: { existing: 'existing', demolition: null, proposed: 'proposed' },
  combined: { existing: 'existing', demolition: 'demolition', proposed: 'proposed' },
}

/**
 * The rows one Display draws, in paint order. Stable within a State, so the model's own order —
 * Existing-Model order, then the Option's — survives.
 */
export function displayRows<T>(rows: readonly EffectiveEntity<T>[], display: RenovationDisplay): DisplayEntity<T>[] {
  const table = DRAWN_AS[display]
  const drawn: DisplayEntity<T>[] = []
  for (const row of rows) {
    const as = table[row.renovationState]
    if (as !== null) drawn.push({ entity: row.entity, renovationState: as })
  }
  return drawn.sort((a, b) => STATE_RANK[a.renovationState] - STATE_RANK[b.renovationState])
}

/** Everything one Display draws of one effective model. */
export function displayModel(model: EffectiveModel, display: RenovationDisplay): DisplayModel {
  return {
    optionId: model.optionId,
    display,
    walls: displayRows(model.walls, display),
    wallJunctions: displayRows(model.wallJunctions, display),
    openings: displayRows(model.openings, display),
    rooms: displayRows(model.rooms, display),
    placedItems: displayRows(model.placedItems, display),
  }
}

/** How many of each kind a Display draws — the numbers the strip shows (#70 §5). */
export function displayCounts(model: EffectiveModel, display: RenovationDisplay) {
  const drawn = displayModel(model, display)
  return {
    walls: drawn.walls.length,
    wallJunctions: drawn.wallJunctions.length,
    openings: drawn.openings.length,
    rooms: drawn.rooms.length,
    placedItems: drawn.placedItems.length,
  }
}
