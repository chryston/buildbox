/**
 * Scoping a renovation Transaction's validation pass (#69 §8), on the committed scene.
 *
 * The pure half of this file — `validationScope.test.ts` — proves the mechanism on generated
 * Projects. This half proves it on the one Project the issue is stated against, because the two
 * things that only happen with Design Options are the two that could plausibly go wrong: an Option
 * that has to be re-validated because the **baseline** it is a delta over moved, and a write into
 * one Option that must not drag the other Option's geometry back into the pass.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Patch } from 'immer'
import { describe, expect, it } from 'vitest'
import type { Project, ValidationScope } from '../domain'
import { validateProject } from '../domain'
import { applyIntent, previewIntent } from './index'
import type { Intent } from './index'
import { intent } from './testing'
import { validationScopeFor } from './validationScope'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as { projects: { data: Project }[] }

const FLOOR = 'seed-001'
const W1 = 'seed-wall-002'
const W2 = 'seed-wall-003'
const ROOM = 'seed-room-017'
const A = 'option-a'

const project = (): Project => structuredClone(seed.projects[0]!.data)

function long(title: string, fn: () => void): void {
  it(title, fn, 30_000)
}

/** Apply, and return the Project, the patches, and the scope `applyIntent` validated them against. */
function run(source: Project, next: Intent): { after: Project; scope: ValidationScope | null } | { refused: string } {
  const result = applyIntent(source, next)
  if (result.ok === false) return { refused: result.code }
  return { after: result.project, scope: validationScopeFor(result.patches, source, result.project) }
}

/** The two passes, compared problem for problem. */
function expectAgreement(before: Project, after: Project, patches: readonly Patch[]): ValidationScope | null {
  const scope = validationScopeFor(patches, before, after)
  const full = validateProject(after)
  const scoped = validateProject(after, scope)
  expect(scoped.ok).toBe(full.ok)
  if (full.ok === false && scoped.ok === false) expect(scoped.problems).toEqual(full.problems)
  return scope
}

const doorOnW2 = (): Intent =>
  intent(
    'renovation.placeOpening',
    {
      floorId: FLOOR,
      hostWallId: W2,
      kind: 'door',
      label: 'Door 9',
      start: 2000,
      width: 900,
      sill: 0,
      head: 2100,
      swing: 'left',
      hingeSide: 'start',
      target: { designOptionId: A },
    },
    ['scope-opening'],
  )

const CORPUS: readonly { name: string; build: () => Intent }[] = [
  { name: 'an Option rename', build: () => intent('designOption.rename', { optionId: A, name: 'Open plan' }, ['scope-tx']) },
  { name: 'an Opening cut inside an Option', build: doorOnW2 },
  {
    name: 'a demolition inside an Option',
    build: () => intent('renovation.demolish', { entityId: W1, target: { designOptionId: A } }, ['scope-tx']),
  },
  {
    name: 'a correction of the Existing Model',
    build: () =>
      intent(
        'renovation.correctExistingModel',
        { inner: intent('wall.setThickness', { wallId: W2, thickness: 150 }, ['scope-inner']) },
        ['scope-tx'],
      ),
  },
  {
    // A baseline edit only reaches the Existing Model through a correction (#69 §12), so the corpus
    // reaches it the same way the UI does.
    name: 'a correction that renames a Room',
    build: () =>
      intent('renovation.correctExistingModel', { inner: intent('room.rename', { roomId: ROOM, name: 'Utility' }, ['scope-inner']) }, ['scope-tx']),
  },
]

describe('a renovation Transaction agrees with the whole document', () => {
  long('on every row of the corpus', () => {
    for (const row of CORPUS) {
      const before = project()
      const result = applyIntent(before, row.build())
      if (result.ok === false) throw new Error(`${row.name}: refused with ${result.code}`)
      expectAgreement(before, result.project, result.patches)
    }
  })

  long('and the scope is narrow where narrowing is the point', () => {
    const before = project()
    // Writing into one Option must not pull the Existing Model's Walls back into the pass: that is
    // the whole reason a knock-through on a 450-Wall Project costs anything at all.
    const applied = run(before, doorOnW2())
    if ('refused' in applied) throw new Error(`refused with ${applied.refused}`)
    const scope = applied.scope
    if (scope === null) throw new Error('an Option write fell back to whole-document validation')
    expect(scope.entities.has('scope-opening')).toBe(true)
    expect(scope.entities.has(A)).toBe(true)
    for (const wall of before.existingModel.walls) {
      if (wall.id === W2) continue
      expect(scope.entities.has(wall.id), `an untouched Wall ${wall.id} was validated for an Option write`).toBe(false)
    }
  })
})

describe('a baseline edit reaches every Design Option', () => {
  long('because each Option is a delta over that baseline', () => {
    const before = project()
    const applied = run(before, intent('renovation.correctExistingModel', { inner: intent('wall.setThickness', { wallId: W1, thickness: 150 }, ['scope-inner']) }, ['scope-tx']))
    if ('refused' in applied) throw new Error(`refused with ${applied.refused}`)
    const scope = applied.scope
    if (scope === null) throw new Error('a Wall edit fell back to whole-document validation')
    for (const option of before.designOptions ?? []) {
      expect(scope.entities.has(option.id), `Option ${option.id} was skipped for a baseline edit`).toBe(true)
    }
    // …and the Item Designs, which no renovation edit touches, stayed out of it.
    expect(scope.entities.has(before.itemDesigns[0]!.id)).toBe(false)
  })

  long('and a preview reports what a scoped pass reports', () => {
    const before = project()
    // `previewIntent` runs the same Transaction, so the hover state of a command is judged by the
    // same validator with the same scope: a door that applies must never preview as a rejection.
    expect(previewIntent(before, doorOnW2()).rejection).toBeNull()
    const applied = run(before, doorOnW2())
    if ('refused' in applied) throw new Error(`refused with ${applied.refused}`)
    expect(validateProject(applied.after, applied.scope).ok).toBe(true)
  })
})
