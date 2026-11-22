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
async function csvOf(tables: ListsRecipe['tables'], over: Partial<QuantityScope> = {}): Promise<Record<string, string>[]> {
  const at = scope(over)
  // The Warnings List is written from sentences the caller supplies, so the test supplies them the
  // way the app does: for the scope being exported, keyed by what the row is about.
  const result = await exportLists(snapshot, { tables, scope: at }, {
    clock: CLOCK,
    buildboxVersion: '0.0.0-test',
    warningMessages: warningMessages(project, at, (key) => `sentence:${key}`),
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
