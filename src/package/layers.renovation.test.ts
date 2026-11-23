/**
 * A Backup of a layered Project, restored (#71 criterion 3).
 *
 * The codec is the only place a Project leaves the app and comes back, and Drawing Layers make a
 * new kind of promise for it: the layer list is Project data, the per-view settings are saved-view
 * data, and a record's `drawingLayerId` is content data — all three must survive encode → restore
 * byte for byte, in both directions of the interesting case. The interesting case is the empty one:
 * a Backup taken after every layer has been deleted must restore a Project with **no** layers, not
 * one that grew the three defaults back, because "the Project has no layers" is a state a person
 * chose and `drawingLayersOf` defaulting must never be confused with it.
 *
 * Both fixtures are transcripts of real Intents (`scripts/make-layers-seed.ts`), so what is being
 * round-tripped is a Project the editor could have written, not a hand-written shape that happens
 * to serialise.
 */
import { describe, expect, it } from 'vitest'
import layeredFixture from '../../fixtures/domain/v8/layers.json?raw'
import zeroFixture from '../../fixtures/domain/v8/layers-zero.json?raw'
import planImageSeed from '../../fixtures/e2e/preview-seed/renovation-views.json?raw'
import type { Project } from '../domain'
import { drawingLayersOf, entityLayerId, UNLAYERED_LAYER_KEY } from '../domain'
import { canonicalJson } from '../lib'
import { referencedAssetHashes } from './assets'
import { encodeProject, type AssetSource } from './encode'
import { stageImport } from './import'
import { allocateIds, FIXTURE_BUILD } from './testing'

const layered = (JSON.parse(layeredFixture) as { project: Project }).project
const zero = (JSON.parse(zeroFixture) as { project: Project }).project

/**
 * The Plan Image the fixtures reference, as the bytes that hash to it. The store is
 * content-addressed, so a restore refuses anything else — the preview seed that the fixtures were
 * generated from is where the real bytes live.
 */
const ASSETS = new Map(
  (JSON.parse(planImageSeed) as { assets: { sha256: string; mediaType: string; base64: string }[] }).assets.map((asset) => [
    asset.sha256,
    { bytes: new Uint8Array(Buffer.from(asset.base64, 'base64')), mediaType: asset.mediaType as 'image/png' },
  ]),
)

const assets: AssetSource = async (hash) => {
  const asset = ASSETS.get(hash)
  if (asset === undefined) throw new Error(`the asset store holds no ${hash}`)
  return asset
}

async function restore(project: Project): Promise<Project> {
  const result = await stageImport(await encodeProject(project, assets, FIXTURE_BUILD), { acceptPreview: false, allocateId: allocateIds() })
  if (!result.ok) throw new Error(`the restore was refused: ${result.problem.code} ${JSON.stringify(result.problem)}`)
  expect(result.staged.migratedFrom).toBeNull()
  // Every asset the Project mentions comes back, and nothing else does.
  expect([...result.staged.assets.keys()]).toEqual(referencedAssetHashes(project))
  return result.staged.project
}

