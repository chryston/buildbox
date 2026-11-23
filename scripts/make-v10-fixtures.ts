/**
 * Carry the committed domain goldens forward to schema v10 (#75).
 *
 * A domain golden is regenerated when its *scene* changes; a schema bump is not a scene change. So
 * each `fixtures/domain/v10/<name>.json` here is the v9 file beside it read exactly the way the app
 * reads an older Project — through `migrateProject` — and written in the canonical form every file in
 * that folder uses (keys sorted, no whitespace, one trailing newline). The only thing a v10 Project
 * has that its v9 one lacks is the `elevationViews` list, and the tenth step writes the empty one:
 * an Elevation View is always a view a person made, so the carry-forward invents none, and the scene,
 * every ID and every coordinate come through untouched.
 *
 * The v9 files stay committed and are never rewritten: they are the evidence that a Project saved
 * before this build existed still opens. The e2e preview seeds are deliberately left alone too — each
 * one declares the schema it was written at and the persistence layer migrates it on load, which is
 * the compatibility path the issue's tests are there to exercise.
 *
 * Run: `npx vite-node scripts/make-v10-fixtures.ts`
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMAIN_SCHEMA_VERSION, MIGRATORS, migrateProject } from '../src/domain'
import { canonicalJson } from '../src/lib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = resolve(repoRoot, 'fixtures/domain/v9')
const OUT_DIR = resolve(repoRoot, 'fixtures/domain/v10')

const fail = (message: string): never => {
  console.error(`make-v10-fixtures: ${message}`)
  process.exit(1)
}

if (MIGRATORS.length !== 9 || DOMAIN_SCHEMA_VERSION !== 10) {
  fail('this script is the v9 → v10 carry-forward and the chain no longer ends at v10')
}

mkdirSync(OUT_DIR, { recursive: true })

for (const name of readdirSync(SOURCE_DIR).sort()) {
  const envelope = JSON.parse(readFileSync(resolve(SOURCE_DIR, name), 'utf8')) as {
    domainSchemaVersion: number
    project: unknown
  }
  if (envelope.domainSchemaVersion !== 9) fail(`${name} is not a v9 fixture`)

  let spent = 0
  const migrated = migrateProject(envelope.project, 9, (count) =>
    Array.from({ length: count }, () => {
      spent += 1
      return `migrated-${String(spent)}`
    }),
  )
  if (!migrated.ok) fail(`${name} did not migrate: ${migrated.error.message}`)

  const out = resolve(OUT_DIR, name)
  writeFileSync(out, `${canonicalJson({ domainSchemaVersion: DOMAIN_SCHEMA_VERSION, project: migrated.project })}\n`)
  console.log(`make-v10-fixtures: ${out}`)
}
