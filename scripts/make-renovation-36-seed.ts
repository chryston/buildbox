/**
 * Generate `fixtures/e2e/preview-seed/renovation-36.json` (#69 criterion 1).
 *
 * The scene the renovation edits are tested against: one Floor; Walls W-1…W-6; `Door 1` and
 * `Window 2` through W-3; `Window 3` through W-6; a Kitchen whose right Edge is attached to W-5's
 * Kitchen-side face; a Bedroom clear of both; and the Item Design `Base 600` (600 × 400) with one
 * Placed Item — `Base 600 #1` — standing inside the Kitchen. Two Design Options, `Option A` and
 * `Option B`, exist and hold nothing: the fixture is the *before* state every row of the issue's
 * base-plan renovation-edit table starts from, so the edits themselves are what a test applies.
 *
 * Everything the Existing Model holds is drawn through the same Intents the app dispatches, so the
 * fixture cannot hold a Wall, Opening, Room or Item the editor could not have made. The two
 * Options are the one thing written by hand: `design.option.create` arrives with the renovation
 * Intent set later in #69, and by then this file will say so and build them through it instead.
 *
 * The script checks the scene before writing it — the refs, the hosts, the attachment (0 mm,
 * through the same derive the face picker renders), the footprint, the two Option names, and that
 * an empty Option's effective model is the Existing Model exactly. A fixture that drifted would
 * fail here rather than photograph an edit that means nothing.
 *
 * It runs only with the flag on, because the file it writes is a v8 Project:
 *
 *   VITE_FF_RENOVATION=true npx vite-node scripts/make-renovation-36-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, chainJunctionCount, INTENT_LABELS } from '../src/edit'
import type { IntentType, PayloadOf, RoomOutlineShape, WallDraft, WallEndTarget } from '../src/edit'
import { deriveRooms, deriveWalls, effectiveModel, roomFaceCandidates } from '../src/derive'
import { migrateProject, validateProject } from '../src/domain'
import type { DesignOption, Project, WallFaceSide, WallRefLine } from '../src/domain'
import { pt } from '../src/geometry'
import { canonicalJson, FF_RENOVATION } from '../src/lib'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, NewAsset, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/legacy-v3.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/renovation-36.json')
const DOMAIN_OUT = resolve(repoRoot, 'fixtures/domain/v8/renovation.json')

/** 10,240 × 7,680 mm at the scale `legacy-v3.json` calibrates its scan to. */
const PIXELS_PER_MM = 0.025
const PROJECT_NAME = 'Renovation edits'
const NOW = '2026-01-01T09:00:00+08:00'

function fail(message: string): never {
  console.error(`make-renovation-36-seed: ${message}`)
  process.exit(1)
}

if (!FF_RENOVATION) fail('VITE_FF_RENOVATION is off, so this build cannot write a Project that holds Design Options')

let nextId = 0
const newIds = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, () => `seed-${prefix}-${String(++nextId).padStart(3, '0')}`)

interface Seed {
  dbName: string
  source: string
  projects: { id: string; revision: number; schemaVersion: number; savedAt: string; data: unknown }[]
  library: unknown[]
  assets: (Omit<AssetRecord, 'blob'> & { blob: unknown; base64: string })[]
}

const seed = JSON.parse(readFileSync(SOURCE, 'utf8')) as Seed
const [first, ...rest] = seed.projects
if (first === undefined || rest.length === 0) fail('the seed does not hold two Projects')

const migrated = migrateProject(first.data as Project, first.schemaVersion, (count = 1) =>
  Array.from({ length: count }, () => `seed-view-${String(++nextId).padStart(3, '0')}`))
if (!migrated.ok) fail(`the seeded Project no longer migrates: ${migrated.error.message}`)

const floor = migrated.project.floors[0]
if (floor === undefined || floor.planImage === null) fail('the first Floor carries no Plan Image')
const floorId = floor.id

let current: Project = {
  ...migrated.project,
  floors: migrated.project.floors.map((each) =>
    each.id === floorId && each.planImage !== null
      ? { ...each, planImage: { ...each.planImage, pixelsPerMm: PIXELS_PER_MM } }
      : each,
  ),
}

