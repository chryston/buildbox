/**
 * The archive and its manifest (#61 §6).
 *
 * A ZIP of drawings is only useful if a reader can tell which file is which without opening them,
 * so the archive carries a `manifest.json` beside them: the recipe that produced the set, the
 * provenance that travels with any single file, and one entry per file saying which view it is and
 * what the export had to say about it. The manifest is the same JSON the archive's own entries are
 * described by, so nothing is written twice in two places that can disagree.
 *
 * The bytes come from `lib`'s archiver, which is the one the Backup uses: one fixed timestamp, one
 * entry order (the caller's), one compression level. Criterion 1's "byte-identical archive" is
 * therefore a property of a thing already under test rather than a second implementation to trust.
 */

import { zipEntries } from '../lib'
import type { Recipe, ExportFile, ExportSnapshot } from './types'
import type { Provenance } from './provenance'

/** What one file in the archive is (export contract §9). */
export interface ManifestFile {
  /** Where the file sits in the archive. */
  readonly path: string
  /** `manifest` for this file itself, so an extracted archive explains itself. */
  readonly kind: 'drawing' | 'manifest'
  readonly format: string
  readonly media_type: string
  /** The size of the file in the archive; absent for the manifest, which cannot know its own. */
  readonly bytes?: number
  /** The same, so a reader can check the file survived the trip; absent for the manifest. */
  readonly sha256?: string
  /** Which export contract wrote this entry. */
  readonly contract_version: string
  /** The view a drawing shows; absent on the manifest. */
  readonly view?: string
  /** The floor or Item Design the drawing is of. */
  readonly subject?: string
  /** The scale statement printed on the sheet. */
  readonly scale?: string
  /** What the export had to say: a notice naming a label whose glyph was missing, and so on. */
  readonly warnings: readonly string[]
}

/** What a reader of `manifest.json` matches on to know what it is holding. */
export const MANIFEST_FORMAT = 'buildbox-export'
/** Bumped when the fields below change meaning, not when one is added. */
export const MANIFEST_VERSION = 1

/** The archive's own contents, as a reader finds them. */
export interface Manifest {
  readonly format: typeof MANIFEST_FORMAT
  readonly manifest_version: number
  readonly contract_version: string
  readonly generator: 'BuildBox'
  readonly buildbox_version: string
  readonly exported_at: string
  readonly project_id: string
  readonly project_revision: number
  readonly unsaved_changes?: true
  readonly recipe: Recipe
  readonly files: readonly ManifestFile[]
}

/**
 * The manifest for one export, from the same provenance the files carry.
 *
 * Asynchronous because an entry carries the SHA-256 of the file it describes, and the only SHA-256
 * worth having is the host's own — the one the Backup and the `.buildbox` codec already use, so a
 * digest in a manifest means the same thing as one in a Package.
 */
export async function manifestOf(
  snapshot: ExportSnapshot,
  recipe: Recipe,
  provenance: Provenance,
  files: readonly ManifestFile[],
): Promise<Manifest> {
  return {
    format: MANIFEST_FORMAT,
    manifest_version: MANIFEST_VERSION,
    contract_version: provenance.contract_version,
    generator: provenance.generator,
    buildbox_version: provenance.buildbox_version,
    exported_at: provenance.exported_at,
    project_id: snapshot.project.id,
    project_revision: snapshot.revision,
    ...(provenance.unsaved_changes === true ? { unsaved_changes: true as const } : {}),
    recipe,
    files,
  }
}

/** The manifest as bytes: keys in the order above, two-space indented, one trailing newline. */
export function manifestBytes(manifest: Manifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * The archive.
 *
 * Entries in the caller's order, at the archiver's default level, with the archiver's one fixed
 * timestamp — which is why two exports of the same drawings are the same bytes even though the
 * manifest's own `exported_at` differs between them only when the clock moved.
 */
export function zipOf(files: readonly ExportFile[]): Uint8Array {
  return zipEntries(files.map((file) => ({ name: file.name, data: file.bytes })))
}
