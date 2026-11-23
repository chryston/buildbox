/**
 * The Export scene as a preview seed (#73).
 *
 * `fixtures/domain/v8/export.json` is the scene the export tests read: the renovation-views kitchen
 * with two Design Options, three Drawing Layers, four Placed Items filed on `Furniture`, and a view
 * `Ground Floor · Plan · Demolition` that hides the `Furniture` layer. The browser tier cannot read
 * that file — a preview build opens its own database and nothing else (#53) — so the scene has to
 * arrive as a seed the test can install.
 *
 * The renovation-views seed already carries this Project (same id, same name, same assets, same
 * library row) with the export additions left out, so this script does the one honest thing
 * available: it puts the export Project into the envelope's first record and leaves the envelope —
 * revision, savedAt, library summaries, assets — exactly as the storage layer wrote it.
 *
 * Run with `npx tsx scripts/make-renovation-export-seed.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project } from '../src/domain'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCENE = resolve(repoRoot, 'fixtures', 'domain', 'v8', 'export.json')
const ENVELOPE = resolve(repoRoot, 'fixtures', 'e2e', 'preview-seed', 'renovation-views.json')
const OUT = resolve(repoRoot, 'fixtures', 'e2e', 'preview-seed', 'renovation-export.json')

function fail(message: string): never {
  console.error(`make-renovation-export-seed: ${message}`)
  process.exit(1)
}

const scene = JSON.parse(readFileSync(SCENE, 'utf8')) as { domainSchemaVersion: number; project: Project }
if (scene.domainSchemaVersion !== 8) fail('the scene fixture is not a v8 Project')
if ((scene.project.drawingLayers ?? []).length === 0) fail('the scene fixture carries no Drawing Layers')
const hidden = scene.project.views.find((view) =>
  Object.values(view.layerSettings ?? {}).some((setting) => setting.visible === false),
)
if (hidden === undefined) fail('no view of the scene hides a Drawing Layer')

const envelope = JSON.parse(readFileSync(ENVELOPE, 'utf8')) as {
  dbName: string
  source: string
  projects: { id: string; revision: number; schemaVersion: number; savedAt: string; data: unknown }[]
  library: unknown[]
  assets: unknown[]
}

const [first, ...rest] = envelope.projects
if (first === undefined) fail('the envelope seed holds no Project')
if (first.id !== scene.project.id) {
  fail(`the envelope's first record is "${first.id}", the scene is "${scene.project.id}"`)
}
if (first.schemaVersion !== 8) fail(`the envelope's first record is schema v${first.schemaVersion}`)

const fixture = {
  dbName: envelope.dbName,
  source: `${scene.project.name} for export (${envelope.source}; scripts/make-renovation-export-seed.ts)`,
  projects: [{ ...first, data: scene.project }, ...rest],
  library: envelope.library,
  assets: envelope.assets,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`make-renovation-export-seed: ${OUT}`)
