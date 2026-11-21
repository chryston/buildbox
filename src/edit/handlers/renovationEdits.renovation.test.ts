/**
 * The base-plan renovation-edit table, and the Wall demolition review (#69 acceptance 1 and 3).
 *
 * Every test starts from the committed scene — `fixtures/e2e/preview-seed/renovation-36.json`,
 * the file the browser specs open — because the issue's rows are stated against it: Walls
 * W-1…W-6, `Door 1` and `Window 2` through W-3, a Kitchen referencing W-5, and two Options that
 * start empty. "…in Option A, and Option B is unchanged" is only a test if both halves are read
 * from the same bytes.
 *
 * Two things are asserted about every write, over and above what it changed: the Existing Model
 * comes back byte-identical, because a renovation edit is a delta and never a rewrite of the
 * survey; and the whole of one row is one Edit Transaction, so one undo is one row.
 *
 * One deviation from the issue's letter: it says "demolishing W-6 (no Openings)", while this
 * fixture carries `Window 3` through W-6 — so the no-Openings row runs on W-1, and W-6 is the
 * Wall that comes down with an Opening on it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DesignOption, Project } from '../../domain'
import { designOptionsOf, validateProject } from '../../domain'
import { canonicalJson } from '../../lib'
import { effectiveModel } from '../../derive'
import { applyIntent, applyPatches, previewIntent, type DemolitionReview } from '../index'
import { intent } from '../testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as { projects: { data: Project }[] }

const FLOOR = 'seed-001'
const W1 = 'seed-wall-002'
const W2 = 'seed-wall-003'
const W3 = 'seed-wall-004'
const W4 = 'seed-wall-005'
const W5 = 'seed-wall-010'
const W6 = 'seed-wall-013'
const DOOR_1 = 'seed-opening-014'
const WINDOW_2 = 'seed-opening-015'
const WINDOW_3 = 'seed-opening-016'
const A = 'option-a'
const B = 'option-b'

/** A fresh copy of the scene: no test may see another's writes. */
const project = (): Project => structuredClone(seed.projects[0]!.data)
function optionOf(source: Project, id: string): DesignOption {
  const found = designOptionsOf(source).find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`the fixture holds no Design Option ${id}`)
  return found
}

/** The door the issue's first row cuts: 900 wide, hinged, into Existing W-2. */
const doorOnW2 = (taken: string) =>
  intent(
    'renovation.placeOpening',
    {
      floorId: FLOOR,
      hostWallId: W2,
      kind: 'door',
      label: 'Door 2',
      start: 1000,
      width: 900,
      sill: 0,
      head: 2100,
      swing: 'left',
      hingeSide: 'start',
      target: { designOptionId: A },
    },
    [taken],
  )

/** The same cut somewhere on W-3 clear of `Door 1`, `Window 2` and the join with W-5. */
const doorOnW3 = (label: string, taken: string) =>
  intent(
    'renovation.placeOpening',
    {
      floorId: FLOOR,
      hostWallId: W3,
      kind: 'door',
      label,
      start: 4600,
      width: 900,
      sill: 0,
      head: 2100,
      swing: 'left',
      hingeSide: 'start',
      target: { designOptionId: A },
    },
    [taken],
  )

const demolish = (entityId: string, dependants?: string[]) =>
  intent('renovation.demolish', { entityId, target: { designOptionId: A }, ...(dependants === undefined ? {} : { dependants }) })

const unwrap = <R extends { ok: boolean; problems?: readonly unknown[] }>(result: R): Extract<R, { ok: true }> => {
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result as Extract<R, { ok: true }>
}

