/**
 * `encodeProject` and the layout it writes (#44 §"Layout written by `encodeProject`"):
 * entry order, the manifest's claims, and the rule that the only thing not derived from
 * the Project is the timestamp the caller hands in.
 */
import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, readZipIndex, sha256Hex, unzipEntries, type ZipLimits } from '../lib'
import type { Project } from '../domain'
import { encodeProject, type AssetSource } from './encode'
import { FIXTURE_BUILD, fixtureProject } from './testing'

const READ_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxEntryBytes: 52_428_800,
  maxTotalBytes: 262_144_000,
  maxRatio: 1_000_000,
  ratioFloorBytes: Number.MAX_SAFE_INTEGER,
}

const png = (seed: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed + 1, seed + 2])

/** The fixture Project with one Plan Image per Floor, so two assets are written. */
function projectWithImages(hashes: string[], mediaTypes: string[]): Project {
  const source = fixtureProject()
  return {
    ...source,
    floors: source.floors.map((floor, index) => ({
      ...floor,
      planImage: {
        assetHash: hashes[index] ?? '',
        mediaType: (mediaTypes[index] ?? 'image/png') as 'image/png',
        widthPx: 8,
        heightPx: 8,
        pixelsPerMm: null,
      },
    })),
  }
}

const index = (archive: Uint8Array) => {
  const read = readZipIndex(archive)
  if (!read.ok) throw new Error('the archive must be readable')
  return read.entries
}

describe('encodeProject', () => {
  it('writes the manifest, then the project, then the assets by hash', async () => {
    const [low, high] = [await sha256Hex(png(1)), await sha256Hex(png(9))].sort()
    // The Project references the higher hash first: the archive order is the hash order,
    // not the order the Project happens to mention them in.
    const project = projectWithImages([high, low], ['image/png', 'image/png'])
    const archive = await encodeProject(project, async (hash) => ({
      bytes: hash === high ? png(9) : png(1),
      mediaType: 'image/png',
    }), FIXTURE_BUILD)

    expect(index(archive).map((entry) => entry.name)).toEqual([
      'manifest.json',
      'project.json',
      `assets/${low}.png`,
      `assets/${high}.png`,
    ])
  })

  it('writes one entry for an asset two Floors share', async () => {
    const shared = await sha256Hex(png(3))
    const project = projectWithImages([shared, shared], ['image/png', 'image/png'])
    const asked: string[] = []
    const assets: AssetSource = async (hash) => {
      asked.push(hash)
      return { bytes: png(3), mediaType: 'image/png' }
    }
    const archive = await encodeProject(project, assets, FIXTURE_BUILD)
    expect(asked).toEqual([shared])
    expect(index(archive).filter((entry) => entry.name.startsWith('assets/'))).toHaveLength(1)
  })

  it('derives the extension from the media type, and falls back to bin', async () => {
    const bytes = png(5)
    const hash = await sha256Hex(bytes)
    const project = projectWithImages([hash], ['image/webp'])
    const archive = await encodeProject(project, async () => ({ bytes, mediaType: 'image/webp' }), FIXTURE_BUILD)
    expect(index(archive)[2]!.name).toBe(`assets/${hash}.webp`)

    const odd = await encodeProject(projectWithImages([hash], ['image/avif']), async () => ({
      bytes,
      mediaType: 'image/avif',
    }), FIXTURE_BUILD)
    expect(index(odd)[2]!.name).toBe(`assets/${hash}.bin`)
  })

  it('deflates the JSON and stores the images', async () => {
    const archive = await encodeProject(fixtureProject(), async () => ({ bytes: png(2), mediaType: 'image/png' }), FIXTURE_BUILD)
    const entries = index(archive)
    // 8 is deflate, 0 is stored: an already-compressed image gains nothing from a second pass.
    expect(entries.map((entry) => entry.method)).toEqual([8, 8, 0])
    for (const entry of entries) expect(entry.mtime).toEqual({ year: 1980, month: 1, day: 1, hour: 0, minute: 0, second: 0 })
  })

  it('describes every entry it wrote', async () => {
    const bytes = png(4)
    const hash = await sha256Hex(bytes)
    const archive = await encodeProject(projectWithImages([hash], ['image/png']), async () => ({ bytes, mediaType: 'image/png' }), FIXTURE_BUILD)
    const read = unzipEntries(archive, READ_LIMITS)
    if (!read.ok) throw new Error('the archive must be readable')
    const manifest = JSON.parse(new TextDecoder().decode(read.entries[0]!.data)) as {
      entries: { path: string; mediaType: string; byteLength: number; sha256: string }[]
    }
    const projectBytes = canonicalJsonBytes(projectWithImages([hash], ['image/png']))
    expect(manifest.entries).toEqual([
      { path: 'project.json', mediaType: 'application/json', byteLength: projectBytes.length, sha256: await sha256Hex(projectBytes) },
      {
        path: `assets/${await sha256Hex(bytes)}.png`,
        mediaType: 'image/png',
        byteLength: bytes.length,
        sha256: await sha256Hex(bytes),
      },
    ])
  })

  it('carries the caller’s stamp and nothing else from outside the Project', async () => {
    const archive = await encodeProject(fixtureProject(), async () => ({ bytes: png(6), mediaType: 'image/png' }), {
      exportedAt: '2024-02-29T12:34:56.789Z',
      buildboxVersion: '1.2.3',
      preview: false,
    })
    const read = unzipEntries(archive, READ_LIMITS)
    if (!read.ok) throw new Error('the archive must be readable')
    const manifest = JSON.parse(new TextDecoder().decode(read.entries[0]!.data)) as Record<string, unknown>
    expect(manifest).toMatchObject({
      format: 'buildbox-project',
      packageVersion: 1,
      domainSchemaVersion: 1,
      projectId: 'project-0',
      exportedAt: '2024-02-29T12:34:56.789Z',
      buildboxVersion: '1.2.3',
    })
    expect(manifest).not.toHaveProperty('preview')
  })

  it('writes preview only as the flag true', async () => {
    const archive = await encodeProject(fixtureProject(), async () => ({ bytes: png(7), mediaType: 'image/png' }), {
      ...FIXTURE_BUILD,
      preview: true,
    })
    const read = unzipEntries(archive, READ_LIMITS)
    if (!read.ok) throw new Error('the archive must be readable')
    expect(JSON.parse(new TextDecoder().decode(read.entries[0]!.data))).toMatchObject({ preview: true })
  })
})
