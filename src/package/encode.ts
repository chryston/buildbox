/**
 * Encoding a Project Backup (#44 §"Layout written by `encodeProject`").
 *
 * The output is deterministic to the byte: entries in a fixed order — manifest, project,
 * then assets by hash — every one of them stamped 1980-01-01 00:00:00, JSON deflated at
 * level 6, already-compressed images stored, and nothing else in the archive. The only
 * field that does not come from the Project is `exportedAt`, which the caller injects;
 * `package` never reads a clock (#42 §3).
 */
import { canonicalJsonBytes, sha256Hex, zipEntries, type ZipEntryInput } from '../lib'
import { DOMAIN_SCHEMA_VERSION, type Project } from '../domain'
import { assetPath, referencedAssetHashes } from './assets'
import {
  MANIFEST_ENTRY,
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  PROJECT_ENTRY,
  PROJECT_MEDIA_TYPE,
} from './constants'
import type { PackageManifest, PackageManifestEntry } from './manifest'

/** What the caller says about the build that is writing: never read from the environment. */
export interface PackageMeta {
  /** ISO-8601 UTC timestamp, injected by the caller. */
  readonly exportedAt: string
  readonly buildboxVersion: string
  /** `true` writes `preview: true`, which production imports refuse (#20 §11). */
  readonly preview: boolean
}

/** Where one asset's bytes live. The caller owns the asset store; `package` only asks. */
export type AssetSource = (sha256: string) => Promise<{ bytes: Uint8Array; mediaType: string }>

/**
 * Write `project` and every asset it references as one `.buildbox` archive.
 *
 * `assets` is asked once per distinct hash the Project references, in ascending hash
 * order; its media type is what the manifest records and what the extension is derived
 * from.
 */
export async function encodeProject(
  project: Project,
  assets: AssetSource,
  meta: PackageMeta,
): Promise<Uint8Array> {
  const projectBytes = canonicalJsonBytes(project)
  const entries: PackageManifestEntry[] = [
    {
      path: PROJECT_ENTRY,
      mediaType: PROJECT_MEDIA_TYPE,
      byteLength: projectBytes.length,
      sha256: await sha256Hex(projectBytes),
    },
  ]

  const assetEntries: ZipEntryInput[] = []
  for (const sha256 of referencedAssetHashes(project)) {
    const { bytes, mediaType } = await assets(sha256)
    entries.push({ path: assetPath(sha256, mediaType), mediaType, byteLength: bytes.length, sha256: await sha256Hex(bytes) })
    // Images arrive already compressed: deflating them again buys nothing and costs a
    // deterministic byte sequence, so they are stored (#44 §"Determinism rules").
    assetEntries.push({ name: assetPath(sha256, mediaType), data: bytes, level: 0 })
  }

  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    packageVersion: PACKAGE_FORMAT_VERSION,
    domainSchemaVersion: DOMAIN_SCHEMA_VERSION,
    projectId: project.id,
    exportedAt: meta.exportedAt,
    buildboxVersion: meta.buildboxVersion,
    ...(meta.preview ? { preview: true as const } : {}),
    entries,
  }
  const manifestBytes = canonicalJsonBytes(manifest)

  return zipEntries([
    { name: MANIFEST_ENTRY, data: manifestBytes, level: 6 },
    { name: PROJECT_ENTRY, data: projectBytes, level: 6 },
    ...assetEntries,
  ])
}
