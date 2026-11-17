/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../lib'
import { DOMAIN_SCHEMA_VERSION, migrateProject } from './index'
import readmeText from '../../fixtures/domain/README.md?raw'

// Every domain fixture on disk, migrated and validated on every run (#42 §6). A fixture
// is permanent compatibility evidence: the day `DOMAIN_SCHEMA_VERSION` moves, this test
// is what proves the new chain still reads the old data.
const fixtures = Object.entries(
  import.meta.glob<string>('/fixtures/domain/**/*.json', { eager: true, query: '?raw', import: 'default' }),
).map(([path, text]) => ({ path, text }))

describe('domain fixtures (#42 §6)', () => {
  it('has the golden v1 Project and its README', () => {
    expect(fixtures.map(({ path }) => path)).toContain('/fixtures/domain/v1/project-basic.json')
    expect(readmeText).toContain('Never deleted, never edited')
  })

  it.each(fixtures)('$path is canonical JSON with one trailing newline', ({ text }) => {
    const parsed: unknown = JSON.parse(text)
    expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true)
    expect(canonicalJson(parsed)).toBe(text.slice(0, -1))
  })

  it.each(fixtures)('$path migrates to schema v1 and back unchanged', ({ path, text }) => {
    const envelope: Record<string, unknown> = JSON.parse(text)
    expect(envelope.domainSchemaVersion).toBe(DOMAIN_SCHEMA_VERSION)

    const result = migrateProject(envelope.project, envelope.domainSchemaVersion)
    if (!result.ok) throw new Error(`${path}: ${result.error.message}`)
    // Criterion 10: the Project that comes back has the fixture's own canonical bytes.
    expect(canonicalJson(result.project)).toBe(canonicalJson(envelope.project))
  })
})
