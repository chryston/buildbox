/**
 * Generate `fixtures/e2e/preview-seed/openings-scene.json` (#65 criterion 10).
 *
 * The Plan View screenshot needs a Floor on which every shape an Opening can take is visible at
 * once: each door the tool offers, the three windows, one removed section, and a door in a curved
 * Wall. Like `make-openings-plan-seed.ts` it draws the Walls through `wall.createChain` and the
 * Openings through `opening.create`, so the geometry in the picture is what the app itself would
 * have derived — tidied faces, free ends, an arc measured along its curve — and nothing about the
 * scene depends on a gesture working.
 *
 * Every row comes from `OPENING_PRESET_GROUPS`, the same table the tool's picker lists: a preset
 * added to the pack appears in the photograph without this file being touched, and a preset that
 * quietly disappeared shows up as the count this script refuses to commit on.
 *
 * The fixture goes back through the production persistence adapter, exactly as
 * `make-walled-plan-seed.ts` does, so the Library rows, the record envelope and the asset hashes
 * are whatever the app itself would have written.
 *
 *   npx vite-node scripts/make-openings-scene-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, chainJunctionCount, INTENT_LABELS } from '../src/edit'
import type { Intent, WallDraft } from '../src/edit'
import { migrateProject, validateProject } from '../src/domain'
import type { Project } from '../src/domain'
import { pt, refLength } from '../src/geometry'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, NewAsset, ProjectRecord } from '../src/persistence'
import { OPENING_PRESET_GROUPS, resolveOpeningPreset } from '../src/ui/workspace/opening/openingPresets'
import type { OpeningPresetRow } from '../src/ui/workspace/opening/openingPresets'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/e2e/preview-seed/legacy-v3.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/openings-scene.json')

const PIXELS_PER_MM = 0.025
const PROJECT_NAME = 'Plan with every opening'
const NOW = '2026-01-01T09:00:00+08:00'

/**
 * The three hosts, far enough apart that no two sets of marks touch in the photograph.
 *
 * `W-1` is 8 m of 200 mm Wall — the doors are a row a person can read one at a time. `W-2` is a
 * lighter 6 m partition for the three windows. `W-3` is an arc, because an Opening on a curve is
 * measured along the curve and drawn square to the chord, and that is the one thing a straight
 * Wall cannot show. All three have free ends, so every Opening here sits in a stretch trimmed
 * only by half a thickness at each end.
 */
const HOSTS: readonly WallDraft[] = [
  {
    line: { kind: 'line', start: pt(600, 1200), end: pt(8600, 1200) },
    thickness: 200,
    justification: 'centre',
    baseElevation: 0,
    height: 2600,
  },
  {
    line: { kind: 'line', start: pt(600, 3600), end: pt(6600, 3600) },
    thickness: 100,
    justification: 'centre',
    baseElevation: 0,
    height: 2600,
  },
  {
    // R = 2 000 mm through the middle of a 3 000 mm chord: 3 392 mm of arc.
    line: { kind: 'arc', start: pt(7000, 5000), end: pt(10000, 5000), through: pt(8500, 5677.124) },
    thickness: 150,
    justification: 'centre',
    baseElevation: 0,
    height: 2600,
  },
]

/** The gap left between two Openings on the same Wall, so their marks never touch. */
const GAP_MM = 400

