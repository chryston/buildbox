/**
 * `stageImport` against hostile input (#44 acceptance): one test per rejection code, in
 * the order the steps run. Every case asserts the code and the path or detail that names
 * the offending record — never a message that carries user content.
 */
import { describe, expect, it } from 'vitest'
import { sha256Hex, unzipEntries, zipEntries, type ZipLimits } from '../lib'
import type { Migrator, Project } from '../domain'
import { DOMAIN_SCHEMA_VERSION } from '../domain'
import { PACKAGE_LIMITS } from './constants'
import { encodeProject } from './encode'
import { migrateDomainProject, stageImport } from './import'
import { allocateIds, FIXTURE_BUILD, fixtureProject } from './testing'

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)
const text = (value: Uint8Array): string => new TextDecoder().decode(value)

/** A small asset stands in for a Plan Image; the codec never decodes asset bytes. */
const ASSET = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04])
const ASSET_HASH = await sha256Hex(ASSET)
const ASSET_ENTRY = `assets/${ASSET_HASH}.png`

/** The fixture Project, with its Plan Image pointed at {@link ASSET}. */
function projectWithAsset(assetHash: string): Project {
  const project = fixtureProject()
  return {
    ...project,
    floors: [
      {
        ...project.floors[0]!,
        planImage: { assetHash, mediaType: 'image/png', widthPx: 8, heightPx: 8, pixelsPerMm: null },
      },
      project.floors[1]!,
    ],
  }
}

const PROJECT = projectWithAsset(ASSET_HASH)
const assetSource = async (): Promise<{ bytes: Uint8Array; mediaType: string }> => ({
  bytes: ASSET,
  mediaType: 'image/png',
})

/** A well-formed v1 Backup of {@link PROJECT}. */
const validArchive = (): Promise<Uint8Array> => encodeProject(PROJECT, assetSource, FIXTURE_BUILD)

const READ_LIMITS: ZipLimits = {
  maxEntries: PACKAGE_LIMITS.maxEntries,
  maxEntryBytes: PACKAGE_LIMITS.maxEntryBytes,
  maxTotalBytes: PACKAGE_LIMITS.maxTotalBytes,
  maxRatio: 1_000_000,
  ratioFloorBytes: Number.MAX_SAFE_INTEGER,
}

/** The entries of an archive, so one of them can be replaced and the rest kept as written. */
function partsOf(archive: Uint8Array): { name: string; data: Uint8Array }[] {
  const read = unzipEntries(archive, READ_LIMITS)
  if (!read.ok) throw new Error(`the test archive must be readable: ${read.failure.code}`)
  return read.entries.map((entry) => ({ name: entry.name, data: entry.data }))
}

/** Re-zip an archive with one entry's bytes replaced. */
function replaceEntry(archive: Uint8Array, name: string, data: Uint8Array): Uint8Array {
  return zipEntries(partsOf(archive).map((part) => (part.name === name ? { name, data } : part)))
}

/** Re-zip an archive with entries added, removed or renamed. */
function rebuild(
  archive: Uint8Array,
  edit: (parts: { name: string; data: Uint8Array }[]) => { name: string; data: Uint8Array }[],
): Uint8Array {
  return zipEntries(edit(partsOf(archive)))
}

/** Re-zip an archive with its manifest rewritten as JSON. */
function withManifest(archive: Uint8Array, edit: (manifest: Record<string, unknown>) => void): Uint8Array {
  const parts = partsOf(archive)
  const manifest = parts.find((part) => part.name === 'manifest.json')
  if (manifest === undefined) throw new Error('the test archive must carry a manifest')
  const json = JSON.parse(text(manifest.data)) as Record<string, unknown>
  edit(json)
  return zipEntries(
    parts.map((part) => (part.name === 'manifest.json' ? { name: part.name, data: bytes(JSON.stringify(json)) } : part)),
  )
}

