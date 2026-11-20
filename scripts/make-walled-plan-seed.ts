/**
 * Generate `fixtures/e2e/preview-seed/walled-plan.json` (#64 criterion 12).
 *
 * The screenshot baseline of a walled plan needs a Project whose Walls were written the way the
 * app writes them, so this starts from the seed the other Plan View baselines use —
 * `legacy-v3.json`, whose first Project carries the converted floor-plan scan — and does three
 * things to it: recalibrates that Plan Image to 0.025 px/mm, which turns the 256 × 192 px scan
 * into a 10.24 m × 7.68 m Floor a house can sit on; renames the Project; and draws twelve Walls
 * through `wall.createChain`, the same Intent the Wall tool finishes with. Nothing here writes
 * Wall geometry into the JSON by hand, so the fixture cannot drift from what the domain accepts.
 *
 * The drawing is a two-bedroom outline: a closed outer ring of 200 mm Walls (four L junctions),
 * three 100 mm partitions and one arc Wall, each end hosted on the Wall it meets (T junctions),
 * and a four-way cross of 100 mm Walls in the right-hand room whose ends all meet at one point
 * (one X junction). Mixed thickness, every junction shape the join kernel knows, and a curve.
 *
 * The result goes back through the production persistence adapter, exactly as
 * `make-preview-seed.ts` does, so the Library rows, the record envelope and the asset hashes are
 * whatever the app itself would have written.
 *
 *   npx vite-node scripts/make-walled-plan-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, chainJunctionCount, INTENT_LABELS } from '../src/edit'
import type { Intent, WallDraft, WallEndTarget } from '../src/edit'
import { migrateProject, validateProject } from '../src/domain'
import type { Project, WallRefLine } from '../src/domain'
import { pt } from '../src/geometry'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, NewAsset, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/legacy-v3.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/walled-plan.json')

/** The scan read at one tenth of the scale `legacy-v3.json` calibrates it to. */
const PIXELS_PER_MM = 0.025
const PROJECT_NAME = 'Two-bedroom plan with Walls'
const NOW = '2026-01-01T09:00:00+08:00'

function fail(message: string): never {
  console.error(`make-walled-plan-seed: ${message}`)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] => Array.from({ length: count }, () => `seed-wall-${String(++nextId).padStart(3, '0')}`)

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

// Recalibrate the scan, immutably: the same asset, read at a house scale.
const floor = migrated.project.floors[0]
if (floor === undefined || floor.planImage === null) fail('the first Floor carries no Plan Image')
const scaled: Project = {
  ...migrated.project,
  floors: migrated.project.floors.map((each) =>
    each.id === floor.id && each.planImage !== null ? { ...each, planImage: { ...each.planImage, pixelsPerMm: PIXELS_PER_MM } } : each,
  ),
}
const floorId = floor.id
const widthMm = floor.planImage.widthPx / PIXELS_PER_MM
const heightMm = floor.planImage.heightPx / PIXELS_PER_MM

const free: WallEndTarget = { kind: 'free' }
const link = (index: number, end: 'start' | 'end'): WallEndTarget => ({ kind: 'segment', index, end })
const attach = (wallId: string): WallEndTarget => ({ kind: 'host', wallId })
const join = (wallId: string, end: 'start' | 'end'): WallEndTarget => ({ kind: 'wall', wallId, end })

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

/** The outer ring, drawn as one closed chain: four Walls, four L junctions. */
const RING: readonly WallDraft[] = [
  wall(straight(600, 600, 9600, 600), 200),
  wall(straight(9600, 600, 9600, 7000), 200),
  wall(straight(9600, 7000, 600, 7000), 200),
  wall(straight(600, 7000, 600, 600), 200),
]

/** One 100 mm partition; its ends are hosted by whichever Walls the caller names. */
const partition = (x1: number, y1: number, x2: number, y2: number): readonly WallDraft[] => [
  wall(straight(x1, y1, x2, y2), 100),
]

/** The arc: a curved closet wall from the first partition to the top of the ring. */
const ARC: readonly WallDraft[] = [
  wall({ kind: 'arc', start: pt(4000, 2200), end: pt(7000, 600), through: pt(5900, 1200) }, 100),
]

