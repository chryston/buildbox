/**
 * Generate `fixtures/e2e/preview-seed/warnings-scene.json` (#66 criterion 11).
 *
 * The walled Plan View — the same ring, partitions, arc and four-way cross
 * `make-walled-plan-seed.ts` draws, from the same Intents — plus three Walls that are *not*
 * joined to anything, which is what the first producer exists to notice:
 *
 *   - one Wall crossing the right-hand side of the ring → `wall_crossing`;
 *   - one collinear overlap lying along the bottom of the ring → `wall_overlap`;
 *   - one short Wall crossing the middle partition, so a third subject pair exists.
 *
 * On top of the produced warnings the fixture stores two Acknowledgements, and between them
 * they cover the three statuses the strip renders:
 *
 *   - the first warning is left alone, so it is `open`;
 *   - the second is acknowledged with the signature the engine computes for it, so it is
 *     `acknowledged` and shows its note;
 *   - the third is acknowledged with a signature from before a change to its geometry, so the
 *     engine answers `reopened` and keeps the note visible beside `Reopened after change`.
 *
 * The signatures are read back from `deriveWarnings` rather than written by hand: a fixture that
 * guessed them would photograph a status it could not produce, and the photograph is the
 * assertion. The stale one is a real signature of a real warning — the crossing pair's — used
 * against the overlap, so it is a signature that once matched something and no longer does,
 * which is the only way a signature goes stale in the app.
 *
 *   npx vite-node scripts/make-warnings-scene-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, chainJunctionCount, INTENT_LABELS } from '../src/edit'
import type { Intent, WallDraft, WallEndTarget } from '../src/edit'
import { deriveWarnings, warningSignature } from '../src/derive'
import { migrateProject, validateProject, warningKey } from '../src/domain'
import type { Acknowledgement, Project, WallRefLine } from '../src/domain'
import { pt } from '../src/geometry'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, NewAsset, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/legacy-v3.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/warnings-scene.json')

/** The scan read at one tenth of the scale `legacy-v3.json` calibrates it to. */
const PIXELS_PER_MM = 0.025
const PROJECT_NAME = 'Two-bedroom plan with warnings'
const NOW = '2026-01-01T09:00:00+08:00'

function fail(message: string): never {
  console.error(`make-warnings-scene-seed: ${message}`)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] =>
  Array.from({ length: count }, () => `seed-wall-${String(++nextId).padStart(3, '0')}`)

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
const scaled: Project = {
  ...migrated.project,
  floors: migrated.project.floors.map((each) =>
    each.id === floor.id && each.planImage !== null
      ? { ...each, planImage: { ...each.planImage, pixelsPerMm: PIXELS_PER_MM } }
      : each,
  ),
}
const floorId = floor.id

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
const [top, right, , left] = ring.ids
const partition1 = draw(current, partition(4000, 600, 4000, 7000), [attach(top!)], [attach(ring.ids[2]!)])
current = partition1.project
const partition2 = draw(current, partition(4000, 3800, 9600, 3800), [attach(partition1.ids[0]!)], [attach(right!)])
current = partition2.project
const partition3 = draw(current, partition(6800, 3800, 6800, 7000), [attach(partition2.ids[0]!)], [attach(ring.ids[2]!)])
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

// --- the three unjoined Walls the producer exists to notice ---------------------------------
//
// Each is drawn with free ends, so nothing joins it: a crossing that is not a Junction is the
// warning, and a Junction drawn at the crossing is the thing that removes it (#66 §8). They sit
// in the left half of the plan, away from the cross, so all three `!` badges and their leaders
// are legible in the photograph.

/** Crosses the left side of the ring at about a third of its height. */
const crossing = draw(current, [wall(straight(200, 2600, 3400, 2600), 100)], [free], [free])
current = crossing.project
/** Lies along the bottom of the ring for 2,400 mm — a collinear overlap, not a crossing. */
const along = draw(current, [wall(straight(1200, 7000, 3600, 7000), 200)], [free], [free])
current = along.project
/** Crosses the middle partition twice over, at an angle, so the pair is neither parallel nor touching. */
const slant = draw(current, [wall(straight(3400, 1400, 4600, 3200), 100)], [free], [free])
current = slant.project

const validated = validateProject(current)
if (!validated.ok) fail(`the warned Project does not validate: ${JSON.stringify(validated.problems.slice(0, 3))}`)

// --- the two Acknowledgements, read back from the engine ------------------------------------

const produced = deriveWarnings(current, floorId, null).warnings
if (produced.length !== 3) {
  fail(`${String(produced.length)} warnings produced, expected the crossing, the overlap and the slant`)
}
const [open, acknowledged, reopened] = produced as [typeof produced[0], typeof produced[0], typeof produced[0]]

const ackOf = (warning: typeof open, signature: string, note: string): Acknowledgement => ({
  id: `seed-ack-${warningKey(warning.type, warning.subjects.map((s) => s.id), null).slice(0, 24)}`,
  warningType: warning.type,
  subjectIds: [...warning.subjects.map((s) => s.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  designOptionId: null,
  signature,
  note,
  acknowledgedAt: NOW,
})

// The second keeps the signature the engine computes for it, so it stays `acknowledged`. The
// third is given the *first* warning's signature: a real one, of a real warning, that no longer
// describes this pair — which is precisely what a model change does to a signature.
const acknowledgements: Acknowledgement[] = [
  ackOf(acknowledged, acknowledged.signature, 'Checked on site: the duct runs above both.'),
  ackOf(reopened, open.signature, 'Re-measure after the partition moves.'),
]
current = { ...current, warningAcknowledgements: acknowledgements }

const checked = deriveWarnings(current, floorId, null).warnings
const statuses = checked.map((warning) => warning.status).sort()
if (statuses.join(',') !== 'acknowledged,open,reopened') {
  fail(`the fixture would render ${statuses.join(', ')}, expected one of each status`)
}
if (validateProject(current).ok !== true) fail('the acknowledged Project no longer validates')

// --- commit through the production adapter, as `make-walled-plan-seed.ts` does --------------

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
  source: `${relative(repoRoot, SOURCE)} + wall Intents (scripts/make-warnings-scene-seed.ts)`,
  projects: records,
  library: listed.value,
  assets: storedAssets,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `make-warnings-scene-seed: ${OUT}\n` +
    `  Floor ${floorId} at ${String(PIXELS_PER_MM)} px/mm\n` +
    `  ${String(current.existingModel.walls.length)} Walls, ${String(checked.length)} warnings: ` +
    checked.map((w) => `${w.type}=${w.status}`).join(', ') + '\n' +
    `  projects: ${records.map((r) => `${r.data.meta.name}@r${r.revision}`).join(', ')}\n` +
    `  ids minted: ${nextId}`,
)