/** Stage `bytes` as a production import would, and hand back the problem. */
async function problemOf(archive: Uint8Array, acceptPreview = false): Promise<unknown> {
  const result = await stageImport(archive, { acceptPreview, allocateId: allocateIds() })
  if (result.ok) throw new Error('the input was accepted')
  return result.problem
}

const expectProblem = async (
  archive: Uint8Array,
  code: string,
  extra: Record<string, unknown> = {},
  acceptPreview = false,
): Promise<void> => {
  await expect(problemOf(archive, acceptPreview)).resolves.toMatchObject({ code, ...extra })
}

describe('stageImport: a well-formed Backup', () => {
  it('stages the Project, the manifest and the assets', async () => {
    const result = await stageImport(await validArchive(), { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}`)
    const staged = result.staged
    expect(staged.project).toEqual(PROJECT)
    expect(staged.migratedFrom).toBeNull()
    expect(staged.manifest.projectId).toBe('project-0')
    expect(staged.manifest.entries.map((entry) => entry.path)).toEqual(['project.json', ASSET_ENTRY])
    expect(staged.assets.get(ASSET_HASH)).toEqual({ bytes: ASSET, mediaType: 'image/png' })
  })

  it('accepts a Project with no Plan Image and no assets', async () => {
    const source = fixtureProject()
    const bare: Project = {
      ...source,
      floors: [{ ...source.floors[0]!, planImage: null }, source.floors[1]!],
    }
    const archive = await encodeProject(bare, async () => ({ bytes: ASSET, mediaType: 'image/png' }), FIXTURE_BUILD)
    const result = await stageImport(archive, { acceptPreview: false, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}`)
    expect(result.staged.project).toEqual(bare)
    expect(result.staged.assets.size).toBe(0)
  })
})

// --- Steps 1 and 2: size, format, paths ---------------------------------------

describe('stageImport: what the input is', () => {
  it('refuses a file over the input limit before parsing it', async () => {
    await expectProblem(new Uint8Array(PACKAGE_LIMITS.maxInputBytes + 1), 'too-large', {
      detail: { bytes: PACKAGE_LIMITS.maxInputBytes + 1, limit: PACKAGE_LIMITS.maxInputBytes },
    })
  })

  it('refuses input that is nothing at all', async () => {
    await expectProblem(new Uint8Array(0), 'not-a-backup')
  })

  it('refuses bytes that are not a BuildBox Backup', async () => {
    // A deterministic stand-in for a random file: no ZIP signature, no export shape.
    const noise = new Uint8Array(1024)
    let state = 0x1234abcd
    for (let index = 0; index < noise.length; index += 1) {
      state = (state * 1664525 + 1013904223) >>> 0
      noise[index] = (state >>> 24) | 0x80
    }
    await expectProblem(noise, 'not-a-backup')
    await expectProblem(bytes('hello world'), 'not-a-backup')
  })

  it('names a loose export as an export, not a Backup (#19)', async () => {
    await expectProblem(bytes('name,width,depth\nBase Cabinet,600,560\n'), 'export-not-backup')
    await expectProblem(bytes('item;qty\nBed;1\n'), 'export-not-backup')
    await expectProblem(bytes('item\tqty\nBed\t1\n'), 'export-not-backup')
    await expectProblem(bytes('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF'), 'export-not-backup')
    await expectProblem(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="10"/>'), 'export-not-backup')
    await expectProblem(bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'), 'export-not-backup')
    await expectProblem(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]), 'export-not-backup')
  })

  it('refuses a damaged archive as corrupt, not as a wrong format', async () => {
    const archive = await validArchive()
    await expectProblem(archive.subarray(0, 200), 'corrupt-archive')
    await expectProblem(bytes('PK\u0003\u0004then nothing at all follows'), 'corrupt-archive')
  })

  it('refuses an entry path that is not a plain relative path', async () => {
    const archive = await validArchive()
    for (const name of ['../project.json', '/abs/project.json', 'assets\\x.png', 'C:/project.json', 'a//b', './project.json', 'project.json/', 'ünïcode.json'.normalize('NFD')]) {
      await expectProblem(rebuild(archive, (parts) => parts.map((part) => (part.name === 'project.json' ? { name, data: part.data } : part))), 'bad-path', { path: name })
    }
  })

  it('refuses two entries with one name', async () => {
    const archive = await validArchive()
    const parts = partsOf(archive)
    await expectProblem(zipEntries([...parts, parts[1]!]), 'bad-path', { path: 'project.json' })
  })

  it('refuses an entry the format does not define', async () => {
    const archive = await validArchive()
    await expectProblem(
      rebuild(archive, (parts) => [...parts, { name: 'evil.txt', data: bytes('rm -rf /') }]),
      'unexpected-entry',
      { path: 'evil.txt' },
    )
    await expectProblem(
      rebuild(archive, (parts) => [...parts, { name: 'assets/not-a-hash.png', data: ASSET }]),
      'unexpected-entry',
      { path: 'assets/not-a-hash.png' },
    )
  })
})