describe('the renovation-edit table: cutting work into an Option', () => {
  it('cuts a door into an Existing Wall, leaves that Wall alone, and leaves Option B alone', () => {
    const before = project()
    const applied = unwrap(applyIntent(before, doorOnW2('opening-door-2')))
    const next = applied.project
    const optionA = optionOf(next, A)

    expect(optionA.proposed.openings).toHaveLength(1)
    expect(optionA.proposed.openings[0]).toEqual({
      id: 'opening-door-2',
      floorId: FLOOR,
      hostWallId: W2,
      kind: 'door',
      label: 'Door 2',
      start: 1000,
      width: 900,
      head: 2100,
      sill: 0,
      swing: 'left',
      hingeSide: 'start',
      predecessorIds: [],
    })
    // W-2 is retained: no demolition record, no successor Wall, and the Wall itself untouched.
    expect(optionA.demolishedIds).toEqual([])
    expect(optionA.proposed.walls).toEqual([])
    expect(next.existingModel.walls.find((wall) => wall.id === W2)).toEqual(
      before.existingModel.walls.find((wall) => wall.id === W2),
    )
    // The other Option, and the Existing Model as a whole, are byte-identical.
    expect(canonicalJson(optionOf(next, B))).toBe(canonicalJson(optionOf(before, B)))
    expect(canonicalJson(next.existingModel)).toBe(canonicalJson(before.existingModel))
    expect(validateProject(next).ok).toBe(true)
  })

  it('refuses a cut that crosses a join, and one into a Wall this Option took down', () => {
    // W-5 joins W-3 at 5,600, so nothing may be cut across that point…
    const crossing = applyIntent(
      project(),
      intent(
        'renovation.placeOpening',
        {
          floorId: FLOOR,
          hostWallId: W3,
          kind: 'door',
          label: 'Door 2',
          start: 5500,
          width: 900,
          sill: 0,
          head: 2100,
          swing: 'left',
          hingeSide: 'start',
          target: { designOptionId: A },
        },
        ['opening-cross'],
      ),
    )
    expect(crossing.ok).toBe(false)
    if (crossing.ok) return
    expect(crossing.code).toBe('opening-blocked')
    // …and a Wall this Option has demolished is no host at all, which is the effective model
    // deciding what can be cut rather than the survey.
    const down = unwrap(applyIntent(project(), demolish(W1)))
    const intoRubble = applyIntent(
      down.project,
      intent(
        'renovation.placeOpening',
        {
          floorId: FLOOR,
          hostWallId: W1,
          kind: 'window',
          label: 'Window 4',
          start: 1000,
          width: 900,
          sill: 600,
          head: 1800,
          target: { designOptionId: A },
        },
        ['opening-rubble'],
      ),
    )
    expect(intoRubble.ok).toBe(false)
    if (intoRubble.ok) return
    expect(intoRubble.code).toBe('unknown-target')
  })

  it('knocks a whole-height section through a Wall it keeps', () => {
    const before = project()
    const applied = unwrap(
      applyIntent(
        before,
        intent(
          'renovation.knockThrough',
          { floorId: FLOOR, hostWallId: W4, label: 'Opening 1', start: 600, width: 1200, target: { designOptionId: A } },
          ['opening-knock'],
        ),
      ),
    )
    const knocked = optionOf(applied.project, A).proposed.openings[0]
    expect(knocked).toMatchObject({ kind: 'removed_section', start: 600, width: 1200, sill: 0, head: 2600 })
    // The head is the Wall's own height, which is what makes a knock-through a knock-through.
    expect(knocked?.head).toBe(before.existingModel.walls.find((wall) => wall.id === W4)?.height)
    expect(knocked?.swing).toBeUndefined()
    expect(optionOf(applied.project, A).demolishedIds).toEqual([])
    expect(
      effectiveModel(applied.project, FLOOR, A).standingWalls.some((wall) => wall.id === W4),
    ).toBe(true)
    expect(validateProject(applied.project).ok).toBe(true)
  })
})

describe('the renovation-edit table: demolition', () => {
  it('records a Wall with nothing on it as one demolition and no successor', () => {
    const applied = unwrap(applyIntent(project(), demolish(W1)))
    expect(optionOf(applied.project, A).demolishedIds).toEqual([W1])
    expect(optionOf(applied.project, A).proposed.walls).toEqual([])
    expect(
      effectiveModel(applied.project, FLOOR, A).standingWalls.some((wall) => wall.id === W1),
    ).toBe(false)
    expect(validateProject(applied.project).ok).toBe(true)
  })

  it('takes an Opening down with the Wall it was cut into, in the same transaction', () => {
    const applied = unwrap(applyIntent(project(), demolish(W6, [WINDOW_3])))
    expect(optionOf(applied.project, A).demolishedIds).toEqual([W6, WINDOW_3].sort())
    expect(
      effectiveModel(applied.project, FLOOR, A).standingOpenings.some((opening) => opening.id === WINDOW_3),
    ).toBe(false)
  })

  it('blocks up an Opening so the Wall’s face runs through the former gap', () => {
    const applied = unwrap(applyIntent(project(), demolish(DOOR_1)))
    expect(optionOf(applied.project, A).demolishedIds).toEqual([DOOR_1])
    // Blocking up is a record, not a rebuild: no successor Wall stands where Door 1 was cut.
    expect(optionOf(applied.project, A).proposed.walls).toEqual([])
    const model = effectiveModel(applied.project, FLOOR, A)
    // Nothing cuts W-3 any more but Window 2, so its faces run through the former gap.
    expect(model.standingOpenings.filter((opening) => opening.hostWallId === W3)).toEqual([
      expect.objectContaining({ id: WINDOW_2 }),
    ])
    // The record still comes back, in the Demolition state, so it stays on screen and selectable.
    expect(model.openings.find((entry) => entry.entity.id === DOOR_1)?.renovationState).toBe('demolition')
  })

  it('deletes the Option’s own work instead of recording a demolition against it', () => {
    const cut = unwrap(applyIntent(project(), doorOnW2('opening-door-2')))
    const applied = unwrap(applyIntent(cut.project, demolish('opening-door-2')))
    expect(optionOf(applied.project, A).proposed.openings).toEqual([])
    expect(optionOf(applied.project, A).demolishedIds).toEqual([])
    expect(canonicalJson(applied.project.existingModel)).toBe(canonicalJson(cut.project.existingModel))
  })
})

