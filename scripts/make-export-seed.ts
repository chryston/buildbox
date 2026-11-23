/**
 * Generate `fixtures/domain/v8/export.json` (#73 criteria 6 and 7).
 *
 * The same Floor as `renovation-views.json` — Walls W-1…W-6, the Kitchen, the Bedroom, the two
 * Options — reached through the Intents the editor dispatches, so the fixture is a transcript and
 * not a hand-written object. It is the Project the Export dialog's two Lists seeds are named after:
 *
 *   `Ground Floor`            the one Floor, named the way the issue's scope sentence names it.
 *   Structure / Services / Furniture
 *                             the three default layers. Every Existing Wall, Opening and Room is
 *                             fabric and sits on Structure; Services stays empty, because a scope
 *                             narrowed to a layer with nothing on it is a case worth having.
 *   four Placed Items         `Base 600`, `Base 600′` (a fork of the first, which is what the prime
 *                             means in the product), `Fridge` and `Island`, and nothing else on
 *                             Furniture. Four is the number criterion 6's notice prints.
 *   `Ground Floor · Plan · Demolition`
 *                             Option A on the Demolition display, with Furniture hidden — the view
 *                             criterion 6 exports from, and the reason the notice exists: a Data
 *                             export never inherits view hiding, so those four rows are in the file
 *                             and the dialog says so.
 *
 * Nothing here writes a field directly. `validateProject` at the end is what proves the transcript
 * ends somewhere legal.
 *
 *   npx vite-node scripts/make-export-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, INTENT_LABELS } from '../src/edit'
import type { Intent, IntentType, PayloadOf } from '../src/edit'
import { validateProject } from '../src/domain'
import type { EntityId, Project } from '../src/domain'
import { canonicalJson } from '../src/lib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/domain/v8/renovation-views.json')
const OUT = resolve(repoRoot, 'fixtures/domain/v8/export.json')

const NOW = '2026-01-01T10:15:00+08:00'
/** The issue's §2 default colours. */
const STRUCTURE_COLOR = '#b9b9c2'
const SERVICES_COLOR = '#5fb3ff'
const FURNITURE_COLOR = '#e3a857'
/** The four Placed Items, spread apart so the sheet and the screenshots do not stack them. */
const FLOOR_ID = 'seed-001'
const PLACEMENTS: readonly (readonly [string, { x: number; y: number }])[] = [
  ['seed-item-027', { x: 0, y: 0 }],
  ['seed-007', { x: 1200, y: 0 }],
  ['seed-012', { x: 2400, y: 0 }],
  ['seed-item-027', { x: 3600, y: 0 }],
]

function fail(message: string): never {
  console.error(`make-export-seed: ${message}`)
  process.exit(1)
}


let nextId = 0
const newIds = (count: number): string[] => Array.from({ length: count }, () => `export-${String(++nextId).padStart(3, '0')}`)

const envelope = JSON.parse(readFileSync(SOURCE, 'utf8')) as { domainSchemaVersion: number; project: Project }
if (envelope.domainSchemaVersion !== 8) fail('the source fixture is not a v8 Project')

/** One Intent, with the IDs it spends minted the way the app mints them. */
function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

let current = envelope.project

/**
 * An edit the baseline guard refuses until the Existing Model is corrected to accept it (#69 §4).
 * Design Options are drawn against the baseline, so adding a Placed Item to it is the product's one
 * deliberate act of correction — the fixture records that act rather than pretending it was free,
 * which is the state criterion 6's four Placed Items are really in.
 */
function corrected<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const inner = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as unknown as Intent
  return apply(project, 'renovation.correctExistingModel', { inner }, ids)
}

// --- the Floor and the layers ------------------------------------------------------------------

current = apply(current, 'floor.rename', { floorId: FLOOR_ID, name: 'Ground Floor' })

// `layer.add` puts a new layer at the front, so they arrive Furniture, Services, Structure and the
// Project order ends up Structure → Services → Furniture: the shell behind the joinery behind the
// furniture, which is the order the issue's §2 names them in reversed.
current = apply(current, 'layer.add', { name: 'Furniture', color: FURNITURE_COLOR }, newIds(1))
current = apply(current, 'layer.add', { name: 'Services', color: SERVICES_COLOR }, newIds(1))
current = apply(current, 'layer.add', { name: 'Structure', color: STRUCTURE_COLOR }, newIds(1))

