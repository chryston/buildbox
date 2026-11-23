/**
 * Generate `fixtures/domain/v10/elevation-scene.json` (#75, the Fixture scene).
 *
 * The scene the projection, drawing and snapping criteria are stated against. It starts from the #74
 * Plan View Range scene — one Floor, a 4 m × 3 m shell, a window, four placements — migrated forward
 * to this build's schema, and then does the two things that scene was missing:
 *
 *   Tall cupboard  a fifth placement, 2 100 tall, standing at y = 2 400: outside the Kitchen
 *                  elevation's prism, so criterion 9 has an entity to bring in by moving the line
 *                  and to push out again
 *   Kitchen elevation  the view the criteria are named after: the line (0, 1 400) → (4 000, 1 400),
 *                  `side: 'left'`, depth 2 000. Its viewing normal is (0, −1), so the band runs from
 *                  y = 1 400 down to y = −600 and holds W-1 with its window, both base cabinets, the
 *                  wall cabinet above the first and the sump box — and nothing else
 *   Angled elevation   the same band turned 30° to the plan axes, which is what makes the projection
 *                  tests state their answer for a line that is not axis-parallel
 *
 * Nothing here writes a field directly: the two views are made with the same `elevationView.create`
 * Intent the tool dispatches, so the fixture cannot describe a Project the editor could not have
 * produced, and `validateProject` at the end is what proves the transcript ends somewhere legal.
 *
 *   npx vite-node scripts/make-elevation-seed.ts
 *
 * Unlike the other seed scripts this one writes no browser preview seed: the Elevation View has no UI
 * until the split-workspace milestone, and a seed the browser cannot open would only drift.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, INTENT_LABELS } from '../src/edit'
import type { IntentType, PayloadOf } from '../src/edit'
import { designHeight, migrateProject, validateProject } from '../src/domain'
import type { EntityId, Project } from '../src/domain'
import { createMemoryAdapter } from '../src/persistence'
import type { ProjectRecord } from '../src/persistence'
import { canonicalJson } from '../src/lib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/domain/v9/plan-range-scene.json')
const OUT = resolve(repoRoot, 'fixtures/domain/v10/elevation-scene.json')
/** The same Project as a browser fixture, which `e2e/smoke/elevation.spec.ts` seeds into IndexedDB. */
const PREVIEW_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/elevation.json')
const DB_NAME = 'buildbox'

const NOW = '2026-01-01T10:20:00+08:00'
/** The height the preset pack calls a Tall cupboard, and the one entity the scene adds. */
const TALL_CUPBOARD_HEIGHT = 2100
/** Where the Tall cupboard stands: the far side of the view line, out of the band. */
const TALL_CUPBOARD_AT = { x: 3000, y: 2400 }
/** The Kitchen elevation: a line across the room at y = 1 400, looking at the run of cabinets. */
const KITCHEN_LINE = { start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } }
const KITCHEN_DEPTH = 2000
/**
 * The same band turned 30° to the plan axes. The two ends are whole millimetres whose difference is
 * (2 198, 1 260) — 29.86°, which is the issue's 30° to within a rounding and keeps the fixture free
 * of eleven-decimal coordinates.
 */
const ANGLED_LINE = { start: { x: 400, y: 200 }, end: { x: 2598, y: 1460 } }
const ANGLED_DEPTH = 2400

function fail(message: string): never {
  console.error(`make-elevation-seed: ${message}`)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] => Array.from({ length: count }, () => `el-${String(++nextId).padStart(3, '0')}`)

/** One Intent, with the IDs it spends minted the way the app mints them. */
function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

// --- the #74 scene, read forward to this build's schema -----------------------------------------

const envelope = JSON.parse(readFileSync(SOURCE, 'utf8')) as { domainSchemaVersion: number; project: unknown }
const migrated = migrateProject(envelope.project, envelope.domainSchemaVersion, newIds)
if (!migrated.ok) fail(`the plan-range scene no longer migrates: ${migrated.error.message}`)
let current = migrated.project
if (current.elevationViews === undefined) fail('the chain did not reach v10 — the Project has no Elevation Views field')

const floorId: EntityId = current.floors[0]?.id ?? fail('the scene has no Floor')
const planViewId: EntityId = current.views.find((view) => view.isDefault)?.id ?? fail('the Floor has no default view')
const baseDesign: EntityId =
  current.itemDesigns.find((design) => design.name === 'Base cabinet')?.id ?? fail('the scene has no Base cabinet design')

