/**
 * Nothing edits the Existing Model out of a renovation display without saying so (#70 criterion 19).
 *
 * The rule lives in `applyIntent`, not in any dialog: once a Project carries a Design Option, an
 * Intent whose patches touch `existingModel` is refused unless it *is* a
 * `renovation.correctExistingModel`. That is the only place the rule can live, because the surface
 * that dispatches the edit is not one thing — a drag, a nudge, a typed field, a tool, and later
 * whatever the catalogue gains. So the property is written against the catalogue rather than the
 * UI: for a random Existing-entity move or edit dispatched against a Project that has Options, the
 * Existing Model is byte-identical before and after, in canonical JSON.
 *
 * A rejection is a pass: the sweep cannot tell "refused" from "did nothing", and it does not need
 * to. What it must never see is an accepted edit that moved baseline geometry.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Project } from '../../domain'
import type { KeepFixed, Pt } from '../../geometry'
import { canonicalJson } from '../../lib'
import { applyIntent, type Intent } from '../index'
import { intent } from '../testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as { projects: { data: Project }[] }

const FLOOR = 'seed-001'
const project = seed.projects[0].data
const model = project.existingModel

const wallIds = model.walls.map((each) => each.id)
const junctionIds = model.wallJunctions.map((each) => each.id)
const openingIds = model.openings.map((each) => each.id)
const roomIds = model.rooms.map((each) => each.id)
const placedIds = model.placedItems.map((each) => each.id)
const catalogKeys = ['bed-king', 'sofa-3-seat', 'fridge-tall']

/** A whole-millimetre Floor point: the sweep is about which collection a write lands in, not floats. */
const point = (): fc.Arbitrary<Pt> =>
  fc.record({ x: fc.integer({ min: 0, max: 12000 }), y: fc.integer({ min: 0, max: 9000 }) })
const delta = (): fc.Arbitrary<Pt> =>
  fc.record({ x: fc.integer({ min: -800, max: 800 }), y: fc.integer({ min: -800, max: 800 }) })
const pick = <T>(values: readonly T[]): fc.Arbitrary<T> => fc.constantFrom(...values)
const keepFixed = (): fc.Arbitrary<KeepFixed> => fc.constantFrom('start' as KeepFixed, 'end' as KeepFixed)