/** Re-zip an archive with the manifest and its entries edited together, manifest first. */
async function rewrite(
  archive: Uint8Array,
  edit: (
    manifest: Record<string, unknown>,
    parts: { name: string; data: Uint8Array }[],
  ) => Promise<{ name: string; data: Uint8Array }[]> | { name: string; data: Uint8Array }[],
): Promise<Uint8Array> {
  const parts = partsOf(archive)
  const manifestPart = parts.find((part) => part.name === 'manifest.json')
  if (manifestPart === undefined) throw new Error('the test archive must carry a manifest')
  const json = JSON.parse(text(manifestPart.data)) as Record<string, unknown>
  const rest = await edit(json, parts.filter((part) => part.name !== 'manifest.json'))
  return zipEntries([{ name: 'manifest.json', data: bytes(JSON.stringify(json)) }, ...rest])
}

const manifestEntries = (manifest: Record<string, unknown>): Record<string, unknown>[] =>
  manifest.entries as Record<string, unknown>[]

// --- Step 3: the manifest ------------------------------------------------------

describe('stageImport: the manifest', () => {
  it('refuses an archive with no manifest', async () => {
    const archive = await validArchive()
    await expectProblem(rebuild(archive, (parts) => parts.filter((part) => part.name !== 'manifest.json')), 'manifest-mismatch', {
      detail: { field: 'manifest.json' },
    })
  })

  it('refuses a manifest that is not a JSON object', async () => {
    await expectProblem(replaceEntry(await validArchive(), 'manifest.json', bytes('not json at all')), 'manifest-mismatch', {
      detail: { field: 'manifest.json' },
    })
    await expectProblem(replaceEntry(await validArchive(), 'manifest.json', bytes('[]')), 'manifest-mismatch', {
      detail: { field: 'manifest.json' },
    })
  })

  it('refuses a manifest field it has never heard of', async () => {
    await expectProblem(withManifest(await validArchive(), (m) => { m.surprise = 1 }), 'manifest-mismatch', {
      detail: { field: 'surprise' },
    })
    await expectProblem(
      withManifest(await validArchive(), (m) => { manifestEntries(m)[1]!.executable = true }),
      'manifest-mismatch',
      { detail: { field: 'entries[1].executable' } },
    )
  })

  it('refuses a manifest field of the wrong shape', async () => {
    for (const [field, value, expected] of [
      ['packageVersion', 0, 'packageVersion'],
      ['packageVersion', '1', 'packageVersion'],
      ['domainSchemaVersion', 1.5, 'domainSchemaVersion'],
      ['projectId', '', 'projectId'],
      ['exportedAt', 1767225600000, 'exportedAt'],
      ['buildboxVersion', null, 'buildboxVersion'],
      ['preview', false, 'preview'],
      ['entries', {}, 'entries'],
    ] as const) {
      await expectProblem(withManifest(await validArchive(), (m) => { m[field] = value }), 'manifest-mismatch', {
        detail: { field: expected },
      })
    }
  })

  it('refuses an entry record that is not one', async () => {
    await expectProblem(
      withManifest(await validArchive(), (m) => { (manifestEntries(m) as unknown[])[0] = 'project.json' }),
      'manifest-mismatch',
      { detail: { field: 'entries[0]' } },
    )
    await expectProblem(
      withManifest(await validArchive(), (m) => { manifestEntries(m)[1]!.sha256 = 'deadbeef' }),
      'manifest-mismatch',
      { detail: { field: 'entries[1].sha256' } },
    )
    await expectProblem(
      withManifest(await validArchive(), (m) => { manifestEntries(m)[1]!.byteLength = -1 }),
      'manifest-mismatch',
      { detail: { field: 'entries[1].byteLength' } },
    )
  })

  it('refuses a manifest that does not describe the archive', async () => {
    const archive = await validArchive()
    // The list omits the asset that is there.
    await expectProblem(
      await rewrite(archive, (m, parts) => {
        m.entries = manifestEntries(m).filter((entry) => entry.path !== ASSET_ENTRY)
        return parts
      }),
      'manifest-mismatch',
      { detail: { field: 'entries' } },
    )
    // The list names an entry that is not there.
    await expectProblem(
      withManifest(archive, (m) => {
        manifestEntries(m).push({ path: 'ghost.json', mediaType: 'application/json', byteLength: 2, sha256: '0'.repeat(64) })
      }),
      'manifest-mismatch',
      { detail: { field: 'entries' } },
    )
    // The list is right but in the wrong order.
    await expectProblem(
      withManifest(archive, (m) => { m.entries = manifestEntries(m).reverse() }),
      'manifest-mismatch',
      { detail: { field: 'entries' } },
    )
  })

  it('refuses an archive with no project record', async () => {
    await expectProblem(
      await rewrite(await validArchive(), (m, parts) => {
        m.entries = manifestEntries(m).filter((entry) => entry.path !== 'project.json')
        return parts.filter((part) => part.name !== 'project.json')
      }),
      'manifest-mismatch',
      { detail: { field: 'project.json' } },
    )
  })

  it('refuses a package written by a newer BuildBox', async () => {
    await expectProblem(withManifest(await validArchive(), (m) => { m.packageVersion = 2 }), 'newer-package', {
      detail: { detected: 2, supported: 1 },
    })
  })

  it('names an export ZIP as an export, not a Backup (#19)', async () => {
    await expectProblem(withManifest(await validArchive(), (m) => { m.format = 'buildbox-export' }), 'export-not-backup')
  })

  it('refuses a format that is neither a Backup nor an export', async () => {
    await expectProblem(withManifest(await validArchive(), (m) => { m.format = 'buildbox-thing' }), 'not-a-backup')
  })
})

