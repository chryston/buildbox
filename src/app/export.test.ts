/**
 * The recipe this device remembers (#61 §17).
 *
 * The remembered recipe is device-local preference data: never in the Project, never undoable, never
 * in a Backup. All of that is a property of where it is stored, which is exactly what a dialog test
 * cannot see — the dialog only calls `remember`. So the round trip is tested here, against a
 * preference store that is a Map, and against a session that is never written to.
 */
import { describe, expect, it } from 'vitest'
import { referenceProject } from '../derive/testing'
import type { Recipe } from '../export'
import { createExportPort } from './export'
import type { ProjectSession } from '../session'
import type { PrefsRepository, Result } from '../persistence'

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value }) as Result<T, never>

/**
 * A gate on the preference store's own writes: `remember` is fire-and-forget, so a test awaits the
 * write it caused rather than a guessed duration.
 */
function writeGate(): { hit(): void; after(writes: number): Promise<void> } {
  let writes = 0
  const waiting: Array<{ need: number; done: () => void }> = []
  return {
    hit() {
      writes += 1
      for (const one of waiting.slice()) if (writes >= one.need) one.done()
    },
    after(need: number) {
      if (writes >= need) return Promise.resolve()
      return new Promise<void>((resolve) => waiting.push({ need, done: resolve }))
    },
  }
}

/** The preference store as it behaves in these tests: a Map, and nothing else. */
function memoryPrefs(
  gate: { hit(): void },
  seed: Record<string, unknown> = {},
): { prefs: PrefsRepository; rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>(Object.entries(seed))
  // One cast for the whole double: `PrefsRepository` is generic over `PrefsMap`, and a Map keyed by
  // string cannot promise what a caller asks for. Every key these tests use is `exportRecipes`.
  const prefs = {
    async get(key: string) {
      return ok(rows.get(key))
    },
    async set(key: string, value: unknown) {
      rows.set(key, value)
      gate.hit()
      return ok(undefined)
    },
  } as unknown as PrefsRepository
  return { prefs, rows }
}

function portFor(seed: Record<string, unknown> = {}) {
  const project = referenceProject()
  const before = JSON.stringify(project)
  const gate = writeGate()
  const { prefs, rows } = memoryPrefs(gate, seed)
  const session = { getSnapshot: () => ({ project, revision: 3 }) } as unknown as ProjectSession
  const port = createExportPort({
    session: () => session,
    prefs,
    readAsset: async () => null,
    clock: { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' },
    buildboxVersion: '0.0.0-test',
  })
  return {
    port,
    rows,
    project,
    /** Await this after `remember`: the write has landed once it resolves. */
    written: () => gate.after(1),
    /** The same, for the second write in one test. */
    writtenTwice: () => gate.after(2),
    unchanged: () => JSON.stringify(project) === before,
  }
}

const RECIPE: Recipe = {
  views: [{ kind: 'plan', viewId: 'v-1' }],
  format: 'pdf',
  pageSize: 'A3',
  orientation: 'landscape',
  scale: 50,
  pngLongEdge: 4096,
  titleBlock: false,
  grid: true,
  unit: 'mm',
  precision: 1,
}

describe('the remembered recipe', () => {
  it('comes back for the view it was remembered from', async () => {
    const { port, written } = portFor()
    expect(await port.recall('plan:v-1')).toBeNull()
    port.remember('plan:v-1', RECIPE)
    await written()
    expect(await port.recall('plan:v-1')).toEqual(RECIPE)
  })

  it('stays out of another view', async () => {
    const { port, written } = portFor()
    port.remember('plan:v-1', RECIPE)
    await written()
    expect(await port.recall('plan:v-2')).toBeNull()
  })

  it('replaces itself rather than piling up', async () => {
    const { port, rows, written, writtenTwice } = portFor()
    port.remember('plan:v-1', RECIPE)
    await written()
    port.remember('plan:v-1', { ...RECIPE, format: 'svg' })
    await writtenTwice()
    const stored = rows.get('exportRecipes')
    expect(Array.isArray(stored) && stored.length).toBe(1)
    expect(await port.recall('plan:v-1')).toEqual({ ...RECIPE, format: 'svg' })
  })

  it('keeps a Project measured in metres', async () => {
    // The unit is a `DisplayUnit`, and `m` is one of them: a recipe that came back as `null` here
    // would silently reset a metres Project to the dialog's defaults every time it was opened.
    const { port, written } = portFor()
    port.remember('plan:v-1', { ...RECIPE, unit: 'm' })
    await written()
    expect(await port.recall('plan:v-1')).toEqual({ ...RECIPE, unit: 'm' })
  })

  it('ignores a row that is not a recipe', async () => {
    const { port } = portFor({
      exportRecipes: [
        { key: 'plan:v-1', recipe: { ...RECIPE, format: 'eps' } },
        { key: 'plan:v-2', recipe: { ...RECIPE, precision: 'one' } },
        { key: 'plan:v-3', recipe: { ...RECIPE, views: [] } },
        'not even an object',
      ],
    })
    expect(await port.recall('plan:v-1')).toBeNull()
    expect(await port.recall('plan:v-2')).toBeNull()
    expect(await port.recall('plan:v-3')).toBeNull()
  })

  it('reads a row written before this build existed', async () => {
    const { port } = portFor({ exportRecipes: [{ key: 'plan:v-1', recipe: RECIPE }] })
    expect(await port.recall('plan:v-1')).toEqual(RECIPE)
  })

  it('writes nothing to the Project', async () => {
    const { port, written, unchanged } = portFor()
    port.remember('plan:v-1', RECIPE)
    await written()
    expect(unchanged()).toBe(true)
  })
})

describe('the view list', () => {
  it('names every Plan View by its own name and its Floor', () => {
    const { port, project } = portFor()
    const views = port.views()
    expect(views.length).toBeGreaterThanOrEqual(project.views.length)
    for (const view of views.filter((one) => one.ref.kind === 'plan')) {
      expect(view.label.length).toBeGreaterThan(0)
      expect(view.group.length, `${view.label} has no Floor to sit under`).toBeGreaterThan(0)
    }
  })

  it('says there are no unacknowledged warnings while the warnings engine is #66', () => {
    expect(portFor().port.unacknowledgedWarnings()).toBe(0)
  })
})
