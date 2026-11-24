/**
 * The #74 Plan View Range scene (`fixtures/domain/v9/plan-range-scene.json`).
 *
 * Two jobs in one file, the way `layersScene.renovation.test.ts` splits them:
 *
 * - the **committed bytes** are held to the issue's Fixture scene, so the day the generator changes,
 *   the scene a hundred drawing, cycle and inspector assertions lean on is what gets caught;
 * - the **criteria the scene exists for** are run against it — the boundary (criterion 2), the one
 *   transaction and its undo (criterion 3), and the property that a range edit never touches an
 *   entity. They are here rather than in `src/edit` because they are claims about *this* scene: at
 *   0–1500 the Wall cabinet is Above it, and the warning criterion 2 acknowledges is the one the
 *   scene's own four corners raise.
 *
 * The scene, in the criteria's words: one Floor with an upper limit of 2 600 and no lower one; W-1…W-4
 * at 0–2 600; `Window 1` in W-1 at 900–2 100; `Base cabinet #1` and `#2` at Base 0 as two placements of
 * one design; `Wall cabinet #1` at 1 500 standing over `#1`; `Sump box` at −150; and the Floor's default
 * Plan View ranged 0–1 200 — the range criterion 1 counts the classes at.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { deriveWarnings, effectiveModel, rangeClasses } from '../derive'
import { designHeight, validateProject } from '../domain'
import type { PlanView, Project } from '../domain'
import { applyIntent, applyPatches, INTENT_LABELS } from '../edit'
import { expectApplied, idSource, intent } from '../edit/testing'
import { planRangeScene } from '../derive/testing'
import { canonicalJson } from '../lib'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const committed = readFileSync(join(fixturesRoot, 'domain', 'v9', 'plan-range-scene.json'), 'utf8')
const envelope = JSON.parse(committed) as { domainSchemaVersion: number; project: Project }

const scene = planRangeScene()
const floor = scene.floors[0]!
const view = scene.views.find((candidate) => candidate.isDefault) ?? scene.views[0]!

const design = (name: string) => scene.itemDesigns.find((candidate) => candidate.name === name) ?? expect.fail(`no ${name} design`)
const placementsOf = (name: string) => scene.existingModel.placedItems.filter((item) => item.itemDesignId === design(name).id)
const placement = (name: string, index = 0) => placementsOf(name)[index] ?? expect.fail(`no ${name} placement ${index}`)

/** Every entity's Range Class on this Floor at a range of the caller's. */
const classesAt = (project: Project, lowerMm: number, upperMm: number): Map<string, string> =>
  rangeClasses(effectiveModel(project, floor.id, null), project.itemDesigns, { lowerMm, upperMm })

/** The range edit, as the gauge commits it: one Intent, no IDs to spend. */
const setRange = (project: Project, lowerMm: number, upperMm: number, viewId = view.id): Project =>
  expectApplied(project, intent('view.setPlanViewRange', { viewId, lowerMm, upperMm })).project

