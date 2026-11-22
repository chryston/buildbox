/**
 * Click-to-cycle over overlapping Existing / Demolition / Proposed candidates (#70 §8, criteria
 * 15–18). The stack is the one the issue names: `W-2` as Existing, `W-2` as Demolition, `W-2′` as
 * Proposed, drawn in that order so the Proposed successor is under the finger.
 */
import { describe, expect, it } from 'vitest'
import { SNAP_ACQUISITION_PX, type RenovationState } from '../../../derive'
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
