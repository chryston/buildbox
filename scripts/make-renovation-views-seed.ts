/**
 * Generate `fixtures/domain/v8/renovation-views.json` and its e2e twin
 * `fixtures/e2e/preview-seed/renovation-views.json` (#70 criterion 7).
 *
 * The scene the four Renovation Displays are tested against. It starts from the committed
 * `renovation-36.json` — the same Floor, Walls W-1…W-6, `Door 1`, `Window 2`, `Window 3`, the
 * Kitchen on W-5, the Bedroom and `Base 600 #1`, all of it drawn through the Intents the app
 * dispatches — and then does the rest of the issue's scene the same way, through `applyIntent`:
 *
 *   Option A · Open kitchen   demolishes W-2; replaces `Base 600 #1` with `Base 600 #1′`; adds a
 *                             new Island (see below)
 *   Option B · Widened opening replaces W-2 with `W-2′` on the same footprint
 *
 * plus the saved views the Displays are named by: the Floor's default view on the Existing Model,
 * `Option A · Proposed`, `Option A · Demolition` and `Option B · Combined`, each written by
 * `view.create` followed by `view.setDesignOption` and `view.setRenovationDisplay`.
 *
 * The Island is the one record in the file that is not the product of an Intent, because no Intent
 * in the shipped set creates a Placed Item owned by an Option — `renovation.replace` makes a
 * successor out of an Existing one, `renovation.placeOpening` and `renovation.knockThrough` make
 * Openings, and nothing pushes onto `designOptions[].proposed.placedItems`. Placing new work into
 * an Option is the authoring follow-up #70 leaves behind it, so the Island is written as a domain
 * record and `validateProject` below is what proves it is a legal one. Everything else in the
 * fixture is what the editor could have drawn.
 *
 *   npx vite-node scripts/make-renovation-views-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, INTENT_LABELS } from '../src/edit'
import type { IntentType, PayloadOf } from '../src/edit'
import { effectiveModel } from '../src/derive'
import { validateProject } from '../src/domain'
import type { Project } from '../src/domain'
import { canonicalJson } from '../src/lib'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, NewAsset, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/renovation-36.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/renovation-views.json')
const DOMAIN_OUT = resolve(repoRoot, 'fixtures/domain/v8/renovation-views.json')

const NOW = '2026-01-01T09:30:00+08:00'
const OPTION_A = 'option-a'
const OPTION_B = 'option-b'
const OPTION_A_NAME = 'Option A · Open kitchen'
const OPTION_B_NAME = 'Option B · Widened opening'

function fail(message: string): never {
  console.error(`make-renovation-views-seed: ${message}`)
  process.exit(1)
}


let nextId = 0
const newIds = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, () => `views-${prefix}-${String(++nextId).padStart(3, '0')}`)

interface Seed {
  dbName: string
  source: string
  projects: { id: string; revision: number; schemaVersion: number; savedAt: string; data: unknown }[]
  library: unknown[]
  assets: (Omit<AssetRecord, 'blob'> & { blob: unknown; base64: string })[]
}

const seed = JSON.parse(readFileSync(SOURCE, 'utf8')) as Seed
const [first, ...rest] = seed.projects
if (first === undefined) fail('the seed holds no Project')
let current = first.data as Project
const floor = current.floors[0]
if (floor === undefined) fail('the Project holds no Floor')
const floorId = floor.id

/** One Intent, with the IDs it spends minted the way the app mints them. */
function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[]): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

const wallByRef = (project: Project, ref: string) =>
  project.existingModel.walls.find((each) => each.ref === ref) ?? fail(`the Existing Model holds no ${ref}`)
const base600 = current.itemDesigns.find((each) => each.name === 'Base 600') ?? fail('the Project holds no Base 600')
const baseItem =
  current.existingModel.placedItems.find((each) => each.itemDesignId === base600.id) ??
  fail('the Existing Model holds no Base 600 placement')

// --- the two Options, named for what they are ------------------------------------------------
//
// `renovation-36.json` carries them unnamed because #69's edit table reads "…in Option A, and
// Option B is unchanged" and needs nothing else. Here they are the two answers to one kitchen, and
// the names the saved views and the mode bar show are the issue's.

