/**
 * The Comments scene (#80 §16, criteria 36).
 *
 * The warnings scene already has what the Notes panel needs to be judged on: a Floor with Walls,
 * Openings and Placed Items, and a Warning the strip really raises. Migrated to the current schema it
 * gains the two Comment fields empty, which is the honest starting point — the eight notes below are
 * then added as data, one per Anchor kind, so the panel, the overlay, the inspector section and the
 * Warning link all have something real to show.
 *
 * The eight are numbered C-001 to C-008 and the reference counter is left at 9, the number the next
 * note would be given, so a test can tell "the eighth note" from "a note this scene made".
 *
 * Run with `npx vite-node scripts/make-comments-seed.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateProject } from '../src/domain'
import type { Comment, Project } from '../src/domain'
import { migrateProject } from '../src/domain/migrate'
import { createMemoryAdapter } from '../src/persistence'
import type { ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/services.json')
const PREVIEW_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/comments-scene.json')
const DB_NAME = 'buildbox'
const NOW = '2026-11-18T09:00:00.000Z'

const fail = (message: string): never => {
  console.error(`make-comments-seed: ${message}`)
  process.exit(1)
}

const seed = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
  projects: { id: string; schemaVersion: number; data: unknown }[]
}
const record = seed.projects[0]!

// The scene is migrated by the same chain the app runs, so the seed holds what a person who opened
// this Project today would have in front of them — including `comments: []`.
const migrated = migrateProject(record.data, record.schemaVersion, () => 'unused-no-ids-needed')
if (!migrated.ok) fail(`migrating the scene failed: ${migrated.error.message}`)
const base = migrated.project as Project
if (base.comments.length !== 0) fail('the migrated scene was expected to hold no Comments')

const floor = base.floors[0]!
const planView = base.views.find((view) => view.kind === 'plan') ?? null
if (planView === null) fail('the scene has no Plan View to anchor a note to')
const wall = base.existingModel.walls[0]!
const wallFeature = base.existingModel.walls.find((entry) => entry.id !== wall.id) ?? wall
const placed = base.existingModel.placedItems[0]!
const design = base.itemDesigns.find((entry) => entry.id === placed.designId) ?? base.itemDesigns[0]!

const note = (
  reference: string,
  title: string,
  body: string,
  anchor: Comment['anchor'],
  over: Partial<Comment> = {},
): Comment => ({
  id: `comment-${reference}`,
  reference,
  title,
  body,
  anchor,
  status: 'open',
  priority: 'normal',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

const comments: Comment[] = [
  note('C-001', 'Check the ceiling void before ordering', 'The ductwork runs through the void above the kitchen. Confirm the clear height with the services engineer before any cabinet is ordered.', { kind: 'project' }, { priority: 'high' }),
  note('C-002', 'Floor level to be confirmed on site', 'The slab level differs from the drawing by around 20 mm at the east end. Set out from the site datum, not from this plan.', { kind: 'floor', floorId: floor.id }),
  note('C-003', 'Island needs 1000 mm on the sink side', 'The client wants a dishwasher to the left of the sink. Check the aisle still clears 1000 mm once it is in.', { kind: 'floor_point', floorId: floor.id, point: { x: 3400, y: 2200 } }, { priority: 'low' }),
  note('C-004', 'Ventilation grille for this base unit', 'This run needs a 1200 x 150 mm grille in the plinth. Confirm the appliance behind it before the front is cut.', { kind: 'item_design', itemDesignId: design.id }),
  note('C-005', 'Conduit to be chased in this wall', 'The electrician wants a conduit chased to the switch height. Confirm the wall is not structural before chasing.', { kind: 'entity', entityId: wall.id }, { priority: 'high' }),
  note('C-006', 'Radiator on this face', 'The radiator goes on the kitchen side of this wall. Keep the fixings clear of the conduit noted on the wall itself.', { kind: 'feature', ownerId: wallFeature.id, featureId: 'leftFace', t: 0.5 }),
  note('C-007', 'Door opening to be widened', 'The client asked whether this opening could be 100 mm wider. Check what is above it before answering.', { kind: 'floor_point', floorId: floor.id, point: { x: 1200, y: 900 } }),
  note('C-008', 'Worktop sample chosen', 'The quartz sample was approved at the showroom visit. Resolved — nothing further to do.', { kind: 'floor', floorId: floor.id }, { status: 'resolved', resolvedAt: NOW }),
]

const project: Project = { ...base, comments, commentReferenceCounter: 9 }
const problems = validateProject(project)
if (problems.length > 0) fail(`the scene does not validate: ${problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`)

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
      source: 'the warnings scene with eight Comments (scripts/make-comments-seed.ts)',
      projects: records,
      library: listed.value,
      assets: [],
    },
    null,
    2,
  )}\n`,
)

console.log(`wrote ${PREVIEW_OUT.replace(`${repoRoot}/`, '')}: ${comments.length} Comments, counter 9`)