/** One Intent, with the IDs it spends minted the way the app mints them. */
function apply<T extends IntentType>(project: Project, type: T, payload: PayloadOf<T>, ids: string[]): Project {
  const intent = { type, payload, label: INTENT_LABELS[type], ids, now: NOW } as Parameters<typeof applyIntent>[1]
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`${type} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return applied.project
}

// --- the Walls: a ring, one partition across it, one free-standing partition -----------------
//
// The ring is clockwise in the +Y-down frame, so the flat's interior lies on every ring Wall's
// `right` — which is the side the Kitchen's reference names. W-5 runs top to bottom through the
// middle and T-joins W-1 and W-3 at both ends, which is what makes it the Wall a Room references
// and a `replaceInOption` has to carry junctions for. W-6 stands free, so demolishing it — the
// issue's `Remove whole wall` row — has nothing hanging off it but its own window.

const free: WallEndTarget = { kind: 'free' }
const link = (index: number, end: 'start' | 'end'): WallEndTarget => ({ kind: 'segment', index, end })
const attach = (wallId: string): WallEndTarget => ({ kind: 'host', wallId })

const straight = (x1: number, y1: number, x2: number, y2: number): WallRefLine => ({
  kind: 'line',
  start: pt(x1, y1),
  end: pt(x2, y2),
})

const wall = (line: WallRefLine, thickness: number): WallDraft => ({
  line,
  thickness,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

function drawChain(
  project: Project,
  walls: readonly WallDraft[],
  starts: readonly WallEndTarget[],
  ends: readonly WallEndTarget[],
): { project: Project; ids: string[] } {
  const payload = { floorId, walls, starts, ends }
  const ids = newIds('wall', walls.length + chainJunctionCount(payload))
  const next = apply(project, 'wall.createChain', payload, ids)
  return { project: next, ids: ids.slice(0, walls.length) }
}

// W-2 and W-4 are 6,000 long so a 900 door and a 1,200 knock-through both fit; W-3 carries two
// Openings with room to spare; W-6 is 2,500 long for its window.
const RING: readonly WallDraft[] = [
  wall(straight(600, 600, 9600, 600), 200), // W-1 · faces y = 500 / 700
  wall(straight(9600, 600, 9600, 6600), 200), // W-2 · faces x = 9700 / 9500
  wall(straight(9600, 6600, 600, 6600), 200), // W-3 · faces y = 6700 / 6500
  wall(straight(600, 6600, 600, 600), 200), // W-4 · faces x = 500 / 700
]

current = apply(current, 'project.rename', { name: PROJECT_NAME }, [])

const ring = drawChain(
  current,
  RING,
  [link(3, 'end'), link(0, 'end'), link(1, 'end'), link(2, 'end')],
  [link(1, 'start'), link(2, 'start'), link(3, 'start'), link(0, 'start')],
)
current = ring.project
const [w1, w2, w3, w4] = ring.ids

const partition = drawChain(current, [wall(straight(4000, 600, 4000, 6600), 150)], [attach(w1!)], [attach(w3!)])
current = partition.project
const w5 = partition.ids[0]!

const standalone = drawChain(current, [wall(straight(5000, 4200, 7500, 4200), 100)], [free], [free])
current = standalone.project
const w6 = standalone.ids[0]!

// --- the Openings: `Door 1` and `Window 2` through W-3, `Window 3` through W-6 ---------------

const opening = (
  hostWallId: string,
  label: string,
  kind: 'door' | 'window',
  start: number,
  width: number,
  sill: number,
  head: number,
): Project =>
  apply(current, 'opening.create', {
    floorId,
    hostWallId,
    kind,
    label,
    start,
    width,
    sill,
    head,
    ...(kind === 'door' ? { swing: 'left' as const, hingeSide: 'start' as const } : {}),
  }, newIds('opening', 1))

current = opening(w3!, 'Door 1', 'door', 800, 900, 0, 2100)
current = opening(w3!, 'Window 2', 'window', 3200, 1200, 900, 2400)
current = opening(w6!, 'Window 3', 'window', 600, 900, 900, 2400)

// --- the Kitchen: a Custom Path whose right Edge is claimed from W-5 -------------------------

/** W-5's Kitchen-side face: x = 3,925, the Wall being 150 thick and centre-justified. */
const KITCHEN_FACE_X = 3925

const KITCHEN_EDGES = [pt(700, 700), pt(KITCHEN_FACE_X, 700), pt(KITCHEN_FACE_X, 5400), pt(700, 5400)]

const kitchenShape: RoomOutlineShape = {
  kind: 'path',
  path: {
    start: KITCHEN_EDGES[0]!,
    segments: [...KITCHEN_EDGES.slice(1), KITCHEN_EDGES[0]!].map((to) => ({ kind: 'line' as const, to })),
  },
}

const kitchenIds = newIds('room', 1 + KITCHEN_EDGES.length)
current = apply(current, 'room.create', { floorId, outline: kitchenShape, name: 'Kitchen' }, kitchenIds)
const kitchenId = kitchenIds[0]!
const kitchenPartitionEdge = kitchenIds[2]!

// The side is read from the derive rather than assumed: the candidate at x = 3,925 is the face the
// Edge stands on, and attaching it moves nothing. A wrong side would slide the Edge to the
// other face, which the check below would catch — but not as kindly as this line does.
const faceFor = (project: Project, roomId: string, segmentId: string) =>
  roomFaceCandidates(
    project.existingModel.rooms.find((each) => each.id === roomId)!,
    segmentId,
    deriveWalls(project, floorId),
    project.existingModel.rooms.filter((each) => each.floorId === floorId),
    1,
  )
const faceAt = faceFor(current, kitchenId, kitchenPartitionEdge).find(
  (candidate) => candidate.wallId === w5 && candidate.from.x === KITCHEN_FACE_X,
)
if (faceAt === undefined) fail(`W-5 offers no face at x = ${String(KITCHEN_FACE_X)} for the Kitchen's Edge`)
current = apply(
  current,
  'room.attachFace',
  { roomId: kitchenId, segmentId: kitchenPartitionEdge, wallId: w5!, side: faceAt.side as WallFaceSide },
  [],
)

// --- the Bedroom: the Rectangle preset, clear of the Kitchen and of W-6 ----------------------

// 3,000 × 2,400 centred at (6,500, 2,000): it lies wholly on the far side of W-5, so a Kitchen
// successor that grows eastward has something to be refused against (#69 criterion 4).
current = apply(current, 'room.create', {
  floorId,
  outline: {
    kind: 'preset',
    preset: { kind: 'rectangle', width: 3000, depth: 2400 },
    centre: pt(6500, 2000),
    orientationDeg: 0,
  },
  name: 'Bedroom',
}, newIds('room', 5))

// --- `Base 600`: one Item Design, one Placed Item --------------------------------------------

const [base600, baseItem] = newIds('item', 2)
current = apply(current, 'plan.addObject', { floorId, catalogKey: 'sofa-2' }, [base600, baseItem])
current = apply(current, 'design.update', { itemDesignId: base600, patch: { name: 'Base 600' } }, [])
current = apply(current, 'design.setFootprint', {
  itemDesignId: base600,
  footprint: { kind: 'preset', preset: { kind: 'rectangle', width: 600, depth: 400 }, centre: pt(0, 0), orientationDeg: 0 },
}, [])
current = apply(current, 'design.setOrigin', { itemDesignId: base600, origin: pt(0, 0) }, [])
current = apply(current, 'plan.movePlacement', { placedItemId: baseItem, translation: pt(2000, 3000) }, [])

// --- the two Design Options ------------------------------------------------------------------

/** An Option that proposes nothing yet: the state every renovation edit in #69 starts from. */
const emptyOption = (id: string, name: string): DesignOption => ({
  id,
  name,
  demolishedIds: [],
  proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] },
})

