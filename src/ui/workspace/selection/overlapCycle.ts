/**
 * Click-to-cycle selection of overlapping candidates (#70 §8, criteria 15–18) — the ordering, as
 * pure functions.
 *
 * Three Renovation States can stack on one pixel: `W-2` as Existing, `W-2` as Demolition, `W-2′` as
 * Proposed. A click picks the top one; clicking again in the same spot walks down the stack and
 * wraps. Nothing here touches the store, the canvas or a pointer event — the caller reports the
 * candidates it can see and where the click landed, and gets back which candidate to select and
 * what the next click should remember. That is what lets #74 add Plan View Range grouping by
 * extending *this* function instead of writing a second one.
 *
 * Two rules are load-bearing:
 *
 * - **The order is the draw order, read from the top**: layer order first, then Existing <
 *   Demolition < Proposed. The last thing drawn is the thing under the finger, so it is first in the
 *   cycle and first in the candidate list — which is why the list reads top first.
 * - **Every drawn, selectable, filter-allowed candidate is reachable by cycling.** BuildBox never
 *   prefers a successor so strongly that its predecessor becomes unreachable, so the cycle is the
 *   whole reachable set with nothing skipped, and `reachableCandidates` is the same list the cycle
 *   walks. The `Pick:` filter narrows both together, never one without the other.
 *
 * The same-spot radius is `SNAP_ACQUISITION_PX` — the constant the shape editor already uses for
 * "the same pixel twice" — so a click that jitters by a pixel keeps cycling instead of restarting.
 */
import { SNAP_ACQUISITION_PX, type RangeClass, type RenovationState } from '../../../derive'
import type { EntityId } from '../../../domain'

/** One thing a click could pick, as the canvas sees it. */
export interface CycleCandidate {
  readonly entityId: EntityId
  /** The State it is drawn as, which is what the badge on its row says. */
  readonly renovationState: RenovationState
  /**
   * Where it sits in the Display's paint order: higher is drawn later, so higher is on top. The
   * canvas already knows this — it is the index it drew the entity at.
   */
  readonly drawOrder: number
  /**
   * What the Plan View Range says about it (#74 §6): In, Above or Below. Absent means In range,
   * which is what every entity without a Vertical Extent is — a Room, a Plan Image, a Drawing Layer's
   * annotation — and what a caller that has not derived the classes yet means.
   */
  readonly rangeClass?: RangeClass
  /**
   * How far in front of the Elevation View's viewing line the entity stands, in millimetres (#75).
   * Only an Elevation View reads it: nearest first is the order that picks what the eye is on. Absent
   * is 0, the nearest answer there is.
   */
  readonly distance?: number
}

/** A point in CSS pixels, the space the 12 px acquisition radius is measured in. */
export interface CanvasPoint {
  readonly x: number
  readonly y: number
}

/** What the previous click left behind, or `null` when there is no cycle running. */
export interface CycleState {
  readonly point: CanvasPoint
  /** The reachable candidates in cycle order, by id — the set the next click has to match. */
  readonly candidateIds: readonly EntityId[]
  /** Which of them is selected now. */
  readonly index: number
}

/** The result of one click: what to select, and what to remember for the next one. */
export interface CycleOutcome {
  /** The candidate to select, or `null` when nothing under the pointer can be picked. */
  readonly selected: CycleCandidate | null
  readonly state: CycleState | null
}

const STATE_RANK: { [S in RenovationState]: number } = { existing: 0, demolition: 1, proposed: 2 }

/**
 * The candidates a click can reach: drawn and selectable (the caller's job to decide), and allowed
 * by the `Pick:` filter. An empty filter means every State can be picked, which is the chips-off
 * state; the filter never reorders anything.
 */
export function reachableCandidates(
  candidates: readonly CycleCandidate[],
  filter: readonly RenovationState[],
): CycleCandidate[] {
  return filter.length === 0 ? [...candidates] : candidates.filter((row) => filter.includes(row.renovationState))
}

/**
 * Which Range Class the cycle walks first (#74 §6): In range, then Above, then Below.
 *
 * This is `RANGE_RANK` rotated rather than copied. That constant orders the *paint* pass, where a
 * Below-range entity goes down first because it is the faintest background and everything else is
 * drawn over it; the cycle starts with what the view is looking at, which is where the paint pass ends.
 * Two orders of one grouping, and the difference is which end a person clicks first.
 */
