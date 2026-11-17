// @vitest-environment node
// Filesystem only, and the node environment keeps import.meta.url a file URL.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importWorkspace } from '../utils/workspaceIO'

// Golden legacy fixtures (#38 §4) are never deleted or regenerated, so an accidental
// edit has to fail loudly here rather than quietly change what S1, S2 and S4 compare
// against. The README carries one SHA-256 per file; this test is what makes that
// table true.
const fixturesRoot = fileURLToPath(new URL('../../fixtures/legacy', import.meta.url))

const storeFixtures: Array<{ path: string; version: number }> = [
  { path: 'v0/buildbox-store.json', version: 0 },
  { path: 'v1/buildbox-store.json', version: 1 },
  { path: 'v2/buildbox-store.json', version: 2 },
  { path: 'v3/buildbox-store.json', version: 3 },
  { path: 'v3-large-image/buildbox-store.json', version: 3 },
]

const sha256 = (absPath: string) =>
  createHash('sha256').update(readFileSync(absPath)).digest('hex')

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry)
    return statSync(abs).isDirectory() ? listFiles(abs) : [relative(fixturesRoot, abs).split(sep).join('/')]
  })
}

describe('legacy store fixtures', () => {
  it.each(storeFixtures)('$path is a persist envelope at version $version', ({ path, version }) => {
    const raw = readFileSync(join(fixturesRoot, path), 'utf8')
    const envelope = JSON.parse(raw) as { state?: { projects?: unknown }; version?: unknown }

    expect(envelope.version).toBe(version)
    expect(Array.isArray(envelope.state?.projects)).toBe(true)
    // Byte-for-byte capture: the file is the raw localStorage string, not reformatted JSON.
    expect(raw).toBe(JSON.stringify(JSON.parse(raw)))
  })
})

describe('fixture integrity', () => {
  const readme = readFileSync(join(fixturesRoot, 'README.md'), 'utf8')
  const documented = new Map<string, string>()
  for (const line of readme.split('\n')) {
    const row = line.match(/^\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$/)
    if (row) documented.set(row[1], row[2])
  }

  it('documents a hash for every fixture file', () => {
    const onDisk = listFiles(fixturesRoot).filter((file) => file !== 'README.md')
    expect([...onDisk].sort()).toEqual([...documented.keys()].sort())
  })

  it.each([...documented.entries()])('$file matches its recorded SHA-256', (file, hash) => {
    expect(sha256(join(fixturesRoot, file))).toBe(hash)
  })
})

// The one hand-authored fixture exists to pin the other half of the import path: the
// store migration covers localStorage envelopes, this covers a downloaded file whose
// project is still in the pre-units Design shape.
describe('hand-authored v0 workspace fixture', () => {
  const json = readFileSync(join(fixturesRoot, 'workspace/v0-design-shape.buildbox.json'), 'utf8')
  const file = importWorkspace(json)

  it('is a bare Design before import', () => {
    const raw = JSON.parse(json) as Record<string, unknown>
    const [project] = raw.projects as Array<Record<string, unknown>>
    expect(project.units).toBeUndefined()
    expect(project.root).toBeDefined()
    // The pre-rename settings key, which is the point of this fixture.
    expect((project.globalSettings as Record<string, unknown>).defaultMaterial).toBe('oak')
  })

  it('wraps the bare Design into one unit', () => {
    expect(file.version).toBe(1)
    expect(file.activeProjectId).toBe('proj-legacy-closet')
    expect(file.projects).toHaveLength(1)

    const [project] = file.projects
    expect(project.units).toHaveLength(1)
    const [unit] = project.units
    expect(unit.label).toBe('Unit 1')
    expect(unit.settings.unit).toBe('mm')
    expect(unit.root.id).toBe('n0')
    expect(unit.root.children).toHaveLength(2)
  })
})