/** Every way the surface can ask for an Existing-entity move or edit, aimed at real fixture records. */
const editIntent: fc.Arbitrary<Intent> = fc.oneof(
  fc.record({ wallId: pick(wallIds), d: delta() }).map(({ wallId, d }) => intent('wall.dragBody', { wallId, delta: d })),
  fc
    .record({ wallId: pick(wallIds), end: fc.constantFrom('start' as const, 'end' as const), to: point() })
    .map(({ wallId, end, to }) => intent('wall.dragEndpoint', { wallId, end, to })),
  fc
    .record({ junctionId: pick(junctionIds), d: delta() })
    .map(({ junctionId, d }) => intent('wall.dragJunction', { junctionId, delta: d })),
  fc
    .record({ wallId: pick(wallIds), length: fc.integer({ min: 100, max: 9000 }), fixed: keepFixed() })
    .map(({ wallId, length, fixed }) => intent('wall.setLength', { wallId, length, keepFixed: fixed })),
  fc
    .record({ wallId: pick(wallIds), directionDeg: fc.integer({ min: 0, max: 359 }) })
    .map(({ wallId, directionDeg }) => intent('wall.setDirection', { wallId, directionDeg })),
  fc
    .record({ wallId: pick(wallIds), radius: fc.integer({ min: 200, max: 6000 }) })
    .map(({ wallId, radius }) => intent('wall.setArc', { wallId, radius })),
  fc
    .record({ wallId: pick(wallIds), thickness: fc.integer({ min: 80, max: 400 }) })
    .map(({ wallId, thickness }) => intent('wall.setThickness', { wallId, thickness })),
  fc
    .record({ wallId: pick(wallIds), distance: fc.integer({ min: -600, max: 600 }), side: fc.constantFrom('left' as const, 'right' as const) })
    .map(({ wallId, distance, side }) => intent('wall.offset', { wallId, distance, side })),
  fc.record({ wallId: pick(wallIds), at: fc.integer({ min: 100, max: 5000 }) }).map(({ wallId, at }) => intent('wall.split', { wallId, at })),
  fc.record({ wallId: pick(wallIds) }).map(({ wallId }) => intent('wall.delete', { wallId })),
  fc.record({ openingId: pick(openingIds) }).map(({ openingId }) => intent('opening.flipHinge', { openingId })),
  fc.record({ openingId: pick(openingIds) }).map(({ openingId }) => intent('opening.flipSwing', { openingId })),
  fc
    .record({ openingId: pick(openingIds), start: fc.integer({ min: 0, max: 4000 }) })
    .map(({ openingId, start }) => intent('opening.setStart', { openingId, start })),
  fc
    .record({ openingId: pick(openingIds), width: fc.integer({ min: 400, max: 2400 }) })
    .map(({ openingId, width }) => intent('opening.setWidth', { openingId, width })),
  fc
    .record({ openingId: pick(openingIds), label: fc.constantFrom('Door 1', 'Window 2', 'Opening 3') })
    .map(({ openingId, label }) => intent('opening.rename', { openingId, label })),
  fc.record({ openingId: pick(openingIds) }).map(({ openingId }) => intent('opening.delete', { openingId })),
  fc
    .record({ roomId: pick(roomIds), name: fc.constantFrom('Kitchen', 'Utility', 'Lounge') })
    .map(({ roomId, name }) => intent('room.rename', { roomId, name })),
  fc
    .record({ centre: point(), orientationDeg: fc.integer({ min: 0, max: 359 }) })
    .map(({ centre, orientationDeg }) => intent('room.placeShelter', { floorId: FLOOR, centre, orientationDeg })),
  fc
    .record({ placedItemId: pick(placedIds), translation: delta() })
    .map(({ placedItemId, translation }) => intent('plan.movePlacement', { placedItemId, translation })),
  fc
    .record({ placedItemId: pick(placedIds), rotationDeg: fc.integer({ min: 0, max: 359 }) })
    .map(({ placedItemId, rotationDeg }) => intent('plan.rotatePlacement', { placedItemId, rotationDeg })),
  fc.record({ placedItemId: pick(placedIds) }).map(({ placedItemId }) => intent('plan.removeObject', { placedItemId })),
  fc
    .record({ catalogKey: pick(catalogKeys) })
    .map(({ catalogKey }) => intent('plan.addObject', { floorId: FLOOR, catalogKey })),
)

const baseline = canonicalJson(project.existingModel)

describe('an Existing Model edit needs the correction (#70 criterion 19)', () => {
  it('leaves the Existing Model byte-identical for any move or edit dispatched without a resolution', { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(editIntent, (each) => {
        const result = applyIntent(project, each)
        if (result.ok) {
          expect(
            canonicalJson(result.project.existingModel),
            `${each.type} changed the Existing Model without a correctExistingModel resolution`,
          ).toBe(baseline)
        }
      }),
      { numRuns: 400 },
    )
  })

  it('is the protection refusing, not the edit: wrapped in the correction the same Intent is no longer refused for the baseline', { timeout: 60_000 }, () => {
    // The same Project with its Options taken away: the guard only fires while Options exist, so the
    // inner Intent runs on its own merits here. An Intent that writes nothing when nothing stops it —
    // a Door renamed to the label it already carries, a width set to the width it has — writes nothing
    // wrapped either, and the correction is not the rule that was holding it.
    const bare: Project = { ...project, designOptions: [] }
    const writesNothing = (each: Intent): boolean => {
      const own = applyIntent(bare, each)
      return own.ok && canonicalJson(own.project.existingModel) === baseline
    }
    fc.assert(
      fc.property(editIntent, (each) => {
        const refused = applyIntent(project, each)
        if (refused.ok || refused.code !== 'baseline-correction-required') return
        if (writesNothing(each)) return
        const corrected = applyIntent(project, intent('renovation.correctExistingModel', { inner: each }))
        // The correction can still be refused on its own merits — an Option whose dependent update
        // cannot follow is `option-blocked` — but never by the rule it exists to answer.
        if (corrected.ok) expect(canonicalJson(corrected.project.existingModel)).not.toBe(baseline)
        else
          expect(
            corrected.code,
            `${each.type} wrapped in the correction was still refused as a baseline correction`,
          ).not.toBe('baseline-correction-required')
      }),
      { numRuns: 400 },
    )
  })
})