// --- the Tall cupboard ---------------------------------------------------------------------------
//
// `cabinet.addUnit` forks a design and places the new Unit where the tool would have dropped it, which
// is how the #74 scene made its Wall cabinet and its sump box; the same move puts it in the corner the
// criteria want. It is 2 100 tall, so it is the tallest thing in the scene and the one thing outside
// the band.

const before = new Set(current.itemDesigns.map((design) => design.id))
current = apply(current, 'cabinet.addUnit', { sourceItemDesignId: baseDesign }, newIds(3))
const tallDesign = current.itemDesigns.find((design) => !before.has(design.id)) ?? fail('the Tall cupboard design was not added')
current = apply(current, 'design.update', { itemDesignId: tallDesign.id, patch: { name: 'Tall cupboard' } })
current = apply(current, 'cabinet.updateSettings', { itemDesignId: tallDesign.id, patch: { height: TALL_CUPBOARD_HEIGHT } })
const tallPlacement: EntityId =
  current.existingModel.placedItems.find((item) => item.itemDesignId === tallDesign.id)?.id ?? fail('the Tall cupboard has no placement')
current = apply(current, 'plan.movePlacement', { placedItemId: tallPlacement, translation: TALL_CUPBOARD_AT })

// --- the two Elevation Views ----------------------------------------------------------------------
//
// Both take their Design Option and Renovation Display from the Floor's own Plan View, which is what
// the tool sends: `fromViewId` is the view the tool was used in.

current = apply(
  current,
  'elevationView.create',
  { floorId, fromViewId: planViewId, line: KITCHEN_LINE, side: 'left', depth: KITCHEN_DEPTH, name: 'Kitchen elevation' },
  newIds(1),
)
current = apply(
  current,
  'elevationView.create',
  { floorId, fromViewId: planViewId, line: ANGLED_LINE, side: 'right', depth: ANGLED_DEPTH, name: 'Angled elevation' },
  newIds(1),
)

// --- the check and the write ----------------------------------------------------------------------

const checked = validateProject(current)
if (!checked.ok) fail(`the scene does not validate: ${JSON.stringify(checked.problems, null, 2)}`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${canonicalJson({ domainSchemaVersion: 10, project: current })}\n`)

// The same Project as a browser fixture: committed through the production adapter and read back, so
// every record in the seed is one the app itself wrote — revision, summary and all. The Elevation
// View has to survive that round trip for the browser spec to have a pane to open.
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
writeFileSync(PREVIEW_OUT, `${JSON.stringify(
  {
    dbName: DB_NAME,
    source: 'the elevation scene (scripts/make-elevation-seed.ts)',
    projects: records,
    library: listed.value,
    assets: [],
  },
  null,
  2,
)}\n`)

const nameOf = (id: EntityId): string => current.itemDesigns.find((design) => design.id === id)?.name ?? '?'
const topOf = (id: EntityId): number => {
  const item = current.existingModel.placedItems.find((placed) => placed.id === id)!
  const design = current.itemDesigns.find((candidate) => candidate.id === item.itemDesignId)!
  return item.baseElevation + designHeight(design)
}

console.log(
  `make-elevation-seed: ${OUT}\n` +
    `  ${current.floors[0]?.name}: limits ${JSON.stringify(current.floors[0]?.limits)}\n` +
    `  walls ${current.existingModel.walls.map((wall) => `${wall.ref} ${wall.baseElevation}–${wall.baseElevation + wall.height}`).join(', ')}\n` +
    `  openings ${current.existingModel.openings.map((o) => `${o.label} ${o.sill}–${o.head}`).join(', ')}\n` +
    `  items ${current.existingModel.placedItems
      .map((item) => `${nameOf(item.itemDesignId)} @ ${item.translation.x},${item.translation.y} base ${item.baseElevation}–${topOf(item.id)}`)
      .join(', ')}\n` +
    `  views ${current.views.map((view) => `${view.name} (plan)`).join(', ')}\n` +
    `  elevation views ${(current.elevationViews ?? [])
      .map((view) => `${view.name}: (${view.line.start.x},${view.line.start.y})→(${view.line.end.x},${view.line.end.y}) ${view.side} ${view.depth}`)
      .join(' | ')}\n` +
    `  ids minted: ${nextId}`,
)
