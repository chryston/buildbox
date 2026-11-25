/**
 * Determinism (#44 §"Determinism rules"): the same Project encodes to the same bytes, and
 * the only thing that can make two encodes differ is the stamp the caller hands in.
 */
import { describe, expect, it } from 'vitest'
import { readZipIndex, unzipEntries, type ZipLimits } from '../lib'
import { encodeProject, type AssetSource } from './encode'
import { FIXTURE_BUILD, fixtureProject } from './testing'

const READ_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxEntryBytes: 52_428_800,
  maxTotalBytes: 262_144_000,
  maxRatio: 1_000_000,
  ratioFloorBytes: Number.MAX_SAFE_INTEGER,
}

const ASSET = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])
const assets: AssetSource = async () => ({ bytes: ASSET, mediaType: 'image/png' })

function entriesOf(archive: Uint8Array) {
  const read = unzipEntries(archive, READ_LIMITS)
  if (!read.ok) throw new Error(`the archive must be readable: ${read.failure.code}`)
  return read.entries
}
const manifestOf = (archive: Uint8Array): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(entriesOf(archive)[0]!.data)) as Record<string, unknown>

describe('encodeProject determinism', () => {
  it('writes identical bytes for identical input', async () => {
    const first = await encodeProject(fixtureProject(), assets, FIXTURE_BUILD)
    const second = await encodeProject(fixtureProject(), assets, FIXTURE_BUILD)
    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(0)
  })

  it('is indifferent to the order the record was built in', async () => {
    const project = fixtureProject()
    // The same record with its keys written in another order: canonical JSON decides the
    // bytes, not the object that happened to hold them.
    const rebuilt = JSON.parse(
      JSON.stringify({
        existingModel: project.existingModel,
        itemDesigns: project.itemDesigns,
        views: project.views,
        floors: project.floors,
        preferences: project.preferences,
        meta: project.meta,
        id: project.id,
        comments: project.comments,
        commentReferenceCounter: project.commentReferenceCounter,
        warningAcknowledgements: project.warningAcknowledgements,
      }),
    )
    expect(await encodeProject(rebuilt, assets, FIXTURE_BUILD)).toEqual(
      await encodeProject(project, assets, FIXTURE_BUILD),
    )
  })

  it('changes only the manifest when the stamp changes', async () => {
    const before = await encodeProject(fixtureProject(), assets, { ...FIXTURE_BUILD, exportedAt: '2026-01-01T00:00:00.000Z' })
    const after = await encodeProject(fixtureProject(), assets, { ...FIXTURE_BUILD, exportedAt: '2027-03-04T05:06:07.890Z' })
    const beforeEntries = entriesOf(before)
    const afterEntries = entriesOf(after)

    expect(afterEntries.map((entry) => entry.name)).toEqual(beforeEntries.map((entry) => entry.name))
    for (const [index, entry] of beforeEntries.entries()) {
      if (index === 0) continue
      expect(afterEntries[index]!.data).toEqual(entry.data)
    }

    const beforeManifest = manifestOf(before)
    const afterManifest = manifestOf(after)
    expect(beforeManifest.exportedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(afterManifest.exportedAt).toBe('2027-03-04T05:06:07.890Z')
    expect({ ...afterManifest, exportedAt: '' }).toEqual({ ...beforeManifest, exportedAt: '' })
  })

  it('changes no other entry when the stamp changes', async () => {
    const before = await encodeProject(fixtureProject(), assets, { ...FIXTURE_BUILD, exportedAt: '2026-01-01T00:00:00.000Z' })
    const after = await encodeProject(fixtureProject(), assets, { ...FIXTURE_BUILD, exportedAt: '2027-03-04T05:06:07.890Z' })
    const beforeIndex = readZipIndex(before)
    const afterIndex = readZipIndex(after)
    if (!beforeIndex.ok || !afterIndex.ok) throw new Error('the archive must be readable')
    const [beforeManifest, ...beforeRest] = beforeIndex.entries
    const [afterManifest, ...afterRest] = afterIndex.entries
    // Deflate can turn two equally long stamps into streams of different length, so the
    // claim is about the entries: every one of them but the manifest is untouched.
    const shape = (entries: typeof beforeRest) =>
      entries.map((entry) => [entry.name, entry.method, entry.crc32, entry.compressedSize, entry.uncompressedSize, entry.mtime])
    expect(shape(afterRest)).toEqual(shape(beforeRest))
    expect(afterManifest.name).toBe(beforeManifest.name)
    expect(afterManifest.method).toBe(beforeManifest.method)
    expect(afterManifest.mtime).toEqual(beforeManifest.mtime)
    expect(afterManifest.uncompressedSize).toBe(beforeManifest.uncompressedSize)
    expect(afterManifest.crc32).not.toBe(beforeManifest.crc32)
  })

  it('stamps every entry with the fixed DOS date, never the clock', async () => {
    const archive = await encodeProject(fixtureProject(), assets, FIXTURE_BUILD)
    const index = readZipIndex(archive)
    if (!index.ok) throw new Error('the archive must be readable')
    for (const entry of index.entries) {
      expect(entry.mtime).toEqual({ year: 1980, month: 1, day: 1, hour: 0, minute: 0, second: 0 })
    }
  })
})
