/**
 * Generate `fixtures/e2e/preview-seed/legacy-v3.json` (#49 criterion 1).
 *
 * The `projects-v2` Playwright projects need a `buildbox-preview` database that holds the
 * same saved work the S0 screenshot baselines were taken from. Rather than hand-write
 * domain-v1 records, this runs the real #43 conversion over the untouched legacy fixture —
 * the same code path the app's importer uses — attaches the legacy floor plan to the first
 * Project, and commits the result through the in-memory adapter so the records, the derived
 * Library rows and the asset hashes are all whatever the production code actually writes.
 *
 *   npx vite-node scripts/make-preview-seed.ts
 *
 * Assets are base64-encoded *only* inside this fixture: IndexedDB holds Blobs, JSON does not,
 * and `e2e/support/seedPreviewDb.ts` turns them back before writing. Nothing at runtime reads
 * this file but the tests.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachFloorPlan, convertLegacy } from '../src/package'
import { createMemoryAdapter } from '../src/persistence'
import type { AssetRecord, LibraryRecord, NewAsset, ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/legacy/v3/buildbox-store.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/legacy-v3.json')

/** The database the flagged build opens, repeated here so a rename cannot pass silently. */
const DB_NAME = 'buildbox-preview'

/**
 * The clock the baselines freeze (#39). The first Project is the newest because
 * `projects.list` sorts by `savedAt` descending and the app opens the first row it is given —
 * the Project with the floor plan has to be the one that opens.
 */
const SAVED_AT = ['2026-01-01T09:00:00+08:00', '2026-01-01T08:00:00+08:00']

function fail(message: string): never {
  console.error(`make-preview-seed: ${message}`)
  process.exit(1)
}

/** Deterministic, unique, and obviously synthetic: a seed must not look like user data. */
let nextId = 0
const newId = () => `seed-${String(++nextId).padStart(3, '0')}`

const raw = readFileSync(SOURCE, 'utf8')
const converted = await convertLegacy(raw, { newId })
if (!converted.ok) fail(`the legacy fixture no longer converts: ${JSON.stringify(converted.problems)}`)

const { conversion } = converted
// `flatMap` rather than `filter`: it narrows to the variant each branch names, so the
// `project` and `problems` fields below are the ones that exist for that status.
const proposals = conversion.projects.flatMap((proposal) => (proposal.status === 'ok' ? [proposal] : []))
if (proposals.length === 0) fail('no Project in the fixture converted')
for (const rejected of conversion.projects.flatMap((p) => (p.status === 'rejected' ? [p] : []))) {
  console.warn(`make-preview-seed: skipped "${rejected.name}": ${JSON.stringify(rejected.problems)}`)
}
if (conversion.floorPlan === null) fail('the legacy fixture carries no floor plan')
if (conversion.floorPlan.status !== 'ok') fail(`the floor plan did not convert: ${JSON.stringify(conversion.floorPlan.problems)}`)

// The floor plan goes on the first Project's first Floor, which is the pairing the
// floor-plan baseline depends on (#49: "the legacy floor plan attached to the first Project").
const [first, ...rest] = proposals
const floorId = first.project.floors[0]?.id ?? fail('the first Project has no Floor')
const attached = attachFloorPlan(first.project, conversion.floorPlan.content, { floorId, newId })
if (!attached.ok) fail(`the floor plan would not attach: ${JSON.stringify(attached.problems)}`)

const projects = [attached.project, ...rest.map((proposal) => proposal.project)]

// The Plan Image's dimensions travel with the asset, so read them off the Floor that now
// carries it; any other image in the source is stored uncalibrated.
const planImage = attached.project.floors.find((floor) => floor.planImage !== null)?.planImage ?? null
const newAssets: NewAsset[] = conversion.assets.map((asset) => ({
  bytes: new Blob([asset.bytes]),
  mediaType: asset.mediaType,
  widthPx: planImage?.assetHash === asset.sha256 ? planImage.widthPx : null,
  heightPx: planImage?.assetHash === asset.sha256 ? planImage.heightPx : null,
}))

const ports = createMemoryAdapter()
for (const [index, project] of projects.entries()) {
  const committed = await ports.projects.commit(
    { project, revision: 1, savedAt: SAVED_AT[index] ?? SAVED_AT[SAVED_AT.length - 1], newAssets: index === 0 ? newAssets : [] },
    null,
  )
  if (!committed.ok) fail(`committing "${project.name}" failed: ${committed.error.kind}`)
}

const listed = await ports.projects.list({ includeTrashed: false })
if (!listed.ok) fail(`reading the library back failed: ${listed.error.kind}`)
const library = listed.value
const records: ProjectRecord[] = []
for (const record of library) {
  const loaded = await ports.projects.load(record.id)
  if (!loaded.ok) fail(`reading "${record.id}" back failed: ${loaded.error.kind}`)
  records.push(loaded.value)
}

const assets: (AssetRecord & { base64: string })[] = []
for (const asset of conversion.assets) {
  const stored = await ports.assets.get(asset.sha256)
  if (!stored.ok) fail(`the asset ${asset.sha256} was not stored: ${stored.error.kind}`)
  const bytes = new Uint8Array(await stored.value.blob.arrayBuffer())
  assets.push({ ...stored.value, base64: Buffer.from(bytes).toString('base64') })
}

const fixture = { dbName: DB_NAME, source: 'fixtures/legacy/v3/buildbox-store.json', projects: records, library, assets }
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)

console.log(
  `make-preview-seed: ${OUT}\n` +
    `  projects: ${records.map((r) => `${r.data.name}@r${r.revision}`).join(', ')}\n` +
    `  assets: ${assets.map((a) => `${a.sha256.slice(0, 12)}(${a.byteLength}B)`).join(', ')}\n` +
    `  ids minted: ${nextId}`,
)
