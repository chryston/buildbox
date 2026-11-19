/**
 * The golden fixtures (#44, #56, #58): `fixtures/package/v1/`, `v2/` and `v3/` are committed,
 * never deleted and never edited. Whatever each says a Backup is, this BuildBox has to keep
 * reading — and keep writing byte for byte, for the version it writes.
 *
 * v1 is the compatibility evidence #44 left behind; #56 made it evidence of a different kind,
 * because a v1 Backup has no Plan Views and staging one has to invent them. v3 is the version
 * this build writes: an Item Footprint became a preset or a Custom Path (#58), which is what
 * makes v1 and v2 compatibility evidence rather than something to re-issue.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, sha256Hex } from '../lib'
import type { PlanView, Project } from '../domain'
import { encodeProject } from './encode'
import { stageImport } from './import'
import {
  allocateIds,
  FIXTURE_BUILD,
  FIXTURE_PLAN_IMAGE_HASH,
  fixtureProject,
  legacyFixtureRecord,
} from './testing'

const ASSET_ENTRY = `assets/${FIXTURE_PLAN_IMAGE_HASH}.png`

type FixtureVersion = 'v1' | 'v2' | 'v3'

const fixtureDir = (version: FixtureVersion): URL => new URL(`../../fixtures/package/${version}/`, import.meta.url)
const readFrom = (version: FixtureVersion) => (relative: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(relative, fixtureDir(version)))))

const readV1 = readFrom('v1')
const readV2 = readFrom('v2')
const readV3 = readFrom('v3')

const ARCHIVE_V1 = readV1('reference.buildbox')
const ARCHIVE_V2 = readV2('reference.buildbox')
const ARCHIVE_V3 = readV3('reference.buildbox')
const ASSET_BYTES = readV2(ASSET_ENTRY)
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

describe('the committed v1 Backup', () => {
  it('stages into the current Project, with one default Plan View per Floor (#56)', async () => {
    const result = await stageImport(ARCHIVE_V1, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(v1StagedAsViews())
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
    expect(result.staged.project).toEqual(fixtureProject())
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
  it('stages into the Project it was written from, unmigrated', async () => {
    const result = await stageImport(ARCHIVE_V3, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(fixtureProject())
    expect(result.staged.migratedFrom).toBeNull()
  })

  it('is re-encoded byte for byte by this build', async () => {
    expect(await encodeProject(fixtureProject(), assetSource, FIXTURE_BUILD)).toEqual(ARCHIVE_V3)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    const canonical = canonicalOf(fixtureProject())
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
