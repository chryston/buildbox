/**
 * Generate `fixtures/domain/v9/layers.json` and `layers-zero.json` (#71 criterion 3).
 *
 * Both files are the same Floor as `renovation-views.json` — Walls W-1…W-6, `Door 1`, the Kitchen,
 * the Bedroom, the two Options and the four saved views — reached through the Intents the editor
 * dispatches, so the fixture is a transcript rather than a hand-written object:
 *
 *   `layers.json`       the three default layers, the content filed on them, and one saved view's
 *                       say about them: `Option A · Proposed` hides Furniture and re-colours
 *                       Structure, `Option B · Combined` makes Structure read-only and snaps to
 *                       hidden content, `Option A · Demolition` keeps an order of its own, and the
 *                       Floor's default view has an active layer. The Project order is not the
 *                       order they arrived in, because one `layer.move` says it isn't.
 *   `layers-zero.json`  the same Project with every entity moved to Unlayered and all three layers
 *                       deleted — the state a Backup taken after that deletion restores into, which
 *                       is what criterion 3 is about.
 *
 * Nothing here writes a field directly. That is the point: a fixture assembled by `applyIntent`
 * cannot drift from what the editor can actually produce, and `validateProject` at the end is what
 * proves the transcript ends somewhere legal.
 *
 *   npx vite-node scripts/make-layers-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, INTENT_LABELS } from '../src/edit'
import type { IntentType, PayloadOf } from '../src/edit'
import { validateProject } from '../src/domain'
import type { EntityId, Project } from '../src/domain'
import { canonicalJson } from '../src/lib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/domain/v9/renovation-views.json')
const OUT = resolve(repoRoot, 'fixtures/domain/v9/layers.json')
const ZERO_OUT = resolve(repoRoot, 'fixtures/domain/v9/layers-zero.json')

const NOW = '2026-01-01T10:15:00+08:00'
/** The issue's §2 default colours. */
const STRUCTURE_COLOR = '#b9b9c2'
const SERVICES_COLOR = '#5fb3ff'
const FURNITURE_COLOR = '#e3a857'
/** The colour one saved view prefers for Structure — the `◐` marker's reason to exist. */
const VIEW_COLOR = '#7aa2ff'

function fail(message: string): never {
  console.error(`make-layers-seed: ${message}`)
  process.exit(1)
}


let nextId = 0
const newIds = (count: number): string[] => Array.from({ length: count }, () => `layers-${String(++nextId).padStart(3, '0')}`)

const envelope = JSON.parse(readFileSync(SOURCE, 'utf8')) as { domainSchemaVersion: number; project: Project }
if (envelope.domainSchemaVersion !== 9) fail('the source fixture is not a v9 Project')

/** One Intent, with the IDs it spends minted the way the app mints them. */
function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

const viewByName = (project: Project, name: string) => project.views.find((view) => view.name === name) ?? fail(`no saved view is named ${name}`)

let current = envelope.project
const proposed = viewByName(current, 'Option A · Proposed')
const combined = viewByName(current, 'Option B · Combined')
const demolition = viewByName(current, 'Option A · Demolition')
const fallback = current.views.find((view) => view.isDefault) ?? fail('the Floor has no default view')

// --- the three layers, in the order the issue names them --------------------------------------
//
// `layer.add` puts a new layer at the front, so they arrive Furniture, Services, Structure and the
// Project order ends up Structure → Services → Furniture — back to front, the shell behind the
// joinery behind the furniture.

current = apply(current, 'layer.add', { name: 'Furniture', color: FURNITURE_COLOR }, newIds(1))
current = apply(current, 'layer.add', { name: 'Services', color: SERVICES_COLOR }, newIds(1))
current = apply(current, 'layer.add', { name: 'Structure', color: STRUCTURE_COLOR }, newIds(1))

const layerId = (name: string): EntityId =>
  current.drawingLayers?.find((layer) => layer.name === name)?.id ?? fail(`no layer is named ${name}`)

const STRUCTURE = layerId('Structure')
const SERVICES = layerId('Services')
const FURNITURE = layerId('Furniture')

// --- the content, filed by what it is ---------------------------------------------------------
//
// Every Existing Wall, Opening and Room is fabric; the Island and the replaced base unit are
// Furniture. A Wall Junction carries no layer of its own — it is where two Walls meet and follows
// them — and the Services layer stays empty on purpose: it is the layer criterion 14 deletes, and
// an empty one is the case where deletion has nothing to move.

const fileOn = (project: Project, entityId: EntityId, layer: EntityId, designOptionId: EntityId | null): Project =>
  apply(project, 'entity.setLayer', { entityId, layerId: layer, target: { designOptionId } })

for (const wall of current.existingModel.walls) current = fileOn(current, wall.id, STRUCTURE, null)
for (const opening of current.existingModel.openings) current = fileOn(current, opening.id, STRUCTURE, null)
for (const room of current.existingModel.rooms) current = fileOn(current, room.id, STRUCTURE, null)
for (const item of current.existingModel.placedItems) current = fileOn(current, item.id, FURNITURE, null)
for (const option of current.designOptions ?? []) {
  for (const wall of option.proposed.walls) current = fileOn(current, wall.id, STRUCTURE, option.id)
  for (const opening of option.proposed.openings) current = fileOn(current, opening.id, STRUCTURE, option.id)
  for (const room of option.proposed.rooms) current = fileOn(current, room.id, STRUCTURE, option.id)
  for (const item of option.proposed.placedItems) current = fileOn(current, item.id, FURNITURE, option.id)
}

