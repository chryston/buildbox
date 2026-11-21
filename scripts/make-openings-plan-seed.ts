/**
 * Generate `fixtures/e2e/preview-seed/openings-plan.json` (#65).
 *
 * The Opening suite needs a Floor whose Walls arrived the way the app writes them, and it needs
 * them *before* the browser opens: a host drawn through the Wall tool would put the geometry
 * being tested (the tidied faces, the usable stretch) behind a gesture that is itself under test.
 * So this starts from the seed the other Plan View baselines use — `legacy-v3.json`, whose first
 * Project carries the converted floor-plan scan — recalibrates that scan to 0.025 px/mm (the
 * 256 × 192 px scan becomes a 10.24 m × 7.68 m Floor) and draws exactly one Wall through
 * `wall.createChain`: a 2 500 mm, 100 mm-thick partition with two free ends.
 *
 * One Wall, on purpose. It is `W-1`, so the sentences the suite asserts name a host the reader
 * can find; both ends are free, so its usable stretch is exactly 50 … 2 450 — half a thickness
 * trimmed at each end, with no junction to reason about; and a delete of it is the smallest
 * review worth photographing: one Wall, the Openings the suite placed on it, nothing else.
 *
 * The fixture goes back through the production persistence adapter, exactly as
 * `make-walled-plan-seed.ts` does, so the Library rows, the record envelope and the asset hashes
 * are whatever the app itself would have written.
 *
 *   npx vite-node scripts/make-openings-plan-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, chainJunctionCount, INTENT_LABELS } from '../src/edit'
import type { Intent, WallDraft } from '../src/edit'
import { migrateProject, validateProject } from '../src/domain'
import type { Project } from '../src/domain'
import { pt } from '../src/geometry'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, NewAsset, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/legacy-v3.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/openings-plan.json')

const PIXELS_PER_MM = 0.025
const PROJECT_NAME = 'Plan with one Wall to open'
const NOW = '2026-01-01T09:00:00+08:00'

/** The host: 2 500 mm of 100 mm Wall, running east from (600, 3 000), both ends free. */
const HOST: WallDraft = {
  line: { kind: 'line', start: pt(600, 3000), end: pt(3100, 3000) },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
}

function fail(message: string): never {
  console.error(`make-openings-plan-seed: ${message}`)
  process.exit(1)
}

let nextId = 0
const newIds = (count: number): string[] => Array.from({ length: count }, () => `seed-open-${String(++nextId).padStart(3, '0')}`)

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
let current: Project = {
  ...migrated.project,
  floors: migrated.project.floors.map((each) =>
    each.id === floor.id && each.planImage !== null ? { ...each, planImage: { ...each.planImage, pixelsPerMm: PIXELS_PER_MM } } : each,
  ),
}
const floorId = floor.id
const widthMm = floor.planImage.widthPx / PIXELS_PER_MM
const heightMm = floor.planImage.heightPx / PIXELS_PER_MM

const commit = (intent: Intent): void => {
  const applied = applyIntent(current, intent)
  if (!applied.ok) fail(`${intent.label} was refused: ${applied.code} ${JSON.stringify(applied.problems ?? null)}`)
  current = applied.project
}

commit({ type: 'project.rename', payload: { name: PROJECT_NAME }, label: INTENT_LABELS['project.rename'], ids: [], now: NOW })

const payload = { floorId, walls: [HOST], starts: [{ kind: 'free' } as const], ends: [{ kind: 'free' } as const] }
commit({
  type: 'wall.createChain',
  payload,
  label: INTENT_LABELS['wall.createChain'],
  ids: newIds(1 + chainJunctionCount(payload)),
  now: NOW,
})

const validated = validateProject(current)
if (!validated.ok) fail(`the Project does not validate: ${JSON.stringify(validated.problems.slice(0, 3))}`)

const walls = current.existingModel.walls
if (walls.length !== 1) fail(`${String(walls.length)} Walls drawn, expected 1`)
const [host] = walls
if (host === undefined || host.ref !== 'W-1') fail(`the host is not W-1 (${String(host?.ref)})`)
if (host.line.kind !== 'line') fail('the host should be straight')
const hostLength = Math.hypot(
  host.line.end.x - host.line.start.x,
  host.line.end.y - host.line.start.y,
)
if (Math.abs(hostLength - 2500) > 0.001) fail(`the host is ${String(hostLength)} mm, expected 2 500`)
if (current.existingModel.wallJunctions.length !== 0) fail('a lone Wall should hold no junction')

// --- commit through the production adapter, as `make-walled-plan-seed.ts` does ---------------

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
  source: `${relative(repoRoot, SOURCE)} + one wall.createChain (scripts/make-openings-plan-seed.ts)`,
  projects: records,
  library: listed.value,
  assets: storedAssets,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `make-openings-plan-seed: ${OUT}\n` +
    `  Floor ${floorId}: ${String(Math.round(widthMm))} × ${String(Math.round(heightMm))} mm at ${String(PIXELS_PER_MM)} px/mm\n` +
    `  ${host.ref}: ${String(Math.round(hostLength))} mm of ${String(host.thickness)} mm Wall, both ends free\n` +
    `  projects: ${records.map((r) => `${r.data.meta.name}@r${r.revision}`).join(', ')}\n` +
    `  ids minted: ${nextId}`,
)