const RANGE_CYCLE_RANK: Record<RangeClass, number> = { in: 0, above: 1, below: 2 }

/**
 * Which view is cycling (#74 §6). A Plan View groups by Range Class; an Elevation View has no Range —
 * it is a slice — so it orders by distance from the viewing line instead, nearest first.
 */
export type CycleViewKind = 'plan' | 'elevation'

/**
 * The cycle order: top candidate first.
 *
 * In a Plan View the Plan View Range decides first — In range, then Above, then Below — then layer
 * order, then the State (Proposed above Demolition above Existing), and two candidates equal on all
 * three keep the order the canvas drew them in, so the function is stable and a re-derive cannot
 * reshuffle the list.
 *
 * "Walls and Openings before Rooms" needs no key of its own: a Room has no Vertical Extent, so it is
 * In range by definition, and it is always drawn behind the Walls and Openings of the same Floor. Both
 * halves of §6's order therefore fall out of the two keys above, in the group the criterion describes.
 *
 * In an Elevation View distance from the viewing line decides first, nearest first (#75 aims it); the
 * two tiebreaks are the same.
 */
export function cycleOrder(candidates: readonly CycleCandidate[], viewKind: CycleViewKind = 'plan'): CycleCandidate[] {
  const tie = (a: CycleCandidate, b: CycleCandidate): number =>
    b.drawOrder - a.drawOrder || STATE_RANK[b.renovationState] - STATE_RANK[a.renovationState]
  return [...candidates].sort(
    viewKind === 'plan'
      ? (a, b) => RANGE_CYCLE_RANK[a.rangeClass ?? 'in'] - RANGE_CYCLE_RANK[b.rangeClass ?? 'in'] || tie(a, b)
      : (a, b) => (a.distance ?? 0) - (b.distance ?? 0) || tie(a, b),
  )
}

/** Whether two clicks are "the same spot": inside the snap acquisition radius of each other. */
export function isSameSpot(a: CanvasPoint, b: CanvasPoint): boolean {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy) <= SNAP_ACQUISITION_PX
}

/**
 * One click on the canvas.
 *
 * The cycle continues only when the previous click left one, this click is in the same spot, and the
 * reachable set is the same set — a changed candidate set means the user has been looking at
 * something else, and a click anywhere else is a new question. Anything else starts at the top.
 * Continuing moves to the next candidate and wraps at the end, so the stack can be walked round and
 * round without ever dead-ending.
 */
export function nextCycle(
  candidates: readonly CycleCandidate[],
  filter: readonly RenovationState[],
  point: CanvasPoint,
  previous: CycleState | null,
  viewKind: CycleViewKind = 'plan',
): CycleOutcome {
  const ordered = cycleOrder(reachableCandidates(candidates, filter), viewKind)
  if (ordered.length === 0) return { selected: null, state: null }
  const ids = ordered.map((row) => row.entityId)
  const continues =
    previous !== null &&
    isSameSpot(previous.point, point) &&
    previous.candidateIds.length === ids.length &&
    previous.candidateIds.every((id, at) => id === ids[at]) &&
    previous.index >= 0 &&
    previous.index < ordered.length
  const index = continues ? (previous.index + 1) % ordered.length : 0
  return { selected: ordered[index]!, state: { point, candidateIds: ids, index } }
}

/** A box in CSS pixels: the candidate list's own size, or the canvas host's. */
export interface CanvasSize {
  readonly width: number
  readonly height: number
}

/**
 * Where the candidate list goes: beside the pointer, and never past the canvas bounds (#70
 * criterion 16). The list is placed to the lower-right of the click, which is where it does not
 * cover the thing just clicked, and pulled back when that would hang it off the right or bottom
 * edge. A list bigger than the canvas sits at the origin — the names are never shortened, so the
 * list keeps its width and the canvas is the thing that is too small.
 */
export function clampOverlay(at: CanvasPoint, size: CanvasSize, bounds: CanvasSize, gap = 12): CanvasPoint {
  return {
    x: Math.max(4, Math.min(at.x + gap, bounds.width - size.width - 4)),
    y: Math.max(4, Math.min(at.y + gap, bounds.height - size.height - 4)),
  }
}
