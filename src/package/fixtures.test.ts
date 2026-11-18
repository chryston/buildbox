/**
 * The golden fixtures (#44, #56): `fixtures/package/v1/` and `fixtures/package/v2/` are
 * committed, never deleted and never edited. Whatever each says a Backup is, this BuildBox
 * has to keep reading — and keep writing byte for byte, for the version it writes.
 *
 * v1 is the compatibility evidence #44 left behind; #56 made it evidence of a different
 * kind, because a v1 Backup has no Plan Views and staging one has to invent them.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, sha256Hex } from '../lib'
import type { PlanView, Project } from '../domain'
import { encodeProject } from './encode'
import { stageImport } from './import'
import { allocateIds, FIXTURE_BUILD, FIXTURE_PLAN_IMAGE_HASH, fixtureProject } from './testing'

const ASSET_ENTRY = `assets/${FIXTURE_PLAN_IMAGE_HASH}.png`

const fixtureDir = (version: 'v1' | 'v2'): URL => new URL(`../../fixtures/package/${version}/`, import.meta.url)
const readFrom = (version: 'v1' | 'v2') => (relative: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(relative, fixtureDir(version)))))

const readV1 = readFrom('v1')
const readV2 = readFrom('v2')

const ARCHIVE_V1 = readV1('reference.buildbox')
const ARCHIVE_V2 = readV2('reference.buildbox')
const ASSET_BYTES = readV2(ASSET_ENTRY)
const assetSource = async (): Promise<{ bytes: Uint8Array; mediaType: string }> => ({
  bytes: ASSET_BYTES,
  mediaType: 'image/png',
})

/** The Project the v1 fixture was written from, before #56 gave every Floor a Plan View. */
function v1Project(): Project {
  const record: Record<string, unknown> = { ...fixtureProject() }
  delete record.views
  return record as unknown as Project
}

/** What staging that file has to produce: the same Project, plus one default view per Floor. */
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
    const canonical = new TextDecoder().decode(canonicalJsonBytes(v1Project()))
    // The fixture file carries one trailing newline for a readable diff.
    expect(new TextDecoder().decode(readV1('project.json'))).toBe(`${canonical}\n`)
  })

  it('is described by a manifest that names domain schema v1', async () => {
    const staged = await stageImport(ARCHIVE_V1, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    const canonical = new TextDecoder().decode(canonicalJsonBytes(v1Project()))
    expect(staged.staged.manifest).toEqual(await manifestOf(canonical, 1))
  })

  it('carries an asset that still hashes to its own name', async () => {
    expect(await sha256Hex(ASSET_BYTES)).toBe(FIXTURE_PLAN_IMAGE_HASH)
    expect(readV1(ASSET_ENTRY)).toEqual(ASSET_BYTES)
  })
})

describe('the committed v2 Backup (#56)', () => {
  it('stages into the Project it was written from, unmigrated', async () => {
    const result = await stageImport(ARCHIVE_V2, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(fixtureProject())
    expect(result.staged.migratedFrom).toBeNull()
  })

  it('is re-encoded byte for byte by this build', async () => {
    expect(await encodeProject(fixtureProject(), assetSource, FIXTURE_BUILD)).toEqual(ARCHIVE_V2)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    const canonical = new TextDecoder().decode(canonicalJsonBytes(fixtureProject()))
    expect(new TextDecoder().decode(readV2('project.json'))).toBe(`${canonical}\n`)

    const staged = await stageImport(ARCHIVE_V2, { acceptPreview: false, allocateId: allocateIds() })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual(await manifestOf(canonical, 2))
  })
})
