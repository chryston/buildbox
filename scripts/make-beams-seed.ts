/**
 * Generate `fixtures/domain/v12/beams-scene.json` and its browser seed (#77, the photographed scene).
 *
 * The domain fixture `beams.json` carries one Beam and nothing to look at it in. This is the scene
 * the screenshot spec photographs: the same Floor, the same Beam, and the two things a person needs
 * to see the record the way the issue describes it.
 *
 *   Beam B-2   a second Beam, 250 wide and 400 deep, its underside at 2 050, run across the room at
 *              y = 1 200 — a different length, width, depth and height from `Beam B-1`, so the Beams
 *              table and the Plan View have two rows and two bodies to compare rather than one
 *   Kitchen section   the Elevation View the Section criteria are stated against: the line
 *              (0, −400) → (4 000, −400), `side: 'left'`, depth 2 000. Its viewing normal is (0, −1),
 *              so the band runs from y = −400 up to y = 1 600 and holds `Beam B-1` — which lies on
 *              the line itself, straddling it — and nothing else. The Section is a picture of the
 *              Beam's two numbers, so the pane must hold only the Beam.
 *
 * Nothing here writes a field directly: the Beam and the view are made with the same `beam.create`
 * and `elevationView.create` Intents the tools dispatch, so the fixture cannot describe a Project
 * the editor could not have produced, and `validateProject` at the end proves the transcript ends
 * somewhere legal.
 *
 *   npx vite-node scripts/make-beams-seed.ts
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
const SOURCE = resolve(repoRoot, 'fixtures/domain/v12/beams.json')
const OUT = resolve(repoRoot, 'fixtures/domain/v12/beams-scene.json')
const PREVIEW_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/beams.json')
const DB_NAME = 'buildbox'

const NOW = '2026-01-01T10:20:00+08:00'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] =>
  Array.from({ length: count }, () => `bm-${String(++nextId).padStart(3, '0')}`)

function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

const envelope = JSON.parse(readFileSync(SOURCE, 'utf8')) as { domainSchemaVersion: number; project: Project }
const floorId = envelope.project.floors[0]?.id ?? fail('the source scene has no Floor')
const planViewId = envelope.project.views[0]?.id ?? fail('the source scene has no Plan View')

// --- the second Beam -------------------------------------------------------------------------------

let current = apply(envelope.project, 'renovation.correctExistingModel', {
  inner: {
    type: 'beam.create',
    payload: {
      floorId,
      line: { start: { x: 800, y: 1200 }, end: { x: 3200, y: 1200 } },
      justification: 'left',
      width: 250,
      underside: 2050,
      height: 400,
      label: 'Beam B-2',
    },
    label: INTENT_LABELS['beam.create'],
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
    line: { start: { x: 0, y: -400 }, end: { x: 4000, y: -400 } },
    side: 'left',
    depth: 2000,
    name: 'Kitchen section',
  },
  newIds(1),
)

// --- the check and the write -----------------------------------------------------------------------

const checked = validateProject(current)
if (!checked.ok) fail(`the scene does not validate: ${JSON.stringify(checked.problems, null, 2)}`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${canonicalJson({ domainSchemaVersion: 12, project: current })}\n`)

// The same Project as a browser fixture: committed through the production adapter and read back, so
// every record in the seed is one the app itself wrote — revision, summary and all. The Beam and the
// Elevation View both have to survive that round trip for the browser spec to have anything to draw.
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
mkdirSync(dirname(PREVIEW_OUT), { recursive: true })
writeFileSync(
  PREVIEW_OUT,
  `${JSON.stringify(
    {
      dbName: DB_NAME,
      source: 'the beams scene (scripts/make-beams-seed.ts)',
      projects: records,
      library: listed.value,
      assets: [],
    },
    null,
    2,
  )}\n`,
)

const beams = current.existingModel.beams ?? []
console.log(`wrote ${OUT} and ${PREVIEW_OUT}`)
for (const beam of beams) {
  console.log(`  ${beam.label ?? beam.id}: ${beam.width} × ${beam.height} deep, underside ${beam.underside}`)
}
console.log(`  ${String(current.elevationViews?.length ?? 0)} Elevation View(s): ${(current.elevationViews ?? []).map((each) => each.name).join(', ')}`)
