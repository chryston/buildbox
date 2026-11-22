/**
 * Layer operations never touch what a record *is* (#71 criteria 5, 6, 11), under the flag.
 *
 * Four things had to hold for every sequence of layer Intents, on a Project that already carries
 * Design Options — the case where a wrong answer is most expensive, because the Existing Model is
 * the baseline every Option is drawn against:
 *
 *  1. the model records are the same records, in the same order, with the same geometry: only the
 *     `drawingLayerId` field of a record may move, and only onto a layer the Project has;
 *  2. the Project stays valid, which among other things means every view's own layer order still
 *     covers every layer exactly once — the invariant `layer.add` and `layer.delete` share;
 *  3. no refusal is ever `baseline-correction-required`: re-filing a baseline record onto another
 *     layer is presentation, not a change to the record every Option is drawn against (#71 §5);
 *  4. the whole sequence undoes byte-identically, because #48 stores the patches and nothing else.
 *
 * A refusal is a pass for the sweep — the handler's own refusals are the subject of
 * `layerHandlers.renovation.test.ts`. What this file must never see is an accepted edit that changed
 * something a layer operation has no business changing.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Project } from '../../domain'
import { UNLAYERED_LAYER_KEY, validateProject } from '../../domain'
import { canonicalJson } from '../../lib'
import { applyIntent, applyPatches, type Intent } from '../index'
import { intent } from '../testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as { projects: { data: Project }[] }

const base = seed.projects[0].data

/** Names the sweep may hand a layer; distinct, so a fresh name is never a duplicate of another. */
const NAMES = Array.from({ length: 24 }, (_, index) => `Layer ${index + 1}`)
const COLORS = ['#b9b9c2', '#5fb3ff', '#e3a857', '#9ad48a', '#123456']

/** One layer command, built against the Project it is about to be applied to. */
type Command = (project: Project) => Intent

const NOW = '2026-11-22T00:00:00.000Z'

const layerId = (n: number): string => `sweep-layer-${n}`
const nameOf = (index: number): string => NAMES[index]!
const colorOf = (index: number): string => COLORS[index]!

/** Every model record of the Project, with its layer erased — everything a layer op may not change. */
function recordsExceptLayer(project: Project): string {
  return canonicalJson(
    modelsOf(project).flatMap((model) => [
      ...model.walls.map((wall) => ({ ...wall, drawingLayerId: null })),
      ...model.openings.map((opening) => ({ ...opening, drawingLayerId: null })),
      ...model.rooms.map((room) => ({ ...room, drawingLayerId: null })),
      ...model.placedItems.map((item) => ({ ...item, drawingLayerId: null })),
    ]),
  )
}

/** Which layer each record sits on — the one field a layer operation may write. */
function layerFiling(project: Project): [string, string | null][] {
  return modelsOf(project).flatMap((model) => [
    ...model.walls.map((wall) => [wall.id, wall.drawingLayerId ?? null] as [string, string | null]),
    ...model.openings.map((opening) => [opening.id, opening.drawingLayerId ?? null] as [string, string | null]),
    ...model.rooms.map((room) => [room.id, room.drawingLayerId ?? null] as [string, string | null]),
    ...model.placedItems.map((item) => [item.id, item.drawingLayerId ?? null] as [string, string | null]),
  ])
}

function modelsOf(project: Project) {
  return [project.existingModel, ...(project.designOptions ?? []).map((option) => option.proposed)]
}

/** A full order for the Project as it stands, which is what `view.setLayerOrder` demands. */
function fullOrder(project: Project): string[] {
  return [...(project.drawingLayers ?? []).map((layer) => layer.id), UNLAYERED_LAYER_KEY]
}

const allIds = layerFiling(base).map(([id]) => id)
const existingIds = new Set(layerFiling(base).map(([id]) => id).filter((id) =>
  base.existingModel.walls.some((wall) => wall.id === id) ||
  base.existingModel.openings.some((opening) => opening.id === id) ||
  base.existingModel.rooms.some((room) => room.id === id) ||
  base.existingModel.placedItems.some((item) => item.id === id),
))
const viewIds = base.views.map((view) => view.id)
const optionIds = (base.designOptions ?? []).map((option) => option.id)

const pick = <T>(values: readonly T[], index: number): T => values[index % values.length]!

/** One command of each kind, drawn from what the sweep knows about the seed Project. */
const layerNumber = (): fc.Arbitrary<number> => fc.integer({ min: 1, max: 40 })