describe('the committed scene (#74, the Fixture scene)', () => {
  it('is a v9 Project the validator accepts', () => {
    // The bytes stay at v9 forever as compatibility evidence, so what the validator judges is the
    // Project the app actually holds after reading them forward to the current schema (#80).
    expect(envelope.domainSchemaVersion).toBe(9)
    expect(validateProject(scene).ok).toBe(true)
  })

  it('stands one Floor whose limits have an upper end and no lower one', () => {
    expect(scene.floors).toHaveLength(1)
    expect(floor.limits).toEqual({ upperMm: 2600 })
    // The Floor Datum is Z = 0 by definition, so "no lower limit" is the absence of `lowerMm`.
    expect(floor.limits?.lowerMm).toBeUndefined()
  })

  it('draws W-1…W-4 at the storey and the window in W-1', () => {
    expect(scene.existingModel.walls.map((wall) => wall.ref)).toEqual(['W-1', 'W-2', 'W-3', 'W-4'])
    for (const wall of scene.existingModel.walls) {
      expect([wall.baseElevation, wall.height]).toEqual([0, 2600])
    }
    expect(scene.existingModel.openings).toHaveLength(1)
    const opening = scene.existingModel.openings[0]!
    expect([opening.label, opening.kind, opening.sill, opening.head]).toEqual(['Window 1', 'window', 900, 2100])
    expect(opening.hostWallId).toBe(scene.existingModel.walls[0]!.id)
  })

  it('places the four items the scene names, at the Bases and heights it names', () => {
    expect(scene.existingModel.placedItems).toHaveLength(4)
    expect(scene.itemDesigns.map((item) => `${item.name} ${designHeight(item)}`)).toEqual([
      'Base cabinet 860',
      'Wall cabinet 700',
      'Sump box 100',
    ])
    expect([placement('Base cabinet', 0).baseElevation, placement('Base cabinet', 1).baseElevation]).toEqual([0, 0])
    expect(placement('Wall cabinet').baseElevation).toBe(1500)
    expect(placement('Sump box').baseElevation).toBe(-150)
    // `#2` is a second placement of the same design, which is what §5's `shared by 2 placements` is.
    expect(placementsOf('Base cabinet')[0]!.itemDesignId).toBe(placementsOf('Base cabinet')[1]!.itemDesignId)
    // The Wall cabinet stands over `Base cabinet #1`: the pair criterion 9 clicks in one spot.
    expect(placement('Wall cabinet').translation).toEqual(placement('Base cabinet', 0).translation)
    // No Placed Item carries a height of its own (#74 §7).
    for (const item of scene.existingModel.placedItems) expect(Object.keys(item)).not.toContain('height')
  })

  it('ranges its one Plan View at 0–1200', () => {
    expect(view.planViewRange).toEqual({ lowerMm: 0, upperMm: 1200 })
  })

  it('holds one entity in each Range Class at its own range (#74 criterion 1)', () => {
    const classes = classesAt(scene, 0, 1200)
    expect(classes.get(placement('Wall cabinet').id)).toBe('above')
    expect(classes.get(placement('Sump box').id)).toBe('below')
    for (const wall of scene.existingModel.walls) expect(classes.get(wall.id)).toBe('in')
    expect(classes.get(scene.existingModel.openings[0]!.id)).toBe('in')
    for (const item of placementsOf('Base cabinet')) expect(classes.get(item.id)).toBe('in')
  })

  it('raises the warnings criterion 2 acknowledges', () => {
    // The shell is four free-ended Walls, so each corner is two Walls crossing unjoined — the scene
    // carries real S7 warnings, which is what criterion 2 needs one of to have already Seen.
    const warnings = deriveWarnings(scene, floor.id, null).warnings
    expect(warnings.map((warning) => warning.type)).toEqual(['wall_crossing', 'wall_crossing', 'wall_crossing', 'wall_crossing'])
    expect(warnings.every((warning) => warning.status === 'open')).toBe(true)
  })
})

describe('the boundary (#74 criterion 2)', () => {
  it('calls the Wall cabinet Above at 0–1500 and In range at 0–1510', () => {
    const wallCabinet = placement('Wall cabinet').id
    expect(classesAt(scene, 0, 1500).get(wallCabinet)).toBe('above')
    expect(classesAt(scene, 0, 1510).get(wallCabinet)).toBe('in')
  })

  it('edits no entity to move the boundary', () => {
    const before = canonicalJson({ existing: scene.existingModel, designs: scene.itemDesigns })
    const moved = setRange(setRange(scene, 0, 1500), 0, 1510)
    expect(moved.views.find((candidate) => candidate.id === view.id)?.planViewRange).toEqual({ lowerMm: 0, upperMm: 1510 })
    expect(canonicalJson({ existing: moved.existingModel, designs: moved.itemDesigns })).toBe(before)
  })

  it('leaves an acknowledged warning Seen ✓', () => {
    const warning = deriveWarnings(scene, floor.id, null).warnings[0]!
    const acknowledged = expectApplied(
      scene,
      intent(
        'warning.acknowledge',
        { warningType: warning.type, subjectIds: warning.subjects.map((entry) => entry.id), designOptionId: warning.optionId, signature: warning.signature, note: 'Corners are structural' },
        idSource('ack', scene)(1),
      ),
    ).project
    expect(deriveWarnings(acknowledged, floor.id, null).warnings.find((row) => row.key === warning.key)?.status).toBe('acknowledged')

    const after = setRange(acknowledged, 0, 1500)
    // The same record, the same signature, the same status: a range change never reopens a warning.
    expect(after.warningAcknowledgements).toEqual(acknowledged.warningAcknowledgements)
    const row = deriveWarnings(after, floor.id, null).warnings.find((candidate) => candidate.key === warning.key)
    expect(row?.status).toBe('acknowledged')
  })
})

