/**
 * Generate `fixtures/e2e/preview-seed/clearance-envelope.json` (#76).
 *
 * The #76 clearance domain fixture as a browser seed: committed through the production adapter
 * and read back, so every record is one the app itself wrote — revision, summary and all. The
 * scene: a `Base cabinet` Item Design shared by two Placed Items and owning a Clearance
 * Envelope, a `Wall cabinet` with none, a `Sump box` below the Floor Datum and a `Tall cupboard`
 * beside them, on the one Floor whose upper limit is 2 600 mm.
 *
 *   npx vite-node scripts/make-clearance-envelope-seed.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateProject } from '../src/domain'
import type { Project } from '../src/domain'
import { createMemoryAdapter } from '../src/persistence'
import type { ProjectRecord } from '../src/persistence'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/domain/v11/clearance.json')
const OUT = resolve(repoRoot, 'fixtures/e2e/preview-seed/clearance-envelope.json')
const DB_NAME = 'buildbox'
const NOW = '2026-01-01T10:15:00+08:00'

const project = (JSON.parse(readFileSync(SOURCE, 'utf8')) as { project: Project }).project
const checked = validateProject(project)
if (!checked.ok) throw new Error(`the scene does not validate: ${JSON.stringify(checked.problems, null, 2)}`)

const ports = createMemoryAdapter()
const committed = await ports.projects.commit({ project, revision: 1, savedAt: NOW, newAssets: [] }, null)
if (!committed.ok) throw new Error(`committing the scene failed: ${committed.error.kind}`)
const listed = await ports.projects.list({ includeTrashed: false })
if (!listed.ok) throw new Error(`reading the library back failed: ${listed.error.kind}`)
const records: ProjectRecord[] = []
for (const row of listed.value) {
  const loaded = await ports.projects.load(row.id)
  if (!loaded.ok) throw new Error(`reading "${row.id}" back failed: ${loaded.error.kind}`)
  records.push(loaded.value)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      dbName: DB_NAME,
      source: 'the #76 clearance scene (fixtures/domain/v11/clearance.json)',
      projects: records,
      library: listed.value,
      assets: [],
    },
    null,
    2,
  )}\n`,
)
console.log(`make-clearance-envelope-seed: ${OUT}\n  ${records.length} project record(s)`)
