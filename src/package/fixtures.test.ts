/**
 * The golden fixture (#44): `fixtures/package/v1/` is committed, never deleted and never
 * edited. Whatever it says a v1 Backup is, this BuildBox has to keep reading and keep
 * writing byte for byte.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, sha256Hex } from '../lib'
import { encodeProject } from './encode'
import { stageImport } from './import'
import { FIXTURE_BUILD, FIXTURE_PLAN_IMAGE_HASH, fixtureProject } from './testing'

const FIXTURES = new URL('../../fixtures/package/v1/', import.meta.url)
const read = (relative: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(relative, FIXTURES))))

const ARCHIVE = read('reference.buildbox')
const ASSET_ENTRY = `assets/${FIXTURE_PLAN_IMAGE_HASH}.png`
const ASSET_BYTES = read(ASSET_ENTRY)
const assetSource = async (): Promise<{ bytes: Uint8Array; mediaType: string }> => ({
  bytes: ASSET_BYTES,
  mediaType: 'image/png',
})

describe('the committed v1 Backup', () => {
  it('stages into the Project it was written from', async () => {
    const result = await stageImport(ARCHIVE, { acceptPreview: false })
    if (!result.ok) throw new Error(`${result.problem.code}: ${JSON.stringify(result.problem)}`)
    expect(result.staged.project).toEqual(fixtureProject())
    expect(result.staged.migratedFrom).toBeNull()
    expect(result.staged.manifest.entries.map((entry) => entry.path)).toEqual(['project.json', ASSET_ENTRY])
    expect([...result.staged.assets.keys()]).toEqual([FIXTURE_PLAN_IMAGE_HASH])
    expect(result.staged.assets.get(FIXTURE_PLAN_IMAGE_HASH)?.mediaType).toBe('image/png')
  })

  it('is re-encoded byte for byte by this build', async () => {
    expect(await encodeProject(fixtureProject(), assetSource, FIXTURE_BUILD)).toEqual(ARCHIVE)
  })

  it('holds the canonical Project record, and nothing else', async () => {
    const canonical = new TextDecoder().decode(canonicalJsonBytes(fixtureProject()))
    // The fixture file carries one trailing newline for a readable diff; the archive
    // entry is the canonical bytes alone.
    expect(new TextDecoder().decode(read('project.json'))).toBe(`${canonical}\n`)

    const staged = await stageImport(ARCHIVE, { acceptPreview: false })
    if (!staged.ok) throw new Error('the fixture must stage')
    expect(staged.staged.manifest).toEqual({
      format: 'buildbox-project',
      packageVersion: 1,
      domainSchemaVersion: 1,
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
        {
          path: ASSET_ENTRY,
          mediaType: 'image/png',
          byteLength: ASSET_BYTES.length,
          sha256: FIXTURE_PLAN_IMAGE_HASH,
        },
      ],
    })
  })

  it('carries an asset that still hashes to its own name', async () => {
    expect(await sha256Hex(ASSET_BYTES)).toBe(FIXTURE_PLAN_IMAGE_HASH)
  })
})
