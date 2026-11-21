/**
 * Three things that must hold for every Intent, not just the ones anyone thought to write a
 * case for (#66 criteria 3, 4 and 8).
 *
 * The first is the pruning post-step: no sequence of edits may leave an acknowledgement
 * pointing at an entity that is gone. The second is the undo contract the post-step shares
 * with the handler it runs beside: every accepted step must come back through its own
 * inverse patches to exactly the Project it started from, acknowledgements included. The
 * third is the engine's: shuffling the arrays a model is stored in changes no warning, no
 * signature and no order.
 *
 * The oracle for "does this subject still exist" is written out here rather than imported
 * from the post-step, so a bug in that helper cannot certify itself.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { EntityId, Project, Wall } from '../domain'
import { arbProject } from '../domain/testing'
import { deriveWarnings } from '../derive'
import { canonicalJson } from '../lib'
import { applyIntent, applyPatches } from './index'
import type { Intent } from './index'
import { idSource, intent } from './testing'

/** Independent of `pruneStaleAcknowledgements`, on purpose. */
function exists(project: Project, id: EntityId): boolean {
  const model = project.existingModel
  return (
    project.floors.some((floor) => floor.id === id) ||
    project.views.some((view) => view.id === id) ||
    project.itemDesigns.some((design) => design.id === id) ||
    model.walls.some((wall) => wall.id === id) ||
    model.wallJunctions.some((junction) => junction.id === id) ||
    model.openings.some((opening) => opening.id === id) ||
    model.placedItems.some((placement) => placement.id === id)
  )
}

const live = (project: Project): string[] =>
  project.warningAcknowledgements
    .filter((record) => !record.subjectIds.every((subject) => exists(project, subject)))
    .map((record) => `${record.warningType}|${record.subjectIds.join(',')}`)

const warningsOf = (project: Project): string[] =>
  project.floors.flatMap((floor) =>
    deriveWarnings(project, floor.id, null).warnings.map((warning) => `${warning.key} ${warning.signature}`),
  )

/** One random step for the Project it is about to be applied to, or `null` if none fits. */
function step(project: Project, pick: (n: number) => number, ids: (count?: number) => string[]): Intent | null {
  const warnings = project.floors.flatMap((floor) => deriveWarnings(project, floor.id, null).warnings)
  const records = project.warningAcknowledgements
  const walls = project.existingModel.walls
  const menu: (Intent | null)[] = [
    warnings.length === 0
      ? null
      : intent(
          'warning.acknowledge',
          {
            warningType: warnings[pick(warnings.length)]!.type,
            subjectIds: warnings[pick(warnings.length)]!.subjects.map((entry) => entry.id),
            designOptionId: warnings[pick(warnings.length)]!.optionId,
            signature: warnings[pick(warnings.length)]!.signature,
            note: `Deliberate ${pick(1000)}`,
          },
          ids(1),
        ),
    records.length === 0
      ? null
      : intent('warning.editNote', {
          warningType: records[pick(records.length)]!.warningType,
          subjectIds: [...records[pick(records.length)]!.subjectIds],
          designOptionId: records[pick(records.length)]!.designOptionId,
          note: `Revised ${pick(1000)}`,
        }),
    walls.length === 0 ? null : intent('wall.delete', { wallId: walls[pick(walls.length)]!.id }),
    walls.length === 0
      ? null
      : intent('wall.setThickness', { wallId: walls[pick(walls.length)]!.id, thickness: 60 + 10 * pick(30) }),
    project.floors.length === 0 ? null : intent('floor.rename', { floorId: project.floors[pick(project.floors.length)]!.id, name: `Floor ${pick(99)}` }),
  ]
  const usable = menu.filter((entry): entry is Intent => entry !== null)
  return usable.length === 0 ? null : usable[pick(usable.length)]!
}

/**
 * Two Walls that cross, standing on the Project's first Floor.
 *
 * `arbProject` draws a star of Walls that almost never overlap by chance — two projects in
 * sixty — and a walk over a model with nothing to acknowledge tests the pruning by absence.
 * The pair is added rather than substituted so the random model around it still varies the
 * number of Floors, Views and other Walls the step menu chooses among.
 */
function withCrossing(project: Project, tag: string): Project {
  const floor = project.floors[0]
  if (floor === undefined) return project
  const cross = (suffix: string, ref: string, x: number, y: number, dx: number, dy: number): Wall => ({
    id: `cross-${tag}-${suffix}`,
    ref,
    floorId: floor.id,
    line: { kind: 'line', start: { x, y }, end: { x: x + dx, y: y + dy } },
    thickness: 100,
    justification: 'centre',
    baseElevation: 0,
    height: 2600,
  })
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      walls: [
        ...project.existingModel.walls,
        cross('a', `W-A${tag}`, 0, 0, 4000, 0),
        cross('b', `W-B${tag}`, 2000, -500, 0, 1000),
      ],
    },
  }
}