// --- Step 4: hashes and assets -------------------------------------------------

describe('stageImport: hashes and assets', () => {
  it('refuses bytes that do not hash to what the manifest says', async () => {
    const archive = await validArchive()
    const flipped = new Uint8Array(ASSET)
    flipped[8] = (flipped[8] as number) ^ 0xff
    await expectProblem(replaceEntry(archive, ASSET_ENTRY, flipped), 'hash-mismatch', { path: ASSET_ENTRY })

    const project = partsOf(archive).find((part) => part.name === 'project.json')!
    await expectProblem(replaceEntry(archive, 'project.json', bytes(`${text(project.data)} `)), 'hash-mismatch', {
      path: 'project.json',
    })
  })

  it('refuses a length that does not match the bytes', async () => {
    await expectProblem(
      withManifest(await validArchive(), (m) => { manifestEntries(m)[1]!.byteLength = ASSET.length - 1 }),
      'hash-mismatch',
      { path: ASSET_ENTRY },
    )
  })

  it('refuses an asset whose bytes do not hash to its own name', async () => {
    const other = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const otherHash = await sha256Hex(other)
    await expectProblem(
      await rewrite(await validArchive(), async (m, parts) => {
        manifestEntries(m)[1]!.sha256 = otherHash
        manifestEntries(m)[1]!.byteLength = other.length
        return parts.map((part) => (part.name === ASSET_ENTRY ? { name: ASSET_ENTRY, data: other } : part))
      }),
      'hash-mismatch',
      { path: ASSET_ENTRY },
    )
  })

  it('refuses an asset the Project references but the archive does not carry', async () => {
    await expectProblem(
      await rewrite(await validArchive(), (m, parts) => {
        m.entries = manifestEntries(m).filter((entry) => entry.path !== ASSET_ENTRY)
        return parts.filter((part) => !part.name.startsWith('assets/'))
      }),
      'missing-asset',
      { path: 'floors[0].planImage', detail: { assetHash: ASSET_HASH } },
    )
  })

  it('refuses an asset nothing references', async () => {
    const extra = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    const extraHash = await sha256Hex(extra)
    await expectProblem(
      await rewrite(await validArchive(), async (m, parts) => {
        manifestEntries(m).push({
          path: `assets/${extraHash}.png`,
          mediaType: 'image/png',
          byteLength: extra.length,
          sha256: extraHash,
        })
        return [...parts, { name: `assets/${extraHash}.png`, data: extra }]
      }),
      'unreferenced-asset',
      { path: `assets/${extraHash}.png` },
    )
  })
})

