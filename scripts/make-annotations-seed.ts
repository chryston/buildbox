/**
 * The Annotations scene (#81 §12).
 *
 * The Comments scene already has the drawing the Annotations need to sit on: a Floor with Walls,
 * Openings and Placed Items, Design Options to scope by, and a Plan View. Migrated to v16 it gains
 * `annotations: []` and the reference counter empty — the honest start — and the five Annotations
 * below are then added as data, one per type, so the Annotations tab, the overlay marks, the editor
 * and the Reference Marker's cross-view target all have something real to show.
 *
 * They are numbered A-001 to A-005 and the counter is left at 6, the number the next Annotation would
 * be given, so a test can tell "the fifth Annotation" from "one this scene made". A second Plan View
 * of the same Floor is added so the Reference Marker has a target that stays in Plan mode when a
 * person follows it.
 *
 * Run with `npx vite-node scripts/make-annotations-seed.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateProject, validateProject } from '../src/domain'
import type { Annotation, Project } from '../src/domain'
import { createMemoryAdapter } from '../src/persistence'
import type { ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/services.json')
const PREVIEW_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/annotations-scene.json')
const DB_NAME = 'buildbox'
const NOW = '2026-11-18T09:00:00.000Z'

const fail = (message: string): never => {
  console.error(`make-annotations-seed: ${message}`)
  process.exit(1)
}

const seed = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
  projects: { id: string; schemaVersion: number; data: unknown }[]
}
const record = seed.projects[0]!

// The scene is migrated by the same chain the app runs, so the seed holds what a person who opened
// this Project today would have in front of them — including `annotations: []`.
const migrated = migrateProject(record.data, record.schemaVersion, () => 'unused-no-ids-needed')
if (!migrated.ok) fail(`migrating the scene failed: ${migrated.error.message}`)
const base = migrated.project as Project
if (base.annotations.length !== 0) fail('the migrated scene was expected to hold no Annotations')

const planView = base.views.find((view) => view.kind === 'plan') ?? null
if (planView === null) fail('the scene has no Plan View to draw an Annotation on')
const elevation = base.elevationViews?.[0] ?? null
if (elevation === null) fail('the scene has no Elevation View for a Reference Marker to target')
const wall = base.existingModel.walls[0]!

// A second Plan View of the same Floor, so the Reference Marker's target stays in Plan mode when a
// person follows it rather than jumping to an Elevation.
const secondView = {
  id: 'seed-view-002',
  kind: 'plan' as const,
  floorId: planView.floorId,
  name: 'Reflected ceiling',
  isDefault: false,
  planViewRange: { lowerMm: 0, upperMm: 2600 },
  showPlanImage: true,
}

const annotation = (
  reference: string,
  type: Annotation['type'],
  over: Partial<Annotation>,
): Annotation => ({
  id: `annotation-${reference}`,
  reference,
  type,
  viewId: planView.id,
  position: { x: 2000, y: 1500 },
  text: 'Annotation',
  layerId: null,
  scope: 'all',
  ...over,
})

const annotations: Annotation[] = [
  annotation('A-001', 'text', { position: { x: 1800, y: 1200 }, text: 'Check the clear height above the island' }),
  annotation('A-002', 'leader', {
    position: { x: 3200, y: 2400 },
    text: 'Conduit chased to this wall',
    endpoint: { anchor: { kind: 'entity', entityId: wall.id } },
  }),
  annotation('A-003', 'arrow', {
    position: { x: 4200, y: 1600 },
    text: 'Door swings this way',
    endpoint: { free: { x: 4800, y: 1900 } },
  }),
  annotation('A-004', 'revision_cloud', {
    position: { a: { x: 5200, y: 900 }, b: { x: 6400, y: 1500 } },
    text: 'Revised at the client’s request',
    style: { cloudTint: true },
  }),
  annotation('A-005', 'reference_marker', {
    position: { x: 2600, y: 3000 },
    text: 'See the ceiling plan',
    targetViewId: secondView.id,
    style: { markerShape: 'hexagon' },
  }),
]

const project: Project = {
  ...base,
  views: [...base.views, secondView],
  annotations,
  annotationReferenceCounter: 6,
}
// `validateProject` answers `{ ok }`, not a list: a gate written against a list can never fail and
// ships a scene the app then refuses as `invalid-project`.
const checked = validateProject(project)
if (!checked.ok) fail(`the scene does not validate: ${checked.problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`)

// Committed through the production adapter and read back, so every record is one the app itself wrote.
const ports = createMemoryAdapter()
const committed = await ports.projects.commit({ project, revision: 1, savedAt: NOW, newAssets: [] }, null)
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
      source: 'the services scene with five Annotations, one per type (scripts/make-annotations-seed.ts)',
      projects: records,
      library: listed.value,
      assets: [],
    },
    null,
    2,
  )}\n`,
)

console.log(`wrote ${PREVIEW_OUT.replace(`${repoRoot}/`, '')}: ${annotations.length} Annotations, counter 6`)