const withOptions: Project = { ...current, designOptions: [emptyOption('option-a', 'Option A'), emptyOption('option-b', 'Option B')] }
current = withOptions

// --- check the scene the fixture exists to be -----------------------------------------------

const problems = validateProject(current)
if (!problems.ok) fail(`the scene does not validate: ${JSON.stringify(problems.error)}`)
const refs = current.existingModel.walls.map((each) => each.ref)
if (refs.join('+') !== 'W-1+W-2+W-3+W-4+W-5+W-6') fail(`the Walls are ${refs.join(', ')}, expected W-1 to W-6`)
const openings = current.existingModel.openings
const hostOf = (label: string): string | undefined =>
  openings.find((each) => each.label === label)?.hostWallId
const refOf = (wallId: string | undefined): string | undefined =>
  current.existingModel.walls.find((each) => each.id === wallId)?.ref
if (refOf(hostOf('Door 1')) !== 'W-3') fail(`Door 1 is in ${String(refOf(hostOf('Door 1')))}, expected W-3`)
if (refOf(hostOf('Window 2')) !== 'W-3') fail(`Window 2 is in ${String(refOf(hostOf('Window 2')))}, expected W-3`)
if (refOf(hostOf('Window 3')) !== 'W-6') fail(`Window 3 is in ${String(refOf(hostOf('Window 3')))}, expected W-6`)
const kitchen = current.existingModel.rooms.find((each) => each.name === 'Kitchen')
if (kitchen === undefined || kitchen.wallFaceRefs.length !== 1) fail('the Kitchen does not reference exactly one Wall')
if (kitchen?.wallFaceRefs[0]?.wallId !== w5) fail("the Kitchen's reference is not W-5")
const attached = faceFor(current, kitchenId, kitchenPartitionEdge).find((candidate) => candidate.wallId === w5)
if (attached === undefined || !attached.onFace) fail("the Kitchen's Edge is not standing on W-5's face")
const base = current.itemDesigns.find((each) => each.name === 'Base 600')
if (base === undefined) fail('Base 600 is not the one design it should be')
if (current.existingModel.placedItems.filter((each) => each.itemDesignId === base?.id).length !== 1)
  fail('Base 600 does not carry exactly one Placed Item')
