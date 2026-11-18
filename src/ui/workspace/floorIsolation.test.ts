/**
 * Nothing gets to remember which Floor is open (#56 criterion 12).
 *
 * #25 made the Floor a reference, not an owner: every selector takes the Floor id and the
 * only place a Floor is *current* is the workspace store's pointer, which is view state and
 * never history. A module that cached `currentFloorId` or `currentPlanImage` would put a
 * second copy of that pointer somewhere the session cannot see — and the failure it produces
 * is the worst kind: geometry drawn on the Floor the person is not looking at, or snapped to
 * the scale of a different Plan Image.
 *
 * That is not visible in any single test of behaviour, so it is checked structurally, over
 * the two places it would most plausibly appear: the derivation modules and the Plan View
 * model. Both are pure today and this test is what keeps them pure.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DERIVE_DIR = resolve(process.cwd(), 'src/derive')
const PLAN_MODEL = resolve(process.cwd(), 'src/ui/workspace/planModel.ts')

const sources = (files: string[]): Array<{ path: string; text: string }> =>
  files.map((path) => ({ path, text: readFileSync(path, 'utf8') }))

const deriveFiles = readdirSync(DERIVE_DIR)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => resolve(DERIVE_DIR, name))

const underTest = sources([...deriveFiles, PLAN_MODEL])

/** A name that would mean "this module knows which Floor is open". */
const POINTER_STATE = /\b(?:current|active|last|selected)(?:Floor|View|PlanImage|Image)\w*\b/i

describe('no module remembers the open Floor', () => {
  it.each(underTest.map((each) => [each.path.split('/').pop() as string, each]))(
    '%s holds no current-Floor identifier', (_name, source) => {
      expect(source.text.match(POINTER_STATE)).toBeNull()
    },
  )

  it.each(underTest.map((each) => [each.path.split('/').pop() as string, each]))(
    '%s declares no module-level mutable state', (_name, source) => {
      const mutable = source.text
        .split('\n')
        .filter((line) => /^(?:export )?(?:let|var)\s/.test(line))
      expect(mutable).toEqual([])
    },
  )
})

describe('the Plan View model is asked which Floor it means', () => {
  const signatures = readFileSync(PLAN_MODEL, 'utf8').match(/export function \w+\([^)]*\)/g) ?? []

  it('exports the selectors this test is about', () => {
    expect(signatures.length).toBeGreaterThan(3)
  })

  it.each(signatures.map((signature) => [signature, signature] as const))(
    '%s takes the Floor it selects from', (_label, signature) => {
      const name = /export function (\w+)/.exec(signature)?.[1] ?? ''
      if (!/Floor/.test(name)) return
      expect(signature).toContain('floorId')
    },
  )
})
