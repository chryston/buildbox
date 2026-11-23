/**
 * Click-to-cycle over overlapping Existing / Demolition / Proposed candidates (#70 §8, criteria
 * 15–18). The stack is the one the issue names: `W-2` as Existing, `W-2` as Demolition, `W-2′` as
 * Proposed, drawn in that order so the Proposed successor is under the finger.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SNAP_ACQUISITION_PX, type RenovationState } from '../../../derive'
import { RANGE_CLASS_LABELS, RENOVATION_STRINGS } from '../../strings/renovation'
import type { CycleCandidate } from './overlapCycle'
import { cycleOrder, isSameSpot, nextCycle, reachableCandidates } from './overlapCycle'

const stack: CycleCandidate[] = [
  { entityId: 'wall-2', renovationState: 'existing', drawOrder: 0 },
  { entityId: 'wall-2', renovationState: 'demolition', drawOrder: 1 },
  { entityId: 'prop-wall-2', renovationState: 'proposed', drawOrder: 2 },
]

const at = { x: 100, y: 200 }
const ids = (rows: readonly CycleCandidate[]): string[] => rows.map((row) => `${row.entityId}:${row.renovationState}`)

/** Click `n` times in the same spot and name what each click selected. */
function walk(times: number, candidates = stack, filter: readonly RenovationState[] = []): string[] {
  const picked: string[] = []
  let state = null
  for (let click = 0; click < times; click += 1) {
    const outcome = nextCycle(candidates, filter, at, state)
    if (outcome.selected === null) break
    picked.push(...ids([outcome.selected]))
    state = outcome.state
  }
  return picked
}

describe('the cycle order (#70 criterion 15)', () => {
  it('picks the top candidate first: layer order, then Proposed above Demolition above Existing', () => {
    expect(ids(cycleOrder(stack))).toEqual(['prop-wall-2:proposed', 'wall-2:demolition', 'wall-2:existing'])
    expect(walk(1)).toEqual(['prop-wall-2:proposed'])
  })

  it('walks down the stack and wraps at the end', () => {
    expect(walk(4)).toEqual(['prop-wall-2:proposed', 'wall-2:demolition', 'wall-2:existing', 'prop-wall-2:proposed'])
  })

  it('reads the layer before the State, so a later layer wins even an Existing row', () => {
    // A Proposed Wall drawn under a later Existing Wall: the thing on top is the Existing one.
    const layered: CycleCandidate[] = [
      { entityId: 'prop-under', renovationState: 'proposed', drawOrder: 0 },
      { entityId: 'exist-over', renovationState: 'existing', drawOrder: 5 },
    ]
    expect(ids(cycleOrder(layered))).toEqual(['exist-over:existing', 'prop-under:proposed'])
  })

  it('is stable inside one layer and State, so a re-derive cannot reshuffle the list', () => {
    const sameLayer: CycleCandidate[] = [
      { entityId: 'a', renovationState: 'existing', drawOrder: 3 },
      { entityId: 'b', renovationState: 'existing', drawOrder: 3 },
      { entityId: 'c', renovationState: 'existing', drawOrder: 3 },
    ]
    expect(cycleOrder(sameLayer).map((row) => row.entityId)).toEqual(['a', 'b', 'c'])
  })
})

describe('the same spot (#70 criterion 16)', () => {
  it('uses the snap acquisition radius, and nothing else', () => {
    expect(SNAP_ACQUISITION_PX).toBe(12)
    expect(isSameSpot(at, { x: 100, y: 200 })).toBe(true)
    expect(isSameSpot(at, { x: 100 + SNAP_ACQUISITION_PX, y: 200 })).toBe(true)
    expect(isSameSpot(at, { x: 100 + SNAP_ACQUISITION_PX + 0.5, y: 200 })).toBe(false)
    // A diagonal click just outside the radius is a different spot, even though each axis moved less.
    expect(isSameSpot(at, { x: 100 + 9, y: 200 + 9 })).toBe(false)
  })

  it('restarts at the top when the click lands somewhere else', () => {
    const first = nextCycle(stack, [], at, null)
    const moved = nextCycle(stack, [], { x: 400, y: 400 }, first.state)
    expect(ids([moved.selected!])).toEqual(['prop-wall-2:proposed'])
  })

  it('restarts when the candidate set changed, even in the same spot', () => {
    const first = nextCycle(stack, [], at, null)
    const fewer = stack.slice(0, 2)
    const after = nextCycle(fewer, [], at, first.state)
    expect(ids([after.selected!])).toEqual(['wall-2:demolition'])
    expect(after.state?.candidateIds).toEqual(['wall-2', 'wall-2'])
  })
})