// --- Steps 5 and 6: migration, then the strict validator -----------------------

describe('stageImport: the migrator chain', () => {
  it('refuses a Project saved by a newer BuildBox before touching a field', async () => {
    // One ahead of whatever this build writes: a preview build is a version further along the
    // chain, and "newer" has to mean newer than it, not newer than production (#69 §1).
    const newer = DOMAIN_SCHEMA_VERSION + 1
    await expectProblem(withManifest(await validArchive(), (m) => { m.domainSchemaVersion = newer }), 'newer-schema', {
      detail: { detected: newer, supported: DOMAIN_SCHEMA_VERSION },
    })
  })

  it('names the chain step that failed', () => {
    const adds: Migrator = (data) => ({ ...(data as Record<string, unknown>), added: true })
    const boom: Migrator = () => {
      throw new Error('a migrator that cannot run')
    }
    expect(migrateDomainProject({ v: 1 }, 1, [adds, boom], 3, allocateIds())).toMatchObject({
      ok: false,
      problem: { code: 'migration-failed', detail: { step: 2 } },
    })
  })

  it('runs every step of a chain and reports the schema it came from', () => {
    const step = (key: string): Migrator => (data) => ({ ...(data as Record<string, unknown>), [key]: true })
    expect(migrateDomainProject({ v: 1 }, 1, [step('two'), step('three')], 3, allocateIds())).toEqual({
      ok: true,
      record: { v: 1, two: true, three: true },
      migratedFrom: 1,
    })
    // A Project already at the current schema has not been migrated by anything.
    expect(migrateDomainProject({ v: 1 }, 1, [], 1, allocateIds())).toEqual({ ok: true, record: { v: 1 }, migratedFrom: null })
  })
})

