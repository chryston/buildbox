/**
 * The golden fixtures (#44, #56, #58, #64, #65, #66, #67): `fixtures/package/v1/` through `v7/`
 * are committed, never deleted and never edited. Whatever each says a Backup is, this
 * BuildBox has to keep reading — and keep writing byte for byte, for the version it writes.
 *
 * v1 is the compatibility evidence #44 left behind; #56 made it evidence of a different kind,
 * because a v1 Backup has no Plan Views and staging one has to invent them. v7 is the version
 * this build writes: a Project gained its Room collection (#67), which is what makes v1 through
 * v6 compatibility evidence rather than something to re-issue.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, sha256Hex } from '../lib'
import { DEFAULT_DRAWING_LAYERS, type PlanView, type Project } from '../domain'
import { encodeProject } from './encode'
import { stageImport } from './import'
import {
  acknowledgementsFixtureProject,
  allocateIds,
  FIXTURE_BUILD,
  FIXTURE_EXPORTED_AT,
  FIXTURE_PLAN_IMAGE_HASH,
  fixtureProject,
  legacyFixtureRecord,
  openingsFixtureProject,
  roomsFixtureProject,
  renovationFixtureProject,
} from './testing'

const ASSET_ENTRY = `assets/${FIXTURE_PLAN_IMAGE_HASH}.png`

type FixtureVersion = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8'

const fixtureDir = (version: FixtureVersion): URL => new URL(`../../fixtures/package/${version}/`, import.meta.url)
const readFrom = (version: FixtureVersion) => (relative: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(relative, fixtureDir(version)))))

const readV1 = readFrom('v1')
const readV2 = readFrom('v2')
const readV3 = readFrom('v3')
const readV4 = readFrom('v4')
const readV5 = readFrom('v5')
const readV6 = readFrom('v6')
const readV7 = readFrom('v7')
const readV8 = readFrom('v8')

const ARCHIVE_V1 = readV1('reference.buildbox')
const ARCHIVE_V2 = readV2('reference.buildbox')
const ARCHIVE_V3 = readV3('reference.buildbox')
const ARCHIVE_V4 = readV4('reference.buildbox')
// The v5 file is named for what the step added, not for the reference Project: it is the
// first Backup whose Project carries an Opening (#65).
const ARCHIVE_V5 = readV5('openings.buildbox')
// The v6 file is named for what the step added, as v5's was: it is the first Backup whose
// Project carries a warning acknowledgement (#66).
const ARCHIVE_V6 = readV6('acknowledgements.buildbox')
// The v7 file is named for what the step added, as v5's and v6's were: it is the first Backup
// whose Project carries a Room (#67).
const ARCHIVE_V7 = readV7('rooms.buildbox')
// The v8 file is named for what the step added, as v5's, v6's and v7's were: it is the first Backup
// whose Project carries a Design Option, and the first written by a preview build (#69).
const ARCHIVE_V8 = readV8('renovation.buildbox')
const ASSET_BYTES = readV2(ASSET_ENTRY)

/** The one Plan Image every fixture carries, served the way the export serves it. */
const assetSource = async (): Promise<{ bytes: Uint8Array; mediaType: string }> => ({
  bytes: ASSET_BYTES,
  mediaType: 'image/png',
})

/** The record the v1 file was written from: no Plan Views (#56), pre-v3 footprints (#58). */
function v1Record(): unknown {
  const record = legacyFixtureRecord()
  if (record === null || typeof record !== 'object' || !('views' in record)) {
    throw new Error('the fixture record must carry views')
  }
  const withoutViews = { ...record, views: undefined }
  delete withoutViews.views
  return withoutViews
}

/** What staging that file has to produce: the current Project, plus one default view per Floor. */
function v1StagedAsViews(): Project {
  const project = fixtureProject()
  return {
    ...project,
    views: project.floors.map((floor, index): PlanView => ({
      id: `migrated-${index + 1}`,
      kind: 'plan',
      floorId: floor.id,
      name: floor.name,
      isDefault: true,
      showPlanImage: true,
    })),
  }
}

const canonicalOf = (record: unknown): string => new TextDecoder().decode(canonicalJsonBytes(record))

