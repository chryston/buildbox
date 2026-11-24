/**
 * Generate `fixtures/domain/v13/skirting-scene.json` and its browser seeds (#78, the photographed scene).
 *
 * The domain fixture `skirting.json` carries one Skirting and nothing to look at it in. This is the
 * scene the screenshot spec photographs: the same Floor, the same strip, and the two things a person
 * needs to see the record the way the issue describes it.
 *
 *   Skirting SK-3   a second strip on the opposite side of the Flat, 80 high and 12 off the face,
 *                   run from 500 to 5 500 along `W-4` — a different face, range, height and thickness
 *                   from `Skirting SK-1`, so the Skirting table and the Plan View have two rows and
 *                   two bodies to compare rather than one
 *   Kitchen section the Elevation View the Section criteria are stated against: the line
 *                   (0, 600) → (4 000, 600), `side: 'left'`, depth 3 000 — stood on `W-1`'s own
 *                   reference line and looking back over the Flat, so the band holds `W-1` whole,
 *                   `Skirting SK-1` at its foot from 0 to 100, and the cabinets standing in front of
 *                   it. The Section is a picture of the strip's two numbers against the Wall it is
 *                   skirted to, with the cabinet that would cover it on the plan drawn between them.
 *
 * Nothing here writes a field directly: the strip and the view are made with the same
 * `skirting.create` and `elevationView.create` Intents the tools dispatch, so the fixture cannot
 * describe a Project the editor could not have produced, and `validateProject` at the end proves the
 * transcript ends somewhere legal.
 *
 *   npx vite-node scripts/make-skirting-seed.ts
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
const SOURCE = resolve(repoRoot, 'fixtures/domain/v13/skirting.json')
const OUT = resolve(repoRoot, 'fixtures/domain/v13/skirting-scene.json')
const PREVIEW_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/skirting.json')
/**
 * The same scene with its Design Options taken out, for the smoke spec.
 *
 * #70 §7c shuts a baseline record's fields and handles while the Project carries an Option, and the
 * press that opens them is the Renovation inspector's. What the smoke spec is about is the Skirting's
 * own gestures — the tool, the face, the boxes, the flip, the delete, the Undo — and with no Option in
 * the Project there is nothing sharing the record, so each gesture commits as it always did.
 */
const PREVIEW_PLAIN_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/skirting-plain.json')
const DB_NAME = 'buildbox'

const NOW = '2026-01-01T10:20:00+08:00'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] =>
  Array.from({ length: count }, () => `sk-${String(++nextId).padStart(3, '0')}`)

function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

const envelope = JSON.parse(readFileSync(SOURCE, 'utf8')) as { domainSchemaVersion: number; project: Project }
const floorId = envelope.project.floors[0]?.id ?? fail('the source scene has no Floor')
const planViewId = envelope.project.views[0]?.id ?? fail('the source scene has no Plan View')
const farWall = envelope.project.existingModel.walls.find((wall) => wall.ref === 'W-4') ?? fail('the source scene has no W-4')

// --- the second Skirting ---------------------------------------------------------------------------

let current = apply(envelope.project, 'renovation.correctExistingModel', {
  inner: {
    type: 'skirting.create',
    payload: {
      floorId,
      hostWallId: farWall.id,
      side: 'right',
      start: 500,
      end: 5500,
      bottom: 0,
      height: 80,
      thickness: 12,
      label: 'Skirting SK-3',
    },
    label: INTENT_LABELS['skirting.create'],
    now: NOW,
  },
}, newIds(1))

// --- the section that looks at the first one -------------------------------------------------------

current = apply(
  current,
  'elevationView.create',
  {
    floorId,
    fromViewId: planViewId,
    line: { start: { x: 0, y: 600 }, end: { x: 4000, y: 600 } },
    side: 'left',
    depth: 3000,
    name: 'Kitchen section',
  },
  newIds(1),
)

// --- the check and the write -----------------------------------------------------------------------

const checked = validateProject(current)
if (!checked.ok) fail(`the scene does not validate: ${JSON.stringify(checked.problems, null, 2)}`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${canonicalJson({ domainSchemaVersion: 13, project: current })}\n`)

// The same Project as a browser fixture: committed through the production adapter and read back, so
// every record in the seed is one the app itself wrote — revision, summary and all. The Skirting and
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
      source: 'the skirting scene without Design Options (scripts/make-skirting-seed.ts)',
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
      source: 'the skirting scene (scripts/make-skirting-seed.ts)',
      projects: records,
      library: listed.value,
      assets: [],
    },
    null,
    2,
  )}\n`,
)

const skirting = current.existingModel.skirting ?? []
console.log(`wrote ${OUT} and ${PREVIEW_OUT}`)
for (const each of skirting) {
  console.log(`  ${each.label ?? each.id}: side ${each.side}, ${each.start}–${each.end}, ${each.height} × ${each.thickness} at ${each.bottom}`)
}
console.log(`  ${String(current.elevationViews?.length ?? 0)} Elevation View(s): ${(current.elevationViews ?? []).map((each) => each.name).join(', ')}`)
