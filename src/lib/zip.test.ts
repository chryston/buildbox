/**
 * The ZIP layer (#44): what `package` is allowed to know about archives. The budget is
 * exercised with small synthetic limits — the package's own numbers are 250 MB, and a
 * test that filled them would be a test of the machine's memory.
 */
import { deflateSync, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readZipIndex, unzipEntries, zipEntries, type ZipLimits } from './zip'

const GENEROUS: ZipLimits = {
  maxEntries: 100,
  maxEntryBytes: 1_000_000,
  maxTotalBytes: 10_000_000,
  maxRatio: 1_000,
  ratioFloorBytes: 65_536,
}

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)
const text = (value: Uint8Array): string => new TextDecoder().decode(value)

/** Entries big enough for the ratio floor to be in play, and compressible enough to prove it. */
const repetitive = (length: number): Uint8Array => {
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) out[index] = index % 7
  return out
}

describe('zipEntries', () => {
  it('writes an archive any ZIP reader can open', () => {
    const archive = zipEntries([
      { name: 'manifest.json', data: bytes('{"format":"buildbox-project"}'), level: 6 },
      { name: 'assets/blob.bin', data: repetitive(4096), level: 0 },
      { name: 'empty.txt', data: new Uint8Array(0), level: 6 },
    ])
    const files = unzipSync(archive)
    expect(text(files['manifest.json']!)).toBe('{"format":"buildbox-project"}')
    expect(files['assets/blob.bin']).toEqual(repetitive(4096))
    expect(files['empty.txt']).toEqual(new Uint8Array(0))
  })

  it('keeps names, order and bytes through a round trip', () => {
    const archive = zipEntries([
      { name: 'a.txt', data: bytes('a'), level: 0 },
      { name: 'dir/b.txt', data: bytes('bee'), level: 6 },
      { name: 'ünïcode/日本語.txt', data: bytes('unicode'), level: 6 },
    ])
    const read = unzipEntries(archive, GENEROUS)
    if (!read.ok) throw new Error(`the archive must be readable: ${read.failure.code}`)
    expect(read.entries.map((entry) => [entry.name, text(entry.data)])).toEqual([
      ['a.txt', 'a'],
      ['dir/b.txt', 'bee'],
      ['ünïcode/日本語.txt', 'unicode'],
    ])
  })

  it('writes an archive with no entries at all', () => {
    const index = readZipIndex(zipEntries([]))
    if (!index.ok) throw new Error('an empty archive must still be readable')
    expect(index.entries).toEqual([])
  })

  it('stamps every entry with the fixed DOS date', () => {
    const index = readZipIndex(zipEntries([{ name: 'a.txt', data: bytes('a') }]))
    if (!index.ok) throw new Error('the archive must be readable')
    expect(index.entries[0]!.mtime).toEqual({ year: 1980, month: 1, day: 1, hour: 0, minute: 0, second: 0 })
  })
})

describe('readZipIndex', () => {
  it('refuses bytes that are not an archive', () => {
    expect(readZipIndex(new Uint8Array(0)).ok).toBe(false)
    expect(readZipIndex(bytes('not a zip at all, not even close'))).toEqual({ ok: false })
  })

  it('refuses an archive whose directory is cut short', () => {
    const archive = zipEntries([{ name: 'a.txt', data: bytes('a'.repeat(500)) }])
    expect(readZipIndex(archive.subarray(0, archive.length - 4))).toEqual({ ok: false })
  })

  it('refuses a ZIP64 archive rather than guessing at its sizes', () => {
    const archive = zipEntries([{ name: 'a.txt', data: bytes('a') }])
    const zip64 = new Uint8Array(archive)
    // The end-of-directory record's own entry count, set to the ZIP64 escape value.
    const eocd = zip64.length - 22
    new DataView(zip64.buffer).setUint16(eocd + 10, 0xffff, true)
    expect(readZipIndex(zip64)).toEqual({ ok: false })
  })
})

