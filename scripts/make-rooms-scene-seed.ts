/**
 * Generate `fixtures/e2e/preview-seed/odd-shape-30.json` (#67 criterion 11).
 *
 * The scene the issue names: one Floor; Walls W-1…W-5; a Kitchen drawn as an L-shaped Custom
 * Path; a Bedroom from the Rectangle preset; and the Item Design `Base 600` (600 × 400) with two
 * Placed Items. Everything is drawn through the same Intents the app dispatches — `applyIntent`
 * with real ID spends — so the fixture cannot hold a Room the editor could not have made.
 *
 * The one thing the prototype got wrong and this fixture exists to get right (shape prototype
 * defect: Rooms floated 150–200 mm inside the faces): **every seeded Room Edge that runs along a
 * Wall lies exactly on that Wall's Room-side face**. The Kitchen's three face Edges are therefore
 * not merely drawn near a face — they are attached with `room.attachFace`, which slides them onto
 * the face and records the reference, so the fixture also carries the references that make
 * `wall.delete` refuse. The Bedroom is a preset, and a preset Edge cannot hold a reference (the
 * picker says `Convert to Custom Path to attach this edge`), so its two face Edges are placed on
 * the faces by construction: the rectangle's bounds are the face coordinates themselves.
 *
 * The script checks both claims before writing, through the same derive the app renders from:
 * every attached Edge is offered its own face at 0 mm, and the Bedroom's evaluated Outline touches
 * W-1's and W-2's Room-side faces. A fixture that drifted would fail here rather than photograph
 * a Room floating off its Wall.
 *
 *   npx vite-node scripts/make-rooms-scene-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, chainJunctionCount, INTENT_LABELS } from '../src/edit'
import type { IntentType, PayloadOf, RoomOutlineShape, WallDraft, WallEndTarget } from '../src/edit'
import { deriveRooms, deriveWalls, roomFaceCandidates } from '../src/derive'
import { migrateProject, roomSegments, validateProject } from '../src/domain'
import type { Project, Room, WallFaceSide, WallRefLine } from '../src/domain'
import { pt } from '../src/geometry'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, NewAsset, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/legacy-v3.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/odd-shape-30.json')

/** The scan read at one tenth of the scale `legacy-v3.json` calibrates it to: 10,240 × 7,680 mm. */
const PIXELS_PER_MM = 0.025
const PROJECT_NAME = 'Odd-shaped rooms with wall references'
const NOW = '2026-01-01T09:00:00+08:00'

function fail(message: string): never {
  console.error(`make-rooms-scene-seed: ${message}`)
  process.exit(1)
}

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
/** The scan is the only thing that gives the Plan View its extent, so it is calibrated to 40 mm/px. */
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

// --- the Walls: a clockwise ring and one partition ------------------------------------------
//
// Clockwise in the +Y-down frame puts the interior of the flat on every Wall's `right`, so the
// Room-side face of all five Walls is the `right` one — which is what the Kitchen's references
// name, and what the Bedroom's bounds are built from.

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

const RING: readonly WallDraft[] = [
  wall(straight(600, 600, 9600, 600), 200), // W-1 · faces y = 500 / 700
  wall(straight(9600, 600, 9600, 7000), 200), // W-2 · faces x = 9700 / 9500
  wall(straight(9600, 7000, 600, 7000), 200), // W-3 · faces y = 7100 / 6900
  wall(straight(600, 7000, 600, 600), 200), // W-4 · faces x = 500 / 700
]

const renamed = apply(current, 'project.rename', { name: PROJECT_NAME }, [])
current = renamed

const ring = drawChain(
  current,
  RING,
  [link(3, 'end'), link(0, 'end'), link(1, 'end'), link(2, 'end')],
  [link(1, 'start'), link(2, 'start'), link(3, 'start'), link(0, 'start')],
)
current = ring.project
const [w1, w2, w3, w4] = ring.ids
const partition = drawChain(current, [wall(straight(4000, 600, 4000, 3000), 100)], [attach(w1!)], [free])
current = partition.project
const w5 = partition.ids[0]!

// The Room-side face of each Wall, by plan reference — the coordinates the Rooms are built on.
const FACE = {
  /** W-1 · y = 700. */ top: 700,
  /** W-2 · x = 9500. */ right: 9500,
  /** W-4 · x = 700. */ left: 700,
  /** W-5 · x = 3950. */ partition: 3950,
} as const

