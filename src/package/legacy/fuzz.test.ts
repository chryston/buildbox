import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkLegacyStore } from './read'
import { validateLegacyDesigns, validateLegacyFloorPlan, validateLegacyPersistedState } from './validate'
import type { ValidationProblem } from '../../lib'

/**
 * The fuzz property of #40 §6: whatever a hostile file or a corrupted browser holds, the
 * reader answers with problems or stays quiet — it never throws and never runs forever.
 * The seed is fixed so CI replays the same 1,000 values on every machine.
 */
const SEED = 20_260_117
const NUM_RUNS = 1000
const params = { numRuns: NUM_RUNS, seed: SEED }

const wellFormed = (problems: ValidationProblem[]): boolean =>
  problems.every((p) =>
    typeof p.path === 'string'
    && typeof p.code === 'string'
    && p.code.length > 0
    && typeof p.message === 'string'
    && p.message.length > 0,
  )

/** `fc.anything()` builds values JSON has no word for; those are not files anyone could upload. */
const asJson = (value: unknown): string | null => {
  try {
    return JSON.stringify(value) ?? null
  } catch {
    return null
  }
}

describe('the legacy reader never throws', () => {
  it('answers a JSON value with problems that name a rule each', () => {
    fc.assert(fc.property(fc.jsonValue(), (value) => {
      const designs = validateLegacyDesigns(value, 'projects')
      expect(wellFormed(designs)).toBe(true)
      expect(validateLegacyDesigns(value, 'projects')).toEqual(designs)
      expect(wellFormed(validateLegacyFloorPlan(value, 'state.floorPlan'))).toBe(true)
      expect(wellFormed(validateLegacyPersistedState(value))).toBe(true)
    }), params)
  })

  it('answers any value at all with problems that name a rule each', () => {
    fc.assert(fc.property(fc.anything(), (value) => {
      expect(wellFormed(validateLegacyDesigns(value, 'projects'))).toBe(true)
      expect(wellFormed(validateLegacyFloorPlan(value, 'state.floorPlan'))).toBe(true)
      expect(wellFormed(validateLegacyPersistedState(value))).toBe(true)
    }), params)
  })

  it('says which rule a JSON value breaks, with a path for each', () => {
    fc.assert(fc.property(fc.jsonValue(), (value) => {
      const problems = validateLegacyDesigns(value, 'projects')
      expect(problems.length === 0 || problems.every((p) => p.path.startsWith('projects'))).toBe(true)
    }), params)
  })

  it('checks any stored string without throwing', () => {
    fc.assert(fc.property(fc.anything(), (value) => {
      const raw = asJson({ state: value, version: 3 })
      if (raw === null) return
      const check = checkLegacyStore(raw)
      expect(check.ok || check.problems.length > 0).toBe(true)
      if (!check.ok) expect(wellFormed(check.problems)).toBe(true)
    }), params)
  })

  it('checks any JSON value stored as the whole value', () => {
    fc.assert(fc.property(fc.jsonValue(), (value) => {
      const raw = asJson(value)
      if (raw === null) return
      const check = checkLegacyStore(raw)
      expect(check.ok || check.problems.length > 0).toBe(true)
    }), params)
  })

  it('survives a string of any shape at all', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      const check = checkLegacyStore(raw)
      expect(check.ok || check.problems.length > 0).toBe(true)
    }), params)
  })
})