describe('unzipEntries', () => {
  it('refuses more entries than the caller allows, before reading any of them', () => {
    const archive = zipEntries([
      { name: 'a.txt', data: bytes('a') },
      { name: 'b.txt', data: bytes('b') },
      { name: 'c.txt', data: bytes('c') },
    ])
    expect(unzipEntries(archive, { ...GENEROUS, maxEntries: 2 })).toEqual({
      ok: false,
      failure: { code: 'too-many-entries' },
    })
  })

  it('refuses an entry over the per-entry limit', () => {
    const archive = zipEntries([{ name: 'big.bin', data: repetitive(9_000), level: 0 }])
    expect(unzipEntries(archive, { ...GENEROUS, maxEntryBytes: 4_000 })).toEqual({
      ok: false,
      failure: { code: 'entry-too-large', path: 'big.bin' },
    })
  })

  it('refuses an archive whose entries together pass the total limit', () => {
    const archive = zipEntries([
      { name: 'a.bin', data: repetitive(4_000), level: 0 },
      { name: 'b.bin', data: repetitive(4_000), level: 0 },
      { name: 'c.bin', data: repetitive(4_000), level: 0 },
    ])
    expect(unzipEntries(archive, { ...GENEROUS, maxTotalBytes: 9_000 })).toEqual({
      ok: false,
      failure: { code: 'total-too-large', path: 'c.bin' },
    })
  })

  it('refuses an entry that inflates far past its own size', () => {
    const bomb = new Uint8Array(200_000)
    const archive = zipEntries([{ name: 'bomb.bin', data: bomb }])
    expect(unzipEntries(archive, { ...GENEROUS, maxRatio: 100, ratioFloorBytes: 65_536 })).toEqual({
      ok: false,
      failure: { code: 'ratio-exceeded', path: 'bomb.bin' },
    })
  })

  it('leaves a small entry alone about how much it compressed', () => {
    // A 2 KB manifest at level 6 is 60:1 on its own; the floor is what keeps that legal.
    const payload = bytes(`{"a":"${' '.repeat(2048)}"}`)
    const archive = zipEntries([{ name: 'manifest.json', data: payload }])
    const read = unzipEntries(archive, { ...GENEROUS, maxRatio: 2, ratioFloorBytes: 65_536 })
    expect(read.ok).toBe(true)
  })

  it('refuses an entry whose bytes are not a deflate stream', () => {
    const archive = zipEntries([{ name: 'a.bin', data: bytes('plain'), level: 0 }])
    const broken = new Uint8Array(archive)
    // Claim method 8 in the central directory for bytes that were stored.
    const eocd = broken.length - 22
    const view = new DataView(broken.buffer)
    const centralOffset = view.getUint32(eocd + 16, true)
    view.setUint16(centralOffset + 10, 8, true)
    expect(unzipEntries(broken, GENEROUS)).toEqual({ ok: false, failure: { code: 'corrupt-archive', path: 'a.bin' } })
  })

  it('reports the same bytes fflate reads', () => {
    const entries = [
      { name: 'a.txt', data: bytes('hello'), level: 6 as const },
      { name: 'b.bin', data: repetitive(300_000), level: 0 as const },
    ]
    const archive = zipEntries(entries)
    const read = unzipEntries(archive, { ...GENEROUS, maxEntryBytes: 1_000_000 })
    if (!read.ok) throw new Error('the archive must be readable')
    const files = unzipSync(archive)
    for (const entry of read.entries) expect(entry.data).toEqual(files[entry.name])
  })

  it('hashes what it read the same way twice', () => {
    const archive = zipEntries([{ name: 'a.bin', data: repetitive(50_000) }])
    const first = unzipEntries(archive, GENEROUS)
    const second = unzipEntries(archive, GENEROUS)
    if (!first.ok || !second.ok) throw new Error('the archive must be readable')
    expect(second.entries[0]!.data).toEqual(first.entries[0]!.data)
    // Deflate is deterministic: the same bytes compress to the same stream.
    expect(zipEntries([{ name: 'a.bin', data: repetitive(50_000) }])).toEqual(archive)
    expect(deflateSync(repetitive(50_000)).length).toBeGreaterThan(0)
  })
})