const layerId = (name: string): EntityId =>
  current.drawingLayers?.find((layer) => layer.name === name)?.id ?? fail(`no layer is named ${name}`)

const STRUCTURE = layerId('Structure')
const FURNITURE = layerId('Furniture')

for (const wall of current.existingModel.walls) {
  current = apply(current, 'entity.setLayer', { entityId: wall.id, layerId: STRUCTURE, target: { designOptionId: null } })
}
for (const opening of current.existingModel.openings) {
  current = apply(current, 'entity.setLayer', { entityId: opening.id, layerId: STRUCTURE, target: { designOptionId: null } })
}
for (const room of current.existingModel.rooms) {
  current = apply(current, 'entity.setLayer', { entityId: room.id, layerId: STRUCTURE, target: { designOptionId: null } })
}

const onFurniture = (project: Project): number =>
  project.existingModel.placedItems.filter((row) => row.drawingLayerId === FURNITURE).length

// --- the four Placed Items ---------------------------------------------------------------------

// `Island (custom)` is the Island of the issue's example; the name is what the table prints.
current = apply(current, 'design.update', { itemDesignId: 'seed-012', patch: { name: 'Island' } })

const placed: EntityId[] = []
for (const [itemDesignId, translation] of PLACEMENTS) {
  current = corrected(current, 'plan.placeDesign', { floorId: FLOOR_ID, itemDesignId }, newIds(1))
  const id = current.existingModel.placedItems[current.existingModel.placedItems.length - 1]!.id
  placed.push(id)
  current = corrected(current, 'plan.movePlacement', { placedItemId: id, translation })
}

// The second `Base 600` is forked, which is what the prime on the issue's `Base 600 #1′` marks: a
// design that started as a copy of another and then diverged. The fork keeps the placement.
current = corrected(current, 'design.fork', { placedItemId: placed[0]!, name: 'Base 600′' }, newIds(1))

// The four Placed Items arrived on Furniture by themselves: `layer.add` makes the new layer the
// active one, and a new entity is filed on the layer that is active when it is drawn. Filing them
// again would be a no-change, and the guard would rightly refuse it.
if (onFurniture(current) !== 4) fail(`Furniture holds ${onFurniture(current)} Placed Items, not the four the notice counts`)

// --- the view the notice is about --------------------------------------------------------------

// Made from `Option A · Demolition` so it inherits Option A and the Demolition display, which is
// what `view.create` does for a reason (#70 §1), and then named the way the issue names it.
const demolition = current.views.find((view) => view.name === 'Option A · Demolition') ?? fail('no Demolition view to copy')
current = apply(current, 'view.create', { floorId: FLOOR_ID, name: 'Ground Floor · Plan · Demolition', fromViewId: demolition.id }, newIds(1))
const seedView = current.views[current.views.length - 1]!
if (seedView.designOptionId !== 'option-a' || seedView.renovationDisplay !== 'demolition') {
  fail(`${seedView.name} did not inherit Option A on the Demolition display`)
}
current = apply(current, 'view.setLayerSetting', { viewId: seedView.id, layerKey: FURNITURE, setting: { visible: false } })

const result = validateProject(current)
if (!result.ok) fail(`export.json is not a valid Project: ${JSON.stringify(result.problems.slice(0, 3), null, 2)}`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${canonicalJson({ domainSchemaVersion: 8, project: current })}\n`)

const furnitureNames = current.existingModel.placedItems
  .filter((row) => row.drawingLayerId === FURNITURE)
  .map((row) => current.itemDesigns.find((design) => design.id === row.itemDesignId)?.name ?? '?')
  .join(', ')
console.log(
  `make-export-seed: ${OUT}\n` +
    `  floor: ${current.floors.map((floor) => floor.name).join(', ')}\n` +
    `  order: ${(current.drawingLayers ?? []).map((layer) => layer.name).join(' → ')} (back to front)\n` +
    `  Furniture: ${onFurniture(current)} Placed Items — ${furnitureNames}\n` +
    `  ${seedView.name}: Option A, Demolition, Furniture hidden\n` +
    `  ids minted: ${nextId}`,
)
