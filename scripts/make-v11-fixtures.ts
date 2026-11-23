/**
 * Writes the `fixtures/domain/v11/` goldens (#76 §4).
 *
 * Run it with `npx vite-node scripts/make-v11-fixtures.ts`. Every v10 fixture is carried forward by
 * the real chain — the same `migrateProject` the app runs — and written as canonical JSON, so the
 * goldens are the bytes the chain actually produces, not a hand-edit of them. The v10 files are
 * never touched: they stay on disk as that version's permanent compatibility evidence.
 *
 * The one file that is not a carry is `clearance.json`: the shared elevation scene with the
 * Clearance Envelope the v10 step could not have invented — a 600 × 300 mm zone off the front edge
 * of the Base cabinet design, at its full 860 mm height — because that scene is what the #76
 * warnings tests and the package fixture are judged against. It is written by the same chain plus
 * the one field, so its bytes are still exactly what a build that knows envelopes would save.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '../src/lib'
import { DOMAIN_SCHEMA_VERSION, migrateProject, type ItemDesign, type Project } from '../src/domain'
import { MIGRATORS } from '../src/domain/migrate'

if (MIGRATORS.length !== 10 || DOMAIN_SCHEMA_VERSION !== 11) {
  console.error(`Expected ten migrators and schema v11, found ${String(MIGRATORS.length)} and v${String(DOMAIN_SCHEMA_VERSION)}.`)
  process.exit(1)
}

const SOURCE = join('fixtures', 'domain', 'v10')
const OUT = join('fixtures', 'domain', 'v11')
const NAMES = [
  'export',
  'layers-zero',
  'layers',
  'paste-elm',
  'paste-fitout',
  'plan-range-scene',
  'renovation',
  'renovation-views',
  'elevation-scene',
]

/** Sequential IDs, so a migrated fixture's new views are named the same way every run. */
function allocator(prefix = 'fixture-view'): (count: number) => string[] {
  let issued = 0
  return (count) => Array.from({ length: count }, () => `${prefix}-${(issued += 1)}`)
}

mkdirSync(OUT, { recursive: true })
for (const name of NAMES) {
  const envelope = JSON.parse(readFileSync(join(SOURCE, `${name}.json`), 'utf8')) as { domainSchemaVersion: number; project: unknown }
  const result = migrateProject(envelope.project, 10, allocator())
  if (!result.ok) {
    console.error(`${name}: ${result.error.message}`)
    process.exit(1)
  }
  writeFileSync(join(OUT, `${name}.json`), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: result.project })}\n`)
  console.info(`wrote ${join(OUT, `${name}.json`)}`)
}

// The Clearance Envelope golden: the elevation scene, one design carrying the zone its editor
// would have drawn — the front edge of the 600 × 500 Base cabinet, 300 mm out, the design's own
// 860 mm up from the Base. Every placement of the design shares it.
const scene = JSON.parse(readFileSync(join(OUT, 'elevation-scene.json'), 'utf8')) as { domainSchemaVersion: number; project: Project }
const base = scene.project.itemDesigns.find((design: ItemDesign) => design.id === 'pr-004')
if (base === undefined) {
  console.error('clearance: the elevation scene has no pr-004')
  process.exit(1)
}
base.clearanceEnvelope = {
  path: {
    start: { x: 0, y: 500 },
    segments: [
      { kind: 'line', to: { x: 600, y: 500 } },
      { kind: 'line', to: { x: 600, y: 800 } },
      { kind: 'line', to: { x: 0, y: 800 } },
      { kind: 'line', to: { x: 0, y: 500 } },
    ],
  },
  bottomOffset: 0,
  height: 860,
}
writeFileSync(join(OUT, 'clearance.json'), `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: scene.project })}\n`)
console.info(`wrote ${join(OUT, 'clearance.json')}`)
