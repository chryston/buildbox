/**
 * The Notes dependency-review scene (#82 fixture).
 *
 * The issue's fixture names things the shipped scenes do not hold: two placements of one `Base 600`
 * design so one can be deleted and the other offered as a Reanchor target; a Resolved Comment on the
 * Wall whose face is being replaced, to prove review is not filtered by status; an Elevation View with a
 * Reference Marker pointing at the Item Detail of a design; an Island that exists only in Option B, with
 * a Comment on it and an Annotation scoped to that Option; and a second Floor to delete a Floor Comment
 * from. `comments-scene.json` and `annotations-scene.json` each hold half of that and none of the
 * relationships, so the scene is grown here from `services.json` — the one base with Design Options, an
 * Elevation View and a `Base 600` design to place twice.
 *
 * References are C-001 to C-008 and A-001 to A-004 with the counters left one ahead, so a test can tell
 * "the fourth Comment" from "one this scene made".
 *
 * Run with `npx vite-node scripts/make-notes-review-seed.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateProject, validateProject } from '../src/domain'
import type { Annotation, Comment, Project } from '../src/domain'
import { createMemoryAdapter } from '../src/persistence'
import type { ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/services-plain.json')
const PREVIEW_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/notes-review-scene.json')
const DB_NAME = 'buildbox'
const NOW = '2026-11-25T09:00:00.000Z'

const fail = (message: string): never => {
  console.error(`make-notes-review-seed: ${message}`)
  process.exit(1)
}

const seed = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
  projects: { id: string; schemaVersion: number; data: unknown }[]
}
const migrated = migrateProject(seed.projects[0]!.data, seed.projects[0]!.schemaVersion, () => [])
if (!migrated.ok) fail(`migrating the scene failed: ${migrated.error.message}`)
const base = migrated.project as Project

const planView = base.views.find((view) => view.kind === 'plan') ?? null
if (planView === null) fail('the scene has no Plan View to draw on')
const elevation = base.elevationViews?.[0] ?? null
if (elevation === null) fail('the scene has no Elevation View for a Reference Marker to sit in')

// `Base 600` is placed once by the base scene. The second placement is the one a person deletes, and
// the first is what the review offers as a target — the pair criterion 3 is about. It is Option A's own
// proposed work rather than Existing content, because deleting Existing work while Design Options exist
// is refused by the baseline rule (#70) long before the notes question is reached, and the review would
// never be seen.
const baseDesign = base.itemDesigns.find((design) => design.name === 'Base 600') ?? null
if (baseDesign === null) fail('the scene has no "Base 600" Item Design to place twice')
const firstBase = base.existingModel.placedItems.find((item) => item.itemDesignId === baseDesign.id) ?? null
if (firstBase === null) fail('the scene does not place "Base 600" at all')
const secondBase = {
  ...firstBase!,
  id: 'seed-item-029',
  translation: { x: firstBase!.translation.x + 900, y: firstBase!.translation.y },
}

// Walls read W-1, W-2, … in the order they are stored, so the third is the Wall criterion 5 and 6 name.
const wall = base.existingModel.walls[2] ?? null
if (wall === null) fail('the scene has no third Wall to be W-3')
const featureOwner = base.existingModel.walls[1] ?? wall

// The Island C-007 speaks for. The base scene carries no Design Options, which is deliberate: deleting
// Existing work while Options exist is refused by the baseline rule (#70) before the notes question is
// ever reached, so the review would never be seen. The Option case (#82 criterion 9) is covered against
// a variant of this scene with Options added, in `src/integration/notesReviewFlow.test.tsx`.
const island = base.existingModel.placedItems.find((item) => item.id === 'fp-island') ?? null
if (island === null) fail('the scene has no Island for a Comment to speak for')

// A second Floor, so a Comment anchored to a Floor has a Floor that can be deleted (criterion 10). It
// needs its own default Plan View, which is what a Floor without one would be refused for.
const levelTwo = { id: 'seed-floor-002', name: 'Level 2', planImage: null }
const levelTwoView = {
  id: 'seed-view-002',
  kind: 'plan' as const,
  floorId: levelTwo.id,
  name: 'Level 2',
  isDefault: true,
  planViewRange: { lowerMm: 0, upperMm: 2600 },
  showPlanImage: true,
}

const comment = (reference: string, over: Partial<Comment>): Comment => ({
  id: `comment-${reference}`,
  reference,
  title: 'Note',
  body: 'A note on the scene this fixture is drawn for.',
  anchor: { kind: 'project' },
  scope: 'all',
  status: 'open',
  priority: 'normal',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

const comments: Comment[] = [
  comment('C-001', { title: 'Check the ceiling void before ordering', anchor: { kind: 'project' } }),
  comment('C-002', { title: 'Floor level to be confirmed on site', anchor: { kind: 'floor', floorId: planView.floorId } }),
  comment('C-003', {
    title: 'Island needs 1000 mm on the sink side',
    anchor: { kind: 'floor_point', floorId: planView.floorId, point: { x: 3400, y: 2200 } },
  }),
  // The one criterion 2, 3 and 4 are about: anchored to the placement being deleted.
  comment('C-004', {
    title: 'Shift 50 mm for dishwasher',
    body: 'The dishwasher needs its 50 mm. Move this unit, not the note.',
    anchor: { kind: 'entity', entityId: secondBase.id },
    scope: undefined,
    priority: 'high',
  }),
  // Resolved, and still listed: the review is not filtered by status (criterion 5).
  comment('C-005', {
    title: 'Conduit to be chased in this wall',
    anchor: { kind: 'entity', entityId: wall.id },
    scope: undefined,
    status: 'resolved',
    resolvedAt: NOW,
  }),
  comment('C-006', {
    title: 'Radiator on this face',
    anchor: { kind: 'feature', ownerId: featureOwner.id, featureId: 'leftFace', t: 0.5 },
    scope: undefined,
  }),
  // On the Island, so deleting it is what strands the note.
  comment('C-007', {
    title: 'Worktop overhang on the island',
    anchor: { kind: 'entity', entityId: island.id },
    scope: undefined,
  }),
  // Anchored to Level 2, the Floor a person can delete (criterion 10).
  comment('C-008', {
    title: 'Stair position to be set out',
    anchor: { kind: 'floor', floorId: levelTwo.id },
  }),
]

const annotation = (reference: string, type: Annotation['type'], over: Partial<Annotation>): Annotation => ({
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
  // Anchored to W-3, so moving the Wall carries it along (criterion 6).
  annotation('A-002', 'leader', {
    position: { x: 3200, y: 2400 },
    text: 'Chase this wall for the conduit',
    endpoint: { anchor: { kind: 'entity', entityId: wall.id } },
  }),
  // An Arrow over the Island, so a delete that takes the Island takes the mark with it.
  annotation('A-003', 'arrow', {
    position: { x: 1400, y: 3000 },
    text: 'Island sits here',
    endpoint: { free: { x: island.translation.x, y: island.translation.y } },
  }),
  // Drawn in the Elevation View and pointing at the Item Detail of `Base 600`: deleting the Elevation
  // strands an incoming Reference Marker, which is a different question from an owned mark (criterion 7).
  annotation('A-004', 'reference_marker', {
    viewId: elevation.id,
    position: { x: 2600, y: 3000 },
    text: 'See the base unit detail',
    targetViewId: baseDesign.id,
    style: { markerShape: 'hexagon' },
  }),
]

const project: Project = {
  ...base,
  floors: [...base.floors, levelTwo],
  views: [...base.views, levelTwoView],
  elevationViews: (base.elevationViews ?? []).map((view) =>
    view.id === elevation.id ? { ...view, name: 'Kitchen · North Elevation' } : view,
  ),
  existingModel: { ...base.existingModel, placedItems: [...base.existingModel.placedItems, secondBase] },
  comments,
  commentReferenceCounter: 9,
  annotations,
  annotationReferenceCounter: 5,
}

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
      source: 'the services scene with the eight Comments and four Annotations #82 reviews (scripts/make-notes-review-seed.ts)',
      projects: records,
      library: listed.value,
      assets: [],
    },
    null,
    2,
  )}\n`,
)
console.log(`wrote ${PREVIEW_OUT}: ${comments.length} Comments, ${annotations.length} Annotations`)
