import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkLegacyStore, readLegacyWorkspaceFile, type LegacyStoreCheck, type LegacyWorkspaceRead } from './read'
import { ROOT_PATH, type ValidationProblem } from './problems'

const settings = {
  unit: 'mm',
  height: 720,
  width: 600,
  depth: 560,
  thickness: 18,
  backThickness: 12,
  toeKick: null,
  material: 'oak',
}
const root = { id: 'r', fixedSize: 300 }
const unit = (id: string): unknown => ({ type: 'cabinet', id, label: 'Unit 1', x: 0, y: 0, settings, root })
const design = (id: string, over: Record<string, unknown> = {}): unknown => ({ id, name: 'Kitchen', units: [unit(`${id}-u1`)], ...over })

const file = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, exportedAt: '2026-01-01T00:00:00.000Z', projects: [design('p1')], activeProjectId: 'p1', ...over })

const ids = (): (() => string) => {
  let issued = 0
  return () => `new-${++issued}`
}

const shown = (problems: ValidationProblem[]): string[] => problems.map((p) => `${p.path} ${p.code}`)
/** The problems a workspace file was rejected for, or null when it was accepted. */
const rejected = (result: LegacyWorkspaceRead): string[] | null => (result.ok ? null : shown(result.problems))
/** The problems a stored value was rejected for, or null when it was accepted. */
const storeProblems = (raw: string): string[] | null => {
  const check: LegacyStoreCheck = checkLegacyStore(raw)
  return check.ok ? null : shown(check.problems)
}
const read = (over: Record<string, unknown> = {}): LegacyWorkspaceRead => readLegacyWorkspaceFile(file(over), ids())

