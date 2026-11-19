/**
 * The `derive` module's second entry point (#42 §7): the Project fixtures its tests read,
 * reachable from a `*.test.ts` file and from nothing else.
 *
 * `edit`'s `basicProject` would be the shorter route, and `derive` may not import `edit`
 * (#20 §2), so the committed `fixtures/domain` files are read and migrated here instead —
 * the same bytes the app reads, and no hand-rolled Project that could drift from the schema.
 * Reading them through `migrateProject` also means a test of a derivation is a test of the
 * version of the data the app actually holds, not of whatever shape the file happens to be
 * saved in (#42 §5).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateProject } from '../domain'
import type { Project } from '../domain'

const fixturesRoot = fileURLToPath(new URL('../../fixtures', import.meta.url))

/** The IDs a migration invents, named for the caller that asked for them (#42 §3). */
const allocator = (prefix: string): ((count: number) => string[]) => {
  let issued = 0
  return (count) => Array.from({ length: count }, () => `${prefix}-${++issued}`)
}

/** A committed Project fixture, read and migrated exactly as the app reads one. */
export function domainFixture(relativePath: string, idPrefix = 'view'): Project {
  const envelope = JSON.parse(readFileSync(join(fixturesRoot, 'domain', relativePath), 'utf8')) as {
    domainSchemaVersion: number
    project: unknown
  }
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion, allocator(idPrefix))
  if (!result.ok) throw new Error(`${relativePath}: ${result.error.message}`)
  return result.project
}

/** Two Floors with Plan Images — one calibrated, one not — a cabinet placed twice, three generics. */
export const basicProject = (): Project => domainFixture('v1/project-basic.json')

/** The reference Project: three Floors, thirty cabinets, six hundred and thirty placements. */
export const referenceProject = (): Project => domainFixture('v3/reference-project.json')
