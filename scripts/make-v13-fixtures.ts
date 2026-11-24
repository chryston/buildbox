/**
 * Writes the `fixtures/domain/v13/` goldens (#78 §1).
 *
 * Run it with `npx vite-node scripts/make-v13-fixtures.ts`. Every v12 fixture is carried forward by
 * the real chain — the same `migrateProject` the app runs — and written as canonical JSON, so the
 * goldens are the bytes the chain actually produces, not a hand-edit of them. The v12 files are
 * never touched: they stay on disk as that version's permanent compatibility evidence.
 *
 * The one file that is not a carry is `skirting.json`: the shared elevation scene with the Skirting
 * the v12 step could not have invented — one Existing Skirting drawn against a Wall of the scene and
 * one Proposed Skirting owned by its Design Option — because that scene is what the #78 derive,
 * warning, table and package tests are judged against. It is written by the same chain plus the two
 * records, so its bytes are still exactly what a build that knows Skirting would save.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '../src/lib'
import { DOMAIN_SCHEMA_VERSION, migrateProject, type Project } from '../src/domain'
import { refLength } from '../src/geometry'
import { MIGRATORS } from '../src/domain/migrate'

if (MIGRATORS.length !== 12 || DOMAIN_SCHEMA_VERSION !== 13) {
  console.error(`Expected twelve migrators and schema v13, found ${String(MIGRATORS.length)} and v${String(DOMAIN_SCHEMA_VERSION)}.`)
  process.exit(1)
}

const SOURCE = join('fixtures', 'domain', 'v12')
const OUT = join('fixtures', 'domain', 'v13')
const NAMES = [
  'beams-scene',
  'beams',
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
  const result = migrateProject(envelope.project, 12, allocator())
  if (!result.ok) {
    console.error(`${name}: ${result.error.message}`)
    process.exit(1)
  }
  writeFileSync(join(OUT, `${name}.json`), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: result.project })}\n`)
  console.info(`wrote ${join(OUT, `${name}.json`)}`)
}

// The Skirting golden: the renovation scene, plus one Skirting the Existing Model holds and one a
// Design Option proposes. Both are drawn against the scene's first Wall, on its left face, over the
// whole of that Wall: 100 mm tall, 15 mm thick, standing on the Floor Datum. The Option's Skirting
// is the same run on the other face, which is the edit the issue calls duplicating to the other side.
const scene = JSON.parse(readFileSync(join(OUT, 'renovation.json'), 'utf8')) as { domainSchemaVersion: number; project: Project }
const floorId = scene.project.floors[0]!.id
const host = scene.project.existingModel.walls.find((wall) => wall.floorId === floorId)
const option = scene.project.designOptions?.[0]
if (host === undefined || option === undefined) {
  console.error('skirting: the renovation scene carries no Wall or no Design Option')
  process.exit(1)
}
const length = Math.round(refLength(host.line))
;(scene.project.existingModel.skirting ??= []).push({
  id: 'skirting-1',
  floorId,
  hostWallId: host.id,
  side: 'left',
  start: 0,
  end: length,
  bottom: 0,
  height: 100,
  thickness: 15,
  label: 'Skirting SK-1',
})
;(option.proposed.skirting ??= []).push({
  id: 'skirting-2',
  floorId,
  hostWallId: host.id,
  side: 'right',
  start: 0,
  end: length,
  bottom: 0,
  height: 100,
  thickness: 15,
  label: 'Skirting SK-2',
  predecessorIds: ['skirting-1'],
})
// A predecessor is only honest when this Option actually takes the entity it names out of the way
// (#69 §3), so Skirting SK-2 replaces Skirting SK-1 rather than merely remembering it.
;(option.demolishedIds as string[]).push('skirting-1')
writeFileSync(join(OUT, 'skirting.json'), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: scene.project })}\n`)
console.info(`wrote ${join(OUT, 'skirting.json')}`)