function fail(message: string): never {
  console.error(`make-openings-scene-seed: ${message}`)
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

for (const host of HOSTS) {
  const payload = { floorId, walls: [host], starts: [{ kind: 'free' } as const], ends: [{ kind: 'free' } as const] }
  commit({
    type: 'wall.createChain',
    payload,
    label: INTENT_LABELS['wall.createChain'],
    ids: newIds(1 + chainJunctionCount(payload)),
    now: NOW,
  })
}

const [doorRows, windowRows, otherRows] = OPENING_PRESET_GROUPS.map((section) => section.rows)
if (doorRows === undefined || windowRows === undefined || otherRows === undefined) fail('the picker lost a group')
const LABEL_WORDS: Record<string, string> = { door: 'Door', window: 'Window', removed_section: 'Removed section' }

/**
 * Lay a row of presets along one Wall, left to right, `GAP_MM` apart.
 *
 * The hinge alternates so both readings of "which way it opens" appear in the photograph, and a
 * sliding door is given none — it has no hinge to have a side of.
 */
const place = (hostWallId: string, hostHeight: number, from: number, rows: readonly OpeningPresetRow[]): number => {
  const seen: Record<string, number> = {}
  let at = from
  for (const row of rows) {
    const shape = resolveOpeningPreset(row, hostHeight)
    const count = (seen[shape.kind] ??= 0) + 1
    seen[shape.kind] = count
    commit({
      type: 'opening.create',
      payload: {
        floorId,
        hostWallId,
        kind: shape.kind,
        label: `${LABEL_WORDS[shape.kind] ?? shape.kind} ${String(count)}`,
        start: at,
        width: shape.width,
        sill: shape.sill,
        head: shape.head,
        ...(shape.swing === undefined
          ? {}
          : { swing: shape.swing, ...(shape.swing === 'sliding' ? {} : { hingeSide: rows.indexOf(row) % 2 === 0 ? 'start' as const : 'end' as const }) }),
      },
      label: INTENT_LABELS['opening.create'],
      ids: newIds(1),
      now: NOW,
    })
    at += shape.width + GAP_MM
  }
  return at
}

const [wallOne, wallTwo, wallThree] = current.existingModel.walls
if (wallOne === undefined || wallTwo === undefined || wallThree === undefined) fail('three Walls were not drawn')
// The doors and the knocked-through section take the long Wall, the windows the light one, and
// the arc gets one bedroom door — the shape a curve has to carry.
const doorsEnd = place(wallOne.id, wallOne.height, 300, [...doorRows, ...otherRows])
place(wallTwo.id, wallTwo.height, 400, windowRows)
place(wallThree.id, wallThree.height, 1000, [doorRows[0]!])

const validated = validateProject(current)
if (!validated.ok) fail(`the Project does not validate: ${JSON.stringify(validated.problems.slice(0, 3))}`)

const walls = current.existingModel.walls
if (walls.length !== 3) fail(`${String(walls.length)} Walls drawn, expected 3`)
if (walls.map((wall) => wall.ref).join(' ') !== 'W-1 W-2 W-3') fail(`unexpected refs: ${walls.map((wall) => wall.ref).join(', ')}`)
if (wallThree.line.kind !== 'arc') fail('the third Wall should be the arc')
const openings = current.existingModel.openings
const expected = doorRows.length + otherRows.length + windowRows.length + 1
if (openings.length !== expected) fail(`${String(openings.length)} Openings placed, expected ${String(expected)}`)
if (doorsEnd - GAP_MM > 8000 - 100) fail(`the doors run off W-1 (${String(doorsEnd - GAP_MM)} mm)`)
if (openings.some((opening) => opening.hostWallId === '')) fail('an Opening was placed without a host')

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
  source: `${relative(repoRoot, SOURCE)} + three wall.createChain and ${String(expected)} opening.create (scripts/make-openings-scene-seed.ts)`,
  projects: records,
  library: listed.value,
  assets: storedAssets,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `make-openings-scene-seed: ${OUT}\n` +
    `  Floor ${floorId}: ${String(Math.round(widthMm))} × ${String(Math.round(heightMm))} mm at ${String(PIXELS_PER_MM)} px/mm\n` +
    `  ${walls.map((wall) => `${wall.ref}: ${String(Math.round(refLength(wall.line)))} mm of ${String(wall.thickness)} mm, ${wall.line.kind}`).join('\n  ')}\n` +
    `  ${openings.map((opening) => `${opening.label} on ${opening.hostWallId} at ${String(Math.round(opening.start))}`).join('\n  ')}\n` +
    `  projects: ${records.map((r) => `${r.data.meta.name}@r${r.revision}`).join(', ')}\n` +
    `  ids minted: ${nextId}`,
)