current = apply(current, 'designOption.rename', { optionId: OPTION_A, name: OPTION_A_NAME }, [])
current = apply(current, 'designOption.rename', { optionId: OPTION_B, name: OPTION_B_NAME }, [])

// --- Option A · Open kitchen -----------------------------------------------------------------
//
// W-2 is the ring Wall on the east, so taking it out opens the flat to the stair landing rather
// than cutting a room in half: a demolition with nothing hanging off it but its own geometry.
// `Base 600 #1` is replaced rather than removed — the run of cabinetry moves down the Kitchen wall
// and comes back as `Base 600 #1′`, which is the issue's Replace (dimensions) row.

const w2 = wallByRef(current, 'W-2')
current = apply(current, 'renovation.demolish', { entityId: w2.id, target: { designOptionId: OPTION_A } }, [])
current = apply(
  current,
  'renovation.replace',
  { entityId: baseItem.id, edit: { translation: { x: baseItem.translation.x + 900, y: baseItem.translation.y } }, target: { designOptionId: OPTION_A } },
  newIds('successor', 4),
)

// --- Option B · Widened opening --------------------------------------------------------------
//
// The same Wall, replaced with no edit at all: the successor carries the footprint, the thickness
// and the height unchanged, which is what "W-2′ on the same footprint" means. The two Options
// therefore disagree about one Wall in a way the Combined display has to show — W-2 standing
// (Existing), demolished (Option A) and replaced (Option B) — and each Option's own model stays
// untouched by the other's.

current = apply(
  current,
  'renovation.replace',
  { entityId: w2.id, edit: {}, target: { designOptionId: OPTION_B } },
  newIds('successor', 8),
)

// --- the Island: the one record no Intent can make -------------------------------------------
//
// The issue's Option A adds a new Island, and nothing in the shipped Intent set creates a Placed
// Item that belongs to an Option: `renovation.replace` makes a successor out of an Existing one,
// `renovation.placeOpening` and `renovation.knockThrough` make Openings, and no handler pushes onto
// `proposed.placedItems`. Option-authoring — placing new work into an Option — is the follow-up
// issue #70 leaves behind it, so the Island is written here as a domain record and the validator
// below is what proves it is a legal one. It is the only hand-written entity in this file, and the
// only thing standing in for an Intent that does not exist yet.

const islandDesign =
  current.itemDesigns.find((each) => each.name === 'Kitchen island') ?? fail('the catalogue holds no Kitchen island')
const ISLAND = {
  id: newIds('island', 1)[0]!,
  itemDesignId: islandDesign.id,
  floorId,
  // Free in the middle of the Kitchen, clear of `Base 600 #1′` (2,900 × 3,000) and of every Existing
  // placement: the Island is new work standing in a room whose cabinetry the same Option moved.
  translation: { x: 1800, y: 4200 },
  rotationDeg: 0,
  baseElevation: 0,
  // Invented from nothing, which the validator spells out: an empty list, not an absent field.
  predecessorIds: [],
}
current = {
  ...current,
  designOptions: current.designOptions?.map((each) =>
    each.id === OPTION_A ? { ...each, proposed: { ...each.proposed, placedItems: [...each.proposed.placedItems, ISLAND] } } : each,
  ),
}

// --- the saved views the Displays are named by ------------------------------------------------

function view(name: string, designOptionId: string | null, renovationDisplay: string): string {
  const [viewId] = newIds('view', 1)
  current = apply(current, 'view.create', { floorId, name }, [viewId!])
  current = apply(current, 'view.setDesignOption', { viewId: viewId!, designOptionId }, [])
  current = apply(current, 'view.setRenovationDisplay', {
    viewId: viewId!,
    renovationDisplay: renovationDisplay as never,
  }, [])
  return viewId!
}

const viewAProposed = view('Option A · Proposed', OPTION_A, 'proposed')
view('Option A · Demolition', OPTION_A, 'demolition')
const viewBCombined = view('Option B · Combined', OPTION_B, 'combined')

// --- check the scene the fixture exists to be ------------------------------------------------