describe('the Pick: filter (#70 criterion 17)', () => {
  it('lets every State through when no chip is on', () => {
    expect(reachableCandidates(stack, [])).toHaveLength(3)
  })

  it('narrows the cycle to the chips that are on, in cycle order', () => {
    expect(walk(3, stack, ['demolition', 'existing'])).toEqual(['wall-2:demolition', 'wall-2:existing', 'wall-2:demolition'])
    expect(walk(1, stack, ['existing'])).toEqual(['wall-2:existing'])
  })

  it('selects nothing when the filter excludes every candidate', () => {
    const outcome = nextCycle(stack, ['proposed'], at, null)
    expect(ids([outcome.selected!])).toEqual(['prop-wall-2:proposed'])
    const empty = nextCycle(stack.slice(0, 2), ['proposed'], at, null)
    expect(empty.selected).toBeNull()
    expect(empty.state).toBeNull()
  })
})

describe('every candidate is reachable (#70 criterion 18)', () => {
  it('cycles through the whole reachable set, so a successor never hides its predecessor', () => {
    for (const filter of [[], ['existing'], ['proposed'], ['existing', 'proposed'], ['demolition', 'proposed']] as const) {
      const reachable = ids(reachableCandidates(stack, filter))
      const seen = walk(reachable.length, stack, [...filter])
      expect([...new Set(seen)].sort()).toEqual([...reachable].sort())
    }
  })

  it('keeps a same-id pair reachable in both States', () => {
    // `W-2` exists as both Existing and Demolition: the cycle has to offer both, not collapse them.
    expect(walk(2, stack, ['existing', 'demolition'])).toEqual(['wall-2:demolition', 'wall-2:existing'])
  })
})

// ---- the Plan View Range and the Elevation distance (#74 §6, criteria 9–11)
//
// The stack is criterion 9's, seen at a range of 0–1200: the Base cabinet stands In range and is drawn
// *behind* the Wall cabinet, which is Above range. The first click has to pick the cabinet the view is
// looking at, not the one on top of it — which is the whole reason the Range Class is the first key.
const byRange: CycleCandidate[] = [
  { entityId: 'room-1', renovationState: 'existing', drawOrder: 0 },
  { entityId: 'cab-base', renovationState: 'existing', drawOrder: 1 },
  { entityId: 'wall-in', renovationState: 'existing', drawOrder: 2 },
  { entityId: 'cab-wall', renovationState: 'existing', drawOrder: 3, rangeClass: 'above' },
  { entityId: 'sump', renovationState: 'existing', drawOrder: 4, rangeClass: 'below' },
]

