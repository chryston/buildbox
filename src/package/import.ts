/**
 * Strict staged import, steps 1–6 (#44, #20 §6, ADR 0006).
 *
 * Every `.buildbox` a user hands over is untrusted input and a migration surface, so it
 * is read in one order and nowhere else: size, a limited unzip, the manifest, the hashes,
 * the domain migrators, the strict validator. Each step either passes or returns a typed
 * {@link PackageProblem}; nothing throws and nothing is half-applied. What comes back is
 * a staged Project that changes no storage — steps 7–10 (media decoding, the Replace or
 * Import-as-copy choice, the atomic write and its read-back) belong to #50.
 *
 * The codec reads no environment, no clock and no DOM: `acceptPreview` arrives from the
 * caller, and inputs and outputs are `Uint8Array`, so this runs in a Worker unchanged.
 */
import { problem, sha256Hex, unzipEntries, ROOT_PATH, type ZipEntry, type ZipLimits } from '../lib'
import {
  DOMAIN_SCHEMA_VERSION,
  MIGRATORS,
  runMigrationChain,
  validateProject,
  type Migrator,
  type Project,
} from '../domain'
import { assetHashOf, assetReferences } from './assets'
import { classifyNonZip, entryPathProblem, isKnownEntry, looksLikeZip } from './classify'
import {
  EXPORT_FORMAT,
  MANIFEST_ENTRY,
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  PACKAGE_LIMITS,
  PROJECT_ENTRY,
  RATIO_FLOOR_BYTES,
} from './constants'
import { packageProblem, redactedProblem, type PackageProblem } from './problems'
import { parseManifest, readManifestJson, type PackageManifest } from './manifest'

/** One staged asset: the bytes the archive carried and the media type the manifest gave them. */
export interface StagedAsset {
  readonly bytes: Uint8Array
  readonly mediaType: string
}

/** A Project that has passed every check, held in memory and committed by nothing yet. */
export interface StagedPackage {
  readonly manifest: PackageManifest
  readonly project: Project
  /** By content hash, which is also what its entry path named. */
  readonly assets: Map<string, StagedAsset>
  /** The domain schema the package arrived at, or `null` when no migrator ran. */
  readonly migratedFrom: number | null
}

export interface StageImportContext {
  /** Decided by `app` from its feature flag; the codec reads no environment (#44). */
  readonly acceptPreview: boolean
}

export type StageImportResult = { ok: true; staged: StagedPackage } | { ok: false; problem: PackageProblem }

const ZIP_LIMITS: ZipLimits = {
  maxEntries: PACKAGE_LIMITS.maxEntries,
  maxEntryBytes: PACKAGE_LIMITS.maxEntryBytes,
  maxTotalBytes: PACKAGE_LIMITS.maxTotalBytes,
  maxRatio: PACKAGE_LIMITS.maxRatio,
  ratioFloorBytes: RATIO_FLOOR_BYTES,
}

/**
 * Stage one `.buildbox` file. Never throws: an archive this cannot read comes back as a
 * typed problem, including damage that escapes as an exception somewhere downstream.
 */
export async function stageImport(bytes: Uint8Array, ctx: StageImportContext): Promise<StageImportResult> {
  try {
    return await stage(bytes, ctx)
  } catch {
    return packageProblem('corrupt-archive')
  }
}

async function stage(bytes: Uint8Array, ctx: StageImportContext): Promise<StageImportResult> {
  const archive = readArchive(bytes)
  if (!archive.ok) return archive

  const declared = readManifest(archive.entries, ctx)
  if (!declared.ok) return declared

  const hashes = await checkHashes(declared.manifest, archive.entries)
  if (hashes !== null) return { ok: false, problem: hashes }

  const record = parseProjectRecord(declared.projectBytes)
  if (!record.ok) return record

  const missing = missingAsset(record.record, declared.manifest)
  if (missing !== null) return { ok: false, problem: missing }

  const migrated = migrateDomainProject(record.record, declared.manifest.domainSchemaVersion, MIGRATORS, DOMAIN_SCHEMA_VERSION)
  if (!migrated.ok) return migrated

  return validateStaged(migrated.record, migrated.migratedFrom, declared.manifest, archive.entries)
}

// --- Steps 1 and 2: size, then a limited unzip --------------------------------

type ArchiveRead = { ok: true; entries: Map<string, ZipEntry> } | { ok: false; problem: PackageProblem }

