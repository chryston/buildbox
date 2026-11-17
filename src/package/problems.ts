/**
 * The typed problems a staged import can refuse with (#44 §"Typed problems").
 *
 * A code is a stable kebab-case contract with `ui/strings`, which owns every word the
 * user sees: `export-not-backup` becomes "This is an export, not a BuildBox Backup"
 * there (#19), never here. The codec emits no user-facing text at all.
 *
 * `path` names the record at fault — an entry path, or a domain path inside
 * `project.json` — and `detail` carries only numbers and identifiers such as a version
 * or a content hash. Neither ever carries a value read out of the file: a failure is
 * reported "without exposing sensitive content" (#14).
 */
import type { ValidationProblem } from '../lib'

/**
 * Every refusal the codec can produce, in the order the steps that raise them run. This
 * is the list `ui/strings` keys off and the list a fuzz run asserts against; the type
 * below is derived from it, so a code can never be added to one and not the other.
 */
export const PACKAGE_PROBLEM_CODES = [
  /** Step 1: the file itself is over `maxInputBytes`. */
  'too-large',
  /** Step 1: bytes that are not a BuildBox Backup and not any export either. */
  'not-a-backup',
  /** Step 1 or 3: an export ZIP, or a loose CSV, PDF, SVG or PNG (#19). */
  'export-not-backup',
  /** Step 2: more entries than `maxEntries`. */
  'too-many-entries',
  /** Step 2: one entry over `maxEntryBytes`. */
  'entry-too-large',
  /** Step 2: the entries together over `maxTotalBytes`. */
  'total-too-large',
  /** Step 2: more than `maxRatio` uncompressed to compressed. */
  'ratio-exceeded',
  /** Step 2: an absolute, traversing, backslashed, drive-lettered, empty-segmented, duplicated or non-NFC name. */
  'bad-path',
  /** Step 2: an entry that is not `manifest.json`, `project.json` or `assets/<sha256>.<ext>`. */
  'unexpected-entry',
  /** Step 2: the bytes are a ZIP-shaped archive this cannot read. */
  'corrupt-archive',
  /** Step 3: the manifest is unreadable, malformed, or does not describe the archive. */
  'manifest-mismatch',
  /** Step 4: an entry's bytes are not what the manifest or its own name promises. */
  'hash-mismatch',
  /** Step 4: `project.json` references an asset the archive does not carry. */
  'missing-asset',
  /** Step 4: the archive carries an asset `project.json` never references. */
  'unreferenced-asset',
  /** Step 3: `packageVersion` is newer than this build writes. */
  'newer-package',
  /** Step 3: a preview-build package, and this build does not accept previews (#20 §11). */
  'preview-package',
  /** Step 5: `domainSchemaVersion` is newer than this build understands. */
  'newer-schema',
  /** Step 5: a migrator in the chain threw. */
  'migration-failed',
  /** Step 6: the migrated Project fails the strict domain validator, or is not the manifest's Project. */
  'invalid-project',
] as const

export type PackageProblemCode = (typeof PACKAGE_PROBLEM_CODES)[number]

export interface PackageProblem {
  readonly code: PackageProblemCode
  /** The entry or record at fault, when one is known. */
  readonly path?: string
  /** Numbers and identifiers only — never a value read out of the file. */
  readonly detail?: Record<string, string | number>
  /** Path-addressed validator problems; only ever present for `invalid-project`. */
  readonly problems?: ValidationProblem[]
}

/** One refusal, in the one shape every rejection comes back in. */
export const packageProblem = (
  code: PackageProblemCode,
  extra?: Omit<PackageProblem, 'code'>,
): { ok: false; problem: PackageProblem } => ({ ok: false, problem: extra ? { code, ...extra } : { code } })

/**
 * The domain validator's message for a problem, rewritten so no content value survives
 * (#14): the domain messages quote the duplicated ID or Floor name they collided with,
 * which is exactly the user content a failed import must not echo back.
 */
export const redactedProblem = (at: ValidationProblem): ValidationProblem => ({
  path: at.path,
  code: at.code,
  message: `The Project failed domain validation at ${at.path === '' ? 'its root' : at.path} (${at.code}).`,
})
