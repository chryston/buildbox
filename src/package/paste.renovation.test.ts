//>ff
/**
 * The two Projects of a cross-Project paste (#72 criterion 1) as fixtures: that they survive the
 * codec, and that they say what the browser tier is about to depend on them saying.
 *
 * Both files are transcripts of real Intents (`scripts/make-paste-seed.ts`), so what round-trips
 * here is a pair of Projects the editor could have written. The second half matters more than the
 * round-trip: the e2e names `Tall pantry`, expects `Services` to be missing from the destination so
 * that `Create “Services” here` is the only honest answer, and expects the destination's Combined
 * view to be a display a paste is allowed into. A fixture that drifted from any of that would leave
 * the e2e asserting a scene that no longer exists, which is worse than no e2e.
 */
import { describe, expect, it } from 'vitest'
import { currentSchemaOf, withElevationViews } from '../domain/testing'
import fitoutFixture from '../../fixtures/domain/v9/paste-fitout.json?raw'
import elmFixture from '../../fixtures/domain/v9/paste-elm.json?raw'
import pairSeed from '../../fixtures/e2e/preview-seed/paste-pair.json?raw'
import type { EntityId, Project } from '../domain'
import { entityLayerId } from '../domain'
import { canonicalJson } from '../lib'
import { referencedAssetHashes } from './assets'
import { encodeProject, type AssetSource } from './encode'
import { stageImport } from './import'
import { allocateIds, FIXTURE_BUILD } from './testing'

const project = (raw: string): Project => (JSON.parse(raw) as { domainSchemaVersion: number; project: Project }).project
const fitout = project(fitoutFixture)
const elm = project(elmFixture)

interface Seed {
  dbName: string
  projects: { id: string; schemaVersion: number; data: Project }[]
  library: { id: string; name: string }[]
  assets: { sha256: string; mediaType: string; base64: string }[]
}
const pair = JSON.parse(pairSeed) as Seed

/**
 * The Plan Image both Projects reference, from the seed that carries it: the store is
 * content-addressed, so a restore refuses anything but the bytes that hash to it.
 */
const ASSETS = new Map(
  pair.assets.map((asset) => [
    asset.sha256,
    { bytes: new Uint8Array(Buffer.from(asset.base64, 'base64')), mediaType: asset.mediaType as 'image/png' },
  ]),
)

const assets: AssetSource = async (hash) => {
  const asset = ASSETS.get(hash)
  if (asset === undefined) throw new Error(`the asset store holds no ${hash}`)
  return asset
}

async function restore(source: Project): Promise<Project> {
  const result = await stageImport(await encodeProject(source, assets, FIXTURE_BUILD), { acceptPreview: false, allocateId: allocateIds() })
  if (!result.ok) throw new Error(`the restore was refused: ${result.problem.code} ${JSON.stringify(result.problem)}`)
  expect(result.staged.migratedFrom).toBeNull()
  expect([...result.staged.assets.keys()]).toEqual(referencedAssetHashes(source))
  return result.staged.project
}

/** The copy of criterion 1, by the name the canvas draws and the layer the review will ask about. */
const COPIED: readonly [EntityId, string, string | null][] = [
  ['seed-003', 'Tall pantry', 'Furniture'],
  ['fp-fridge', 'Dishwasher', 'Furniture'],
  ['seed-item-028', 'GPO-9', 'Services'],
  ['fp-sofa', 'Dining chair', null],
]

const itemName = (source: Project, itemId: EntityId): string => {
  const item = source.existingModel.placedItems.find((row) => row.id === itemId)
  if (item === undefined) throw new Error(`no Placed Item is ${itemId}`)
  return source.itemDesigns.find((design) => design.id === item.itemDesignId)?.name ?? ''
}

const layerName = (source: Project, itemId: EntityId): string | null => {
  const item = source.existingModel.placedItems.find((row) => row.id === itemId)
  const layerId = item === undefined ? undefined : entityLayerId(item)
  return source.drawingLayers?.find((layer) => layer.id === layerId)?.name ?? null
}

describe('the paste pair round-trips through the codec (#72 criterion 1)', () => {
  it('restores both Projects byte for byte', async () => {
    expect(canonicalJson(await restore(fitout))).toBe(canonicalJson(fitout))
    expect(canonicalJson(await restore(elm))).toBe(canonicalJson(elm))
  })

  it('keeps the copy’s items on the layers the review will name', async () => {
    const restored = await restore(fitout)
    expect(COPIED.map(([id]) => [itemName(restored, id), layerName(restored, id)])).toEqual([
      ['Tall pantry', 'Furniture'],
      ['Dishwasher', 'Furniture'],
      ['GPO-9', 'Services'],
      ['Dining chair', null],
    ])
    // Unlayered is a state the codec carries, not an absent field the restore can invent: the copy
    // says "1 Unlayered entity" and that count comes from exactly this record.
    expect(entityLayerId(fitout.existingModel.placedItems.find((row) => row.id === 'fp-sofa')!)).toBeNull()
  })

  it('keeps the destination without the layer the copy brings', async () => {
    const restored = await restore(elm)
    expect(restored.drawingLayers?.map((layer) => layer.name)).toEqual(['Furniture', 'Structure'])
    expect(restored.drawingLayers?.map((layer) => layer.name)).not.toContain('Services')
  })
})

describe('the pair is the scene the browser tier drives (#72 criterion 1)', () => {
  it('holds two Projects the Library can offer separately', () => {
    expect(pair.projects.map((record) => record.id)).toEqual(['proj-paste-fitout', 'proj-paste-elm'])
    expect(pair.library.map((row) => [row.id, row.name])).toEqual([
      ['proj-paste-fitout', 'Unit 4 Fitout'],
      ['proj-paste-elm', '14 Elm St'],
    ])
    expect(fitout.meta.name).toBe('Unit 4 Fitout')
    expect(elm.meta.name).toBe('14 Elm St')
    expect(fitout.id).not.toBe(elm.id)
  })

  it('carries the same bytes the domain fixtures hold', () => {
    // The e2e and the domain tests read the same Project, or the e2e is testing a different scene
    // than the one the paste was reasoned about against. The domain goldens beside them were written
    // at v9, before the Elevation View list existed, so the read-forward carries the empty one the
    // tenth step writes (#75).
    expect(currentSchemaOf(pair.projects[0]!.data, 8)).toEqual(withElevationViews(fitout))
    expect(currentSchemaOf(pair.projects[1]!.data, 8)).toEqual(withElevationViews(elm))
    expect(pair.projects.every((record) => record.schemaVersion === 8)).toBe(true)
  })

  it('opens the destination on a display a paste is allowed into', () => {
    const view = elm.views.find((each) => each.name === 'Option A · Combined')
    expect(view).toBeDefined()
    expect(view?.designOptionId).not.toBeNull()
    expect(view?.renovationDisplay).toBe('combined')
    // And the source still has a plain view, which is where the copy is made from.
    expect(fitout.views.some((each) => (each.designOptionId ?? null) === null && each.renovationDisplay === undefined)).toBe(true)
  })
})
