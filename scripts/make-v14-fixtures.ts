/**
 * Writes the `fixtures/domain/v14/` goldens (#79 §1).
 *
 * Run it with `npx vite-node scripts/make-v14-fixtures.ts`. Every v13 fixture is carried forward by
 * the real chain — the same `migrateProject` the app runs — and written as canonical JSON, so the
 * goldens are the bytes the chain actually produces, not a hand-edit of them. The v13 files are
 * never touched: they stay on disk as that version's permanent compatibility evidence.
 *
 * The one file that is not a carry is `services.json`: the shared renovation scene with the Services
 * the v14 step could not have invented — a round Run, a rectangular Run, a Riser, one Run below the
 * Floor Datum and one Run owned by a Design Option — because that scene is what the #79 derive,
 * warning, table and package tests are judged against. It is written by the same chain plus those
 * records, so its bytes are still exactly what a build that knows Services would save.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '../src/lib'
import { DOMAIN_SCHEMA_VERSION, migrateProject, type Project } from '../src/domain'
import { MIGRATORS } from '../src/domain/migrate'

if (MIGRATORS.length !== 13 || DOMAIN_SCHEMA_VERSION !== 14) {
  console.error(`Expected thirteen migrators and schema v14, found ${String(MIGRATORS.length)} and v${String(DOMAIN_SCHEMA_VERSION)}.`)
  process.exit(1)
}

const SOURCE = join('fixtures', 'domain', 'v13')
const OUT = join('fixtures', 'domain', 'v14')
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
  'skirting',
]

/** Sequential IDs, so a migrated fixture's new views are named the same way every run. */
function allocator(prefix = 'fixture-view'): (count: number) => string[] {
  let issued = 0
  return (count) => Array.from({ length: count }, () => `${prefix}-${(issued += 1)}`)
}

mkdirSync(OUT, { recursive: true })
for (const name of NAMES) {
  const envelope = JSON.parse(readFileSync(join(SOURCE, `${name}.json`), 'utf8')) as { domainSchemaVersion: number; project: unknown }
  const result = migrateProject(envelope.project, 13, allocator())
  if (!result.ok) {
    console.error(`${name}: ${result.error.message}`)
    process.exit(1)
  }
  writeFileSync(join(OUT, `${name}.json`), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: result.project })}\n`)
  console.info(`wrote ${join(OUT, `${name}.json`)}`)
}

// The Service golden: the renovation scene, plus four Services the Existing Model holds and one a
// Design Option proposes — every shape and every vertical case the issue names. The Runs are one
// round and one rectangular bar across the room; the Riser is a vertical Ø100 through one point; the
// below-Datum Run is the one the Plan View Range fades; and the Option's Run is work invented there,
// so it carries the empty provenance list that means exactly that (#69 §3).
const scene = JSON.parse(readFileSync(join(OUT, 'renovation.json'), 'utf8')) as { domainSchemaVersion: number; project: Project }
const floorId = scene.project.floors[0]!.id
const option = scene.project.designOptions?.[0]
if (option === undefined) {
  console.error('services: the renovation scene carries no Design Option')
  process.exit(1)
}
;(scene.project.existingModel.services ??= []).push(
  {
    id: 'service-1',
    floorId,
    kind: 'water',
    shape: 'run',
    section: 'round',
    line: { start: { x: 600, y: 1200 }, end: { x: 3600, y: 1200 } },
    centrelineElevation: 2200,
    outsideDiameter: 50,
  },
  {
    id: 'service-2',
    floorId,
    kind: 'air_con',
    shape: 'run',
    section: 'rectangular',
    line: { start: { x: 600, y: 1600 }, end: { x: 2600, y: 1600 } },
    centrelineElevation: 2500,
    width: 80,
    depth: 60,
  },
  {
    id: 'service-3',
    floorId,
    kind: 'drain',
    shape: 'riser',
    point: { x: 3400, y: 2200 },
    outsideDiameter: 100,
    bottomElevation: 0,
    height: 2600,
  },
  {
    id: 'service-4',
    floorId,
    kind: 'electrical',
    shape: 'run',
    section: 'round',
    line: { start: { x: 800, y: 2000 }, end: { x: 2800, y: 2000 } },
    centrelineElevation: -100,
    outsideDiameter: 100,
    label: 'Underfloor trunking',
  },
)
;(option.proposed.services ??= []).push({
  id: 'service-5',
  floorId,
  kind: 'gas',
  shape: 'run',
  section: 'round',
  line: { start: { x: 3000, y: 600 }, end: { x: 3000, y: 1400 } },
  centrelineElevation: 300,
  outsideDiameter: 25,
  predecessorIds: [],
})
writeFileSync(join(OUT, 'services.json'), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: scene.project })}\n`)
console.info(`wrote ${join(OUT, 'services.json')}`)
