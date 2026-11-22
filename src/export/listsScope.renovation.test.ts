/**
 * The Lists scope as a reader sees it (#73 criteria 8, 10 and 12).
 *
 * These read the CSV bytes back rather than the rows the builders returned, because the criterion is
 * about the file: which columns are empty, and whether comparing two Options doubles the rows that
 * belong to neither of them. Criterion 12 is the quiet one — a download that edited the Project would
 * be the worst kind of surprise — so the snapshot is compared with itself across the call.
 */
import { describe, expect, it } from 'vitest'
import renovationFixture from '../../fixtures/domain/v8/renovation-views.json?raw'
import { warningMessages } from '../derive'
import type { QuantityScope } from '../derive'
import type { Project } from '../domain'
import { exportLists } from './lists'
import { parseCsv } from './testing'
import type { ExportSnapshot, ListsRecipe } from './types'

const project = (JSON.parse(renovationFixture) as { project: Project }).project
const snapshot: ExportSnapshot = { project, revision: 7 }
const CLOCK = {
  now: (): string => '2026-11-23T09:30:00.000Z',
  localDate: (): string => '2026-11-23',
}

const scope = (over: Partial<QuantityScope>): QuantityScope => ({
  floorIds: project.floors.map((floor) => floor.id),
  designOptionIds: 'existing-only',
  renovationStates: ['existing', 'demolition', 'proposed'],
  drawingLayers: 'all',
  ...over,
})

/** The rows of one table, as the file holds them: header → value, one object per line. */
async function csvOf(
  tables: ListsRecipe['tables'],
  over: Partial<QuantityScope> = {},
  at: Project = project,
): Promise<Record<string, string>[]> {
  const scopeOf = scope(over)
  // The Warnings List is written from sentences the caller supplies, so the test supplies them the
  // way the app does: for the scope being exported, keyed by what the row is about.
  const result = await exportLists({ project: at, revision: 7 }, { tables, scope: scopeOf }, {
    clock: CLOCK,
    buildboxVersion: '0.0.0-test',
    warningMessages: warningMessages(at, scopeOf, (key) => `sentence:${key}`),
  })
  if (!result.ok) throw new Error(result.failures.map((each) => each.reason).join(', '))
  const wanted = tables[0]
  const files = result.kind === 'single' ? [result.file] : result.files
  const file = files.find((each: { name: string }) => each.name.includes(`_${wanted}_`))
  if (file === undefined) throw new Error(`no ${wanted} table among ${files.map((each) => each.name).join(', ')}`)
  const parsed = parseCsv(file.bytes)
  const [head, ...body] = parsed.rows
  return body.map((row) => Object.fromEntries(head.map((column, index) => [column, row[index] ?? ''])))
}

describe('the Lists scope over Design Options (#73 §8)', () => {
  it('repeats every Existing row once per Option when two are compared', async () => {
    const compared = await csvOf(['walls'], { designOptionIds: ['option-a', 'option-b'] })
    const under = (optionId: string): string[] =>
      compared.filter((row) => row['design_option_id'] === optionId).map((row) => row['stable_id'])
    // The Walls neither Option touches: what one of them demolishes is that Option's own business,
    // and this criterion is about the content the two schemes share.
    const untouched = project.existingModel.walls
      .filter((wall) => (project.designOptions ?? []).every((option) => !option.demolishedIds.includes(wall.id)))
      .map((wall) => wall.id)
      .sort()
    expect(untouched.length).toBeGreaterThan(0)
    for (const optionId of ['option-a', 'option-b']) {
      const ids = under(optionId).sort()
      // The Existing Model belongs to neither Option, so it is listed once under each: what the two
      // schemes have in common has to be readable on both sides of the comparison.
      expect(ids.filter((id) => untouched.includes(id)), optionId).toEqual(untouched)
    }
    // What one Option adds belongs to that Option alone and is not repeated under the other: it is
    // not in the Existing Model at all, which is exactly the difference being compared.
    const proposed = compared.filter((row) => row['renovation_state'] === 'proposed')
    expect(proposed.length).toBeGreaterThan(0)
    const modelWallIds = new Set(project.existingModel.walls.map((wall) => wall.id))
    for (const row of proposed) {
      expect(modelWallIds.has(row['stable_id'])).toBe(false)
      expect(['option-a', 'option-b']).toContain(row['design_option_id'])
    }
  })

  it('leaves both Design Option columns empty for the Existing Model only', async () => {
    const rows = await csvOf(['walls'])
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row['design_option']).toBe('')
      expect(row['design_option_id']).toBe('')
    }
  })
})