describe('readLegacyWorkspaceFile', () => {
  it('reads a file the app exported', () => {
    const result = read()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file).toEqual({
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      projects: [design('p1')],
      activeProjectId: 'p1',
    })
  })

  it('defaults the fields today import left out', () => {
    const result = readLegacyWorkspaceFile(JSON.stringify({ projects: [design('p1')] }), ids())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.version).toBe(1)
    expect(result.file.exportedAt).toBe('')
    expect(result.file.activeProjectId).toBeNull()
  })

  it('reports a file that is not JSON, and one that is not an object', () => {
    expect(readLegacyWorkspaceFile('{', ids())).toEqual({
      ok: false,
      problems: [{ path: ROOT_PATH, code: 'bad-json', message: 'The file is not valid JSON.' }],
    })
    expect(readLegacyWorkspaceFile('[]', ids())).toEqual({
      ok: false,
      problems: [{ path: ROOT_PATH, code: 'wrong-type', message: 'Expected a BuildBox workspace file.' }],
    })
  })

  it('reports a file version it cannot read, and nothing else', () => {
    expect(rejected(read({ version: 2 }))).toEqual(['version newer-version'])
    expect(rejected(read({ version: 0 }))).toEqual(['version out-of-range'])
    expect(rejected(read({ version: '1' }))).toEqual(['version wrong-type'])
    expect(rejected(read({ version: 1.5 }))).toEqual(['version wrong-type'])
  })

  it('reports projects that is missing, not a list, or empty', () => {
    expect(rejected(read({ projects: undefined }))).toEqual(['projects missing-field'])
    expect(rejected(read({ projects: 'p1' }))).toEqual(['projects wrong-type'])
    expect(rejected(read({ projects: [] }))).toEqual(['projects empty-list'])
  })

  it('rejects the empty project from issue #11 and names every field it lacks', () => {
    const result = read({ projects: [{}], activeProjectId: null })
    expect(rejected(result)).toEqual([
      'projects[0].id missing-field',
      'projects[0].name missing-field',
      'projects[0].units missing-field',
    ])
  })

  it('rejects a project with no units', () => {
    expect(rejected(read({ projects: [{ id: 'p1', name: 'A' }] }))).toEqual(['projects[0].units missing-field'])
  })

  it('rejects a unit that is not a cabinet', () => {
    expect(rejected(read({ projects: [{ id: 'p1', name: 'A', units: [{ type: 'countertop', id: 'u', label: 'l', x: 0, y: 0, settings, root }] }] })))
      .toEqual(['projects[0].units[0].type not-one-of'])
  })

  it('reports every problem in a file with three of them', () => {
    const result = read({
      projects: [
        design('p1', { units: [{ type: 'cabinet', id: 'u', label: 'l', x: 0, y: 0, settings, root: { id: 'r', fixedSize: 0 } }] }),
        design('p2', { units: [] }),
        design('p1', { units: [unit('p3-u1')] }),
      ],
      activeProjectId: null,
    })
    expect(rejected(result)).toEqual([
      'projects[0].units[0].root.fixedSize out-of-range',
      'projects[1].units empty-list',
      'projects[2].id duplicate-id',
    ])
  })

  it('keeps an open project the file does not contain, which import ignores anyway', () => {
    // The rule that the open project names a saved project is about stored state, where
    // `App` reads it; `importWorkspace` selects `incoming[0]` and never looks at this.
    const result = read({ activeProjectId: 'nope' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.activeProjectId).toBe('nope')
  })

  it('upgrades a design written before units existed', () => {
    const result = readLegacyWorkspaceFile(JSON.stringify({
      version: 1,
      projects: [{ id: 'p1', name: 'Old', root, globalSettings: { ...settings, defaultMaterial: 'oak' } }],
    }), ids())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.projects).toEqual([{
      id: 'p1',
      name: 'Old',
      root,
      globalSettings: { ...settings, defaultMaterial: 'oak' },
      units: [{
        type: 'cabinet',
        id: 'new-1',
        label: 'Unit 1',
        x: 0,
        y: 0,
        settings: { ...settings, material: 'oak' },
        root,
      }],
    }])
  })

  it('gives each upgraded unit the id its caller asked for', () => {
    let counter = 0
    const result = readLegacyWorkspaceFile(JSON.stringify({
      projects: [
        { id: 'p1', name: 'A', root, globalSettings: settings },
        { id: 'p2', name: 'B', root, globalSettings: settings },
      ],
    }), () => `id-${++counter}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const projects = result.file.projects as Array<{ units: Array<{ id: string }> }>
    expect(projects.map((project) => project.units[0].id)).toEqual(['id-1', 'id-2'])
  })
})

describe('checkLegacyStore', () => {
  const envelope = (version: number): string => readFileSync(`fixtures/legacy/v${version}/buildbox-store.json`, 'utf8')
  const stateOf = (version: number): Record<string, unknown> => JSON.parse(envelope(version)).state as Record<string, unknown>
  const stored = (state: unknown, version: unknown = 3): string => JSON.stringify({ state, version })

  it('accepts every stored version the app has written', () => {
    for (const version of [0, 1, 2, 3]) {
      expect(checkLegacyStore(envelope(version))).toEqual({ ok: true })
    }
  })

  it('accepts a state the app writes today', () => {
    expect(checkLegacyStore(stored({
      projects: [design('p1')],
      activeProjectId: 'p1',
      floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
    }))).toEqual({ ok: true })
  })

  it('reports a stored value that is not JSON', () => {
    expect(storeProblems('{"state":{"projects":[')).toEqual([`${ROOT_PATH} bad-json`])
  })

  it('reports an envelope that is not an object', () => {
    expect(storeProblems('"state"')).toEqual([`${ROOT_PATH} wrong-type`])
  })

  it('reports a stored version it cannot read, before looking inside', () => {
    expect(storeProblems(stored('nonsense', 4))).toEqual(['version newer-version'])
    expect(storeProblems(stored({ projects: [design('p1')] }, -1))).toEqual(['version out-of-range'])
    expect(storeProblems(JSON.stringify({ state: { projects: [design('p1')] } }))).toEqual(['version missing-field'])
    expect(storeProblems(stored({ projects: [design('p1')] }, 'three'))).toEqual(['version wrong-type'])
  })

  it('reports the corruption the recovery screen is tested with', () => {
    const state = stateOf(3)
    const projects = state.projects as Record<string, unknown>[]
    projects[0].units = {}
    expect(storeProblems(stored(state))).toEqual(['state.projects[0].units wrong-type'])
  })

  it('reports a state that is missing', () => {
    expect(storeProblems(JSON.stringify({ version: 3 }))).toEqual(['state missing-field'])
  })

  it('reports a problem the v0 migration would have hidden', () => {
    const state = stateOf(0)
    const projects = state.projects as Record<string, unknown>[]
    delete projects[0].root
    expect(storeProblems(stored(state, 0))).toEqual(['state.projects[0].units[0].root missing-field'])
  })

  it('reports several problems in one stored value', () => {
    const state = stateOf(3)
    const projects = state.projects as Record<string, unknown>[]
    projects[0].units = 'nope'
    state.activeProjectId = 'gone'
    expect(storeProblems(stored(state))).toEqual([
      'state.projects[0].units wrong-type',
      'state.activeProjectId not-one-of',
    ])
  })
})
