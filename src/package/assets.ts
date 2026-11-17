/**
 * Assets: the content-addressed members of a package (#44).
 *
 * An asset is addressed by the lowercase hex SHA-256 of its bytes and written once, so
 * the same image used by two Floors is one entry. The hash lives in the path, which
 * makes the archive self-checking: an entry whose bytes do not hash to its own name is
 * damage, not a different asset.
 */
import { ASSET_PREFIX } from './constants'
import { isRecord, isText } from './shape'

const ASSET_HASH = /^[0-9a-f]{64}$/

/** `assets/<sha256>.<ext>` — the only shape an asset entry may have. */
const ASSET_ENTRY = /^assets\/([0-9a-f]{64})\.([a-z0-9]+)$/

/**
 * The extension an asset entry carries, from its media type (#44). Anything the format
 * has no extension for — `image/avif`, `image/svg+xml`, and the legacy media types a
 * migrator may carry — is `bin`: the media type in the manifest is authoritative, the
 * extension is a courtesy to whoever unpacks the file by hand.
 */
export function assetExtension(mediaType: string): string {
  switch (mediaType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/bmp':
      return 'bmp'
    default:
      return 'bin'
  }
}

/** The path an asset with this hash and media type is written to. */
export const assetPath = (sha256: string, mediaType: string): string =>
  `${ASSET_PREFIX}${sha256}.${assetExtension(mediaType)}`

/** The hash an asset entry path names, or `null` when the path is not an asset entry. */
export function assetHashOf(path: string): string | null {
  const match = ASSET_ENTRY.exec(path)
  return match === null ? null : (match[1] as string)
}

/** Where one asset hash is referenced from, so a refusal can name the record. */
export interface AssetReference {
  readonly assetHash: string
  /** A domain path, e.g. `floors[1].planImage`. */
  readonly path: string
}

/**
 * Every asset a Project references, in document order, with the record that references
 * it (#44). The input is untrusted JSON on the import path, so the walk is defensive and
 * simply finds nothing where the shape is wrong — the domain validator is what reports
 * that shape later.
 */
export function assetReferences(project: unknown): AssetReference[] {
  const references: AssetReference[] = []
  if (isRecord(project) && Array.isArray(project.floors)) {
    for (const [index, floor] of project.floors.entries()) {
      if (!isRecord(floor) || !isRecord(floor.planImage)) continue
      const assetHash = floor.planImage.assetHash
      if (isText(assetHash) && ASSET_HASH.test(assetHash)) {
        references.push({ assetHash, path: `floors[${index}].planImage` })
      }
    }
  }
  return references
}

/** The distinct asset hashes a Project references, ascending — the order they are written in (#44). */
export function referencedAssetHashes(project: unknown): string[] {
  return [...new Set(assetReferences(project).map((reference) => reference.assetHash))].sort()
}