// --- the Kitchen: an L-shaped Custom Path, three Edges on faces -----------------------------

const KITCHEN_EDGES = [
  pt(FACE.left, FACE.top),
  pt(FACE.partition, FACE.top),
  pt(FACE.partition, 3000),
  pt(2400, 3000),
  pt(2400, 4600),
  pt(FACE.left, 4600),
]

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
const [edgeTop, edgePartition, , , , edgeLeft] = kitchenIds.slice(1)

// The three Edges that run along a Wall claim it. Each is already on the face, so the Intent moves
// nothing — it records the reference, which is the thing `wall.delete` then has to honour.
const claim = (segmentId: string, wallId: string, side: WallFaceSide): Project =>
  apply(current, 'room.attachFace', { roomId: kitchenId, segmentId, wallId, side }, [])
current = claim(edgeTop!, w1!, 'right')
current = claim(edgePartition!, w5!, 'right')
current = claim(edgeLeft!, w4!, 'right')

// --- the Bedroom: the Rectangle preset, its bounds on the faces -----------------------------

// 3,500 × 3,300 centred at (7,750, 2,350): its top Edge lies on W-1's Room-side face and its
// right Edge on W-2's, exactly, because these are the face coordinates and not an approximation.
const bedroomShape: RoomOutlineShape = {
  kind: 'preset',
  preset: { kind: 'rectangle', width: 3500, depth: 3300 },
  centre: pt((FACE.right + 6000) / 2, (FACE.top + 4000) / 2),
  orientationDeg: 0,
}
current = apply(current, 'room.create', { floorId, outline: bedroomShape, name: 'Bedroom' }, newIds('room', 5))

// --- `Base 600`: one Item Design, two Placed Items -------------------------------------------

const [base600, placedInside] = newIds('item', 2)
current = apply(current, 'plan.addObject', { floorId, catalogKey: 'sofa-2' }, [base600, placedInside])
current = apply(current, 'design.update', { itemDesignId: base600, patch: { name: 'Base 600' } }, [])
current = apply(current, 'design.setFootprint', {
  itemDesignId: base600,
  footprint: { kind: 'preset', preset: { kind: 'rectangle', width: 600, depth: 400 }, centre: pt(0, 0), orientationDeg: 0 },
}, [])
// The Item Origin at the centre of the footprint, so a placement's `translation` *is* the point
// the footprint stands on and the second Item can be put across the Kitchen's Edge on purpose.
current = apply(current, 'design.setOrigin', { itemDesignId: base600, origin: pt(0, 0) }, [])
const placedCrossing = newIds('item', 1)[0]!
current = apply(current, 'plan.placeDesign', { floorId, itemDesignId: base600 }, [placedCrossing])
// One Item stands inside the Kitchen; the other straddles its partition Edge at x = 3,950, so the
// membership row has something to say about both (#67 §15).
current = apply(current, 'plan.movePlacement', { placedItemId: placedInside, translation: pt(2000, 1800) }, [])
current = apply(current, 'plan.movePlacement', { placedItemId: placedCrossing, translation: pt(3950, 1800) }, [])

// --- check the two claims the fixture exists to make ----------------------------------------

if (!validateProject(current).ok) fail(`the scene does not validate: ${JSON.stringify(validateProject(current).problems.slice(0, 3))}`)

const walls = deriveWalls(current, floorId)
const rooms = current.existingModel.rooms
if (current.existingModel.walls.length !== 5) fail(`${String(current.existingModel.walls.length)} Walls, expected the ring and the partition`)
if (rooms.length !== 2) fail(`${String(rooms.length)} Rooms, expected the Kitchen and the Bedroom`)

const kitchen = rooms.find((room) => room.name === 'Kitchen')
const bedroom = rooms.find((room) => room.name === 'Bedroom')
if (kitchen === undefined || bedroom === undefined) fail('the Kitchen or the Bedroom is missing')

