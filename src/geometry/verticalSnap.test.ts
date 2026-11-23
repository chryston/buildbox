/**
 * Vertical snapping (#75 §5): the 12 CSS px, the three classes of candidate and the order between them,
 * and the one delta a body drag takes.
 */
import { describe, expect, it } from 'vitest'
import { movedEdges, VERTICAL_SNAP_PX, verticalBodySnap, verticalSnap, verticalTolerance } from './index'
import type { VerticalSnapCandidate } from './index'

/** `zoom` is CSS px per millimetre, so 12 px is 60 mm at 0.2 px/mm and 6 mm at 2 px/mm. */
const candidate = (id: string, mm: number, kind: VerticalSnapCandidate['kind'], label = id): VerticalSnapCandidate => ({
  id,
  mm,
  kind,
  label,
})

const datum = candidate('datum', 0, 'datum', 'Floor Datum 0')
const upper = candidate('limit-upper', 2600, 'limit', 'Upper limit 2600')
const lower = candidate('limit-lower', -200, 'limit', 'Lower limit -200')
const wallTop = candidate('w-1', 2600, 'entity', 'Wall 1 top 2600')
const cabinetBase = candidate('i-9', 1500, 'entity', 'Wall cabinet bottom 1500')
const sill = candidate('preset:window-sill', 1050, 'mounting', 'Window sill (HDB BTO typical)')

describe('the acquisition radius (#75 §5)', () => {
  it('is 12 CSS px, whatever the zoom', () => {
    expect(VERTICAL_SNAP_PX).toBe(12)
    expect(verticalTolerance(0.2)).toBe(60)
    expect(verticalTolerance(1)).toBe(12)
    expect(verticalTolerance(2)).toBe(6)
    expect(verticalTolerance(0)).toBe(0)
  })

  it('acquires at the radius and lets go past it, at any zoom', () => {
    const at = 0
    const near_ = candidate('e', 59, 'entity')
    const far = candidate('e', 61, 'entity')
    expect(verticalSnap([near_], at, verticalTolerance(0.2))?.mm).toBe(59)
    expect(verticalSnap([far], at, verticalTolerance(0.2))).toBeNull()
    // The same 59 mm is out of reach once the view is zoomed to 2 px per mm.
    expect(verticalSnap([near_], at, verticalTolerance(2))).toBeNull()
    expect(verticalSnap([candidate('e', 5, 'entity')], at, verticalTolerance(2))?.mm).toBe(5)
  })

  it('ends at the candidate’s height, never at the cursor', () => {
    const snap = verticalSnap([datum], 7, 20)
    expect(snap?.mm).toBe(0)
    expect(snap?.delta).toBe(-7)
  })
})

describe('the order between candidates (#75 §5)', () => {
  it('prefers the Datum and the Floor’s limits over a nearer entity edge', () => {
    // The Datum is 9 mm away and a Wall top is 2 mm away: the Datum wins.
    const snap = verticalSnap([candidate('w-1', 11, 'entity'), datum], 2, 20)
    expect(snap?.candidate.kind).toBe('datum')
    expect(snap?.mm).toBe(0)
    const againstLimit = verticalSnap([candidate('w-2', 2598, 'entity'), upper], 2607, 20)
    expect(againstLimit?.candidate.id).toBe('limit-upper')
  })

  it('prefers an entity’s edge over a preset pack’s typical height', () => {
    // The sill is 2 mm from the cursor and a Wall cabinet's bottom is 6 mm: the cabinet's edge wins.
    const snap = verticalSnap([sill, candidate('i-9', 1058, 'entity')], 1052, 20)
    expect(snap?.candidate.kind).toBe('entity')
    expect(snap?.mm).toBe(1058)
    // With the cabinet's edge out of reach, the typical height is what is there to snap to.
    expect(verticalSnap([sill], 1052, 20)?.candidate.kind).toBe('mounting')
  })

  it('takes the nearer candidate within one class', () => {
    const snap = verticalSnap([candidate('a', 100, 'entity'), candidate('b', 104, 'entity')], 102, 20)
    expect(snap?.candidate.id).toBe('a')
    expect(verticalSnap([candidate('a', 100, 'entity'), candidate('b', 101, 'entity')], 102, 20)?.candidate.id).toBe('b')
  })

  it('breaks an exact tie by the lower id, and a tie between the Datum and a limit too', () => {
    expect(verticalSnap([candidate('b', 100, 'entity'), candidate('a', 100, 'entity')], 100, 20)?.candidate.id).toBe('a')
    // Both are rank 0 and both are exactly 2600: the ids decide, whichever order they arrive in.
    expect(verticalSnap([upper, wallTop], 2600, 20)?.candidate.id).toBe('limit-upper')
    expect(verticalSnap([wallTop, upper], 2600, 20)?.candidate.id).toBe('limit-upper')
  })

  it('never snaps to the thing being dragged', () => {
    expect(verticalSnap([cabinetBase], 1502, 20, 'i-9')).toBeNull()
    expect(verticalSnap([cabinetBase, datum], 1502, 20, 'i-9')).toBeNull()
    expect(verticalSnap([cabinetBase, datum], 1502, 2000, 'i-9')?.candidate.id).toBe('datum')
  })

  it('answers nothing when nothing is in reach', () => {
    expect(verticalSnap([datum, upper, sill], 900, 12)).toBeNull()
    expect(verticalSnap([], 900, 12)).toBeNull()
  })
})

describe('a body drag (#75 §5)', () => {
  const body = { bottom: 1500, top: 2200 }

  it('moves the whole body by the one delta the winning edge asked for', () => {
    const snap = verticalBodySnap([datum, upper], { bottom: 8, top: 708 }, 20, 'i-9')
    expect(snap?.edge).toBe('bottom')
    expect(snap?.mm).toBe(0)
    const moved = movedEdges({ bottom: 8, top: 708 }, snap)
    expect(moved).toEqual({ bottom: 0, top: 700 })
    expect(moved.top - moved.bottom).toBe(700)
  })

  it('takes the top edge when that is the nearer one', () => {
    const snap = verticalBodySnap([datum, upper], { bottom: 100, top: 2608 }, 20, 'i-9')
    expect(snap?.edge).toBe('top')
    expect(snap?.mm).toBe(2600)
    expect(movedEdges({ bottom: 100, top: 2608 }, snap)).toEqual({ bottom: 92, top: 2600 })
  })

  it('ranks the two edges by precedence before nearness', () => {
    // The bottom edge is 4 mm from the Datum and the top edge is 2 mm from a Wall top: the Datum wins.
    const snap = verticalBodySnap([datum, candidate('w-1', 702, 'entity')], { bottom: 4, top: 700 }, 20, 'i-9')
    expect(snap?.edge).toBe('bottom')
    expect(snap?.mm).toBe(0)
  })

  it('keeps the bottom edge on an exact tie between the two edges', () => {
    const snap = verticalBodySnap([candidate('a', 0, 'entity'), candidate('b', 700, 'entity')], { bottom: 4, top: 704 }, 20)
    expect(snap?.edge).toBe('bottom')
    expect(snap?.mm).toBe(0)
  })

  it('leaves the body where it was when neither edge reaches anything', () => {
    const snap = verticalBodySnap([datum], body, 20, 'i-9')
    expect(snap).toBeNull()
    expect(movedEdges(body, snap)).toBe(body)
  })

  it('tests the lower limit as readily as the upper one', () => {
    const snap = verticalBodySnap([lower, upper], { bottom: -196, top: 664 }, 20)
    expect(snap?.edge).toBe('bottom')
    expect(snap?.mm).toBe(-200)
  })
})