/**
 * What this build's current schema asks of a Project that has no Design Option of its own: the
 * record a Backup holds, plus everything the eighth step adds (#73 criterion 14) — an empty
 * `designOptions`, the three default Drawing Layers, every entity filed on the layer its subtype
 * belongs to (Walls, Openings and Rooms on `Structure`, Placed Items on `Furniture`), and the four
 * view fields that carry a Display, a layer stack and the snapping switch.
 *
 * `spent` is how many IDs the chain had already issued when the eighth step ran: a v1 file spends
 * one per Floor on the default Plan Views it grows, so its layers are numbered after them.
 */
function atCurrentSchema(project: Project, spent = 0): Project {
  const layerId = (index: number): string => `migrated-${String(spent + index + 1)}`
  const [structure, , furniture] = [layerId(0), layerId(1), layerId(2)] as const
  const filed = <T extends { id: string }>(entries: readonly T[], drawingLayerId: string): T[] =>
    entries.map((entry) => ({ ...entry, drawingLayerId }))
  return {
    ...project,
    designOptions: [],
    drawingLayers: DEFAULT_DRAWING_LAYERS.map((layer, index) => ({ id: layerId(index), name: layer.name, color: layer.color })),
    existingModel: {
      ...project.existingModel,
      placedItems: filed(project.existingModel.placedItems, furniture!),
      walls: filed(project.existingModel.walls, structure!),
      openings: filed(project.existingModel.openings, structure!),
      rooms: filed(project.existingModel.rooms, structure!),
    },
    views: project.views.map((view) => ({
      ...view,
      designOptionId: null,
      renovationDisplay: 'existing' as const,
      layerSettings: {},
      layerOrder: null,
      activeLayerId: structure!,
      snapToHiddenContent: false,
    })),
  }
}

const manifestOf = async (canonical: string, domainSchemaVersion: number) => ({
  format: 'buildbox-project',
  packageVersion: 1,
  domainSchemaVersion,
  projectId: 'project-0',
  exportedAt: FIXTURE_BUILD.exportedAt,
  buildboxVersion: '0.0.0',
  entries: [
    {
      path: 'project.json',
      mediaType: 'application/json',
      byteLength: new TextEncoder().encode(canonical).length,
      sha256: await sha256Hex(new TextEncoder().encode(canonical)),
    },
    { path: ASSET_ENTRY, mediaType: 'image/png', byteLength: ASSET_BYTES.length, sha256: FIXTURE_PLAN_IMAGE_HASH },
  ],
})

/** The record the v3 file was written from: the current Project without the v4 additions. */
function v3FixtureRecord(): unknown {
  const project = fixtureProject()
  const preferences: Record<string, unknown> = { ...project.preferences }
  delete preferences.defaultWallHeight
  const existingModel: Record<string, unknown> = { placedItems: project.existingModel.placedItems }
  const record: Record<string, unknown> = { ...project, preferences, existingModel }
  delete record.warningAcknowledgements
  return record
}

/** The record the v4 file was written from: the current Project without the v5 addition. */
function v4FixtureRecord(): Project {
  const project = fixtureProject()
  const existingModel: Record<string, unknown> = { ...project.existingModel }
  delete existingModel.openings
  delete existingModel.rooms
  const record: Record<string, unknown> = { ...project, existingModel }
  delete record.warningAcknowledgements
  return record as unknown as Project
}

/** The record the v5 file was written from: the current Project without the v6 addition. */
function v5FixtureRecord(): Project {
  const project = openingsFixtureProject()
  const existingModel: Record<string, unknown> = { ...project.existingModel }
  delete existingModel.rooms
  const record: Record<string, unknown> = { ...project, existingModel }
  delete record.warningAcknowledgements
  return record as unknown as Project
}

/** The record the v6 file was written from: the current Project without the v7 addition. */
function v6FixtureRecord(): Project {
  const project = acknowledgementsFixtureProject()
  const existingModel: Record<string, unknown> = { ...project.existingModel }
  delete existingModel.rooms
  return { ...project, existingModel } as unknown as Project
}

