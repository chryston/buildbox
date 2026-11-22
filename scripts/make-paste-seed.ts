/**
 * The two Projects a cross-Project paste needs (#72 criterion 1).
 *
 * Both come out of `fixtures/domain/v8/layers.json` — the renovation-views kitchen with its three
 * Drawing Layers — reached through the Intents the editor dispatches, so each file is a transcript
 * rather than a hand-written object, and `validateProject` at the end proves both transcripts end
 * somewhere legal.
 *
 *   `paste-fitout.json`  **Unit 4 Fitout**: the copy's side. Four Placed Items carry the names the
 *                        issue's criterion 1 names — `Tall pantry`, `Dishwasher`, `GPO-9`, `Dining
 *                        chair` — and they are filed three ways: two on `Furniture`, `GPO-9` on
 *                        `Services`, and `Dining chair` Unlayered. One copy of those four therefore
 *                        asks two layer questions and states one Unlayered fact, which is the whole
 *                        shape of the mapping review in one paste.
 *   `paste-elm.json`     **14 Elm St**: the destination's side. Its `Services` layer is deleted, so
 *                        the copy's `Services` row has no layer to answer with and `Create
 *                        “Services” here` is the only honest answer; `Furniture` is still there, so
 *                        the other row really does have a name match to be offered — and refused.
 *                        Its `Option A · Proposed` view is renamed `Option A · Combined` and set to
 *                        the Combined display, which is the display a paste is allowed into.
 *
 * `fixtures/e2e/preview-seed/paste-pair.json` puts both into the one database the preview build
 * opens (#53), because the command being tested is the one that crosses from a Project to another
 * Project: the copy is made in the first and spent in the second, in the same tab. Its envelope —
 * revision, savedAt, library rows, the Plan Image asset — is the renovation-layers seed's own, as
 * `scripts/make-renovation-layers-seed.ts` left it, changed only in the two ids and names, because
 * a library row caches what the storage layer wrote and nothing here changes what it cached.
 *
 * The Project `id` is the one field written outside an Intent: it is the record's storage identity,
 * which no Intent can change, and two Projects in one database cannot share one.
 *
 * It runs only with the flag on, because the files it writes hold layer fields:
 *
 *   VITE_FF_RENOVATION=true npx vite-node scripts/make-paste-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, INTENT_LABELS } from '../src/edit'
import type { IntentType, PayloadOf } from '../src/edit'
import { validateProject } from '../src/domain'
import type { EntityId, Project } from '../src/domain'
import { canonicalJson, FF_RENOVATION } from '../src/lib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCENE = resolve(repoRoot, 'fixtures/domain/v8/layers.json')
const ENVELOPE = resolve(repoRoot, 'fixtures/e2e/preview-seed/renovation-layers.json')
const FITOUT_OUT = resolve(repoRoot, 'fixtures/domain/v8/paste-fitout.json')
const ELM_OUT = resolve(repoRoot, 'fixtures/domain/v8/paste-elm.json')
const PAIR_OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/paste-pair.json')

const NOW = '2026-01-01T11:00:00+08:00'
const FITOUT_ID = 'proj-paste-fitout'
const ELM_ID = 'proj-paste-elm'
/** The scene's own layers, as `scripts/make-layers-seed.ts` filed them. */
const FURNITURE = 'layers-001'
const SERVICES = 'layers-002'
/** `Option A · Proposed`, which becomes the destination's Combined view. */
const OPTION_A_VIEW = 'views-view-014'
/** The four items of criterion 1, by the design each placement reads its name from. */
const TALL_PANTRY = 'seed-003'
const DISHWASHER = 'fp-fridge'
const GPO = 'seed-item-028'
const DINING_CHAIR = 'fp-sofa'

function fail(message: string): never {
  console.error(`make-paste-seed: ${message}`)
  process.exit(1)
}

if (!FF_RENOVATION) fail('VITE_FF_RENOVATION is off, so this build cannot write a Project that holds Drawing Layers')

const scene = JSON.parse(readFileSync(SCENE, 'utf8')) as { domainSchemaVersion: number; project: Project }
if (scene.domainSchemaVersion !== 8) fail('the scene fixture is not a v8 Project')
if ((scene.project.drawingLayers ?? []).length === 0) fail('the scene fixture carries no Drawing Layers')

/** One Intent, with the IDs it spends minted the way the app mints them. */
function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[] = []): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

const renameDesign = (project: Project, itemDesignId: EntityId, name: string): Project =>
  apply(project, 'design.update', { itemDesignId, patch: { name } })

/** File an Existing record on a layer — `null` is Unlayered, which is an answer and not an absence. */
const fileOn = (project: Project, entityId: EntityId, layerId: EntityId | null): Project =>
  apply(project, 'entity.setLayer', { entityId, layerId, target: { designOptionId: null } })

const base = scene.project

// --- Unit 4 Fitout: the side the copy comes out of ---------------------------------------------