describe('the Warnings List ignores the Layer and State selections (#73 §10)', () => {
  it('says the same thing whatever is hidden', async () => {
    const wide = await csvOf(['warnings'])
    const narrow = await csvOf(['warnings'], { renovationStates: ['proposed'], drawingLayers: { layerIds: [], includeUnlayered: false } })
    expect(narrow).toEqual(wide)
  })
})

describe('the Demolition state in the tables (#73 §2)', () => {
  it('lists a Wall the Option takes down, and narrows it away with the States control', async () => {
    const wall = (rows: Record<string, string>[]): string[] =>
      rows.filter((row) => row['stable_id'] === 'seed-wall-003').map((row) => row['renovation_state'])
    // Option A takes this Wall down, so its own list says so: the row is the demolition quantity.
    expect(wall(await csvOf(['walls'], { designOptionIds: ['option-a'] }))).toEqual(['demolition'])
    expect(wall(await csvOf(['walls'], { designOptionIds: ['option-a'], renovationStates: ['existing'] }))).toEqual([])
    expect(wall(await csvOf(['walls'], { designOptionIds: ['option-a'], renovationStates: ['proposed'] }))).toEqual([])
    // Option B takes the same Wall down; the Existing Model alone keeps it.
    expect(wall(await csvOf(['walls'], { designOptionIds: ['option-b'] }))).toEqual(['demolition'])
    expect(wall(await csvOf(['walls']))).toEqual(['existing'])
  })

  it('lists the Openings of a Wall that comes down, in that Wall', async () => {
    // Every Opening in the fixture lives on a Wall neither Option touches, so the case is made here:
    // Option A takes down the Wall that hosts two of them, and they come down with it.
    const at: Project = {
      ...project,
      designOptions: (project.designOptions ?? []).map((option) =>
        option.id === 'option-a' ? { ...option, demolishedIds: [...option.demolishedIds, 'seed-wall-004'] } : option,
      ),
    }
    const rows = await csvOf(['openings'], { designOptionIds: ['option-a'] }, at)
    const hosted = rows.filter((row) => row['host_wall_id'] === 'seed-wall-004')
    expect(hosted.map((row) => row['stable_id']).sort()).toEqual(['seed-opening-014', 'seed-opening-015'])
    // The Option marked the Wall and not the doors in it, so they say what they are. What the table
    // owes them is a row that names its host, not silence because the host no longer stands.
    for (const row of hosted) expect(row['renovation_state']).toBe('existing')
    const marked = await csvOf(['openings'], { designOptionIds: ['option-a'] }, {
      ...at,
      designOptions: (at.designOptions ?? []).map((option) =>
        option.id === 'option-a'
          ? { ...option, demolishedIds: [...option.demolishedIds, 'seed-opening-014', 'seed-opening-015'] }
          : option,
      ),
    })
    expect(marked.filter((row) => row['host_wall_id'] === 'seed-wall-004').map((row) => row['renovation_state']))
      .toEqual(['demolition', 'demolition'])
  })

  it('counts a placement the Option takes down in its own state', async () => {
    const rows = await csvOf(['placed-items'], { designOptionIds: ['option-a'] })
    const demolished = rows.filter((row) => row['renovation_state'] === 'demolition')
    expect(demolished.map((row) => row['stable_id'])).toEqual(['seed-item-028'])
    const list = await csvOf(['items'], { designOptionIds: ['option-a'] })
    expect(list.filter((row) => row['renovation_state'] === 'demolition').map((row) => row['count'])).toEqual(['1'])
  })
})

describe('an export never edits (#73 §12)', () => {
  it('leaves the Project and the revision exactly as it found them', async () => {
    const before = structuredClone(project)
    for (const table of ['walls', 'rooms', 'openings', 'placed-items', 'cut-list', 'items'] as const) {
      await csvOf([table])
    }
    expect(project).toEqual(before)
    expect(snapshot.revision).toBe(7)
  })
})
