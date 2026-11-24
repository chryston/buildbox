/**
 * Generate `fixtures/domain/v14/services-scene.json` and its browser seeds (#79, the photographed scene).
 *
 * The source is the domain fixture: five Services already placed by Intents, one of them Proposed in
 * `option-a`. This script adds what a browser spec needs and a domain fixture has no reason to carry —
 * an Elevation View looking at the Riser, so the Section list offers a section with a Service row in
 * it, and the two browser seeds committed through the production adapter.
 *
 * The plain twin has its Design Options taken out. #70 §7c shuts a baseline record's fields and
 * handles while the Project carries an Option, and what the smoke spec is about is the Service's own
 * gestures — the tool, the two shapes, the boxes, the delete, the Undo — so each gesture has to commit
 * as it always did.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, INTENT_LABELS } from '../src/edit'
import type { IntentType, PayloadOf } from '../src/edit'
import { validateProject } from '../src/domain'
import type { Project } from '../src/domain'
import { createMemoryAdapter } from '../src/persistence'
import type { ProjectRecord } from '../src/persistence'
import { canonicalJson } from '../src/lib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/domain/v14/services.json')
const OUT = resolve(repoRoot, 'fixtures/domain/v14/services-scene.json')
const PREVIEW_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/services.json')
const PREVIEW_PLAIN_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/services-plain.json')
const DB_NAME = 'buildbox'

const NOW = '2026-01-01T10:20:00+08:00'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] =>
  Array.from({ length: count }, () => `sv-${String(++nextId).padStart(3, '0')}`)

function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

const envelope = JSON.parse(readFileSync(SOURCE, 'utf8')) as { domainSchemaVersion: number; project: Project }
const floorId = envelope.project.floors[0]?.id ?? fail('the source scene has no Floor')
const planViewId = envelope.project.views[0]?.id ?? fail('the source scene has no Plan View')
const riser = (envelope.project.existingModel.services ?? []).find((each) => each.shape === 'riser')
if (riser === undefined) fail('the source scene has no Riser to look at')

// --- the section that looks at the Riser -----------------------------------------------------------
// A vertical cut through the Riser's centre: the Riser is the one Service whose whole extent is
// interesting, and a section across it shows the Run passing behind it (#79 §Drawing).
let current = apply(
  envelope.project,
  'elevationView.create',
  {
    floorId,
    fromViewId: planViewId,
    // A cut through the Riser's centre running along the plan's x axis: the Riser stands on the line,
    // so the section shows its full height, and the Runs pass behind it (#79 §Drawing).
    line: { start: { x: 0, y: riser.point.y }, end: { x: 6000, y: riser.point.y } },
    side: 'left',
    depth: 3000,
    name: 'Service section',
  },
  newIds(1),
)

// --- the check and the write -----------------------------------------------------------------------

const checked = validateProject(current)
if (!checked.ok) fail(`the scene does not validate: ${JSON.stringify(checked.problems, null, 2)}`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${canonicalJson({ domainSchemaVersion: 14, project: current })}\n`)

// The same Project as a browser fixture: committed through the production adapter and read back, so
// every record in the seed is one the app itself wrote — revision, summary and all. The Services and
// the Elevation View both have to survive that round trip for the browser spec to have anything to
// draw.
const ports = createMemoryAdapter()
const committed = await ports.projects.commit({ project: current, revision: 1, savedAt: NOW, newAssets: [] }, null)
if (!committed.ok) fail(`committing the scene failed: ${committed.error.kind}`)
const listed = await ports.projects.list({ includeTrashed: false })
if (!listed.ok) fail(`reading the library back failed: ${listed.error.kind}`)
const records: ProjectRecord[] = []
for (const row of listed.value) {
  const loaded = await ports.projects.load(row.id)
  if (!loaded.ok) fail(`reading "${row.id}" back failed: ${loaded.error.kind}`)
  records.push(loaded.value)
}
// The plain twin: the same records, no Option to share them, committed the same way.
const plainPorts = createMemoryAdapter()
const plainProject: Project = { ...current, designOptions: [] }
const plainCommitted = await plainPorts.projects.commit(
  { project: plainProject, revision: 1, savedAt: NOW, newAssets: [] },
  null,
)
if (!plainCommitted.ok) fail(`committing the plain scene failed: ${plainCommitted.error.kind}`)
const plainListed = await plainPorts.projects.list({ includeTrashed: false })
if (!plainListed.ok) fail(`reading the plain library back failed: ${plainListed.error.kind}`)
const plainRecords: ProjectRecord[] = []
for (const row of plainListed.value) {
  const loaded = await plainPorts.projects.load(row.id)
  if (!loaded.ok) fail(`reading the plain "${row.id}" back failed: ${loaded.error.kind}`)
  plainRecords.push(loaded.value)
}
mkdirSync(dirname(PREVIEW_PLAIN_OUT), { recursive: true })
writeFileSync(
  PREVIEW_PLAIN_OUT,
  `${JSON.stringify(
    {
      dbName: DB_NAME,
      source: 'the service scene without Design Options (scripts/make-service-seed.ts)',
      projects: plainRecords,
      library: plainListed.value,
      assets: [],
    },
    null,
    2,
  )}\n`,
)

mkdirSync(dirname(PREVIEW_OUT), { recursive: true })
writeFileSync(
  PREVIEW_OUT,
  `${JSON.stringify(
    {
      dbName: DB_NAME,
      source: 'the service scene (scripts/make-service-seed.ts)',
      projects: records,
      library: listed.value,
      assets: [],
    },
    null,
    2,
  )}\n`,
)

const services = current.existingModel.services ?? []
console.log(`wrote ${OUT} and ${PREVIEW_OUT}`)
for (const each of services) {
  console.log(
    each.shape === 'run'
      ? `  ${each.label ?? each.id}: run ${each.kind} ${each.section} at ${each.centrelineElevation}`
      : `  ${each.label ?? each.id}: riser ${each.kind} Ø${each.outsideDiameter}, ${each.bottomElevation}+${each.height}`,
  )
}
console.log(`  ${String(current.elevationViews?.length ?? 0)} Elevation View(s): ${(current.elevationViews ?? []).map((each) => each.name).join(', ')}`)