describe('the committed v1 Backup', () => {
  it('stages into the current Project, with one default Plan View per Floor (#56)', async () => {
    const result = await stageImport(ARCHIVE_V1, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(atCurrentSchema(v1StagedAsViews(), fixtureProject().floors.length))
    expect(result.staged.migratedFrom).toBe(1)
    expect(result.staged.manifest.entries.map((entry) => entry.path)).toEqual(['project.json', ASSET_ENTRY])
    expect([...result.staged.assets.keys()]).toEqual([FIXTURE_PLAN_IMAGE_HASH])
    expect(result.staged.assets.get(FIXTURE_PLAN_IMAGE_HASH)?.mediaType).toBe('image/png')
  })

  it('holds the canonical Project record it was written from, and nothing else', () => {
    const canonical = canonicalOf(v1Record())
    // The fixture file carries one trailing newline for a readable diff.
    expect(new TextDecoder().decode(readV1('project.json'))).toBe(`${canonical}\n`)
  })

  it('is described by a manifest that names domain schema v1', async () => {
    const staged = await stageImport(ARCHIVE_V1, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalOf(v1Record()), 1))
  })

  it('carries an asset that still hashes to its own name', async () => {
    expect(await sha256Hex(ASSET_BYTES)).toBe(FIXTURE_PLAN_IMAGE_HASH)
    expect(readV1(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

describe('the committed v2 Backup (#56)', () => {
  it('stages into the current Project, restating every footprint (#58)', async () => {
    const result = await stageImport(ARCHIVE_V2, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(atCurrentSchema(fixtureProject()))
    // v2 is no longer the current schema: staging it runs the one step #58 added.
    expect(result.staged.migratedFrom).toBe(2)
  })

  it('holds the canonical Project record it was written from, and nothing else', async () => {
    // The pre-v3 record: an Item Footprint was a kind, a width and a depth. The file is
    // compatibility evidence, so it keeps the bytes it was written from.
    const canonical = canonicalOf(legacyFixtureRecord())
    expect(new TextDecoder().decode(readV2('project.json'))).toBe(`${canonical}\n`)

    const staged = await stageImport(ARCHIVE_V2, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonical, 2))
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV2(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

describe('the committed v3 Backup (#58)', () => {
  it('stages into the current Project, gaining the Wall fields (#64)', async () => {
    const result = await stageImport(ARCHIVE_V3, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(atCurrentSchema(fixtureProject()))
    // v3 is no longer the current schema: staging it runs the one step #64 added.
    expect(result.staged.migratedFrom).toBe(3)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    // The pre-v4 record: no default Wall height and no Wall collections. The file is
    // compatibility evidence, so it keeps the bytes it was written from.
    const canonical = canonicalOf(v3FixtureRecord())
    expect(new TextDecoder().decode(readV3('project.json'))).toBe(`${canonical}\n`)

    const staged = await stageImport(ARCHIVE_V3, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonical, 3))
  })

  it('stores a footprint as a preset, which is what the whole step was for', () => {
    const record = fixtureProject().itemDesigns.find((design) => design.id === 'design-2')
    if (record === undefined || record.kind !== 'generic') throw new Error('the fixture must carry design-2')
    expect(record.footprint).toEqual({
      kind: 'preset',
      preset: { kind: 'rectangle', width: 1820, depth: 1980 },
      centre: { x: 910, y: 990 },
      orientationDeg: 0,
    })
  })
})

describe('the committed v4 Backup (#64)', () => {
  it('stages into the current Project, gaining the empty Opening collection (#65)', async () => {
    const result = await stageImport(ARCHIVE_V4, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(atCurrentSchema(fixtureProject()))
    expect(result.staged.migratedFrom).toBe(4)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    const canonical = canonicalOf(v4FixtureRecord())
    expect(new TextDecoder().decode(readV4('project.json'))).toBe(`${canonical}\n`)

    const staged = await stageImport(ARCHIVE_V4, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonical, 4))
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV4(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })

  it('names the two Wall collections, which is what the whole step was for', () => {
    const record = fixtureProject()
    // A Project with no Walls yet is a valid v4 Project: the collections exist and are empty,
    // and `defaultWallHeight` is stored rather than implied.
    expect(record.existingModel.walls).toEqual([])
    expect(record.existingModel.wallJunctions).toEqual([])
    expect(record.preferences.defaultWallHeight).toBe(2600)
    // The v3 record beside it carries neither, which is the whole step in one comparison.
    const prior = v3FixtureRecord() as { preferences: Record<string, unknown>; existingModel: Record<string, unknown> }
    expect(prior.preferences).not.toHaveProperty('defaultWallHeight')
    expect(prior.existingModel).not.toHaveProperty('walls')
  })
})

describe('the committed v5 Backup (#65)', () => {
  it('stages into the current Project, with an empty Acknowledgement list', async () => {
    const result = await stageImport(ARCHIVE_V5, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(atCurrentSchema(openingsFixtureProject()))
    expect(result.staged.migratedFrom).toBe(5)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    const canonical = canonicalOf(v5FixtureRecord())
    expect(new TextDecoder().decode(readV5('project.json'))).toBe(`${canonical}\n`)

    const staged = await stageImport(ARCHIVE_V5, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonical, 5))
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV5(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })

  it('carries a door cut into a Wall, which is what the whole step was for', () => {
    const record = openingsFixtureProject()
    expect(record.existingModel.openings).toHaveLength(1)
    expect(record.existingModel.openings[0]?.hostWallId).toBe('wall-1')
    // The v4 record beside it has no Opening collection at all — the step in one comparison.
    expect(v4FixtureRecord().existingModel).not.toHaveProperty('openings')
  })
})

describe('the committed v6 Backup (#66)', () => {
  it('stages into the current Project, gaining the empty Room collection (#67)', async () => {
    const result = await stageImport(ARCHIVE_V6, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(atCurrentSchema(acknowledgementsFixtureProject()))
    // v6 is no longer the current schema: staging it runs the one step #67 added.
    expect(result.staged.migratedFrom).toBe(6)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    const canonical = canonicalOf(v6FixtureRecord())
    expect(new TextDecoder().decode(readV6('project.json'))).toBe(`${canonical}\n`)

    const staged = await stageImport(ARCHIVE_V6, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonical, 6))
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV6(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })

  it('carries the acknowledgement of a crossing, which is what the whole step was for', () => {
    const record = acknowledgementsFixtureProject()
    expect(record.warningAcknowledgements).toEqual([
      {
        id: 'acknowledgement-1',
        warningType: 'wall_crossing',
        subjectIds: ['wall-1', 'wall-2'],
        designOptionId: null,
        signature: '8db57272e5b2adb2',
        note: 'A flue passes through here; the crossing is intended.',
        acknowledgedAt: FIXTURE_EXPORTED_AT,
      },
    ])
    // The signature is written down, not recomputed: `package` may not reach `derive`, and
    // that is the point — the day the signature algorithm moves, this fixture is what proves
    // an old decision is still read unchanged, and shown as reopened rather than lost.
    expect(v5FixtureRecord()).not.toHaveProperty('warningAcknowledgements')
  })
})

describe('the committed v7 Backup (#67)', () => {
  it('stages into the Project it was written from', async () => {
    const result = await stageImport(ARCHIVE_V7, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${result.problem}`)
    expect(result.staged.project).toEqual(atCurrentSchema(roomsFixtureProject()))
    // v7 is one step behind the current schema now, so staging runs the eighth step: the empty Option
    // list, the three default layers and the filing (#73).
    expect(result.staged.migratedFrom).toBe(7)
  })

  // This build writes v8, so "re-encoded byte for byte" is the v8 Backup's property, not this file's.
  // What stays true of a v7 Backup is the bytes it holds: a migration reads them and stages a newer
  // Project, it never rewrites the file.
  it('holds the record it was written from, byte for byte', async () => {
    const canonical = canonicalOf(roomsFixtureProject())
    expect(new TextDecoder().decode(readV7('project.json'))).toBe(`${canonical}\n`)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    const canonical = canonicalOf(roomsFixtureProject())
    const staged = await stageImport(ARCHIVE_V7, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonical, 7))
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV7(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })

  it('carries two Rooms referenced to opposite faces of one Wall, which is what the step was for', () => {
    const record = roomsFixtureProject()
    expect(record.existingModel.rooms.map((room) => room.name)).toEqual(['Living', 'Study'])
    expect(record.existingModel.rooms[0]?.wallFaceRefs).toEqual([{ segmentId: 'edge-living-3', wallId: 'wall-1', side: 'left' }])
    expect(record.existingModel.rooms[1]?.wallFaceRefs).toEqual([{ segmentId: 'edge-study-1', wallId: 'wall-1', side: 'right' }])
    // The v6 record beside it has no Room collection at all — the step in one comparison.
    expect(v6FixtureRecord().existingModel).not.toHaveProperty('rooms')
  })
})

// The eighth golden step exists only in a `VITE_FF_RENOVATION` build, with the schema version and
// the migrator that read it (#69 §1, architecture §11). A flag-off run neither runs nor misses it:
// the file is on disk either way, and refusing to open it is that build's correct behaviour, which
// the last case below is the one place that asserts it from the outside.
describe('the committed v8 Backup (#69)', () => {
  it('stages into the Project it was written from, unmigrated', async () => {
    const result = await stageImport(ARCHIVE_V8, { acceptPreview: true, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(renovationFixtureProject())
    expect(result.staged.migratedFrom).toBeNull()
  })

  it('is a preview package, which a build that does not accept previews refuses', async () => {
    const result = await stageImport(ARCHIVE_V8, { acceptPreview: false, allocateId: allocateIds() })
    if (result.ok) throw new Error('a preview package staged without being accepted as one')
    expect(result.problem.code).toBe('preview-package')
  })

  it('is re-encoded byte for byte by this build', async () => {
    expect(await encodeProject(renovationFixtureProject(), assetSource, { ...FIXTURE_BUILD, preview: true })).toEqual(ARCHIVE_V8)
    const canonical = canonicalOf(renovationFixtureProject())
    expect(new TextDecoder().decode(readV8('project.json'))).toBe(`${canonical}\n`)
  })

  it('is described by a manifest that names domain schema v8 and says it is a preview', async () => {
    const staged = await stageImport(ARCHIVE_V8, { acceptPreview: true, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual({
      ...(await manifestOf(canonicalOf(renovationFixtureProject()), 8)),
      preview: true,
    })
  })

  it('carries the whole feature in bytes: two Options, a replace, a demolition, four layers, two views', () => {
    const record = renovationFixtureProject()
    expect(record.designOptions?.map((option) => option.name)).toEqual(['Open plan', 'Store wall'])
    // A replace demolishes an Existing Placed Item and proposes its successor; a demolition only
    // demolishes. A Demolition sheet says something different about each, so the fixture holds one.
    const [replace, demolition] = record.designOptions!
    expect(replace!.demolishedIds).toEqual(['place-1'])
    expect(replace!.proposed.placedItems.map((item) => [item.id, item.predecessorIds])).toEqual([['place-4', ['place-1']]])
    expect(demolition!.demolishedIds).toEqual(['wall-2'])
    expect(demolition!.proposed.placedItems).toEqual([])
    // The three layers every Project starts with, plus one a person made, with the content filed.
    expect(record.drawingLayers?.map((layer) => layer.name)).toEqual(['Structure', 'Services', 'Furniture', 'Finishes'])
    expect(record.existingModel.walls.map((wall) => wall.drawingLayerId)).toEqual(['layer-1', 'layer-1'])
    expect(record.existingModel.rooms.map((room) => room.drawingLayerId)).toEqual(['layer-1', 'layer-1'])
    expect(record.existingModel.placedItems.map((item) => item.drawingLayerId)).toEqual([
      'layer-3',
      'layer-3',
      'layer-3',
      'layer-4',
    ])
    // One view says nothing about any layer and looks at the Existing Model; the other overrides
    // every field the eighth schema gave a view and looks at the world through an Option.
    const [zero, overridden] = record.views
    expect([
      zero!.designOptionId,
      zero!.renovationDisplay,
      zero!.layerSettings,
      zero!.layerOrder,
      zero!.activeLayerId,
      zero!.snapToHiddenContent,
    ]).toEqual([null, 'existing', {}, null, 'layer-1', false])
    expect(Object.keys(overridden!.layerSettings!).sort()).toEqual(['layer-3', 'layer-4', 'unlayered'])
    expect([
      overridden!.designOptionId,
      overridden!.renovationDisplay,
      overridden!.layerOrder,
      overridden!.activeLayerId,
      overridden!.snapToHiddenContent,
    ]).toEqual(['option-1', 'combined', ['layer-4', 'layer-3', 'layer-2', 'layer-1', 'unlayered'], 'layer-4', true])
    expect(overridden!.layerSettings!['layer-4']).toEqual({ visible: false, selectable: false, editable: false, color: '#3f7fa6' })
    // The v7 record beside it has none of this — the step in one comparison.
    expect(roomsFixtureProject()).not.toHaveProperty('designOptions')
    expect(roomsFixtureProject()).not.toHaveProperty('drawingLayers')
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV8(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})