let fitout = apply(base, 'project.rename', { name: 'Unit 4 Fitout' })
fitout = renameDesign(fitout, 'unit-kitchen-tall', 'Tall pantry')
fitout = renameDesign(fitout, 'seed-007', 'Dishwasher')
fitout = renameDesign(fitout, 'seed-item-027', 'GPO-9')
fitout = renameDesign(fitout, 'seed-006', 'Dining chair')
// Every Existing Placed Item of this scene already stands on `Furniture`, so `Tall pantry` and
// `Dishwasher` need nothing; `GPO-9` moves to `Services` and `Dining chair` to Unlayered. The copy
// of these four therefore brings two layers and says one Unlayered count, which is the whole shape
// of the mapping review in one paste.
fitout = fileOn(fitout, GPO, SERVICES)
fitout = fileOn(fitout, DINING_CHAIR, null)

// --- 14 Elm St: the side the copy goes into ----------------------------------------------------

let elm = apply(base, 'project.rename', { name: '14 Elm St' })
// Deleting `Services` is what makes `Create “Services” here` the only answer that is not a lie: the
// destination has no layer of that name, and a paste must never invent a membership nobody chose.
elm = apply(elm, 'layer.delete', { layerId: SERVICES, viewId: null })
elm = apply(elm, 'view.rename', { viewId: OPTION_A_VIEW, name: 'Option A · Combined' })
elm = apply(elm, 'view.setRenovationDisplay', { viewId: OPTION_A_VIEW, renovationDisplay: 'combined' })

// The storage identity, not domain content: see the header.
fitout = { ...fitout, id: FITOUT_ID as EntityId }
elm = { ...elm, id: ELM_ID as EntityId }

for (const [name, project] of [['paste-fitout.json', fitout], ['paste-elm.json', elm]] as const) {
  const result = validateProject(project)
  if (!result.ok) fail(`${name} is not a valid Project: ${JSON.stringify(result.problems.slice(0, 3), null, 2)}`)
}
if (fitout.id === elm.id) fail('the two Projects share an id')
if ((elm.drawingLayers ?? []).some((layer) => layer.name === 'Services')) fail('14 Elm St still has a Services layer')
// The scene's promise, restated here so a change to `make-layers-seed.ts` cannot quietly move the
// copy's layers out from under the e2e that names them.
const layerOf = (project: Project, itemId: EntityId): EntityId | null =>
  project.existingModel.placedItems.find((item) => item.id === itemId)?.drawingLayerId ?? null
if (layerOf(fitout, TALL_PANTRY) !== FURNITURE || layerOf(fitout, DISHWASHER) !== FURNITURE) fail('the two Furniture items moved off Furniture')
if (layerOf(fitout, GPO) !== SERVICES) fail('GPO-9 is not on Services')
if (layerOf(fitout, DINING_CHAIR) !== null) fail('Dining chair is not Unlayered')

const write = (path: string, content: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${canonicalJson(content)}\n`)
}
write(FITOUT_OUT, { domainSchemaVersion: 8, project: fitout })
write(ELM_OUT, { domainSchemaVersion: 8, project: elm })

// --- the pair, as the one database the preview build opens -------------------------------------

const envelope = JSON.parse(readFileSync(ENVELOPE, 'utf8')) as {
  dbName: string
  source: string
  projects: { id: string; revision: number; schemaVersion: number; savedAt: string; data: unknown }[]
  library: { id: string; name: string; [key: string]: unknown }[]
  assets: unknown[]
}
const record = envelope.projects[0] ?? fail('the envelope seed holds no Project')
const row = envelope.library[0] ?? fail('the envelope seed holds no library row')
if (record.schemaVersion !== 8) fail(`the envelope's first record is schema v${record.schemaVersion}`)

write(PAIR_OUT, {
  dbName: envelope.dbName,
  source: `Cross-Project paste pair: Unit 4 Fitout and 14 Elm St (${envelope.source}; scripts/make-paste-seed.ts)`,
  projects: [
    { ...record, id: FITOUT_ID, savedAt: NOW, data: fitout },
    { ...record, id: ELM_ID, savedAt: NOW, data: elm },
  ],
  library: [
    { ...row, id: FITOUT_ID, name: 'Unit 4 Fitout', savedAt: NOW },
    { ...row, id: ELM_ID, name: '14 Elm St', savedAt: NOW },
  ],
  assets: envelope.assets,
})

const nameOf = (project: Project, itemId: EntityId): string => {
  const item = project.existingModel.placedItems.find((row) => row.id === itemId) ?? fail(`no item is ${itemId}`)
  const design = project.itemDesigns.find((row) => row.id === item.itemDesignId)
  const layer = (project.drawingLayers ?? []).find((row) => row.id === (item.drawingLayerId ?? undefined))
  return `${design?.name ?? item.id} [${layer?.name ?? 'Unlayered'}]`
}

console.log(
  `make-paste-seed: ${FITOUT_OUT}\n  ${ELM_OUT}\n  ${PAIR_OUT}\n` +
    `  ${fitout.meta.name}: layers ${(fitout.drawingLayers ?? []).map((layer) => layer.name).join(' → ')}\n` +
    `  the copy of criterion 1: ${[TALL_PANTRY, DISHWASHER, GPO, DINING_CHAIR].map((id) => nameOf(fitout, id)).join(', ')}\n` +
    `  ${elm.meta.name}: layers ${(elm.drawingLayers ?? []).map((layer) => layer.name).join(' → ')}; ` +
    `views ${elm.views.map((view) => `${view.name} (${view.designOptionId ?? 'no Option'}/${view.renovationDisplay ?? 'plain'})`).join(', ')}\n` +
    `  pair: 2 Projects, ${envelope.assets.length} asset`,
)