describe('the cycle walks the Range Classes (#74 §6)', () => {
  it('starts with the In range candidate even when it is drawn behind', () => {
    expect(cycleOrder(byRange)[0]!.entityId).toBe('wall-in')
  })

  it('orders In range, then Above, then Below, and front first inside each group', () => {
    expect(cycleOrder(byRange).map((row) => row.entityId)).toEqual(['wall-in', 'cab-base', 'room-1', 'cab-wall', 'sump'])
  })

  it('leaves a candidate with no Range Class In range, which is what a Room always is', () => {
    // The Room has no Vertical Extent, so it is In range (§2) and cycles inside that group — where the
    // draw order it is painted behind leaves it behind the Walls and Openings of the same group, which
    // is §6's "… → Walls and Openings → Rooms" falling out of the two keys rather than a third one.
    expect(cycleOrder(byRange).map((row) => row.entityId).indexOf('room-1')).toBe(2)
    expect(cycleOrder([{ entityId: 'a', renovationState: 'existing', drawOrder: 0 }])).toHaveLength(1)
  })

  it('walks the whole stack and comes back to the start (#74 criterion 9)', () => {
    const picked: string[] = []
    let state = null
    for (let click = 0; click < 6; click += 1) {
      const outcome = nextCycle(byRange, [], at, state)
      picked.push(outcome.selected!.entityId)
      state = outcome.state
    }
    expect(picked).toEqual(['wall-in', 'cab-base', 'room-1', 'cab-wall', 'sump', 'wall-in'])
  })

  it('never starts with an Above-range candidate, whatever the candidate set (#74 criterion 10)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            entityId: fc.string({ minLength: 1, maxLength: 6 }),
            renovationState: fc.constantFrom('existing' as const, 'demolition' as const, 'proposed' as const),
            drawOrder: fc.integer({ min: 0, max: 40 }),
            rangeClass: fc.option(fc.constantFrom('in' as const, 'above' as const, 'below' as const), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (candidates) => {
          const ordered = cycleOrder(candidates)
          const inRange = candidates.some((row) => (row.rangeClass ?? 'in') === 'in')
          expect((ordered[0]!.rangeClass ?? 'in') === 'in').toBe(inRange)
          // The walk is the whole set with nothing skipped, in the order the list shows.
          expect(ordered.map((row) => `${row.entityId}:${row.renovationState}:${row.drawOrder}`)).toEqual(
            [...new Set(ordered.map((row) => `${row.entityId}:${row.renovationState}:${row.drawOrder}`))],
          )
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('an Elevation View cycles nearest first (#74 §6, criterion 11)', () => {
  const slice: CycleCandidate[] = [
    { entityId: 'far', renovationState: 'existing', drawOrder: 9, distance: 4000 },
    { entityId: 'near', renovationState: 'existing', drawOrder: 1, distance: 400 },
    { entityId: 'mid', renovationState: 'existing', drawOrder: 5, distance: 1800 },
  ]

  it('orders by distance from the viewing line, nearest first', () => {
    expect(cycleOrder(slice, 'elevation').map((row) => row.entityId)).toEqual(['near', 'mid', 'far'])
  })

  it('breaks a tie on draw order, front first, and treats no distance as nearest', () => {
    const tied: CycleCandidate[] = [
      { entityId: 'a', renovationState: 'existing', drawOrder: 1, distance: 400 },
      { entityId: 'b', renovationState: 'existing', drawOrder: 7, distance: 400 },
      { entityId: 'c', renovationState: 'existing', drawOrder: 0 },
    ]
    expect(cycleOrder(tied, 'elevation').map((row) => row.entityId)).toEqual(['c', 'b', 'a'])
  })

  it('walks nearest to farthest and wraps, when the caller says it is an Elevation View', () => {
    const picked: string[] = []
    let state = null
    for (let click = 0; click < 4; click += 1) {
      const outcome = nextCycle(slice, [], at, state, 'elevation')
      picked.push(outcome.selected!.entityId)
      state = outcome.state
    }
    expect(picked).toEqual(['near', 'mid', 'far', 'near'])
  })

  it('still groups by Range Class in a Plan View, where distance means nothing', () => {
    expect(cycleOrder(slice, 'plan').map((row) => row.entityId)).toEqual(['far', 'mid', 'near'])
  })
})

describe('the badge names the candidate and its Range Class (#74 §6)', () => {
  it('reads state badge, position, full name and range class', () => {
    expect(
      RENOVATION_STRINGS.overlapRow('Existing', 2, 2, 'Wall cabinet #1', RANGE_CLASS_LABELS.above),
    ).toBe('[Existing] 2 of 2 · Wall cabinet #1 · Above range')
  })

  it('keeps the whole name, including the `#` and everything after it', () => {
    const row = RENOVATION_STRINGS.overlapRow('Proposed', 1, 3, 'Wall cabinet #12', RANGE_CLASS_LABELS.in)
    expect(row).toBe('[Proposed] 1 of 3 · Wall cabinet #12 · In range')
    expect(row).toContain('#12')
  })
})