describe('stageImport: the strict validator', () => {
  it('refuses a Project that is not valid domain v1', async () => {
    const broken = {
      ...PROJECT,
      existingModel: {
        placedItems: [{ ...PROJECT.existingModel.placedItems[0]!, itemDesignId: 'design-does-not-exist' }],
        walls: PROJECT.existingModel.walls,
        wallJunctions: PROJECT.existingModel.wallJunctions,
        openings: PROJECT.existingModel.openings,
        rooms: PROJECT.existingModel.rooms,
      },
    }
    const archive = await encodeProject(broken as Project, assetSource, FIXTURE_BUILD)
    await expectProblem(archive, 'invalid-project', {
      problems: [{ path: 'existingModel.placedItems[0].itemDesignId', code: 'dangling-reference' }],
    })
  })

  it('refuses a project record that is not JSON', async () => {
    await expectProblem(
      await rewrite(await validArchive(), async (m, parts) => {
        const garbage = bytes('<html>a proxy page, not a project</html>')
        manifestEntries(m)[0] = {
          path: 'project.json',
          mediaType: 'application/json',
          byteLength: garbage.length,
          sha256: await sha256Hex(garbage),
        }
        return parts.map((part) => (part.name === 'project.json' ? { name: part.name, data: garbage } : part))
      }),
      'invalid-project',
      { problems: [{ path: '', code: 'bad-json' }] },
    )
  })

  it('refuses a Project that is not the one the manifest describes', async () => {
    await expectProblem(withManifest(await validArchive(), (m) => { m.projectId = 'project-someone-else' }), 'invalid-project', {
      path: 'id',
      problems: [{ path: 'id', code: 'id-mismatch' }],
    })
  })

  it('names the record that failed without echoing what is in it', async () => {
    // Two Floors with one name: the domain message quotes the name, the codec must not.
    const duplicate: Project = {
      ...PROJECT,
      floors: [PROJECT.floors[0]!, { ...PROJECT.floors[1]!, name: PROJECT.floors[0]!.name }],
    }
    const archive = await encodeProject(duplicate, assetSource, FIXTURE_BUILD)
    const problem = (await problemOf(archive)) as { code: string; problems: { path: string; code: string }[] }
    expect(problem.code).toBe('invalid-project')
    expect(problem.problems.map((entry) => entry.code)).toContain('duplicate-name')
    const echoed = JSON.stringify(problem)
    expect(echoed).not.toContain('Floor 1')
    expect(echoed).not.toContain('Maple Street')
    expect(echoed).not.toContain('walnut')
  })
})

// --- Preview, and the package budget -------------------------------------------

describe('stageImport: preview Packages', () => {
  const previewArchive = (): Promise<Uint8Array> =>
    encodeProject(PROJECT, assetSource, { ...FIXTURE_BUILD, preview: true })

  it('is refused by a production import', async () => {
    await expectProblem(await previewArchive(), 'preview-package')
  })

  it('is staged when the caller says preview imports are on', async () => {
    const result = await stageImport(await previewArchive(), { acceptPreview: true, allocateId: allocateIds() })
    if (!result.ok) throw new Error(`${result.problem.code}`)
    expect(result.staged.manifest.preview).toBe(true)
    expect(result.staged.project).toEqual(PROJECT)
  })
})

describe('stageImport: the package budget', () => {
  const ZERO_HASH = '0'.repeat(64)
  const zeroEntry = `assets/${ZERO_HASH}.bin`

  it('refuses more entries than the format allows, before inflating any of them', async () => {
    const entries = Array.from({ length: PACKAGE_LIMITS.maxEntries + 1 }, (_unused, index) => ({
      name: `assets/${index.toString(16).padStart(64, '0')}.bin`,
      data: ASSET,
      level: 0 as const,
    }))
    await expectProblem(zipEntries(entries), 'too-many-entries')
  })

  it('refuses an entry over the uncompressed limit', async () => {
    const huge = new Uint8Array(PACKAGE_LIMITS.maxEntryBytes + 1)
    await expectProblem(zipEntries([{ name: zeroEntry, data: huge, level: 0 }]), 'entry-too-large', { path: zeroEntry })
  })

  it('refuses an entry that inflates far past its own size', async () => {
    const bomb = new Uint8Array(2 * 1024 * 1024)
    await expectProblem(zipEntries([{ name: zeroEntry, data: bomb }]), 'ratio-exceeded', { path: zeroEntry })
  })
})
