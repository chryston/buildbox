import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../lib'
import { validateProject } from './index'
import { arbCorruption, arbProject } from './testing'

/**
 * The general properties #42 §4 claims for the validator: it is total, deterministic,
 * side-effect-free, indifferent to key order, and it accepts everything `arbProject()`
 * produces.
 */

/** The result in a shape that compares deeply, including every message. */
function outcome(value: unknown): unknown {
  const result = validateProject(value)
  return result.ok ? { ok: true } : { ok: false, problems: result.problems }
}

/** `canonicalJson`, or the reason it refused — enough to notice a change. */
function canonicalOrReason(value: unknown): string {
  try {
    return canonicalJson(value)
  } catch (error) {
    return error instanceof Error ? `refused: ${error.message}` : 'refused'
  }
}

/**
 * The same value with every object's keys re-inserted in another order. Arrays keep
 * theirs: order there is meaning.
 */
function reshuffle(value: unknown, rotate: number): unknown {
  if (Array.isArray(value)) return value.map((item) => reshuffle(item, rotate))
  if (typeof value !== 'object' || value === null) return value
  const entries = Object.entries(value)
  if (entries.length === 0) return {}
  const offset = rotate % entries.length
  const ordered = [...entries.slice(offset), ...entries.slice(0, offset)]
  return Object.fromEntries(ordered.map(([key, child]) => [key, reshuffle(child, rotate)]))
}

const arbAnyInput: fc.Arbitrary<unknown> = fc.oneof(
  arbProject(),
  arbCorruption().map((corruption) => corruption.project),
  fc.anything(),
)

describe('validateProject — properties (#42 acceptance)', () => {
  it('accepts every Project arbProject() produces', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        const result = validateProject(project)
        expect(result.ok ? [] : result.problems).toEqual([])
      }),
      { numRuns: 1000 },
    )
  })

  it('is deterministic, total and side-effect-free on any input', () => {
    fc.assert(
      fc.property(arbAnyInput, (value) => {
        const before = canonicalOrReason(value)
        const first = outcome(value)
        const second = outcome(value)
        expect(second).toEqual(first)
        expect(canonicalOrReason(value)).toBe(before)
      }),
      { numRuns: 500 },
    )
  })

  it('reports the same problems whatever order the keys went in', () => {
    fc.assert(
      fc.property(fc.tuple(arbProject(), fc.integer({ min: 1, max: 7 })), ([project, rotate]) => {
        const plain = validateProject(project)
        const shuffled = validateProject(reshuffle(project, rotate))
        expect(shuffled.ok).toBe(plain.ok)
        if (plain.ok === false && shuffled.ok === false) {
          expect(shuffled.problems).toEqual(plain.problems)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('finds every corruption at its exact path and code', () => {
    fc.assert(
      fc.property(arbCorruption(), ({ project, path, code }) => {
        const result = validateProject(project)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.problems).toContainEqual(expect.objectContaining({ path, code }))
      }),
      { numRuns: 300 },
    )
  })
})