// --- what the saved views say -----------------------------------------------------------------

current = apply(current, 'view.setActiveLayer', { viewId: fallback.id, layerId: STRUCTURE })
current = apply(current, 'view.setLayerSetting', { viewId: proposed.id, layerKey: FURNITURE, setting: { visible: false } })
current = apply(current, 'view.setLayerSetting', { viewId: proposed.id, layerKey: STRUCTURE, setting: { color: VIEW_COLOR } })
current = apply(current, 'view.setLayerSetting', { viewId: combined.id, layerKey: STRUCTURE, setting: { editable: false } })
current = apply(current, 'view.setSnapToHidden', { viewId: combined.id, snapToHidden: true })
// One view that draws in its own order: Furniture behind everything, which is the state the
// `Use Project layer order` button exists to leave.
current = apply(current, 'view.setLayerOrder', { viewId: demolition.id, layerOrder: [FURNITURE, STRUCTURE, SERVICES, 'unlayered'] })
// …and a Project order that is not the one they arrived in.
current = apply(current, 'layer.move', { layerId: SERVICES, direction: 'back' })

// --- the same Project with no layers at all ---------------------------------------------------

// The same Project, emptied the way the editor empties it: every record to Unlayered, then the
// layers deleted. Starting from `current` is the point — the per-view overrides above are there to
// be dropped, which is criterion 3's "nothing is left behind".
let zero = current
for (const [id, optionId] of [
  ...current.existingModel.walls.map((row) => [row.id, null] as const),
  ...current.existingModel.openings.map((row) => [row.id, null] as const),
  ...current.existingModel.rooms.map((row) => [row.id, null] as const),
  ...current.existingModel.placedItems.map((row) => [row.id, null] as const),
  ...(current.designOptions ?? []).flatMap((option) => [
    ...option.proposed.walls.map((row) => [row.id, option.id] as const),
    ...option.proposed.openings.map((row) => [row.id, option.id] as const),
    ...option.proposed.rooms.map((row) => [row.id, option.id] as const),
    ...option.proposed.placedItems.map((row) => [row.id, option.id] as const),
  ]),
]) {
  zero = apply(zero, 'entity.setLayer', { entityId: id, layerId: null, target: { designOptionId: optionId } })
}
// Deleting a layer moves its content to Unlayered and drops every view's override of it, which is
// the whole of criterion 3's "no layer is left behind" — so the transcript does it rather than
// editing the fields away.
for (const name of ['Structure', 'Services', 'Furniture']) {
  zero = apply(zero, 'layer.delete', { layerId: zero.drawingLayers?.find((layer) => layer.name === name)?.id ?? fail(`no ${name} layer left`), viewId: proposed.id })
}

for (const [name, project] of [['layers.json', current], ['layers-zero.json', zero]] as const) {
  const result = validateProject(project)
  if (!result.ok) fail(`${name} is not a valid Project: ${JSON.stringify(result.problems.slice(0, 3), null, 2)}`)
}

const write = (path: string, project: Project): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${canonicalJson({ domainSchemaVersion: 9, project })}\n`)
}
write(OUT, current)
write(ZERO_OUT, zero)

const filed = (project: Project): string =>
  (project.drawingLayers ?? [])
    .map((layer) => {
      const count =
        project.existingModel.walls.filter((row) => row.drawingLayerId === layer.id).length +
        project.existingModel.openings.filter((row) => row.drawingLayerId === layer.id).length +
        project.existingModel.rooms.filter((row) => row.drawingLayerId === layer.id).length +
        project.existingModel.placedItems.filter((row) => row.drawingLayerId === layer.id).length +
        (project.designOptions ?? []).reduce((sum, option) => sum + option.proposed.walls.filter((row) => row.drawingLayerId === layer.id).length + option.proposed.placedItems.filter((row) => row.drawingLayerId === layer.id).length, 0)
      return `${layer.name} ${count}`
    })
    .join(', ')

console.log(
  `make-layers-seed: ${OUT}\n  ${ZERO_OUT}\n` +
    `  order: ${(current.drawingLayers ?? []).map((layer) => layer.name).join(' → ')} (back to front)\n` +
    `  filed: ${filed(current)}\n` +
    `  ${proposed.name}: Furniture hidden, Structure ${VIEW_COLOR}\n` +
    `  ${combined.name}: Structure read-only, snaps to hidden content\n` +
    `  ${demolition.name}: own layer order\n` +
    `  zero: ${(zero.drawingLayers ?? []).length} layers, ${zero.views.filter((view) => view.layerSettings !== undefined && Object.keys(view.layerSettings).length > 0).length} views with overrides left\n` +
    `  ids minted: ${nextId}`,
)
