/**
 * The domain schema version and its migrator chain (#42 §5).
 *
 * `DOMAIN_SCHEMA_VERSION` is one of three independent version constants (#20 §12): the
 * workspace file version and the IndexedDB `schemaVersion` say nothing about it. It says
 * what shape a Project has.
 *
 * Migration is explicit and sequential (#14): one pure migrator per version bump, never
 * a best-effort cast, always on a copy, and a version this build does not know is
 * refused before anything is mutated. `MIGRATIONS.md` next door is the rule for the
 * issue that adds the next one.
 */
import type { ValidationProblem } from '../lib'
import type { Project } from './project'
import { validateProject } from './validate'

/** The domain schema this build writes and understands at the top of the chain. */
export const DOMAIN_SCHEMA_VERSION = 1

/** One pure vN → vN+1 step. Its input is already a copy; it never reads the clock. */
export type Migrator = (data: unknown) => unknown

/**
 * `MIGRATORS[i]` migrates v(i+1) → v(i+2). v1 is the first schema, so there is nothing
 * to migrate from yet and the chain is empty; the issue that bumps the version appends
 * the first entry.
 */
export const MIGRATORS: readonly Migrator[] = []

export type MigrateError =
  /** Data from a newer BuildBox: refused, never guessed at (#20 §5). */
  | { kind: 'newer-schema'; found: number; supported: number; message: string }
  /** No usable version on the envelope at all. */
  | { kind: 'unknown-schema'; found: unknown; message: string }
  /** Migrated, but still not a valid Project. */
  | { kind: 'invalid'; problems: ValidationProblem[]; message: string }

export type MigrateResult =
  | { ok: true; project: Project; migratedFrom: number }
  | { ok: false; error: MigrateError }

/**
 * Apply `chain` to `data` from version `from` up to the top, on a copy.
 *
 * Exported separately from {@link migrateProject} so a test can drive a synthetic
 * multi-step chain without shipping fake schema versions. `from` is assumed to be an
 * integer of 1 or more; a chain shorter than `from` applies no steps.
 */
export function runMigrationChain(data: unknown, from: number, chain: readonly Migrator[]): unknown {
  // Migration always runs on a copy: the caller's value is never mutated (#14).
  let current = structuredClone(data)
  for (let index = from - 1; index < chain.length; index += 1) {
    current = (chain[index] as Migrator)(current)
  }
  return current
}

/**
 * Bring `data`, recorded as arriving at `fromVersion`, up to {@link DOMAIN_SCHEMA_VERSION}
 * and validate it. `fromVersion` is `unknown` because it comes off an untrusted envelope.
 */
export function migrateProject(data: unknown, fromVersion: unknown): MigrateResult {
  if (typeof fromVersion !== 'number' || !Number.isInteger(fromVersion) || fromVersion < 1) {
    return {
      ok: false,
      error: {
        kind: 'unknown-schema',
        found: fromVersion,
        message: `This Project's schema version is missing or unreadable — expected a whole number of 1 or more, found ${String(fromVersion)}.`,
      },
    }
  }

  if (fromVersion > DOMAIN_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        kind: 'newer-schema',
        found: fromVersion,
        supported: DOMAIN_SCHEMA_VERSION,
        message: `This Project was saved by a newer BuildBox (schema ${fromVersion}). This version opens schema ${DOMAIN_SCHEMA_VERSION} and older.`,
      },
    }
  }

  const migrated = runMigrationChain(data, fromVersion, MIGRATORS)
  const result = validateProject(migrated)
  if (!result.ok) {
    return {
      ok: false,
      error: {
        kind: 'invalid',
        problems: result.problems,
        message: `This Project does not match BuildBox domain schema ${DOMAIN_SCHEMA_VERSION}.`,
      },
    }
  }

  return { ok: true, project: result.project, migratedFrom: fromVersion }
}