describe('one transaction, and its undo (#74 criterion 3)', () => {
  it('is one Edit Transaction labelled `Change Plan View Range`', () => {
    const transaction = intent('view.setPlanViewRange', { viewId: view.id, lowerMm: 200, upperMm: 900 })
    expect(INTENT_LABELS['view.setPlanViewRange']).toBe('Change Plan View Range')
    expect(transaction.label).toBe('Change Plan View Range')
    const applied = expectApplied(scene, transaction)
    // One transaction: the patches touch this view's range and nothing else.
    expect(applied.patches.length).toBeGreaterThan(0)
    for (const patch of applied.patches) {
      expect(JSON.stringify(patch.path)).toContain('planViewRange')
      expect(JSON.stringify(patch.path)).toContain('views')
    }
  })

  it('undoes to the previous range with every entity byte-identical', () => {
    const applied = expectApplied(scene, intent('view.setPlanViewRange', { viewId: view.id, lowerMm: 0, upperMm: 1500 }))
    expect(applied.project.views.find((candidate) => candidate.id === view.id)?.planViewRange).toEqual({ lowerMm: 0, upperMm: 1500 })
    const back = applyPatches(applied.project, applied.inversePatches)
    expect(canonicalJson(back)).toBe(canonicalJson(scene))
    expect(canonicalJson(back.existingModel)).toBe(canonicalJson(scene.existingModel))
  })

  it('leaves another Plan View range unchanged', () => {
    const ids = idSource('view', scene)
    const created = expectApplied(scene, intent('view.create', { floorId: floor.id, name: 'Ceiling plan' }, ids(1))).project
    const other = created.views.find((candidate) => candidate.name === 'Ceiling plan') as PlanView
    const withOtherRange = setRange(created, 200, 900, other.id)
    expect(withOtherRange.views.find((candidate) => candidate.id === other.id)?.planViewRange).toEqual({ lowerMm: 200, upperMm: 900 })

    const moved = setRange(withOtherRange, 0, 1500, view.id)
    expect(moved.views.find((candidate) => candidate.id === view.id)?.planViewRange).toEqual({ lowerMm: 0, upperMm: 1500 })
    expect(moved.views.find((candidate) => candidate.id === other.id)?.planViewRange).toEqual({ lowerMm: 200, upperMm: 900 })
  })
})

describe('a range edit never changes an entity (#74 criterion 3)', () => {
  const entities = canonicalJson({ existing: scene.existingModel, designs: scene.itemDesigns })

  it('holds the Existing Model and the Item Designs byte-identical, whatever the range', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: 1, max: 6000 }), (lowerMm, span) => {
        const upperMm = lowerMm + span
        const applied = applyIntent(scene, intent('view.setPlanViewRange', { viewId: view.id, lowerMm, upperMm }))
        expect(applied.ok).toBe(true)
        if (!applied.ok) return
        expect(canonicalJson({ existing: applied.project.existingModel, designs: applied.project.itemDesigns })).toBe(entities)
        // …and the one transaction puts the whole Project back, byte for byte.
        expect(canonicalJson(applyPatches(applied.project, applied.inversePatches))).toBe(canonicalJson(scene))
      }),
      { numRuns: 120 },
    )
  })
})