describe('a layered Backup round-trips (#71 criterion 3)', () => {
  it('restores the layer list, the memberships and the per-view settings unchanged', async () => {
    const restored = await restore(layered)
    expect(canonicalJson(restored)).toBe(canonicalJson(layered))
  })

  it('keeps the Project order, which is the one thing a view cannot say for itself', async () => {
    const restored = await restore(layered)
    expect(restored.drawingLayers?.map((layer) => layer.name)).toEqual(layered.drawingLayers?.map((layer) => layer.name))
    expect(restored.drawingLayers?.map((layer) => layer.color)).toEqual(layered.drawingLayers?.map((layer) => layer.color))
  })

  it('keeps each record on its own layer, in the Option that holds it', async () => {
    const restored = await restore(layered)
    const filed = (project: Project): string[] => [
      ...project.existingModel.walls.map((row) => `${row.id}:${entityLayerId(row) ?? '—'}`),
      ...project.existingModel.openings.map((row) => `${row.id}:${entityLayerId(row) ?? '—'}`),
      ...project.existingModel.rooms.map((row) => `${row.id}:${entityLayerId(row) ?? '—'}`),
      ...project.existingModel.placedItems.map((row) => `${row.id}:${entityLayerId(row) ?? '—'}`),
      ...(project.designOptions ?? []).flatMap((option) => [
        ...option.proposed.walls.map((row) => `${row.id}:${entityLayerId(row) ?? '—'}`),
        ...option.proposed.placedItems.map((row) => `${row.id}:${entityLayerId(row) ?? '—'}`),
      ]),
    ]
    expect(filed(restored)).toEqual(filed(layered))
    // And the fixture really does hold the scene: content on two layers, one of them a proposed one.
    expect(new Set(filed(layered).map((row) => row.split(':')[1]))).toEqual(new Set([layered.drawingLayers?.[1]?.id, layered.drawingLayers?.[2]?.id]))
  })

  it('keeps each saved view’s own settings, order, active layer and snap switch', async () => {
    const restored = await restore(layered)
    for (const view of layered.views) {
      const candidate = restored.views.find((each) => each.id === view.id)
      expect(candidate?.layerSettings, view.name).toEqual(view.layerSettings)
      expect(candidate?.layerOrder, view.name).toEqual(view.layerOrder)
      expect(candidate?.activeLayerId, view.name).toEqual(view.activeLayerId)
      expect(candidate?.snapToHiddenContent, view.name).toEqual(view.snapToHiddenContent)
    }
    // The scene the panel is tested against: one view hides Furniture, another makes Structure
    // read-only, a third draws in its own order.
    const byName = (name: string): string => layered.drawingLayers?.find((layer) => layer.name === name)?.id ?? ''
    expect(layered.views.some((view) => view.layerSettings?.[byName('Furniture')]?.visible === false)).toBe(true)
    expect(layered.views.some((view) => view.layerSettings?.[byName('Structure')]?.editable === false)).toBe(true)
    expect(layered.views.filter((view) => view.layerOrder !== undefined && view.layerOrder !== null)).toHaveLength(1)
  })
})

describe('a Backup with no layers at all restores no layers (#71 criterion 3)', () => {
  it('does not grow the default layers back', async () => {
    expect(zero.drawingLayers).toEqual([])
    const restored = await restore(zero)
    expect(restored.drawingLayers).toEqual([])
    expect(canonicalJson(restored)).toBe(canonicalJson(zero))
    // Layers are written at creation and at migration, never conjured at read: a Project that stores
    // none has none, whether the field is absent (a hand-made file) or an empty list (every layer
    // deleted). Defaulting here would resurrect what a person deleted, on every read.
    expect(drawingLayersOf(zero)).toEqual([])
    const unsaid: Project = { ...zero }
    delete unsaid.drawingLayers
    expect(drawingLayersOf(unsaid)).toEqual([])
  })

  it('leaves every record Unlayered and no view with an opinion to give', async () => {
    const restored = await restore(zero)
    const records = [
      ...restored.existingModel.walls,
      ...restored.existingModel.openings,
      ...restored.existingModel.rooms,
      ...restored.existingModel.placedItems,
      ...(restored.designOptions ?? []).flatMap((option) => [...option.proposed.walls, ...option.proposed.openings, ...option.proposed.rooms, ...option.proposed.placedItems]),
    ]
    expect(records.length).toBeGreaterThan(0)
    expect(records.every((record) => entityLayerId(record) === null)).toBe(true)
    expect(restored.views.every((view) => Object.keys(view.layerSettings ?? {}).length === 0)).toBe(true)
    // Deleting the last layer leaves an order of Unlayered alone, which is the same list the
    // Project order would have produced: no view is left naming a layer that is gone.
    for (const view of restored.views) {
      expect(view.layerOrder === null || view.layerOrder === undefined || view.layerOrder.join() === UNLAYERED_LAYER_KEY).toBe(true)
      expect(view.activeLayerId === null || view.activeLayerId === undefined).toBe(true)
    }
  })
})