/**
 * Step 1 then step 2: the file's own size, then the archive under the package budget.
 * Names are checked as they come out of the directory, before any of their bytes are
 * trusted: a path that escapes the archive is refused whatever it contains.
 */
function readArchive(bytes: Uint8Array): ArchiveRead {
  if (bytes.length === 0) return packageProblem('not-a-backup')
  if (bytes.length > PACKAGE_LIMITS.maxInputBytes) {
    return packageProblem('too-large', { detail: { bytes: bytes.length, limit: PACKAGE_LIMITS.maxInputBytes } })
  }
  // Bytes that do not even start a ZIP are classified rather than called corrupt: an
  // export or a spreadsheet is a different answer from a damaged Backup (#19).
  if (!looksLikeZip(bytes)) return packageProblem(classifyNonZip(bytes))

  const read = unzipEntries(bytes, ZIP_LIMITS)
  if (!read.ok) {
    return {
      ok: false,
      problem: {
        code: read.failure.code,
        ...(read.failure.path === undefined ? {} : { path: read.failure.path }),
      },
    }
  }

  const entries = new Map<string, ZipEntry>()
  for (const entry of read.entries) {
    const path = entryPathProblem(entry.name)
    if (path !== null) return { ok: false, problem: path }
    // A duplicate name is a bad path: two entries for one name is how an archive makes
    // the same file mean two different things.
    if (entries.has(entry.name)) return packageProblem('bad-path', { path: entry.name })
    if (!isKnownEntry(entry.name)) return packageProblem('unexpected-entry', { path: entry.name })
    entries.set(entry.name, entry)
  }
  return { ok: true, entries }
}

// --- Step 3: the manifest ------------------------------------------------------

type ManifestRead =
  | { ok: true; manifest: PackageManifest; projectBytes: Uint8Array }
  | { ok: false; problem: PackageProblem }

/**
 * The manifest, strictly, and then the claim it makes about the archive: the `entries`
 * list has to name exactly the entries that are here, in the order they are stored.
 */
function readManifest(entries: Map<string, ZipEntry>, ctx: StageImportContext): ManifestRead {
  const manifestEntry = entries.get(MANIFEST_ENTRY)
  if (manifestEntry === undefined) return packageProblem('manifest-mismatch', { detail: { field: MANIFEST_ENTRY } })

  const json = readManifestJson(manifestEntry.data)
  if (!json.ok) return json

  // Classified before the strict shape: an export manifest is a different shape, and
  // "this is an export" is the true answer about it (#19).
  const format = json.json.format
  if (format === EXPORT_FORMAT) return packageProblem('export-not-backup')
  if (format !== PACKAGE_FORMAT) return packageProblem('not-a-backup')

  const parsed = parseManifest(json.json)
  if (!parsed.ok) return parsed
  const { manifest } = parsed

  if (manifest.packageVersion > PACKAGE_FORMAT_VERSION) {
    return packageProblem('newer-package', {
      detail: { detected: manifest.packageVersion, supported: PACKAGE_FORMAT_VERSION },
    })
  }
  if (manifest.preview === true && !ctx.acceptPreview) return packageProblem('preview-package')

  const stored = [...entries.keys()].filter((name) => name !== MANIFEST_ENTRY)
  if (
    stored.length !== manifest.entries.length ||
    !stored.every((name, index) => manifest.entries[index]?.path === name)
  ) {
    return packageProblem('manifest-mismatch', { detail: { field: 'entries' } })
  }

  const project = entries.get(PROJECT_ENTRY)
  if (project === undefined) return packageProblem('manifest-mismatch', { detail: { field: PROJECT_ENTRY } })
  return { ok: true, manifest, projectBytes: project.data }
}

// --- Step 4: hashes ------------------------------------------------------------

/** Every entry against the manifest, and every asset against its own name. */
async function checkHashes(
  manifest: PackageManifest,
  entries: Map<string, ZipEntry>,
): Promise<PackageProblem | null> {
  for (const expected of manifest.entries) {
    const entry = entries.get(expected.path)
    if (entry === undefined) return { code: 'manifest-mismatch', detail: { field: expected.path } }
    if (entry.data.length !== expected.byteLength) return { code: 'hash-mismatch', path: expected.path }
    const actual = await sha256Hex(entry.data)
    if (actual !== expected.sha256) return { code: 'hash-mismatch', path: expected.path }
    // An asset is named by its content: the hash in the path is a second claim on the
    // same bytes, and it has to hold as well.
    const named = assetHashOf(expected.path)
    if (named !== null && named !== actual) return { code: 'hash-mismatch', path: expected.path }
  }
  return null
}