const problems = validateProject(current)
if (!problems.ok) fail(`the scene does not validate: ${JSON.stringify(problems.error)}`)

const optionA = current.designOptions?.find((each) => each.id === OPTION_A) ?? fail('Option A is gone')
const optionB = current.designOptions?.find((each) => each.id === OPTION_B) ?? fail('Option B is gone')
if (optionA.name !== OPTION_A_NAME || optionB.name !== OPTION_B_NAME) fail('the Options are not named as the issue names them')

const aModel = effectiveModel(current, floorId, OPTION_A)
const bModel = effectiveModel(current, floorId, OPTION_B)
const existingModel = effectiveModel(current, floorId, null)

// Option A takes W-2 down and leaves every other Wall standing.
if (!aModel.walls.some((row) => row.entity.id === w2.id && row.renovationState === 'demolition'))
  fail('Option A does not demolish W-2')
if (aModel.walls.filter((row) => row.renovationState === 'existing').length !== 5)
  fail('Option A leaves something other than five Walls standing')
// Option B replaces W-2 with a successor on the same footprint, and does not touch Option A.
const bSuccessor = bModel.walls.find((row) => row.renovationState === 'proposed')
if (bSuccessor === undefined) fail('Option B proposes no Wall')
if (!bSuccessor.entity.predecessorIds?.includes(w2.id)) fail('W-2′ does not name W-2 as its predecessor')
if (bSuccessor.entity.line !== undefined && JSON.stringify(bSuccessor.entity.line) !== JSON.stringify(w2.line))
  fail('W-2′ is not on W-2’s footprint')
if (!optionB.demolishedIds.includes(w2.id)) fail('Option B does not take W-2 down as part of replacing it')
if (optionB.proposed.walls.length !== 1) fail('Option B does not propose exactly one Wall')
if (optionA.proposed.walls.length !== 0) fail('Option A carries a proposed Wall of its own')
if (!optionA.demolishedIds.includes(w2.id) || !optionA.demolishedIds.includes(baseItem.id))
  fail('Option A does not hold the demolition of W-2 and `Base 600 #1`')
// The replacement: one successor, named after its predecessor with a prime on the end.
const aItems = aModel.placedItems
if (!aItems.some((row) => row.renovationState === 'demolition' && row.entity.id === baseItem.id))
  fail('Option A does not take `Base 600 #1` down')
const successorItem = aItems.find((row) => row.renovationState === 'proposed')
if (successorItem === undefined) fail('Option A proposes no Placed Item')
if (!successorItem.entity.predecessorIds?.includes(baseItem.id))
  fail('the replacement Placed Item does not name `Base 600 #1` as its predecessor')
if (successorItem.entity.translation.x !== baseItem.translation.x + 900) fail('Base 600 #1′ is not where it was moved to')
// The Island: new work, no predecessor, and nowhere in the Existing Model.
if (optionA.proposed.placedItems.length !== 2) fail('Option A does not hold the replacement and the Island')
const island = optionA.proposed.placedItems.find((each) => each.id === ISLAND.id)
if (island === undefined) fail('the Island is not in Option A')
if ((island.predecessorIds ?? []).length !== 0) fail('the Island names a predecessor it does not have')
if (current.existingModel.placedItems.some((each) => each.id === ISLAND.id)) fail('the Island is in the Existing Model')
// Membership is derived from the Existing Model, so it cannot see proposed work; the Kitchen's own
// outline is the check. It is the rectangle `make-renovation-36-seed.ts` drew — x 700…3,925 (the
// right Edge standing on W-5's Kitchen-side face), y 700…5,400 — and the Island's 500 × 300
// footprint, origin at its corner, has to fall inside it and clear of `Base 600 #1′` at 2,900 × 3,000.
if (ISLAND.translation.x < 700 || ISLAND.translation.x + 500 > 3925 || ISLAND.translation.y < 700 || ISLAND.translation.y + 300 > 5400)
  fail('the Island does not stand inside the Kitchen')
// With no Option, the Existing Model is the whole picture — the rule the error state rests on.
if (existingModel.walls.some((row) => row.renovationState !== 'existing'))
  fail('the Existing Model is not all-Existing')