function commands(): fc.Arbitrary<readonly Command[]> {
  const index = (bound: number): fc.Arbitrary<number> => fc.integer({ min: 0, max: bound - 1 })
  return fc.array(
    fc.oneof(
      {
        weight: 3,
        arbitrary: fc.record({ name: index(NAMES.length), color: index(COLORS.length), n: layerNumber() }).map(
          ({ name, color, n }) => () => intent('layer.add', { name: nameOf(name), color: colorOf(color) }, [layerId(n)]),
        ),
      },
      {
        weight: 2,
        arbitrary: fc.record({ n: layerNumber(), name: index(NAMES.length) }).map(
          ({ n, name }) => () => intent('layer.rename', { layerId: layerId(n), name: nameOf(name) }),
        ),
      },
      {
        weight: 2,
        arbitrary: fc.record({ n: layerNumber(), color: index(COLORS.length) }).map(
          ({ n, color }) => () => intent('layer.setColor', { layerId: layerId(n), color: colorOf(color) }),
        ),
      },
      {
        weight: 2,
        arbitrary: fc.record({ n: layerNumber(), forward: fc.boolean() }).map(
          ({ n, forward }) => () => intent('layer.move', { layerId: layerId(n), direction: forward ? 'forward' : 'back' }),
        ),
      },
      {
        weight: 2,
        arbitrary: fc.record({ n: layerNumber(), view: index(viewIds.length) }).map(
          ({ n, view }) => () => intent('layer.delete', { layerId: layerId(n), viewId: viewIds[view]! }),
        ),
      },
      {
        weight: 4,
        arbitrary: fc.record({
          view: index(viewIds.length),
          n: layerNumber(),
          unlayered: fc.boolean(),
          visible: fc.boolean(),
          selectable: fc.boolean(),
          editable: fc.boolean(),
          recolour: fc.boolean(),
        }).map(({ view, n, unlayered, visible, selectable, editable, recolour }) => () =>
          intent(
            'view.setLayerSetting',
            {
              viewId: viewIds[view]!,
              layerKey: unlayered ? UNLAYERED_LAYER_KEY : layerId(n),
              setting: recolour ? { color: '#654321' } : { visible, selectable, editable },
            },
          ),
        ),
      },
      {
        weight: 2,
        arbitrary: fc.record({ view: index(viewIds.length), follow: fc.boolean() }).map(
          // The order command takes the whole list, so it is read off the Project it is aimed at —
          // which is the point of the shape: a partial order is a refusal, never a partial write.
          ({ view, follow }) => (project: Project) =>
            intent('view.setLayerOrder', { viewId: viewIds[view]!, layerOrder: follow ? null : fullOrder(project) }),
        ),
      },
      {
        weight: 2,
        arbitrary: fc.record({ view: index(viewIds.length), n: layerNumber(), none: fc.boolean() }).map(
          ({ view, n, none }) => () => intent('view.setActiveLayer', { viewId: viewIds[view]!, layerId: none ? null : layerId(n) }),
        ),
      },
      {
        weight: 1,
        arbitrary: fc.record({ view: index(viewIds.length), on: fc.boolean() }).map(
          ({ view, on }) => () => intent('view.setSnapToHidden', { viewId: viewIds[view]!, snapToHidden: on }),
        ),
      },
      {
        weight: 5,
        arbitrary: fc.record({
          record: index(allIds.length),
          n: layerNumber(),
          none: fc.boolean(),
          option: index(Math.max(1, optionIds.length)),
        }).map(({ record, n, none, option }) => () =>
          intent('entity.setLayer', {
            entityId: allIds[record]!,
            layerId: none ? null : layerId(n),
            target: { designOptionId: pick(optionIds, option) ?? null },
          }),
        ),
      },
    ),
    { minLength: 8, maxLength: 40 },
  )
}

describe('a sequence of layer Intents (#71)', () => {
  it('changes no model record but its layer, keeps the Project valid, and undoes byte-identically', { timeout: 90_000 }, () => {
    let appliedTotal = 0
    fc.assert(
      fc.property(commands(), (plan) => {
        let project = base
        const history: { project: Project; inverse: Parameters<typeof applyPatches>[1] }[] = []
        for (const command of plan) {
          const result = applyIntent(project, command(project))
          // No layer operation is ever a baseline correction, whether it was refused or not (#71 §5).
          if (!result.ok) {
            expect(result.code).not.toBe('baseline-correction-required')
            continue
          }
          appliedTotal += 1
          history.push({ project, inverse: result.inversePatches })
          project = result.project
        }
        // 1. Only the layer field of a record may have moved.
        expect(recordsExceptLayer(project)).toBe(recordsExceptLayer(base))
        // 2. The Project is valid, which includes every view's own order covering every layer once.
        const check = validateProject(project)
        if (!check.ok) throw new Error(`the sweep left an invalid Project: ${JSON.stringify(check.problems.slice(0, 2))}`)
        for (const view of project.views) {
          if (view.layerOrder === undefined || view.layerOrder === null) continue
          expect([...view.layerOrder].sort()).toEqual(fullOrder(project).sort())
        }
        // Every filing names a layer the Project has, or nothing at all.
        const known = new Set<string>(fullOrder(project))
        for (const [id, layer] of layerFiling(project))
          if (layer !== null) expect(known.has(layer), `record ${id} names ${layer}`).toBe(true)
        // 4. Undoing the whole sequence in reverse rebuilds the Project byte for byte.
        for (const step of [...history].reverse()) {
          project = applyPatches(project, step.inverse)
          expect(canonicalJson(project)).toBe(canonicalJson(step.project))
        }
      }),
      { numRuns: 60 },
    )
    // A sweep that applied nothing would prove nothing.
    expect(appliedTotal).toBeGreaterThan(20)
  })

  it('never answers a baseline re-filing with the correction dialog', { timeout: 60_000 }, () => {
    expect(existingIds.size).toBeGreaterThan(0)
    expect((base.designOptions ?? []).length).toBeGreaterThan(0)
    fc.assert(
      fc.property(
        fc.constantFrom(...[...existingIds]),
        layerNumber(),
        fc.boolean(),
        (entityId, n, none) => {
          const result = applyIntent(base, intent('entity.setLayer', { entityId, layerId: none ? null : layerId(n) }))
          if (result.ok) {
            const filed = layerFiling(result.project).find(([id]) => id === entityId)
            expect(filed?.[1]).toBe(none ? null : layerId(n))
          } else {
            expect(result.code, `a baseline re-filing was refused with ${result.code}`).not.toBe('baseline-correction-required')
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
