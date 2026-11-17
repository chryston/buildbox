/**
 * The two entry points of the frozen legacy reader (#40 §1): read a downloaded workspace
 * file, and check what is in `localStorage['buildbox-store']` before anything touches it.
 *
 * Both are pure and total: they never throw, never mutate their input, and return every
 * problem they found rather than the first one.
 */
import { isRecord } from './guards'
import { migrateLegacyState, upgradeLegacyDesign } from './migrate'
import { ROOT_PATH, problem, type ValidationProblem } from './problems'
import { validateLegacyDesigns, validateLegacyPersistedState } from './validate'
import type { LegacyDesign, LegacyWorkspaceFile } from './types'

/** The only workspace file version this app has ever written. */
export const WORKSPACE_FILE_VERSION = 1

/** The highest persist version this app understands; above it the data came from later. */
export const MAX_PERSIST_VERSION = 3

export type LegacyWorkspaceRead =
  | { ok: true; file: LegacyWorkspaceFile }
  | { ok: false; problems: ValidationProblem[] }

export type LegacyStoreCheck =
  | { ok: true }
  | { ok: false; problems: ValidationProblem[] }

const badJson = (): ValidationProblem[] =>
  [problem(ROOT_PATH, 'bad-json', 'The file is not valid JSON.')]

/**
 * Parse a downloaded `.buildbox.json`, upgrade any pre-`units` Design, and validate.
 * `newId` is what the upgrade hands to each new unit id, so the caller keeps control of
 * id generation (the toolbar passes `() => crypto.randomUUID()`, as today).
 */
export function readLegacyWorkspaceFile(json: string, newId: () => string): LegacyWorkspaceRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, problems: badJson() }
  }
  if (!isRecord(parsed)) {
    return { ok: false, problems: [problem(ROOT_PATH, 'wrong-type', 'Expected a BuildBox workspace file.')] }
  }

  const problems: ValidationProblem[] = []
  const rawVersion = parsed.version
  if (rawVersion !== undefined) {
    if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion)) {
      problems.push(problem('version', 'wrong-type', 'Expected a whole-number file version.'))
    } else if (rawVersion > WORKSPACE_FILE_VERSION) {
      problems.push(problem('version', 'newer-version', 'This file was written by a newer version of BuildBox.'))
    } else if (rawVersion < WORKSPACE_FILE_VERSION) {
      problems.push(problem('version', 'out-of-range', 'This file version is no longer supported.'))
    }
  }

  const rawProjects = parsed.projects
  let projects: unknown[] = []
  if (rawProjects === undefined) {
    problems.push(problem('projects', 'missing-field', 'Missing the list of projects.'))
  } else if (!Array.isArray(rawProjects)) {
    problems.push(problem('projects', 'wrong-type', 'Expected a list of projects.'))
  } else if (rawProjects.length === 0) {
    problems.push(problem('projects', 'empty-list', 'Expected at least one project.'))
  } else {
    projects = rawProjects.map((project) => upgradeLegacyDesign(project, newId))
    problems.push(...validateLegacyDesigns(projects, 'projects'))
  }

  if (problems.length > 0) return { ok: false, problems }

  // `validateLegacyDesigns` has just checked every field these types describe.
  const designs = projects as LegacyDesign[]

  return {
    ok: true,
    file: {
      version: typeof rawVersion === 'number' ? rawVersion : WORKSPACE_FILE_VERSION,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
      projects: designs,
      activeProjectId: typeof parsed.activeProjectId === 'string' ? parsed.activeProjectId : null,
    },
  }
}

/**
 * Whether `localStorage['buildbox-store']` can be opened. `raw` is the stored string,
 * verbatim. The envelope is parsed, migrated on a copy and validated, so a problem names
 * the path inside the value the user could download.
 */
export function checkLegacyStore(raw: string): LegacyStoreCheck {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, problems: badJson() }
  }
  if (!isRecord(parsed)) {
    return { ok: false, problems: [problem(ROOT_PATH, 'wrong-type', 'Expected the saved BuildBox data.')] }
  }

  const problems: ValidationProblem[] = []
  const version = parsed.version
  if (version === undefined) {
    problems.push(problem('version', 'missing-field', 'Missing the version of the saved data.'))
  } else if (typeof version !== 'number' || !Number.isInteger(version)) {
    problems.push(problem('version', 'wrong-type', 'Expected a whole-number data version.'))
  } else if (version > MAX_PERSIST_VERSION) {
    problems.push(problem('version', 'newer-version', 'This data was saved by a newer version of BuildBox.'))
  } else if (version < 0) {
    problems.push(problem('version', 'out-of-range', 'The saved data version is not supported.'))
  }
  // Without a usable version there is no honest migration to run, and guessing one is
  // how a v4 state would get rewritten as a v3 one.
  if (problems.length > 0) return { ok: false, problems }

  problems.push(...validateLegacyPersistedState(migrateLegacyState(parsed.state, version as number, sequenceIds())))
  return problems.length > 0 ? { ok: false, problems } : { ok: true }
}

/**
 * The v0 → v1 migration needs an id for the unit it invents. `checkLegacyStore` throws
 * the migrated value away, so these only have to be unique inside one Design — a counter
 * keeps the check pure and its output reproducible.
 */
function sequenceIds(): () => string {
  let issued = 0
  return () => `checked-${++issued}`
}
