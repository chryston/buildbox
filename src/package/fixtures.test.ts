/**
 * The golden fixtures (#44, #56, #58, #64, #65, #66, #67): `fixtures/package/v1/` through `v7/`
 * are committed, never deleted and never edited. Whatever each says a Backup is, this
 * BuildBox has to keep reading — and keep writing byte for byte, for the version it writes.
 *
 * v1 is the compatibility evidence #44 left behind; #56 made it evidence of a different kind,
 * because a v1 Backup has no Plan Views and staging one has to invent them. v8 is the version this
 * build writes: a Project gained Design Options and Drawing Layers (#69, #71), which is what makes
 * v1 through v7 compatibility evidence rather than something to re-issue.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, sha256Hex } from '../lib'
import { DEFAULT_DRAWING_LAYERS, MIGRATORS, type PlanView, type Project } from '../domain'
import { withClearanceEnvelopes, withElevationViews, withPlanViewRanges } from '../domain/testing'
import { encodeProject } from './encode'
import { migrateDomainProject, stageImport } from './import'
import {
  acknowledgementsFixtureProject,
  allocateIds,
  beamsFixtureProject,
  clearanceFixtureProject,
  commentsFixtureProject,
  elevationFixtureProject,
  FIXTURE_BUILD,
  FIXTURE_EXPORTED_AT,
  FIXTURE_PLAN_IMAGE_HASH,
  fixtureProject,
  legacyFixtureRecord,
  openingsFixtureProject,
  planRangeFixtureProject,
  roomsFixtureProject,
  renovationFixtureProject,
  servicesFixtureProject,
  skirtingFixtureProject,
} from './testing'

const ASSET_ENTRY = `assets/${FIXTURE_PLAN_IMAGE_HASH}.png`

type FixtureVersion = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9' | 'v10' | 'v11' | 'v12' | 'v13' | 'v14' | 'v15'

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
const readV9 = readFrom('v9')
const readV10 = readFrom('v10')
const readV11 = readFrom('v11')
const readV12 = readFrom('v12')
const readV13 = readFrom('v13')
const readV14 = readFrom('v14')
const readV15 = readFrom('v15')

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
// The v9 file is named for what the step added, as the three before it were: it is the first Backup
// whose Plan Views each carry a Vertical Range (#74).
const ARCHIVE_V9 = readV9('plan-range.buildbox')
const ARCHIVE_V10 = readV10('elevation.buildbox')
// The v11 file is named for what the step added, as the four before it were: it is the first
// Backup whose Project carries a Clearance Envelope (#76).
const ARCHIVE_V11 = readV11('clearance.buildbox')
// The v12 file is named for what the step added, as the five before it were: it is the first Backup
// whose Project carries a Beam (#77).
const ARCHIVE_V12 = readV12('beams.buildbox')
// The v13 file is named for what the step added, as the six before it were: it is the first Backup
// whose Project carries a Skirting (#78).
const ARCHIVE_V13 = readV13('skirting.buildbox')
// The v14 file is named for what the step added, as the seven before it were: it is the first Backup
// whose Project carries a Service (#79).
const ARCHIVE_V14 = readV14('services.buildbox')
// The v15 file is named for what the step added, as the eight before it were: it is the first Backup
// whose Project carries a Comment (#80).
const ARCHIVE_V15 = readV15('comments.buildbox')
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
      planViewRange: { lowerMm: 0, upperMm: 2600 },
    })),
  }
}

const canonicalOf = (record: unknown): string => new TextDecoder().decode(canonicalJsonBytes(record))

/**
 * The canonical bytes of a Backup written before the current schema: this build's Project with the
 * named fields taken out — from the Project itself and from both model containers — because the record
 * beside it was written before the steps that added them (#77 §1, #78 §1, #79 §1, #80 §1). A
 * superseded golden keeps the bytes it was written from forever, and those bytes predate the fields the
 * chain grows on the way in — which is what the `stages into` assertion beside each of these says.
 *
 * The three newest steps add a model collection to both containers; the fifteenth adds two fields to
 * the Project itself, so the names are looked for in both places.
 */
