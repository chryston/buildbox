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

/**
 * The IDs a migration invents, named for the caller that asked for them (#42 §3), starting past the
 * highest number the file already carries. The eighth step invents Drawing Layer IDs from the same
 * allocator, and a committed fixture's views are named `view-1`, `view-2` — an allocator that starts
 * at one would hand a Layer an ID a View already holds, and the migrated Project would not validate.
 */
const allocator = (prefix: string, record: unknown): ((count: number) => string[]) => {
  const taken = [...JSON.stringify(record).matchAll(new RegExp(`${prefix}-(\\d+)`, 'g'))]
  let issued = taken.reduce((max, match) => Math.max(max, Number(match[1])), 0)
  return (count) => Array.from({ length: count }, () => `${prefix}-${(issued += 1)}`)
}

/** A committed Project fixture, read and migrated exactly as the app reads one. */
export function domainFixture(relativePath: string, idPrefix = 'view'): Project {
  const envelope = JSON.parse(readFileSync(join(fixturesRoot, 'domain', relativePath), 'utf8')) as {
    domainSchemaVersion: number
    project: unknown
  }
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion, allocator(idPrefix, envelope.project))
  if (!result.ok) throw new Error(`${relativePath}: ${result.error.message}`)
  return result.project
}

/** Two Floors with Plan Images — one calibrated, one not — a cabinet placed twice, three generics. */
export const basicProject = (): Project => domainFixture('v1/project-basic.json')

/** The reference Project: three Floors, thirty cabinets, six hundred and thirty placements. */
export const referenceProject = (): Project => domainFixture('v3/reference-project.json')

/**
 * The #74 Plan View Range scene: one Floor with an upper limit of 2 600 and no lower one, W-1…W-4 at
 * 0–2 600, a window in W-1 at 900–2 100, and four placements — `Base cabinet #1` and `#2` at Base 0
 * (two placements of one design), `Wall cabinet #1` at 1 500 standing over the first of them, and a
 * `Sump box` at −150 — with the Floor's default Plan View ranged 0–1 200. That is one entity in each
 * Range Class, one pair of footprints that overlap, and one entity below the Floor Datum.
 */
export const planRangeScene = (): Project => domainFixture('v9/plan-range-scene.json')