describe('the Wall demolition dependency review (#69 acceptance 3)', () => {
  const reviewOf = (source: Project, entityId: string, dependants?: string[]): DemolitionReview | null =>
    previewIntent(source, demolish(entityId, dependants)).review as DemolitionReview | null

  it('asks about the Wall by its reference and lists the Openings that come with it', () => {
    const review = reviewOf(project(), W3)
    expect(review).toMatchObject({
      kind: 'demolish',
      entityId: W3,
      entityRef: 'W-3',
      message: 'Demolish W-3?',
      blockers: [],
    })
    expect(review?.willDemolish).toEqual([
      { id: DOOR_1, label: 'Door 1' },
      { id: WINDOW_2, label: 'Window 2' },
    ])
  })

  it('changes nothing while the question is on the screen', () => {
    const before = project()
    const beforeJson = canonicalJson(before)
    previewIntent(before, demolish(W3, [DOOR_1, WINDOW_2]))
    expect(canonicalJson(before)).toBe(beforeJson)
    // A review is not an answer: without `applyIntent` nothing is recorded.
    expect(optionOf(before, A).demolishedIds).toEqual([])
  })

  it('writes every record in one transaction, and one undo removes all three', () => {
    const before = project()
    const beforeJson = canonicalJson(before)
    const applied = unwrap(applyIntent(before, demolish(W3, [DOOR_1, WINDOW_2])))
    expect(optionOf(applied.project, A).demolishedIds).toEqual([DOOR_1, W3, WINDOW_2].sort())
    expect(applied.patches.length).toBeGreaterThan(0)
    expect(canonicalJson(applyPatches(applied.project, applied.inversePatches))).toBe(beforeJson)
  })

  it('refuses to demolish a Wall the Option has cut into, and says what to remove', () => {
    const cut = unwrap(applyIntent(project(), doorOnW3('Door 3', 'opening-door-3')))
    const review = reviewOf(cut.project, W3, [DOOR_1, WINDOW_2])
    expect(review?.blockers).toEqual(['Remove Door 3 from this option first.'])
    const refused = applyIntent(cut.project, demolish(W3, [DOOR_1, WINDOW_2]))
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.code).toBe('has-dependants')
    expect(refused.problems[0]?.message).toBe('Remove Door 3 from this option first.')
  })

  it('refuses a Wall a Room of this Option refers to, naming the edge', () => {
    const review = reviewOf(project(), W5)
    expect(review?.blockers).toHaveLength(1)
    expect(review?.blockers[0]).toMatch(/^Kitchen edge \d+ refers to W-5\. Detach, reattach, or remove the Room delta first\.$/)
  })

  it('refuses an answer the Project has moved on from', () => {
    const before = project()
    const stale = applyIntent(before, demolish(W3, [DOOR_1]))
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.code).toBe('dependency-changed')
    // An answer that was never asked for is the same refusal.
    expect(applyIntent(before, demolish(W3)).ok).toBe(false)
    // And a Wall with nothing on it needs no answer at all.
    expect(applyIntent(before, demolish(W1)).ok).toBe(true)
  })

  it('refuses a subject that is not there', () => {
    const refused = applyIntent(project(), demolish('seed-wall-999'))
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.code).toBe('unknown-target')
  })
})