/** The Project's own record, before migration; unparseable bytes are an invalid Project. */
function parseProjectRecord(bytes: Uint8Array): { ok: true; record: unknown } | { ok: false; problem: PackageProblem } {
  try {
    return { ok: true, record: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  } catch {
    return packageProblem('invalid-project', {
      problems: [problem(ROOT_PATH, 'bad-json', 'project.json is not JSON.')],
    })
  }
}

/**
 * Both directions of the asset contract: nothing the Project references may be absent,
 * and nothing the archive carries may be unreferenced — an unlisted asset is either
 * damage or somebody else's file (#44 step 4).
 */
function missingAsset(record: unknown, manifest: PackageManifest): PackageProblem | null {
  const present = new Set<string>()
  for (const entry of manifest.entries) {
    const named = assetHashOf(entry.path)
    if (named !== null) present.add(named)
  }
  const references = assetReferences(record)
  for (const reference of references) {
    if (!present.has(reference.assetHash)) {
      return { code: 'missing-asset', path: reference.path, detail: { assetHash: reference.assetHash } }
    }
  }
  const referenced = new Set(references.map((reference) => reference.assetHash))
  for (const entry of manifest.entries) {
    const named = assetHashOf(entry.path)
    if (named !== null && !referenced.has(named)) {
      return { code: 'unreferenced-asset', path: entry.path, detail: { assetHash: named } }
    }
  }
  return null
}

// --- Steps 5 and 6: migration, then strict validation -------------------------

/** A migrator that threw, tagged with the 1-based chain step that failed. */
class MigrationStepError extends Error {
  constructor(readonly step: number) {
    super(`domain migrator ${step} failed`)
    this.name = 'MigrationStepError'
  }
}

export type MigrationResult =
  | { ok: true; record: unknown; migratedFrom: number | null }
  | { ok: false; problem: PackageProblem }

/**
 * Step 5: run `chain` from `from` up to `current`, on a copy, and refuse anything newer
 * than this build before a single field is touched (#14). The `detected`/`supported`
 * pair is the one `domain`'s own "saved by a newer BuildBox" refusal reports.
 *
 * The chain and the current version are parameters so a test can drive a synthetic
 * multi-step chain, the way `domain`'s `runMigrationChain` does; `stageImport` always
 * passes the real ones.
 */
export function migrateDomainProject(
  record: unknown,
  from: number,
  chain: readonly Migrator[],
  current: number,
): MigrationResult {
  if (from > current) {
    return packageProblem('newer-schema', { detail: { detected: from, supported: current } })
  }
  const numbered: Migrator[] = chain.map((migrator, index) => (data: unknown) => {
    try {
      return migrator(data)
    } catch {
      throw new MigrationStepError(index + 1)
    }
  })
  try {
    return {
      ok: true,
      record: runMigrationChain(record, from, numbered),
      migratedFrom: from === current ? null : from,
    }
  } catch (error) {
    return packageProblem('migration-failed', {
      detail: { step: error instanceof MigrationStepError ? error.step : from },
    })
  }
}

/** Step 6: the strict domain validator, and the manifest's promise about whose Project this is. */
function validateStaged(
  record: unknown,
  migratedFrom: number | null,
  manifest: PackageManifest,
  entries: Map<string, ZipEntry>,
): StageImportResult {
  const validated = validateProject(record)
  if (!validated.ok) {
    // Paths only: a domain message quotes the value it collided with, and a failed
    // import does not echo user content back (#14).
    return packageProblem('invalid-project', { problems: validated.problems.map(redactedProblem) })
  }
  if (validated.project.id !== manifest.projectId) {
    return packageProblem('invalid-project', {
      path: 'id',
      problems: [problem('id', 'id-mismatch', 'The Project is not the one the manifest describes.')],
    })
  }

  const assets = new Map<string, StagedAsset>()
  for (const entry of manifest.entries) {
    const named = assetHashOf(entry.path)
    const stored = named === null ? undefined : entries.get(entry.path)
    if (named !== null && stored !== undefined) {
      assets.set(named, { bytes: stored.data, mediaType: entry.mediaType })
    }
  }
  return { ok: true, staged: { manifest, project: validated.project, assets, migratedFrom } }
}
