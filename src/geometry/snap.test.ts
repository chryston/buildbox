/**
 * The snap resolver (#59 §5, criteria 18–20): a 12 CSS px acquisition radius at every
 * zoom, the D6 tie-break order, and a completed snap that lands on the target's exact
 * canonical coordinate rather than the cursor.
 */
import { describe, expect, it } from 'vitest'
import { SNAP_PRIORITY, resolveSnap } from './index'
import type { SnapCandidate, SnapKind } from './index'
import { pt } from './index'

const ALL = new Set<SnapKind>(SNAP_PRIORITY)

const candidate = (kind: SnapKind, x: number, y: number): SnapCandidate => ({
  point: pt(x, y),
  kind,
  label: kind,
})

describe('acquisition (#59 criterion 18)', () => {
  const vertex = pt(4800, 1300)

  for (const pxPerMm of [0.05, 0.2, 1]) {
    it(`snaps an 11 px miss and ignores a 13 px one at ${pxPerMm} px/mm`, () => {
      const near = pt(vertex.x + 11 / pxPerMm, vertex.y)
      const far = pt(vertex.x + 13 / pxPerMm, vertex.y)
      const snap = resolveSnap([candidate('endpoint', vertex.x, vertex.y)], near, pxPerMm, ALL)
      expect(snap).not.toBeNull()
      // Criterion 20: the canonical coordinate, bit for bit — not the cursor.
      expect(snap!.point.x).toBe(4800)
      expect(snap!.point.y).toBe(1300)
      expect(snap!.target.point).toBe(snap!.point)
      expect(resolveSnap([candidate('endpoint', vertex.x, vertex.y)], far, pxPerMm, ALL)).toBeNull()
    })
  }

  it('resolves to null with no candidates, no enabled kinds or no zoom', () => {
    expect(resolveSnap([], pt(0, 0), 1, ALL)).toBeNull()
    expect(resolveSnap([candidate('grid', 1, 1)], pt(1, 1), 1, new Set())).toBeNull()
    expect(resolveSnap([candidate('grid', 1, 1)], pt(1, 1), 0, ALL)).toBeNull()
  })

  it('gives the cursor to the higher-priority kind even when the other is nearer', () => {
    const cursor = pt(0, 0)
    // The rule criterion 20 needs. A grid point under the cursor and a corner five millimetres
    // away, both inside the radius: the corner wins, because the constructed candidates — grid,
    // axis, angle, perpendicular — are built on the cursor and so are always nearer. Nearest
    // first would hand every snap to them and no corner would ever be caught.
    const snap = resolveSnap(
      [candidate('endpoint', 0, 5), candidate('grid', 0, 1)],
      cursor,
      1,
      ALL,
    )
    expect(snap!.kind).toBe('endpoint')
  })

  it('takes the nearer of two candidates of the same kind', () => {
    const cursor = pt(0, 0)
    const snap = resolveSnap(
      [candidate('endpoint', 0, 5), candidate('endpoint', 0, 1)],
      cursor,
      1,
      ALL,
    )
    expect(snap!.point.y).toBe(1)
  })
})

describe('the D6 tie-break (#59 criterion 19)', () => {
  it('gives every adjacent pair in SNAP_PRIORITY to the earlier kind', () => {
    for (let i = 0; i + 1 < SNAP_PRIORITY.length; i += 1) {
      const [first, second] = [SNAP_PRIORITY[i], SNAP_PRIORITY[i + 1]]
      const snap = resolveSnap(
        [candidate(second, 100, 100), candidate(first, 100, 100)],
        pt(100, 100),
        1,
        ALL,
      )
      expect(snap!.kind, `${first} vs ${second}`).toBe(first)
    }
  })

  it('reports a corner that is also an intersection as endpoint, and a midpoint on a grid point as midpoint', () => {
    expect(resolveSnap(
      [candidate('intersection', 4800, 1300), candidate('endpoint', 4800, 1300)],
      pt(4800, 1300),
      1,
      ALL,
    )!.kind).toBe('endpoint')
    expect(resolveSnap(
      [candidate('grid', 1200, 1300), candidate('midpoint', 1200, 1300)],
      pt(1200, 1300),
      1,
      ALL,
    )!.kind).toBe('midpoint')
  })

  it('breaks a same-kind tie by nearness', () => {
    const snap = resolveSnap(
      [candidate('grid', 0, 3), candidate('grid', 0, 1)],
      pt(0, 0),
      1,
      ALL,
    )
    expect(snap!.point.y).toBe(1)
  })
})