function withoutFields(record: unknown, ...names: string[]): unknown {
  const copy = structuredClone(record) as Record<string, unknown>
  const containers = [copy, copy.existingModel as Record<string, unknown> | undefined, ...((copy.designOptions as Record<string, unknown>[] | undefined) ?? []).map((option) => option?.proposed as Record<string, unknown> | undefined)]
  for (const container of containers) {
    if (container === undefined) continue
    for (const name of names) delete container[name]
  }
  return copy
}

const canonicalWithout = (record: unknown, ...names: string[]): string =>
  new TextDecoder().decode(canonicalJsonBytes(withoutFields(record, ...names)))

/** The two fields the fifteenth step adds to the Project itself (#80 §1). */
const COMMENT_FIELDS = ['comments', 'commentReferenceCounter'] as const

/**
 * What a Backup predating the four newest steps lacks: the model collections the three before it grow
 * (#77, #78, #79) and the Comment fields the fifteenth adds (#80).
 */
const PRIOR_FIELDS = ['beams', 'skirting', 'services', ...COMMENT_FIELDS]
const canonicalOfPrior = (record: unknown): string => canonicalWithout(record, ...PRIOR_FIELDS)

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
    elevationViews: [],
    drawingLayers: DEFAULT_DRAWING_LAYERS.map((layer, index) => ({ id: layerId(index), name: layer.name, color: layer.color })),
    existingModel: {
      ...project.existingModel,
      placedItems: filed(project.existingModel.placedItems, furniture!),
      walls: filed(project.existingModel.walls, structure!),
      openings: filed(project.existingModel.openings, structure!),
      rooms: filed(project.existingModel.rooms, structure!),
      // The twelfth step (#77): every model carries the Beam collection, empty for a Project
      // whose Beams nobody has drawn yet — the chain invents no shape, and neither does this.
      beams: [],
      // The thirteenth step (#78), for the same reason: the Skirting collection, empty here.
      skirting: [],
      // The fourteenth step (#79), for the same reason: the Service collection, empty here.
      services: [],
    },
    views: project.views.map((view) => ({
      ...view,
      planViewRange: { lowerMm: 0, upperMm: 2600 },
      designOptionId: null,
      renovationDisplay: 'existing' as const,
      layerSettings: {},
      layerOrder: null,
      activeLayerId: structure!,
      snapToHiddenContent: false,
    })),
    // The eleventh step (#76): every design carries the Clearance Envelope field, null for the
    // designs that have none — the chain invents no shape, and neither does this.
    itemDesigns: project.itemDesigns.map((design) => ({ ...design, clearanceEnvelope: null })),
    // The fifteenth step (#80): every Project carries the Comment collection and its reference
    // counter, both empty — the chain invents no note, and neither does this.
    comments: [],
    commentReferenceCounter: 0,
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
    const canonical = canonicalOfPrior(v1Record())
    // The fixture file carries one trailing newline for a readable diff.
    expect(new TextDecoder().decode(readV1('project.json'))).toBe(`${canonical}\n`)
  })

  it('is described by a manifest that names domain schema v1', async () => {
    const staged = await stageImport(ARCHIVE_V1, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalOfPrior(v1Record()), 1))
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
    const canonical = canonicalOfPrior(legacyFixtureRecord())
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
    const canonical = canonicalOfPrior(v3FixtureRecord())
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
    const canonical = canonicalOfPrior(v4FixtureRecord())
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
    const canonical = canonicalOfPrior(v5FixtureRecord())
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
    const canonical = canonicalOfPrior(v6FixtureRecord())
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
    const canonical = canonicalOfPrior(roomsFixtureProject())
    expect(new TextDecoder().decode(readV7('project.json'))).toBe(`${canonical}\n`)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    const canonical = canonicalOfPrior(roomsFixtureProject())
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

// The eighth golden step, its schema version and the migrator that reads it (#69 §1, architecture
// §11). The file is the production format of this version: an ordinary Backup, staged the way any
// Backup is, and the last case below is the one place that asserts from the outside what a build
// one schema behind answers when it is handed it.
describe('the committed v8 Backup (#69)', () => {
  it('stages into the Project it was written from, read forward one step (#74)', async () => {
    const result = await stageImport(ARCHIVE_V8, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    // The scene comes through untouched. The only thing the ninth step adds is the range each view
    // draws at, taken from the Floor it shows — and this fixture's Floor carries no limits, so both
    // views get the Project-wide default of a Floor structural level to just below the ceiling.
    expect(result.staged.project).toEqual(withClearanceEnvelopes(withElevationViews(withPlanViewRanges(renovationFixtureProject()))))
    expect(result.staged.migratedFrom).toBe(8)
  })

  // Criterion 14: a BuildBox that stops at v7 has no eighth step to read this with, and #20 §5 says
  // what it owes the person — "saved by a newer BuildBox", before a single field is touched.
  it('is refused by a build one schema behind as saved by a newer BuildBox', () => {
    const record = JSON.parse(new TextDecoder().decode(readV8('project.json'))) as unknown
    const v7Reader = migrateDomainProject(record, 8, MIGRATORS.slice(0, 7), 7, allocateIds())
    if (v7Reader.ok) throw new Error('a build at schema v7 read a v8 Project')
    expect(v7Reader.problem).toEqual({ code: 'newer-schema', detail: { detected: 8, supported: 7 } })
  })

  it('keeps the canonical record it was written from, which this build no longer writes', () => {
    // Being re-encoded byte for byte is the property of the Backup at the current schema — the v9
    // file below. What a superseded file owes forever is that its own bytes are the canonical form
    // of the Project they were written from, so the step above is the only thing between them.
    const canonical = canonicalOfPrior(renovationFixtureProject())
    expect(new TextDecoder().decode(readV8('project.json'))).toBe(`${canonical}\n`)
  })

  it('is described by a manifest that names domain schema v8', async () => {
    const staged = await stageImport(ARCHIVE_V8, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalOfPrior(renovationFixtureProject()), 8))
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

// Criterion 14, the ninth schema (#74): what this build says when it is handed a Backup written one
// schema behind. It is no longer the Backup this build writes — the tenth schema is (#75) — so it
// stages *migrated*, which is the compatibility path the file exists to prove.
describe('the committed v9 Backup (#74)', () => {
  it('stages into the Project it was written from, read forward one step (#75)', async () => {
    const result = await stageImport(ARCHIVE_V9, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(withClearanceEnvelopes(withElevationViews(planRangeFixtureProject())))
    expect(result.staged.migratedFrom).toBe(9)
  })

  it('holds the bytes it was written with, and this build writes the tenth schema', async () => {
    // The file on disk is the golden and is never rewritten; what this build encodes is a v10
    // Project, so the byte-for-byte round trip belongs to the v10 fixture below.
    expect(new TextDecoder().decode(readV9('project.json'))).toBe(`${canonicalOfPrior(planRangeFixtureProject())}\n`)
    const encoded = await encodeProject(planRangeFixtureProject(), assetSource, FIXTURE_BUILD)
    expect(encoded).not.toBe(ARCHIVE_V9)
  })

  it('is described by a manifest that names domain schema v9', async () => {
    const staged = await stageImport(ARCHIVE_V9, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalOfPrior(planRangeFixtureProject()), 9))
  })

  // Criterion 14: a BuildBox that stops at v8 has no ninth step to read this with.
  it('is refused by a build one schema behind as saved by a newer BuildBox', () => {
    const record = JSON.parse(new TextDecoder().decode(readV9('project.json'))) as unknown
    const v8Reader = migrateDomainProject(record, 9, MIGRATORS.slice(0, 8), 8, allocateIds())
    if (v8Reader.ok) throw new Error('a build at schema v8 read a v9 Project')
    expect(v8Reader.problem).toEqual({ code: 'newer-schema', detail: { detected: 9, supported: 8 } })
  })

  it('holds a Vertical Range on every Plan View, and two different ones', () => {
    expect(planRangeFixtureProject().views.map((view) => view.planViewRange)).toEqual([
      { lowerMm: 0, upperMm: 2600 },
      { lowerMm: 900, upperMm: 1200 },
    ])
    // The v8 record beside it has none on either view — the step in one comparison.
    const prior = JSON.parse(new TextDecoder().decode(readV8('project.json'))) as { views: object[] }
    expect(prior.views).toHaveLength(2)
    for (const view of prior.views) expect(view).not.toHaveProperty('planViewRange')
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV9(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

// Criterion 14, the tenth schema (#75): the Backup this build writes, and what a build one schema
// behind says when it is handed it.
describe('the committed v10 Backup (#75)', () => {
  it('stages into the Project it was written from, read forward one step (#76)', async () => {
    const result = await stageImport(ARCHIVE_V10, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(withClearanceEnvelopes(elevationFixtureProject()))
    expect(result.staged.migratedFrom).toBe(10)
  })

  it('keeps the canonical record it was written from, which this build no longer writes', () => {
    // Being re-encoded byte for byte is the property of the Backup at the current schema — the v11
    // file below. What a superseded file owes forever is that its own bytes are the canonical form
    // of the Project they were written from, so the step above is the only thing between them.
    expect(new TextDecoder().decode(readV10('project.json'))).toBe(`${canonicalOfPrior(elevationFixtureProject())}\n`)
  })

  it('is described by a manifest that names domain schema v10', async () => {
    const staged = await stageImport(ARCHIVE_V10, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalOfPrior(elevationFixtureProject()), 10))
  })

  // Criterion 14: a BuildBox that stops at v9 has no tenth step to read this with.
  it('is refused by a build one schema behind as saved by a newer BuildBox', () => {
    const record = JSON.parse(new TextDecoder().decode(readV10('project.json'))) as unknown
    const v9Reader = migrateDomainProject(record, 10, MIGRATORS.slice(0, 8), 9, allocateIds())
    if (v9Reader.ok) throw new Error('a build at schema v9 read a v10 Project')
    expect(v9Reader.problem).toEqual({ code: 'newer-schema', detail: { detected: 10, supported: 9 } })
  })

  it('holds two Elevation Views on the Floor, one of them at an angle', () => {
    const views = elevationFixtureProject().elevationViews ?? []
    expect(views.map((view) => [view.name, view.side, view.depth])).toEqual([
      ['Sink elevation', 'left', 2000],
      ['Corner at an angle', 'right', 1500],
    ])
    // Neither view line runs along an axis by accident: the angled one is the reason the record holds
    // two points rather than a place, a length and a direction.
    expect(views[1]!.line).toEqual({ start: { x: 0, y: 0 }, end: { x: 3200, y: 2400 } })
    // The v9 record beside it has no Elevation View list at all — the step in one comparison.
    const prior = JSON.parse(new TextDecoder().decode(readV9('project.json'))) as Record<string, unknown>
    expect(prior).not.toHaveProperty('elevationViews')
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV10(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

// The eleventh schema (#76), now one step behind: the Backup it holds is still read, still byte for
// byte the record it was written from, and no longer what this build writes.
describe('the committed v11 Backup (#76)', () => {
  it('stages into the Project it was written from, read forward one step (#77)', async () => {
    const result = await stageImport(ARCHIVE_V11, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(clearanceFixtureProject())
    expect(result.staged.migratedFrom).toBe(11)
  })

  it('keeps the canonical record it was written from, which this build no longer writes', () => {
    // Being re-encoded byte for byte is the property of the Backup at the current schema — the v12
    // file below. What a superseded file owes forever is that its own bytes are the canonical form
    // of the Project they were written from, so the step above is the only thing between them.
    expect(new TextDecoder().decode(readV11('project.json'))).toBe(`${canonicalOfPrior(clearanceFixtureProject())}\n`)
  })

  it('is described by a manifest that names domain schema v11', async () => {
    const staged = await stageImport(ARCHIVE_V11, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalOfPrior(clearanceFixtureProject()), 11))
  })

  // Criterion 14: a BuildBox that stops at v10 has no eleventh step to read this with.
  it('is refused by a build one schema behind as saved by a newer BuildBox', () => {
    const record = JSON.parse(new TextDecoder().decode(readV11('project.json'))) as unknown
    const v10Reader = migrateDomainProject(record, 11, MIGRATORS.slice(0, 9), 10, allocateIds())
    if (v10Reader.ok) throw new Error('a build at schema v10 read a v11 Project')
    expect(v10Reader.problem).toEqual({ code: 'newer-schema', detail: { detected: 11, supported: 10 } })
  })

  it('holds one Clearance Envelope on the Base Cabinet design and nulls on the rest', () => {
    const designs = clearanceFixtureProject().itemDesigns
    const base = designs.find((design) => design.id === ('design-0' as never))
    expect(base?.clearanceEnvelope).toEqual({
      path: {
        start: { x: 0, y: 560 },
        segments: [
          { kind: 'line', to: { x: 600, y: 560 } },
          { kind: 'line', to: { x: 600, y: 860 } },
          { kind: 'line', to: { x: 0, y: 860 } },
          { kind: 'line', to: { x: 0, y: 560 } },
        ],
      },
      bottomOffset: 0,
      height: 850,
    })
    expect(designs.filter((design) => design.clearanceEnvelope == null)).toHaveLength(designs.length - 1)
    // The v10 record beside it has no envelope field at all — the step in one comparison.
    const prior = JSON.parse(new TextDecoder().decode(readV10('project.json'))) as { itemDesigns: Record<string, unknown>[] }
    expect(prior.itemDesigns[0]).not.toHaveProperty('clearanceEnvelope')
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV11(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

// The twelfth schema (#77), now one step behind: the Backup it holds is still read, still byte for
// byte the record it was written from, and no longer what this build writes.
describe('the committed v12 Backup (#77)', () => {
  it('stages into the Project it was written from, read forward one step (#78)', async () => {
    const result = await stageImport(ARCHIVE_V12, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(beamsFixtureProject())
    expect(result.staged.migratedFrom).toBe(12)
  })

  it('keeps the canonical record it was written from, which this build no longer writes', () => {
    // Being re-encoded byte for byte is the property of the Backup at the current schema — the v13
    // file below. What a superseded file owes forever is that its own bytes are the canonical form
    // of the Project they were written from, so the step above is the only thing between them.
    expect(new TextDecoder().decode(readV12('project.json'))).toBe(`${canonicalWithout(beamsFixtureProject(), 'skirting', 'services', ...COMMENT_FIELDS)}\n`)
  })

  it('is described by a manifest that names domain schema v12', async () => {
    const staged = await stageImport(ARCHIVE_V12, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalWithout(beamsFixtureProject(), 'skirting', 'services', ...COMMENT_FIELDS), 12))
  })

  it('holds one Beam in the Existing Model, and no Beam collection in the record beside it', () => {
    expect(beamsFixtureProject().existingModel.beams).toEqual([
      {
        id: 'beam-1',
        floorId: 'floor-0',
        line: { start: { x: 600, y: 2400 }, end: { x: 3600, y: 2400 } },
        justification: 'centre',
        width: 200,
        underside: 2300,
        height: 300,
        label: 'Beam B-1',
      },
    ])
    // The v11 record beside it has no Beam collection at all — the step in one comparison.
    const prior = JSON.parse(new TextDecoder().decode(readV11('project.json'))) as { existingModel: Record<string, unknown> }
    expect(prior.existingModel).not.toHaveProperty('beams')
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV12(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

// Criterion 14, the thirteenth schema (#78): the Backup this build writes, and what a build one
// schema behind says when it is handed it.
describe('the committed v13 Backup (#78)', () => {
  it('stages into the Project it was written from, read forward one step (#79)', async () => {
    const result = await stageImport(ARCHIVE_V13, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(skirtingFixtureProject())
    expect(result.staged.migratedFrom).toBe(13)
  })

  it('keeps the canonical record it was written from, which this build no longer writes', () => {
    // Being re-encoded byte for byte is the property of the Backup at the current schema — the v14
    // file below. What a superseded file owes forever is that its own bytes are the canonical form of
    // the Project they were written from, minus the Service collection the fourteenth step adds.
    expect(new TextDecoder().decode(readV13('project.json'))).toBe(`${canonicalWithout(skirtingFixtureProject(), 'services', ...COMMENT_FIELDS)}\n`)
  })

  it('is described by a manifest that names domain schema v13', async () => {
    const staged = await stageImport(ARCHIVE_V13, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalWithout(skirtingFixtureProject(), 'services', ...COMMENT_FIELDS), 13))
  })

  // Criterion 14: a BuildBox that stops at v12 has no thirteenth step to read this with.
  it('is refused by a build one schema behind as saved by a newer BuildBox', () => {
    const record = JSON.parse(new TextDecoder().decode(readV13('project.json'))) as unknown
    const v12Reader = migrateDomainProject(record, 13, MIGRATORS.slice(0, 12), 12, allocateIds())
    if (v12Reader.ok) throw new Error('a build at schema v12 read a v13 Project')
    expect(v12Reader.problem).toEqual({ code: 'newer-schema', detail: { detected: 13, supported: 12 } })
  })

  it('holds one Skirting in the Existing Model, and no Skirting collection in the record beside it', () => {
    expect(skirtingFixtureProject().existingModel.skirting).toEqual([
      {
        id: 'skirting-1',
        floorId: 'floor-0',
        hostWallId: 'wall-1',
        side: 'left',
        start: 0,
        end: 4000,
        bottom: 0,
        height: 100,
        thickness: 15,
        label: 'Skirting SK-1',
      },
    ])
    // The v12 record beside it has no Skirting collection at all — the step in one comparison.
    const prior = JSON.parse(new TextDecoder().decode(readV12('project.json'))) as { existingModel: Record<string, unknown> }
    expect(prior.existingModel).not.toHaveProperty('skirting')
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV13(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

// Criterion 26, the fourteenth schema (#79): the Backup this build writes, and what a build one
// schema behind says when it is handed it.
describe('the committed v14 Backup (#79)', () => {
  it('stages into the Project it was written from, read forward one step (#80)', async () => {
    const result = await stageImport(ARCHIVE_V14, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    // The fifteenth step invents no note: the Project that comes forward has the Comment fields and
    // nothing in them.
    expect(result.staged.project).toEqual(servicesFixtureProject())
    expect(result.staged.migratedFrom).toBe(14)
  })

  it('keeps the canonical record it was written from, which this build no longer writes', () => {
    // Being re-encoded byte for byte is the property of the Backup at the current schema — the v15
    // file below. What a superseded file owes forever is that its own bytes are the canonical form of
    // the Project they were written from, minus the Comment collection and its counter that the
    // fifteenth step adds.
    expect(new TextDecoder().decode(readV14('project.json'))).toBe(`${canonicalWithout(servicesFixtureProject(), ...COMMENT_FIELDS)}\n`)
  })

  it('is described by a manifest that names domain schema v14', async () => {
    const staged = await stageImport(ARCHIVE_V14, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalWithout(servicesFixtureProject(), ...COMMENT_FIELDS), 14))
  })

  // A BuildBox that stops at v13 has no fourteenth step to read this with.
  it('is refused by a build one schema behind as saved by a newer BuildBox', () => {
    const record = JSON.parse(new TextDecoder().decode(readV14('project.json'))) as unknown
    const v13Reader = migrateDomainProject(record, 14, MIGRATORS.slice(0, 13), 13, allocateIds())
    if (v13Reader.ok) throw new Error('a build at schema v13 read a v14 Project')
    expect(v13Reader.problem).toEqual({ code: 'newer-schema', detail: { detected: 14, supported: 13 } })
  })

  it('holds every Service shape, one below the Floor Datum, and one owned by a Design Option', () => {
    const services = servicesFixtureProject().existingModel.services ?? []
    expect(services.map((service) => [service.id, service.shape, service.kind])).toEqual([
      ['service-1', 'run', 'water'],
      ['service-2', 'run', 'air_con'],
      ['service-3', 'riser', 'drain'],
      ['service-4', 'run', 'electrical'],
    ])
    // The round Run stores a diameter and no Width; the rectangular one the other way round; the
    // Riser stores a Bottom and a Height and no centreline. None of them stores a Top.
    expect(services[0]).not.toHaveProperty('width')
    expect(services[1]).not.toHaveProperty('outsideDiameter')
    expect(services[2]).not.toHaveProperty('centrelineElevation')
    for (const service of services) expect(service).not.toHaveProperty('top')
    // The below-Datum Service is the one the Plan View Range fades, and its bytes keep the sign.
    expect(services[3]).toMatchObject({ centrelineElevation: -100, outsideDiameter: 100 })
    expect((servicesFixtureProject().designOptions?.[0]?.proposed.services ?? []).map((service) => service.id)).toEqual(['service-5'])
    // The v13 record beside it has no Service collection at all — the step in one comparison.
    const prior = JSON.parse(new TextDecoder().decode(readV13('project.json'))) as { existingModel: Record<string, unknown> }
    expect(prior.existingModel).not.toHaveProperty('services')
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV14(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

// The fifteenth schema (#80): the Backup this build writes, and what a build one schema behind says
// when it is handed it.
describe('the committed v15 Backup (#80)', () => {
  it('stages into the Project it was written from, unmigrated', async () => {
    const result = await stageImport(ARCHIVE_V15, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(commentsFixtureProject())
    expect(result.staged.migratedFrom).toBeNull()
  })

  it('is re-encoded byte for byte by this build', async () => {
    expect(await encodeProject(commentsFixtureProject(), assetSource, FIXTURE_BUILD)).toEqual(ARCHIVE_V15)
    expect(new TextDecoder().decode(readV15('project.json'))).toBe(`${canonicalOf(commentsFixtureProject())}\n`)
  })

  it('is described by a manifest that names domain schema v15', async () => {
    const staged = await stageImport(ARCHIVE_V15, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonicalOf(commentsFixtureProject()), 15))
  })

  // A BuildBox that stops at v14 has no fifteenth step to read this with.
  it('is refused by a build one schema behind as saved by a newer BuildBox', () => {
    const record = JSON.parse(new TextDecoder().decode(readV15('project.json'))) as unknown
    const v14Reader = migrateDomainProject(record, 15, MIGRATORS.slice(0, 14), 14, allocateIds())
    if (v14Reader.ok) throw new Error('a build at schema v14 read a v15 Project')
    expect(v14Reader.problem).toEqual({ code: 'newer-schema', detail: { detected: 15, supported: 14 } })
  })

  it('holds one Comment of every Anchor kind it names, and no Comment field in the record beside it', () => {
    const comments = commentsFixtureProject().comments
    // One reference per Comment, in order, and the counter ahead of every one of them (#80 §1).
    expect(comments.map((comment) => comment.reference)).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-005'])
    expect(commentsFixtureProject().commentReferenceCounter).toBe(5)
    expect(comments.map((comment) => comment.anchor.kind)).toEqual(['project', 'entity', 'feature', 'feature', 'floor_point'])
    // Only the two choosing Anchors store a scope; the three inheriting ones say nothing (#80 §1).
    expect(comments.map((comment) => comment.scope ?? null)).toEqual(['all', null, null, null, 'option-1'])
    // `resolvedAt` exists exactly while the Comment is Resolved.
    expect(comments.filter((comment) => comment.resolvedAt !== undefined).map((comment) => comment.reference)).toEqual(['C-004'])
    // The v14 record beside it has no Comment field at all — the step in one comparison.
    const prior = JSON.parse(new TextDecoder().decode(readV14('project.json'))) as Record<string, unknown>
    expect(prior).not.toHaveProperty('comments')
    expect(prior).not.toHaveProperty('commentReferenceCounter')
  })

  it('carries the same asset, byte for byte', () => {
    expect(readV15(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})