/** One arm of the cross, drawn from its outer corner to the centre the others meet at. */
const arm = (x: number, y: number): readonly WallDraft[] => [wall(straight(x, y, 8200, 5400), 100)]

/** Draw one chain and return the IDs of the Walls it created. */
function draw(
  project: Project,
  walls: readonly WallDraft[],
  starts: readonly WallEndTarget[],
  ends: readonly WallEndTarget[],
): { project: Project; ids: string[] } {
  const payload = { floorId, walls, starts, ends }
  const ids = newIds(walls.length + chainJunctionCount(payload))
  const intent: Intent = { type: 'wall.createChain', payload, label: INTENT_LABELS['wall.createChain'], ids, now: NOW }
  const applied = applyIntent(project, intent)
  if (!applied.ok) fail(`a chain was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  return { project: applied.project, ids: ids.slice(0, walls.length) }
}

let current = scaled
const renamed = applyIntent(current, {
  type: 'project.rename',
  payload: { name: PROJECT_NAME },
  label: INTENT_LABELS['project.rename'],
  ids: [],
  now: NOW,
})
if (!renamed.ok) fail(`the Project could not be renamed: ${renamed.code}`)
current = renamed.project

const ring = draw(
  current,
  RING,
  [link(3, 'end'), link(0, 'end'), link(1, 'end'), link(2, 'end')],
  [link(1, 'start'), link(2, 'start'), link(3, 'start'), link(0, 'start')],
)
current = ring.project
const [top, right, bottom] = ring.ids
const partition1 = draw(current, partition(4000, 600, 4000, 7000), [attach(top!)], [attach(bottom!)])
current = partition1.project
const partition2 = draw(current, partition(4000, 3800, 9600, 3800), [attach(partition1.ids[0]!)], [attach(right!)])
current = partition2.project
const partition3 = draw(current, partition(6800, 3800, 6800, 7000), [attach(partition2.ids[0]!)], [attach(bottom!)])
current = partition3.project
const arc = draw(current, ARC, [attach(partition1.ids[0]!)], [attach(top!)])
current = arc.project

let cross: string | null = null
for (const [x, y] of [
  [7600, 4800],
  [8800, 4800],
  [8800, 6000],
  [7600, 6000],
] as const) {
  const drawn = draw(current, arm(x, y), [free], [cross === null ? free : join(cross, 'end')])
  current = drawn.project
  cross = drawn.ids[0]!
}

const validated = validateProject(current)
if (!validated.ok) fail(`the walled Project does not validate: ${JSON.stringify(validated.problems.slice(0, 3))}`)

const walls = current.existingModel.walls
const junctions = current.existingModel.wallJunctions
const fourWay = junctions.filter((junction) => junction.ends.length === 4)
const hosted = junctions.filter((junction) => junction.host !== undefined)
const arcs = walls.filter((each) => each.line.kind === 'arc')
if (walls.length !== 12) fail(`${String(walls.length)} Walls drawn, expected 12`)
if (junctions.length !== 13) fail(`${String(junctions.length)} Junctions drawn, expected 13`)
if (fourWay.length !== 1) fail(`${String(fourWay.length)} four-way Junctions, expected the one cross`)
if (hosted.length !== 8) fail(`${String(hosted.length)} hosted Junctions, expected the 8 partition and arc ends`)
if (arcs.length !== 1) fail(`${String(arcs.length)} arc Walls, expected 1`)

// --- commit through the production adapter, as `make-preview-seed.ts` does -----------------

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
  source: `${relative(repoRoot, SOURCE)} + wall Intents (scripts/make-walled-plan-seed.ts)`,
  projects: records,
  library: listed.value,
  assets: storedAssets,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `make-walled-plan-seed: ${OUT}\n` +
    `  Floor ${floorId}: ${String(Math.round(widthMm))} × ${String(Math.round(heightMm))} mm at ${String(PIXELS_PER_MM)} px/mm\n` +
    `  ${String(walls.length)} Walls, ${String(junctions.length)} Junctions (${String(fourWay.length)} four-way, ${String(hosted.length)} hosted, ${String(arcs.length)} arc)\n` +
    `  projects: ${records.map((r) => `${r.data.meta.name}@r${r.revision}`).join(', ')}\n` +
    `  ids minted: ${nextId}`,
)
