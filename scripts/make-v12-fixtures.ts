/**
 * Writes the `fixtures/domain/v12/` goldens (#77 §1).
 *
 * Run it with `npx vite-node scripts/make-v12-fixtures.ts`. Every v11 fixture is carried forward by
 * the real chain — the same `migrateProject` the app runs — and written as canonical JSON, so the
 * goldens are the bytes the chain actually produces, not a hand-edit of them. The v11 files are
 * never touched: they stay on disk as that version's permanent compatibility evidence.
 *
 * The one file that is not a carry is `beams.json`: the shared elevation scene with the Beam the v11
 * step could not have invented — one Existing Beam standing on the scene's Floor and one Proposed
 * Beam owned by its Design Option — because that scene is what the #77 warning, table and package
 * tests are judged against. It is written by the same chain plus the two records, so its bytes are
 * still exactly what a build that knows Beams would save.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '../src/lib'
import { DOMAIN_SCHEMA_VERSION, migrateProject, type Project } from '../src/domain'
import { MIGRATORS } from '../src/domain/migrate'

if (MIGRATORS.length !== 11 || DOMAIN_SCHEMA_VERSION !== 12) {
  console.error(`Expected eleven migrators and schema v12, found ${String(MIGRATORS.length)} and v${String(DOMAIN_SCHEMA_VERSION)}.`)
  process.exit(1)
}

const SOURCE = join('fixtures', 'domain', 'v11')
const OUT = join('fixtures', 'domain', 'v12')
const NAMES = [
  'clearance',
  'elevation-scene',
  'export',
  'layers-zero',
  'layers',
  'paste-elm',
  'paste-fitout',
  'plan-range-scene',
  'renovation',
  'renovation-views',
]

/** Sequential IDs, so a migrated fixture's new views are named the same way every run. */
function allocator(prefix = 'fixture-view'): (count: number) => string[] {
  let issued = 0
  return (count) => Array.from({ length: count }, () => `${prefix}-${(issued += 1)}`)
}

mkdirSync(OUT, { recursive: true })
for (const name of NAMES) {
  const envelope = JSON.parse(readFileSync(join(SOURCE, `${name}.json`), 'utf8')) as { domainSchemaVersion: number; project: unknown }
  const result = migrateProject(envelope.project, 11, allocator())
  if (!result.ok) {
    console.error(`${name}: ${result.error.message}`)
    process.exit(1)
  }
  writeFileSync(join(OUT, `${name}.json`), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: result.project })}\n`)
  console.info(`wrote ${join(OUT, `${name}.json`)}`)
}

// The Beam golden: the renovation scene, plus one Beam the Existing Model holds and one a Design
// Option proposes. The Existing Beam runs along the scene's Floor under the ceiling line, 200 mm
// wide and 300 mm deep with its Top at 2600, so its Underside sits at 2300; the Option's Beam is the
// same size one metre to the side and carries the Option's provenance.
const scene = JSON.parse(readFileSync(join(OUT, 'renovation.json'), 'utf8')) as { domainSchemaVersion: number; project: Project }
const floorId = scene.project.floors[0]!.id
const option = scene.project.designOptions?.[0]
if (option === undefined) {
  console.error('beams: the renovation scene carries no Design Option')
  process.exit(1)
}
;(scene.project.existingModel.beams ??= []).push({
  id: 'beam-1',
  floorId,
  line: { start: { x: 900, y: -400 }, end: { x: 3900, y: -400 } },
  justification: 'centre',
  width: 200,
  underside: 2300,
  height: 300,
  label: 'Beam B-1',
})
;(option.proposed.beams ??= []).push({
  id: 'beam-2',
  floorId,
  line: { start: { x: 900, y: 500 }, end: { x: 2900, y: 500 } },
  justification: 'centre',
  width: 200,
  underside: 2300,
  height: 300,
  label: 'Beam B-2',
  predecessorIds: ['beam-1'],
})
// A predecessor is only honest when this Option actually takes the entity it names out of the way
// (#69 §3), so Beam B-2 replaces Beam B-1 rather than merely remembering it.
;(option.demolishedIds as string[]).push('beam-1')
writeFileSync(join(OUT, 'beams.json'), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: scene.project })}\n`)
console.info(`wrote ${join(OUT, 'beams.json')}`)