/**
 * A seeded walk, so a failure names the seed that reproduces it. `fast-check` supplies the
 * Project; the steps are drawn from a `mulberry32` stream rather than from arbitraries,
 * because each step depends on the Project the step before it produced.
 */
function walk(source: Project, seed: number, steps: number): { project: Project; applied: number; pruned: number } {
  let state = seed >>> 0
  const pick = (n: number): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
  }
  const ids = idSource(`walk-${seed}`)
  let current = withCrossing(source, String(seed))
  let applied = 0
  let pruned = 0
  for (let index = 0; index < steps; index += 1) {
    const next = step(current, pick, ids)
    if (next === null) continue
    const before = current.warningAcknowledgements.length
    const result = applyIntent(current, next)
    if (!result.ok) continue
    applied += 1
    // Criterion 3: the step is one transaction, and its inverse patches are its undo.
    expect(applyPatches(result.project, result.inversePatches)).toEqual(current)
    current = result.project
    // Criterion 4: never at any point, not merely at the end.
    expect(live(current)).toEqual([])
    const after = current.warningAcknowledgements.length
    if (next.type === 'warning.acknowledge' ? after === before : after < before) pruned += 1
  }
  return { project: current, applied, pruned }
}

describe('random Intent sequences and acknowledgements (#66 criteria 3, 4)', () => {
  it('never leaves an acknowledgement whose subject has gone, and undoes every step', () => {
    let accepted = 0
    fc.assert(
      fc.property(arbProject(), fc.integer({ min: 1, max: 2 ** 31 - 1 }), (project, seed) => {
        accepted += walk(project, seed, 12).applied
        return true
      }),
      { numRuns: 60 },
    )
    // A property that never ran is not a property.
    expect(accepted).toBeGreaterThan(20)
  })

  it('reached both halves of the rule along the way', () => {
    // A property that never ran is not a property: the walk has to have dropped at least one
    // acknowledgement by deleting one of its subjects, not merely made edits around records.
    let pruned = 0
    let acknowledged = 0
    fc.assert(
      fc.property(arbProject(), fc.integer({ min: 1, max: 2 ** 31 - 1 }), (project, seed) => {
        const run = walk(project, seed, 12)
        pruned += run.pruned
        acknowledged += run.project.warningAcknowledgements.length
        return true
      }),
      { numRuns: 60 },
    )
    expect(pruned).toBeGreaterThan(0)
    expect(acknowledged).toBeGreaterThan(0)
  })
})

describe('warnings do not depend on storage order (#66 criterion 8)', () => {
  it('gives the same warnings for a Project whose arrays were shuffled', () => {
    fc.assert(
      fc.property(
        arbProject(),
        fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], { minLength: 12, maxLength: 12 }),
        (project, order) => {
          const rank = (index: number): number => order.indexOf(index % 12)
          const shuffled: Project = {
            ...project,
            floors: [...project.floors].sort((a, b) => rank(project.floors.indexOf(a)) - rank(project.floors.indexOf(b))),
            views: [...project.views].sort((a, b) => rank(project.views.indexOf(a)) - rank(project.views.indexOf(b))),
            itemDesigns: [...project.itemDesigns].sort(
              (a, b) => rank(project.itemDesigns.indexOf(a)) - rank(project.itemDesigns.indexOf(b)),
            ),
            existingModel: {
              ...project.existingModel,
              walls: [...project.existingModel.walls].sort(
                (a, b) => rank(project.existingModel.walls.indexOf(a)) - rank(project.existingModel.walls.indexOf(b)),
              ),
              wallJunctions: [...project.existingModel.wallJunctions].sort(
                (a, b) =>
                  rank(project.existingModel.wallJunctions.indexOf(a)) - rank(project.existingModel.wallJunctions.indexOf(b)),
              ),
              openings: [...project.existingModel.openings].sort(
                (a, b) => rank(project.existingModel.openings.indexOf(a)) - rank(project.existingModel.openings.indexOf(b)),
              ),
              placedItems: [...project.existingModel.placedItems].sort(
                (a, b) =>
                  rank(project.existingModel.placedItems.indexOf(a)) - rank(project.existingModel.placedItems.indexOf(b)),
              ),
            },
          }
          expect(canonicalJson(warningsOf(shuffled))).toBe(canonicalJson(warningsOf(project)))
          return true
        },
      ),
      { numRuns: 80 },
    )
  })
})
