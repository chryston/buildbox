/**
 * Restore is the exact inverse of Replace, whatever the drawing did before it (#69 acceptance 5).
 *
 * A random sequence of replaces runs against the committed scene in Option A, and every step the
 * handlers accept is kept. Restoring each entity the sequence replaced then has to leave the Option
 * holding nothing at all — no proposed record, no demolition — and the effective model byte-equal to
 * the one the sequence started from, no matter which Wall was thickened, which Opening was blocked
 * up, or which of those was done on top of the other. The Existing Model is read byte-for-byte
 * before and after, because a renovation delta that could not be taken back would be a rewrite of
 * the survey.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../../domain/testing'
import type { Project } from '../../domain'
import { designOptionsOf, validateProject } from '../../domain'
import { canonicalJson } from '../../lib'
import { effectiveModel } from '../../derive'
import { applyIntent, type ReplaceEdit } from '../index'
import { intent } from '../testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as { projects: { data: Project }[] }

const FLOOR = 'seed-001'
const A = 'option-a'

/** Every Existing entity a replace can be asked of: Walls, Openings and Placed Items. */
const subjectsOf = (source: Project): string[] => [
  ...source.existingModel.walls.map((entry) => entry.id),
  ...source.existingModel.openings.map((entry) => entry.id),
  ...source.existingModel.placedItems.map((entry) => entry.id),
]

/** The UI's ID source, one counter for the whole run: a replace is handed 1 + 16. */
let issued = 0
const ids = (count: number): string[] => Array.from({ length: count }, () => `prop-${String(++issued)}`)

describe('Restore undoes Replace (#69 acceptance 5)', () => {
  it(
    'returns the effective model to what it was, for any sequence of replaces',
    () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({ pick: fc.nat(), thick: fc.boolean() }), { minLength: 1, maxLength: 6 }),
          (draws) => {
            const before = currentSchemaOf(seed.projects[0]!.data, 8)
            const pool = subjectsOf(before)
            let current = before
            const replaced: string[] = []
            for (const draw of draws) {
              const entityId = pool[draw.pick % pool.length]!
              const isWall = current.existingModel.walls.some((wall) => wall.id === entityId)
              const edit: ReplaceEdit = draw.thick && isWall ? { thickness: 150 } : {}
              const result = applyIntent(
                current,
                intent('renovation.replace', { entityId, edit, target: { designOptionId: A } }, ids(17)),
              )
              if (!result.ok) continue
              current = result.project
              if (!replaced.includes(entityId)) replaced.push(entityId)
            }
            for (const entityId of replaced) {
              const result = applyIntent(current, intent('renovation.restore', { entityId, target: { designOptionId: A } }))
              // A restore can arrive with nothing left to do, when restoring something else already
              // took this entity's record back with its successor. Anything else is a real failure.
              if (!result.ok && result.code !== 'no-change')
                throw new Error(`${entityId}: ${JSON.stringify(result.problems)}`)
              if (result.ok) current = result.project
            }
            const optionA = designOptionsOf(current).find((entry) => entry.id === A)!
            expect(optionA.proposed).toEqual({ walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], skirting: [], services: [], placedItems: [] })
            expect(optionA.demolishedIds).toEqual([])
            expect(canonicalJson(effectiveModel(current, FLOOR, A))).toBe(canonicalJson(effectiveModel(before, FLOOR, A)))
            expect(canonicalJson(current.existingModel)).toBe(canonicalJson(before.existingModel))
            expect(validateProject(current).ok).toBe(true)
          },
        ),
        { numRuns: 40 },
      )
    },
    120_000,
  )
})
