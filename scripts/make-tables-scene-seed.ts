/**
 * The Tables scene: the odd-shaped Plan View plus everything the five element tables need to
 * show a reader (#68 criterion 1, 2, 5).
 *
 *   npx vite-node scripts/make-tables-scene-seed.ts
 *
 * It starts from the committed `odd-shape-30.json` Project — the ring, the partition, the
 * L-shaped Kitchen attached to wall faces, the rectangular Bedroom and the Placed Items — and
 * adds, through the same Intents the editor sends, the four things that scene cannot hold:
 *
 *   - `W-6`, an arc Wall of radius 2 000 mm sweeping 90°, so a golden row carries an arc length
 *     (3 141.593 mm) and a radius where a straight Wall carries neither;
 *   - `W-7`, a straight Wall to carry a Window, which has no hinge and no swing;
 *   - three Openings: a 900 hinged Door on the arc — its far jamb is 907.77 mm along the curve,
 *     not 900 — a 1 200 Window on `W-7`, and an 1 800 sliding door in the Kitchen partition;
 *   - a third `Base 600`, standing across the Bedroom's edge, so one Placed Item row reads
 *     `crosses` with an empty Room while two others read `inside Kitchen`.
 *
 * The two Acknowledgements are read back from `deriveWarnings` rather than guessed, as
 * `make-warnings-scene-seed.ts` does: the crossing of the Wardrobe and the Kitchen is
 * acknowledged with the signature the engine computes for it and the note `Builder to check`,
 * and the crossing of the second `Base 600` is given the *first* one's signature — a real
 * signature of a real warning that no longer describes this pair, which is exactly how a
 * signature goes stale. With the new Bedroom crossing left alone, the three statuses the
 * Warnings List sorts by — `acknowledged`, `reopened`, `open` — all exist, once each.
 *
 * Every assertion at the bottom is a fact the goldens under `fixtures/export/golden/` depend on,
 * so a seed that quietly stopped carrying one fails here rather than in a diff of bytes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveWarnings } from '../src/derive'
import { migrateProject, openingSpan, validateProject, warningKey } from '../src/domain'
import type { Acknowledgement, Project } from '../src/domain'
import { refLength } from '../src/geometry'
import { applyIntent, chainJunctionCount, INTENT_LABELS } from '../src/edit'
import type { Intent, WallDraft } from '../src/edit'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, NewAsset, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/odd-shape-30.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/tables-scene.json')

const PROJECT_NAME = 'Every table'
const NOW = '2026-01-01T09:00:00+08:00'

/** The Kitchen's partition, which the sliding door is cut into. */
const PARTITION_ID = 'seed-wall-010'
/** The Item Design placed three times: two in the Kitchen, one across the Bedroom's edge. */
const BASE_600_ID = 'seed-item-024'
const KITCHEN_ID = 'seed-room-012'
const BEDROOM_ID = 'seed-room-019'

/**
 * The arc: centre (6 200, 6 200), radius 2 000, a quarter turn from due west to due north. The
 * `through` point is the 45° point of the same circle, so `arcFromThrough` solves the radius the
 * contract names and the arc length is `2 000 × π/2 = 3 141.593` mm.
 */
const ARC: WallDraft = {
  line: {
    kind: 'arc',
    start: { x: 4200, y: 6200 },
    end: { x: 6200, y: 4200 },
    through: { x: 4785.786, y: 4785.786 },
  },
  thickness: 100,
  justification: 'centre',
  classification: 'external',
  constructionLabel: 'Face brick',
  baseElevation: 0,
  height: 2600,
}

/** The straight Wall the Window goes in, in the same empty quarter of the Floor. */
const WINDOW_WALL: WallDraft = {
  line: { kind: 'line', start: { x: 7000, y: 6200 }, end: { x: 9400, y: 6200 } },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
}

/** Where the third `Base 600` stands: 200 mm of its 600 is outside the Bedroom's west face. */
const CROSSING_PLACEMENT = { x: 5800, y: 2000 }

function fail(message: string): never {
  console.error(`make-tables-scene-seed: ${message}`)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] =>
  Array.from({ length: count }, () => `seed-tbl-${String(++nextId).padStart(3, '0')}`)

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
  Array.from({ length: count }, () => `seed-tbl-view-${String(++nextId).padStart(3, '0')}`))
if (!migrated.ok) fail(`the seeded Project no longer migrates: ${migrated.error.message}`)

