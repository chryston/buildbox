/**
 * fast-check properties for vertical snapping (#75 §5).
 *
 * The order the issue gives — Datum and limits, then entity edges, then typical mounting heights, then
 * nearness, then the lower id — is a total order over candidates, which means the answer cannot depend
 * on the order the caller happened to collect them in. That is what these run: the winner is the same
 * for every permutation, it is always one of the eligible candidates, and no eligible candidate beats it.
 */
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { movedEdges, verticalBodySnap, verticalSnap, verticalTolerance } from './index'
import type { VerticalSnapCandidate, VerticalSnapKind } from './index'

const RUNS = { numRuns: 1000 }

const kinds: VerticalSnapKind[] = ['datum', 'limit', 'entity', 'mounting']
const rank: Record<VerticalSnapKind, number> = { datum: 0, limit: 0, entity: 1, mounting: 2 }

const candidateArb: fc.Arbitrary<VerticalSnapCandidate> = fc.record({
  id: fc.stringMatching(/^[a-z0-9]{1,4}$/),
  mm: fc.integer({ min: -3000, max: 6000 }),
  kind: fc.constantFrom(...kinds),
  label: fc.constant(''),
})

const listArb = fc.array(candidateArb, { minLength: 0, maxLength: 12 })
const height = fc.integer({ min: -3000, max: 6000 })
const tolerance = fc.integer({ min: 0, max: 400 })

/** The stated order, read as a comparison: smaller is stronger. */
const compare = (a: VerticalSnapCandidate, da: number, b: VerticalSnapCandidate, db: number): number =>
  rank[a.kind] - rank[b.kind] || Math.abs(da) - Math.abs(db) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

describe('the winner is the candidate, not the collection', () => {
  it('is the same for every order the candidates arrive in', () => {
    fc.assert(
      fc.property(listArb, height, tolerance, fc.option(fc.stringMatching(/^[a-z0-9]{1,4}$/), { nil: null }), (list, at, tol, exclude) => {
        const first = verticalSnap(list, at, tol, exclude)
        const shuffled = [...list].reverse()
        expect(verticalSnap(shuffled, at, tol, exclude)).toEqual(first)
        const sorted = [...list].sort((a, b) => a.mm - b.mm)
        expect(verticalSnap(sorted, at, tol, exclude)).toEqual(first)
      }),
      RUNS,
    )
  })

  it('is always an eligible candidate, and nothing eligible beats it', () => {
    fc.assert(
      fc.property(listArb, height, tolerance, fc.option(fc.stringMatching(/^[a-z0-9]{1,4}$/), { nil: null }), (list, at, tol, exclude) => {
        const snap = verticalSnap(list, at, tol, exclude)
        if (snap === null) {
          expect(list.some((c) => c.id !== exclude && Math.abs(c.mm - at) <= tol)).toBe(false)
          return
        }
        expect(snap.candidate.id).not.toBe(exclude)
        expect(Math.abs(snap.mm - at)).toBeLessThanOrEqual(tol)
        expect(snap.mm).toBe(snap.candidate.mm)
        expect(snap.delta).toBe(snap.candidate.mm - at)
        const eligible = list.filter((c) => c.id !== exclude && Math.abs(c.mm - at) <= tol)
        for (const other of eligible) {
          expect(compare(snap.candidate, snap.delta, other, other.mm - at)).toBeLessThanOrEqual(0)
        }
      }),
      RUNS,
    )
  })

  it('is stable: the same inputs give the same answer twice over', () => {
    fc.assert(
      fc.property(listArb, height, tolerance, (list, at, tol) => {
        expect(verticalSnap(list, at, tol)).toEqual(verticalSnap(list, at, tol))
      }),
      RUNS,
    )
  })
})

describe('a body keeps its height', () => {
  it('moves both edges by the same delta, whichever edge won', () => {
    fc.assert(
      fc.property(listArb, height, height, tolerance, fc.option(fc.stringMatching(/^[a-z0-9]{1,4}$/), { nil: null }), (list, bottom, top, tol, exclude) => {
        const edges = { bottom, top }
        const snap = verticalBodySnap(list, edges, tol, exclude)
        const moved = movedEdges(edges, snap)
        expect(moved.top - moved.bottom).toBe(top - bottom)
        if (snap === null) {
          expect(moved).toEqual(edges)
          expect(verticalSnap(list, edges.bottom, tol, exclude)).toBeNull()
          expect(verticalSnap(list, edges.top, tol, exclude)).toBeNull()
          return
        }
        const edge = snap.edge === 'bottom' ? edges.bottom : edges.top
        expect(moved[snap.edge]).toBe(snap.mm)
        expect(Math.abs(snap.mm - edge)).toBeLessThanOrEqual(tol)
      }),
      RUNS,
    )
  })

  it('never moves more than the acquisition radius', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 20, noNaN: true }), (zoom) => {
        expect(Math.abs(verticalTolerance(zoom) * zoom - 12)).toBeLessThan(1e-9)
      }),
      RUNS,
    )
  })
})
