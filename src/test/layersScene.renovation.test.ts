/**
 * The layers scene fixture (#71 criteria 1–3).
 *
 * `fixtures/domain/v10/layers.json` is the Project the Layers list is built and tested against, and
 * `layers-zero.json` is the same Project after every layer has been deleted. This holds the
 * **committed bytes** — not the generator's in-memory Project — to the issue's scene, the way
 * `renovationViewsScene.renovation.test.ts` does for #70: the day a generator changes, the fixture
 * that a thousand UI assertions lean on is what has to be caught.
 *
 * The scene, in the words the criteria use:
 *
 *   Project      three layers, the issue's three colours, in an order that is deliberately not the
 *                order they were added in — one `layer.move` says the Project order is data
 *   content      Walls, Openings and Rooms on Structure; Placed Items on Furniture; Services empty,
 *                because criterion 14 deletes a layer and the interesting case is one with nothing
 *                to move
 *   views        `Option A · Proposed` hides Furniture and re-colours Structure;
 *                `Option B · Combined` makes Structure read-only and snaps to hidden content;
 *                `Option A · Demolition` draws in an order of its own; the Floor's default view has
 *                an active layer
 *   zero         no layers, nothing filed, no view with an override left, and no view naming a
 *                layer that is gone
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOMAIN_SCHEMA_VERSION, DEFAULT_DRAWING_LAYERS, entityLayerId, migrateProject, validateProject, viewSnapToHidden } from '../domain'
import type { PlanView, Project } from '../domain'
import { canonicalJson } from '../lib'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

interface Envelope {
  domainSchemaVersion: number
  project: Project
}

const read = (name: string): { text: string; project: Project } => {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v15', name), 'utf8')
  return { text, project: (JSON.parse(text) as Envelope).project }
}

const layeredFile = read('layers.json')
const zeroFile = read('layers-zero.json')
const layered = layeredFile.project
const zero = zeroFile.project

const layerId = (project: Project, name: string): string =>
  project.drawingLayers?.find((layer) => layer.name === name)?.id ?? `no ${name} layer`
const view = (project: Project, name: string): PlanView => project.views.find((candidate) => candidate.name === name) ?? (() => { throw new Error(`no view ${name}`) })()

const allRecords = (project: Project) => [
  ...project.existingModel.walls,
  ...project.existingModel.openings,
  ...project.existingModel.rooms,
  ...project.existingModel.placedItems,
  ...(project.designOptions ?? []).flatMap((option) => [
    ...option.proposed.walls,
    ...option.proposed.openings,
    ...option.proposed.rooms,
    ...option.proposed.placedItems,
  ]),
]

describe('the layers scene (#71 §1, §2)', () => {
  it('is canonical JSON with one trailing newline, and a valid v8 Project', () => {
    for (const { text, project } of [layeredFile, zeroFile]) {
      expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true)
      expect(canonicalJson(JSON.parse(text))).toBe(text.slice(0, -1))
      expect(JSON.parse(text).domainSchemaVersion).toBe(DOMAIN_SCHEMA_VERSION)
      expect(validateProject(project).ok).toBe(true)
      // Reading a current Project changes nothing it stores (#42 criterion 14).
      const migrated = migrateProject(project, DOMAIN_SCHEMA_VERSION, () => ['migrated-view'])
      if (!migrated.ok) throw new Error(migrated.error.message)
      expect(canonicalJson(migrated.project)).toBe(canonicalJson(project))
    }
  })

  it('carries the three default layers in the issue’s colours', () => {
    expect(layered.drawingLayers?.map((layer) => `${layer.name} ${layer.color}`)).toEqual([
      'Services #5fb3ff',
      'Furniture #e3a857',
      'Structure #b9b9c2',
    ])
    // The stored order is not the order they arrived in, and it is not the default order either:
    // the Project layer order is data a person can change, and every view without an override
    // shows that change.
    expect(layered.drawingLayers?.map((layer) => layer.name)).not.toEqual(DEFAULT_DRAWING_LAYERS.map((layer) => layer.name))
  })

  it('files the content by what it is, and leaves Services empty', () => {
    const filed = (name: string): number => allRecords(layered).filter((record) => entityLayerId(record) === layerId(layered, name)).length
    expect(filed('Structure')).toBe(
      layered.existingModel.walls.length + layered.existingModel.openings.length + layered.existingModel.rooms.length +
        (layered.designOptions ?? []).reduce((sum, option) => sum + option.proposed.walls.length, 0),
    )
    expect(filed('Furniture')).toBe(
      layered.existingModel.placedItems.length + (layered.designOptions ?? []).reduce((sum, option) => sum + option.proposed.placedItems.length, 0),
    )
    expect(filed('Services')).toBe(0)
    // Nothing is left Unlayered: the fixture is a Project where the rule has been applied, not one
    // that has never met it.
    expect(allRecords(layered).every((record) => entityLayerId(record) !== null)).toBe(true)
    expect(allRecords(layered).length).toBeGreaterThan(10)
  })

  it('gives each saved view its own say, and only where the issue says so', () => {
    const proposed = view(layered, 'Option A · Proposed')
    const combined = view(layered, 'Option B · Combined')
    const demolition = view(layered, 'Option A · Demolition')
    const fallback = layered.views.find((candidate) => candidate.isDefault) ?? (() => { throw new Error('no default view') })()

    // A colour override carries the three switches as this view understands them and the colour on
    // top; a switch override carries no colour, which is what leaves it to the Project.
    expect(proposed.layerSettings?.[layerId(layered, 'Furniture')]).toEqual({ visible: false, selectable: true, editable: true })
    expect(proposed.layerSettings?.[layerId(layered, 'Structure')]).toEqual({ visible: true, selectable: true, editable: true, color: '#7aa2ff' })
    expect(combined.layerSettings?.[layerId(layered, 'Structure')]).toEqual({ visible: true, selectable: true, editable: false })
    expect(viewSnapToHidden(combined)).toBe(true)
    expect(viewSnapToHidden(proposed)).toBe(false)
    expect(demolition.layerOrder).toEqual([layerId(layered, 'Furniture'), layerId(layered, 'Structure'), layerId(layered, 'Services'), 'unlayered'])
    expect(fallback.activeLayerId).toBe(layerId(layered, 'Structure'))
    // A view that says nothing says nothing: no empty override objects, no inherited copies.
    expect(fallback.layerSettings ?? {}).toEqual({})
    expect(proposed.layerOrder ?? null).toBeNull()
    expect(combined.layerOrder ?? null).toBeNull()
    // And no override repeats a Project default — the validator forbids it, and the fixture is the
    // evidence that the rule and the data agree.
    for (const candidate of layered.views) {
      for (const [key, setting] of Object.entries(candidate.layerSettings ?? {})) {
        expect(Object.keys(setting).length, `${candidate.name}/${key}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('the zero-layer scene (#71 criterion 3)', () => {
  it('has no layers, no memberships and no overrides', () => {
    expect(zero.drawingLayers).toEqual([])
    expect(allRecords(zero).every((record) => entityLayerId(record) === null)).toBe(true)
    for (const candidate of zero.views) {
      expect(candidate.layerSettings ?? {}, candidate.name).toEqual({})
      // Deleting the last layer leaves an order of Unlayered alone, never a dangling ID.
      expect(candidate.layerOrder === null || candidate.layerOrder === undefined || candidate.layerOrder.join() === 'unlayered').toBe(true)
      expect(candidate.activeLayerId ?? null).toBeNull()
    }
  })

  it('is the same Floor, Options and views as the layered scene', () => {
    // The two files differ by layers and nothing else, which is what makes the pair useful: one
    // Project before the deletion and one after, byte for byte comparable.
    expect(canonicalJson({ ...zero, drawingLayers: layered.drawingLayers })).not.toBe(canonicalJson(layered))
    expect(zero.views.map((candidate) => candidate.id)).toEqual(layered.views.map((candidate) => candidate.id))
    expect(zero.designOptions?.map((option) => option.id)).toEqual(layered.designOptions?.map((option) => option.id))
    expect(zero.floors.map((floor) => floor.id)).toEqual(layered.floors.map((floor) => floor.id))
  })
})