let current: Project = migrated.project
const floor = current.floors[0]
if (floor === undefined) fail('the Project holds no Floor')
const floorId = floor.id

const commit = (intent: Intent): void => {
  const applied = applyIntent(current, intent)
  if (!applied.ok) fail(`${intent.label} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  current = applied.project
}

const draw = (draft: WallDraft): void => {
  const payload = { floorId, walls: [draft], starts: [{ kind: 'free' } as const], ends: [{ kind: 'free' } as const] }
  commit({
    type: 'wall.createChain',
    payload,
    label: INTENT_LABELS['wall.createChain'],
    ids: newIds(1 + chainJunctionCount(payload)),
    now: NOW,
  })
}

commit({ type: 'project.rename', payload: { name: PROJECT_NAME }, label: INTENT_LABELS['project.rename'], ids: [], now: NOW })
draw(ARC)
draw(WINDOW_WALL)

const [arcWall, windowWall] = current.existingModel.walls.slice(-2)
if (arcWall === undefined || windowWall === undefined) fail('the two new Walls were not drawn')
if (arcWall.line.kind !== 'arc') fail('the first new Wall is not an arc')

/**
 * The three Openings, and the one thing each is here to prove.
 *
 * A hinged door on the curve, because its far jamb is measured along the arc; a Window, because
 * it has neither hinge nor swing; and the kitchen door, which slides and so has no hinge to have
 * a side of.
 */
const OPENINGS: readonly {
  hostWallId: string
  kind: 'door' | 'window'
  label: string
  start: number
  width: number
  sill: number
  head: number
  swing?: 'left' | 'right' | 'sliding'
  hingeSide?: 'start' | 'end'
}[] = [
  { hostWallId: arcWall.id, kind: 'door', label: 'Door 1', start: 400, width: 900, sill: 0, head: 2100, swing: 'left', hingeSide: 'start' },
  { hostWallId: windowWall.id, kind: 'window', label: 'Window 1', start: 600, width: 1200, sill: 900, head: 2400 },
  { hostWallId: PARTITION_ID, kind: 'door', label: 'Kitchen door', start: 300, width: 1800, sill: 0, head: 2400, swing: 'sliding' },
]

for (const each of OPENINGS) {
  commit({
    type: 'opening.create',
    payload: {
      floorId,
      hostWallId: each.hostWallId,
      kind: each.kind,
      label: each.label,
      start: each.start,
      width: each.width,
      sill: each.sill,
      head: each.head,
      ...(each.swing === undefined ? {} : { swing: each.swing }),
      ...(each.hingeSide === undefined ? {} : { hingeSide: each.hingeSide }),
    },
    label: INTENT_LABELS['opening.create'],
    ids: newIds(1),
    now: NOW,
  })
}

// The third `Base 600`: placed at the catalogue's spawn point, then dragged to the Bedroom edge.
commit({
  type: 'plan.placeDesign',
  payload: { floorId, itemDesignId: BASE_600_ID },
  label: INTENT_LABELS['plan.placeDesign'],
  ids: newIds(1),
  now: NOW,
})
const crossing = current.existingModel.placedItems.at(-1)
if (crossing === undefined) fail('the third Base 600 was not placed')
commit({
  type: 'plan.movePlacement',
  payload: { placedItemId: crossing.id, translation: CROSSING_PLACEMENT },
  label: INTENT_LABELS['plan.movePlacement'],
  ids: [],
  now: NOW,
})

const validated = validateProject(current)
if (!validated.ok) fail(`the Project does not validate: ${JSON.stringify(validated.problems.slice(0, 3))}`)

// --- the two Acknowledgements, read back from the engine ------------------------------------

const produced = deriveWarnings(current, floorId, null).warnings
if (produced.length !== 3) {
  fail(`${String(produced.length)} warnings produced, expected the two Kitchen crossings and the Bedroom one`)
}
const wardrobe = produced.find((warning) => warning.subjects[0]?.id === 'fp-wardrobe')
const secondBase = produced.find((warning) => warning.subjects[0]?.id === 'seed-item-026')
const bedroomCrossing = produced.find((warning) => warning.subjects[0]?.id === crossing.id)
if (wardrobe === undefined || secondBase === undefined || bedroomCrossing === undefined) {
  fail(`the three crossings are not the ones the fixture was written against: ${produced.map((w) => w.key).join(', ')}`)
}
if (bedroomCrossing.subjects[1]?.id !== BEDROOM_ID) fail('the new item does not cross the Bedroom')

const ackOf = (warning: typeof wardrobe, signature: string, note: string): Acknowledgement => ({
  id: `seed-tbl-ack-${warningKey(warning.type, warning.subjects.map((s) => s.id), null).slice(0, 24)}`,
  warningType: warning.type,
  subjectIds: [...warning.subjects.map((s) => s.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  designOptionId: null,
  signature,
  note,
  acknowledgedAt: NOW,
})

const acknowledgements: Acknowledgement[] = [
  ackOf(wardrobe, wardrobe.signature, 'Builder to check'),
  ackOf(secondBase, wardrobe.signature, 'Re-measure after the partition moves.'),
]
current = { ...current, warningAcknowledgements: acknowledgements }

// --- what the goldens are going to say ------------------------------------------------------

const checked = deriveWarnings(current, floorId, null).warnings
const statuses = checked.map((warning) => warning.status).sort()
if (statuses.join(',') !== 'acknowledged,open,reopened') {
  fail(`the fixture would list ${statuses.join(', ')}, expected one of each status`)
}
if (checked.find((warning) => warning.status === 'acknowledged')?.acknowledgement?.note !== 'Builder to check') {
  fail('the acknowledged row lost its note')
}
if (validateProject(current).ok !== true) fail('the acknowledged Project no longer validates')

const walls = current.existingModel.walls
if (walls.length !== 7) fail(`${String(walls.length)} Walls drawn, expected the ring, the partition and two more`)
if (walls.map((wall) => wall.ref).join(' ') !== 'W-1 W-2 W-3 W-4 W-5 W-6 W-7') {
  fail(`unexpected refs: ${walls.map((wall) => wall.ref).join(', ')}`)
}
const arcLength = refLength(arcWall.line)
if (Math.abs(arcLength - 3141.593) > 0.001) fail(`the arc is ${arcLength.toFixed(3)} mm, expected 3141.593`)
const door = current.existingModel.openings.find((each) => each.label === 'Door 1')
if (door === undefined) fail('the arc door was not cut')
const span = openingSpan(arcWall.line, door!.start, door!.width)
if (Math.abs(span.end - door!.start - 907.772) > 0.001) {
  fail(`the 900 door on the arc spans ${(span.end - door!.start).toFixed(3)} mm, expected 907.772`)
}
if (current.existingModel.openings.length !== 3) fail('three Openings were not cut')
if (current.existingModel.placedItems.length !== 12) fail('the third Base 600 is missing')
if (current.existingModel.rooms.map((room) => room.id).join(' ') !== `${KITCHEN_ID} ${BEDROOM_ID}`) {
  fail('the two Rooms are no longer the two the fixture was written against')
}

// --- commit through the production adapter, as `make-openings-scene-seed.ts` does -----------

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
  if (!committed.ok) fail(`committing "${project.meta.name}" failed: ${committed.error.kind}`)
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
  source: `${relative(repoRoot, SOURCE)} + 2 wall.createChain, 3 opening.create, 1 plan.placeDesign, 1 plan.movePlacement and 2 Acknowledgements (scripts/make-tables-scene-seed.ts)`,
  projects: records,
  library: listed.value,
  assets: storedAssets,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `make-tables-scene-seed: ${OUT}\n` +
    `  Floor ${floorId} "${floor.name}": ${String(walls.length)} Walls, ${String(current.existingModel.openings.length)} Openings, ${String(current.existingModel.rooms.length)} Rooms, ${String(current.existingModel.placedItems.length)} Placed Items\n` +
    `  ${arcWall.ref}: ${arcLength.toFixed(3)} mm of arc, radius 2000, sweep 90°\n` +
    `  ${current.existingModel.openings.map((each) => `${each.label} on ${each.hostWallId} at ${String(each.start)}–${openingSpan((walls.find((w) => w.id === each.hostWallId) ?? arcWall).line, each.start, each.width).end.toFixed(3)}`).join('\n  ')}\n` +
    `  ${checked.map((warning) => `${warning.status}: ${warning.key}${warning.status === 'acknowledged' ? ` (${warning.acknowledgement?.note ?? ''})` : ''}`).join('\n  ')}\n` +
    `  projects: ${records.map((r) => `${r.data.meta.name}@r${r.revision}`).join(', ')}\n` +
    `  ids minted: ${nextId}`,
)