if (!existingModel.walls.some((row) => row.entity.id === w2.id)) fail('W-2 does not stand in the Existing Model')

const views = current.views.filter((each) => each.floorId === floorId)
const named = (name: string) => views.find((each) => each.name === name)
if (named('Option A · Proposed')?.designOptionId !== OPTION_A || named('Option A · Proposed')?.renovationDisplay !== 'proposed')
  fail('`Option A · Proposed` is not aimed at Option A on the Proposed display')
if (named('Option A · Demolition')?.renovationDisplay !== 'demolition') fail('`Option A · Demolition` is not on the Demolition display')
if (named('Option B · Combined')?.designOptionId !== OPTION_B || named('Option B · Combined')?.renovationDisplay !== 'combined')
  fail('`Option B · Combined` is not aimed at Option B on the Combined display')
if (views.length !== 4) fail(`${views.length} saved views on the Floor, expected 4`)

// --- commit through the production adapter, as `make-renovation-36-seed.ts` does --------------

const assets = seed.assets.map((asset) => ({ ...asset, bytes: Buffer.from(asset.base64, 'base64') }))
const planImage = current.floors.find((each) => each.planImage !== null)?.planImage ?? null
const newAssets: NewAsset[] = assets.map((asset) => ({
  bytes: new Blob([new Uint8Array(asset.bytes)]),
  mediaType: asset.mediaType,
  widthPx: planImage?.assetHash === asset.sha256 ? planImage.widthPx : null,
  heightPx: planImage?.assetHash === asset.sha256 ? planImage.heightPx : null,
}))

const ports = createMemoryAdapter()
const projects = [current, ...rest.map((record) => record.data as Project)]
for (const [index, project] of projects.entries()) {
  const record = index === 0 ? first : rest[index - 1]!
  const committed = await ports.projects.commit(
    { project, revision: record.revision, savedAt: record.savedAt, newAssets: index === 0 ? newAssets : [] },
    null,
  )
  if (!committed.ok) fail(`committing "${project.name}" failed: ${committed.error.kind}`)
}

const listed = await ports.projects.list({ includeTrashed: false })
if (!listed.ok) fail(`reading the library back failed: ${listed.error.kind}`)
const records: ProjectRecord[] = []
for (const row of listed.value) {
  const loaded = await ports.projects.load(row.id)
  if (!loaded.ok) fail(`reading "${row.id}" back failed: ${loaded.error.kind}`)
  records.push(loaded.value)
}

const storedAssets: (AssetRecord & { base64: string })[] = []
for (const asset of assets) {
  const stored = await ports.assets.get(asset.sha256)
  if (!stored.ok) fail(`the asset ${asset.sha256} was not stored: ${stored.error.kind}`)
  const bytes = new Uint8Array(await stored.value.blob.arrayBuffer())
  storedAssets.push({ ...stored.value, base64: Buffer.from(bytes).toString('base64') })
}

const fixture = {
  dbName: seed.dbName,
  source: `${relative(repoRoot, SOURCE)} + the renovation-views scene (scripts/make-renovation-views-seed.ts)`,
  projects: records,
  library: listed.value,
  assets: storedAssets,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)
mkdirSync(dirname(DOMAIN_OUT), { recursive: true })
writeFileSync(DOMAIN_OUT, `${canonicalJson({ domainSchemaVersion: 8, project: current })}\n`)

console.log(
  `make-renovation-views-seed: ${OUT}\n` +
    `  ${DOMAIN_OUT}\n` +
    `  Options: ${optionA.name} / ${optionB.name}\n` +
    `  Option A: ${String(optionA.demolishedIds.length)} demolition(s), ${String(optionA.proposed.placedItems.length)} proposed Placed Item(s) (replacement + Island)\n` +
    `  Option B: ${String(optionB.proposed.walls.length)} proposed Wall(s)\n` +
    `  views: ${views.map((each) => `${each.name}[${each.designOptionId ?? '—'}/${each.renovationDisplay ?? 'existing'}]`).join(', ')}\n` +
    `  ids minted: ${nextId} (A proposed ${viewAProposed}, B combined ${viewBCombined})`,
)