const membership = deriveRooms(current, floorId).membership.get(baseItem)
if (membership?.some((row) => row.roomName === 'Kitchen' && row.relation === 'inside') !== true)
  fail('Base 600 #1 does not stand inside the Kitchen')
if (deriveWalls(current, floorId).walls.length !== 6) fail('the derived Walls are not six')
for (const optionId of ['option-a', 'option-b']) {
  const model = effectiveModel(current, floorId, optionId)
  if (model.standingWalls.length !== 6 || model.walls.some((row) => row.renovationState !== 'existing'))
    fail(`${optionId} does not stand on the Existing Model unchanged`)
}
// The label the issue names the Item by is the one the derive gives the first placement.
const labels = current.existingModel.placedItems
  .filter((each) => each.itemDesignId === base?.id)
  .map((each) => each.id)
if (labels.length !== 1 || labels[0] !== baseItem) fail('Base 600 has more than one Placed Item to name')

// --- commit through the production adapter, as `make-rooms-scene-seed.ts` does --------------

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
  source: `${relative(repoRoot, SOURCE)} + renovation Options (scripts/make-renovation-36-seed.ts)`,
  projects: records,
  library: listed.value,
  assets: storedAssets,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)
// The same Project as a domain golden: the envelope `fixtures/domain/v7/rooms.json` uses, at v8,
// written in the canonical form every file in that folder is written in (README, "How it was
// produced") — keys sorted, no whitespace, one trailing newline.
mkdirSync(dirname(DOMAIN_OUT), { recursive: true })
writeFileSync(DOMAIN_OUT, `${canonicalJson({ domainSchemaVersion: 8, project: current })}\n`)

console.log(
  `make-renovation-36-seed: ${OUT}\n` +
    `  Floor ${floorId} at ${String(PIXELS_PER_MM)} px/mm\n` +
    `  ${String(current.existingModel.walls.length)} Walls, ${String(openings.length)} Openings, ` +
    `${String(current.existingModel.rooms.length)} Rooms, ${String(current.existingModel.wallJunctions.length)} Junctions\n` +
    `  Options: ${(current.designOptions ?? []).map((each) => each.name).join(', ')}\n` +
    `  projects: ${records.map((r) => `${r.data.meta.name}@r${r.revision}`).join(', ')}\n` +
    `  ids minted: ${nextId}`,
)
