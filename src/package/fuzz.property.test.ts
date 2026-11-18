import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sha256Hex, unzipEntries, zipEntries, type ZipLimits } from '../lib'
import { validateProject } from '../domain'
import { stageImport, type StageImportResult } from './import'
import { PACKAGE_PROBLEM_CODES } from './problems'
import { allocateIds } from './testing'

/**
 * The fuzz property of #44: whatever a hostile upload, a truncated download or a flipped
 * bit turns a Backup into, `stageImport` answers with a staged Project or a typed
 * problem. It never throws, never accepts a Project the validator would refuse, and never
 * stages an asset that does not hash to the name it was read under. The seed is fixed so
 * CI replays the same 1,000 mutations on every machine.
 */
const SEED = 20_260_119
const params = { numRuns: 1000, seed: SEED }

const READ_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxEntryBytes: 52_428_800,
  maxTotalBytes: 262_144_000,
  maxRatio: 1_000_000,
  ratioFloorBytes: Number.MAX_SAFE_INTEGER,
}

/** The committed golden Backup, mutated 1,000 ways (#44 acceptance criterion 5). */
const REFERENCE = readFileSync(
  fileURLToPath(new URL('../../fixtures/package/v1/reference.buildbox', import.meta.url)),
)

type Part = { name: string; data: Uint8Array }

function parts(archive: Uint8Array): Part[] | null {
  const read = unzipEntries(archive, READ_LIMITS)
  return read.ok ? read.entries.map((entry) => ({ name: entry.name, data: entry.data })) : null
}

/** One mutation of the reference archive. */
type Edit =
  | { kind: 'flip'; offset: number; bit: number }
  | { kind: 'truncate'; length: number }
  | { kind: 'append'; payload: Uint8Array }
  | { kind: 'splice'; offset: number; payload: Uint8Array }
  | { kind: 'duplicate'; entry: number }
  | { kind: 'rename'; entry: number; name: string }
  | { kind: 'manifestKey'; key: 'preview' | 'surprise' | 'packageVersion' | 'entries' }

const MUTATION: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('flip' as const), offset: fc.nat(), bit: fc.integer({ min: 0, max: 7 }) }),
  fc.record({ kind: fc.constant('truncate' as const), length: fc.nat() }),
  fc.record({ kind: fc.constant('append' as const), payload: fc.uint8Array({ minLength: 1, maxLength: 64 }) }),
  fc.record({ kind: fc.constant('splice' as const), offset: fc.nat(), payload: fc.uint8Array({ minLength: 1, maxLength: 32 }) }),
  fc.record({ kind: fc.constant('duplicate' as const), entry: fc.nat({ max: 3 }) }),
  fc.record({
    kind: fc.constant('rename' as const),
    entry: fc.nat({ max: 3 }),
    name: fc.constantFrom('../evil.json', 'assets/x.png', 'evil.txt', 'manifest.json', '/etc/passwd', 'a\\b.json'),
  }),
  fc.record({ kind: fc.constant('manifestKey' as const), key: fc.constantFrom('preview', 'surprise', 'packageVersion', 'entries') }),
)

/** Apply one mutation; a structural edit on an archive that cannot be read is a no-op. */
function mutate(archive: Uint8Array, edit: Edit): Uint8Array {
  if (edit.kind === 'flip') {
    if (archive.length === 0) return archive
    const flipped = new Uint8Array(archive)
    const at = edit.offset % archive.length
    flipped[at] = (flipped[at] as number) ^ (1 << edit.bit)
    return flipped
  }
  if (edit.kind === 'truncate') return archive.subarray(0, Math.min(edit.length, archive.length))
  if (edit.kind === 'append') {
    const grown = new Uint8Array(archive.length + edit.payload.length)
    grown.set(archive, 0)
    grown.set(edit.payload, archive.length)
    return grown
  }
  if (edit.kind === 'splice') {
    if (archive.length === 0) return edit.payload
    const at = edit.offset % archive.length
    const spliced = new Uint8Array(archive.length + edit.payload.length)
    spliced.set(archive.subarray(0, at), 0)
    spliced.set(edit.payload, at)
    spliced.set(archive.subarray(at), at + edit.payload.length)
    return spliced
  }

  const entries = parts(archive)
  if (entries === null) return archive
  if (edit.kind === 'duplicate') return zipEntries([...entries, entries[edit.entry % entries.length]!])
  if (edit.kind === 'rename') {
    const renamed = entries.map((entry, index) =>
      index === edit.entry % entries.length ? { name: edit.name, data: entry.data } : entry,
    )
    return zipEntries(renamed)
  }
  const manifest = entries.find((entry) => entry.name === 'manifest.json')
  if (manifest === undefined) return archive
  const json = JSON.parse(new TextDecoder().decode(manifest.data)) as Record<string, unknown>
  if (edit.key === 'preview') json.preview = true
  else if (edit.key === 'surprise') json.surprise = 1
  else if (edit.key === 'packageVersion') json.packageVersion = 99
  else json.entries = []
  const rewritten = new TextEncoder().encode(JSON.stringify(json))
  return zipEntries(
    entries.map((entry) => (entry.name === 'manifest.json' ? { name: entry.name, data: rewritten } : entry)),
  )
}

const accepted = (result: StageImportResult): void => {
  if (!result.ok) {
    expect(PACKAGE_PROBLEM_CODES).toContain(result.problem.code)
    return
  }
  expect(validateProject(result.staged.project).ok).toBe(true)
  expect(result.staged.project.id).toBe(result.staged.manifest.projectId)
}

describe('no archive defeats the importer', () => {
  // A thousand runs over a 200 KB Backup is real work; the default 5 s would be a flake.
  it('answers every mutation of a real Backup with a staged Project or a typed problem', async () => {
    await fc.assert(
      fc.asyncProperty(MUTATION, async (edit) => {
        const result = await stageImport(mutate(REFERENCE, edit), { acceptPreview: false, allocateId: allocateIds() })
        accepted(result)
        for (const [hash, asset] of result.ok ? result.staged.assets : []) {
          expect(await sha256Hex(asset.bytes)).toBe(hash)
        }
      }),
      params,
    )
  }, 60_000)

  it('answers any bytes at all the same way', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 512 }), async (noise) => {
        accepted(await stageImport(noise, { acceptPreview: false, allocateId: allocateIds() }))
      }),
      params,
    )
  })

  it('answers the same mutations when preview packages are accepted', async () => {
    await fc.assert(
      fc.asyncProperty(MUTATION, async (edit) => {
        accepted(await stageImport(mutate(REFERENCE, edit), { acceptPreview: true, allocateId: allocateIds() }))
      }),
      params,
    )
  }, 60_000)
})