/** The face an Edge claims, as the derive answers it: 0 mm away and standing on it. */
function faceUnder(room: Room, segmentId: string): { wallId: string, side: WallFaceSide, distanceMm: number, onFace: boolean } | null {
  const reference = room.wallFaceRefs.find((each) => each.segmentId === segmentId)
  if (reference === undefined) return null
  // The reference names the Wall by ID; the candidate names it by the plan reference a person reads.
  const ref = current.existingModel.walls.find((each) => each.id === reference.wallId)?.ref ?? ''
  const offered = roomFaceCandidates(room, segmentId, walls, rooms, 1)
  const match = offered.find((each) => each.wallRef === ref && each.side === reference.side)
  return match === undefined ? null : { wallId: reference.wallId, side: reference.side, distanceMm: match.distanceMm, onFace: match.onFace }
}

for (const segmentId of [edgeTop!, edgePartition!, edgeLeft!]) {
  const under = faceUnder(kitchen, segmentId)
  if (under === null || under.distanceMm > 0.01 || !under.onFace) {
    fail(`Kitchen edge ${segmentId} does not lie on the face it claims (${JSON.stringify(under)})`)
  }
}
if (kitchen.wallFaceRefs.length !== 3) fail(`${String(kitchen.wallFaceRefs.length)} references, expected the three face Edges`)
if (bedroom.wallFaceRefs.length !== 0) fail('a preset Edge holds a reference, which the editor refuses')

const derived = deriveRooms(current, floorId).rooms
const bedroomPath = derived.find((room) => room.id === bedroom.id)?.path
if (bedroomPath === undefined) fail('the Bedroom does not evaluate')
const bounds = bedroomPath.segments.reduce(
  (box, segment) => {
    const to = segment.kind === 'line' ? segment.to : segment.end
    return { minX: Math.min(box.minX, to.x), minY: Math.min(box.minY, to.y), maxX: Math.max(box.maxX, to.x), maxY: Math.max(box.maxY, to.y) }
  },
  { minX: bedroomPath.start.x, minY: bedroomPath.start.y, maxX: bedroomPath.start.x, maxY: bedroomPath.start.y },
)
if (Math.abs(bounds.minY - FACE.top) > 0.01 || Math.abs(bounds.maxX - FACE.right) > 0.01) {
  fail(`the Bedroom floats off its faces: ${JSON.stringify(bounds)}`)
}
if (roomSegments(kitchen.outline).length !== 6) fail('the Kitchen is not the six-Edge L it was drawn as')

// The scene's own two Items. The Floor also carries the nine Placed Items the legacy plan it is
// built on brings (`legacy-v3.json`, and every scene seed made from it); they are not part of what
// this fixture claims, so the checks below name Base 600's two and nothing else.
const placements = current.existingModel.placedItems.filter((each) => each.itemDesignId === base600)
if (placements.length !== 2) fail(`${String(placements.length)} Placed Items of Base 600, expected two`)
if (current.itemDesigns.filter((each) => each.name === 'Base 600').length !== 1) fail('Base 600 is not the one design it should be')
const membership = deriveRooms(current, floorId).membership
const relations = placements.map((each) => `${each.id}:${String(membership.get(each.id)?.map((row) => `${row.roomName}=${row.relation}`).join('+') ?? 'none')}`)
if (!relations.some((each) => each.includes('Kitchen=inside'))) fail(`no Base 600 Item stands inside the Kitchen: ${relations.join(', ')}`)
if (!relations.some((each) => each.includes('Kitchen=crosses'))) fail(`no Base 600 Item crosses the Kitchen: ${relations.join(', ')}`)

// --- commit through the production adapter, as `make-warnings-scene-seed.ts` does ------------

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
  source: `${relative(repoRoot, SOURCE)} + Room Intents (scripts/make-rooms-scene-seed.ts)`,
  projects: records,
  library: listed.value,
  assets: storedAssets,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `make-rooms-scene-seed: ${OUT}\n` +
    `  Floor ${floorId} at ${String(PIXELS_PER_MM)} px/mm\n` +
    `  ${String(current.existingModel.walls.length)} Walls, ${String(rooms.length)} Rooms (${rooms.map((r) => r.name).join(', ')}), ` +
    `${kitchen.wallFaceRefs.length} face references\n` +
    `  Base 600: ${String(current.existingModel.placedItems.length)} Placed Items\n` +
    `  projects: ${records.map((r) => `${r.data.meta.name}@r${r.revision}`).join(', ')}\n` +
    `  ids minted: ${nextId}`,
)
