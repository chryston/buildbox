/**
 * The `manifest.json` record (#44 §"Layout written by `encodeProject`").
 *
 * It is written and read through `lib`'s canonical JSON, so key order is never a
 * question, and it is validated strictly: a field this format has never heard of is a
 * `manifest-mismatch`, never a quiet drop. A manifest from a newer BuildBox arrives as
 * `packageVersion` 2 and is refused by version, not by guessing at its fields.
 */
import { PACKAGE_FORMAT } from './constants'
import { packageProblem, type PackageProblem } from './problems'
import { isRecord, isText, isWholeNumber, type UnknownRecord } from './shape'

/** One entry of the archive, exactly as the manifest describes it. */
export interface PackageManifestEntry {
  readonly path: string
  readonly mediaType: string
  readonly byteLength: number
  readonly sha256: string
}

/** The whole manifest. `preview` is present only when it is `true` (#20 §11). */
export interface PackageManifest {
  readonly format: typeof PACKAGE_FORMAT
  readonly packageVersion: number
  readonly domainSchemaVersion: number
  readonly projectId: string
  readonly exportedAt: string
  readonly buildboxVersion: string
  readonly preview?: true
  readonly entries: readonly PackageManifestEntry[]
}

export type ManifestRead = { ok: true; manifest: PackageManifest } | { ok: false; problem: PackageProblem }

const MANIFEST_KEYS: readonly string[] = [
  'format',
  'packageVersion',
  'domainSchemaVersion',
  'projectId',
  'exportedAt',
  'buildboxVersion',
  'preview',
  'entries',
]
const ENTRY_KEYS: readonly string[] = ['path', 'mediaType', 'byteLength', 'sha256']

const ASSET_SHA256 = /^[0-9a-f]{64}$/

/** A manifest this format cannot describe: the field that says so is all we report. */
const unreadable = (field: string): { ok: false; problem: PackageProblem } =>
  packageProblem('manifest-mismatch', { detail: { field } })

/**
 * Parse the manifest bytes without checking their shape. `format` is classified before
 * the strict shape, because an export manifest is a different shape entirely and has to
 * be recognised as an export rather than reported as a broken Backup.
 */
export function readManifestJson(
  bytes: Uint8Array,
): { ok: true; json: UnknownRecord } | { ok: false; problem: PackageProblem } {
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return unreadable('manifest.json')
  }
  if (!isRecord(json)) return unreadable('manifest.json')
  return { ok: true, json }
}

/**
 * The strict manifest shape: every field present, of the right type, and no field the
 * format does not define. A `packageVersion` above `PACKAGE_FORMAT_VERSION` passes the
 * shape check and is refused by the caller as `newer-package`, which is a version
 * answer rather than a damage report.
 */
export function parseManifest(json: unknown): ManifestRead {
  if (!isRecord(json)) return unreadable('manifest.json')

  for (const key of Object.keys(json)) if (!MANIFEST_KEYS.includes(key)) return unreadable(key)

  if (json.format !== PACKAGE_FORMAT) return unreadable('format')
  if (!isWholeNumber(json.packageVersion, 1)) return unreadable('packageVersion')
  if (!isWholeNumber(json.domainSchemaVersion, 1)) return unreadable('domainSchemaVersion')
  if (!isText(json.projectId) || json.projectId === '') return unreadable('projectId')
  if (!isText(json.exportedAt) || json.exportedAt === '') return unreadable('exportedAt')
  if (!isText(json.buildboxVersion) || json.buildboxVersion === '') return unreadable('buildboxVersion')
  // `preview` is written only when it is true, so `preview: false` is not a shape this
  // format produces and is not accepted either.
  if ('preview' in json && json.preview !== true) return unreadable('preview')
  if (!Array.isArray(json.entries)) return unreadable('entries')

  const entries: PackageManifestEntry[] = []
  for (const [index, raw] of json.entries.entries()) {
    const at = `entries[${index}]`
    if (!isRecord(raw)) return unreadable(at)
    for (const key of Object.keys(raw)) if (!ENTRY_KEYS.includes(key)) return unreadable(`${at}.${key}`)
    if (!isText(raw.path) || raw.path === '') return unreadable(`${at}.path`)
    if (!isText(raw.mediaType) || raw.mediaType === '') return unreadable(`${at}.mediaType`)
    if (!isWholeNumber(raw.byteLength, 0)) return unreadable(`${at}.byteLength`)
    if (!isText(raw.sha256) || !ASSET_SHA256.test(raw.sha256)) return unreadable(`${at}.sha256`)
    entries.push({ path: raw.path, mediaType: raw.mediaType, byteLength: raw.byteLength, sha256: raw.sha256 })
  }

  return {
    ok: true,
    manifest: {
      format: PACKAGE_FORMAT,
      packageVersion: json.packageVersion,
      domainSchemaVersion: json.domainSchemaVersion,
      projectId: json.projectId,
      exportedAt: json.exportedAt,
      buildboxVersion: json.buildboxVersion,
      ...(json.preview === true ? { preview: true as const } : {}),
      entries,
    },
  }
}
