/**
 * The printed model of a list (#84 §1, §2; criteria 1, 2, 3, 7).
 *
 * Three things are checked here and nothing about paper: that the columns are the CSV's columns with
 * the labels §2 names, that a cell is the Project's number and the reader's word, and that the rows
 * are the CSV's rows. The page those columns are laid out on is `tablePdf.test.ts`'s business; the
 * claim that the two files hold the same rows is held to directly, against the CSV bytes
 * `exportLists` writes, because that is the criterion this module exists to satisfy.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { QuantityScope } from '../derive'
import { basicProject } from '../derive/testing'
import { migrateProject, validateProject } from '../domain'
import type { DisplayUnit, Project } from '../domain'
import { ITEMS_TABLE, TABLES } from './csv/tables'
import type { ListTableId } from './csv/tables'
import { exportLists } from './lists'
import { parseCsv } from './testing'
import { lengthWords, tableModel, timestampWords } from './tableModel'
import type { ExportSnapshot, ListsRecipe } from './types'

const SCENE_FIXTURE = new URL('../../fixtures/e2e/preview-seed/notes-review-scene.json', import.meta.url).pathname

/** The Notes scene, migrated and validated the way the app does it — an invalid seed would make every assertion below vacuously true. */
function loadScene(): Project {
  const envelope = JSON.parse(readFileSync(SCENE_FIXTURE, 'utf8')) as { projects: { schemaVersion: number; data: unknown }[] }
  const record = envelope.projects[0]!
  const migrated = migrateProject(record.data, record.schemaVersion, () => [])
  if (!migrated.ok) throw new Error(`the Notes scene no longer migrates: ${migrated.error.message}`)
  const project = migrated.project as Project
  const checked = validateProject(project)
  if (!checked.ok) throw new Error(`the Notes scene no longer validates: ${JSON.stringify(checked.problems)}`)
  return project
}

const scene = loadScene()

const DEPS = {
  clock: { now: () => '2026-11-28T09:00:00.000Z', localDate: () => '2026-11-28' },
  buildboxVersion: '0.0.0-test',
}

const scopeOf = (project: Project, over: Partial<QuantityScope> = {}): QuantityScope => ({
  floorIds: project.floors.map((floor) => floor.id),
  designOptionIds: 'existing-only',
  renovationStates: ['existing', 'demolition', 'proposed'],
  drawingLayers: 'all',
  ...over,
})

const recipeOf = (project: Project, table: ListTableId, over: Partial<QuantityScope> = {}): ListsRecipe => ({
  tables: [table],
  scope: scopeOf(project, over),
  includeResolvedComments: true,
})

const modelOf = (project: Project, table: ListTableId, over: Partial<QuantityScope> = {}) =>
  tableModel({ project, revision: 1 } satisfies ExportSnapshot, recipeOf(project, table, over), table)

/** The same project with a different display preference, which is the whole of what criterion 7 changes. */
const displayed = (project: Project, displayUnit: DisplayUnit, displayPrecision: number): Project => ({
  ...project,
  preferences: { ...project.preferences, displayUnit, displayPrecision },
})

/** The CSV `exportLists` writes for one table, as the bytes the download would carry. */
async function csvBytesOf(project: Project, table: ListTableId): Promise<Uint8Array> {
  const result = await exportLists({ project, revision: 1 }, recipeOf(project, table), DEPS)
  if (!result.ok) throw new Error(`the lists export failed: ${JSON.stringify(result.failures)}`)
  if (result.kind !== 'single') throw new Error(`one table wrote more than one file`)
  return result.file.bytes
}

/** The same bytes read back as fields. */
const csvOf = async (project: Project, table: ListTableId): Promise<readonly (readonly string[])[]> =>
  parseCsv(await csvBytesOf(project, table)).rows

const column = (table: ListTableId, header: string): number =>
  TABLES[table].columns.findIndex((at) => at.header === header)

describe('the printed columns', () => {
  test('each table prints the CSV columns, in the CSV order, under the §2 label', () => {
    // The order is asserted against the spec rather than written out again so that a column added to
    // the CSV contract has to be given a printed label too — which `columnOf` enforces by throwing.
    for (const table of ['items', 'cut-list', 'comments'] as const) {
      expect(modelOf(table === 'comments' ? scene : basicProject(), table).columns.map((at) => at.header)).toEqual(
        TABLES[table].columns.map((at) => at.header),
      )
    }
    // The labels below are written for a Project displayed in millimetres, which is the default and
    // the unit the §2 table names; the next test covers a Project displayed in something else.
    const mm = displayed(basicProject(), 'mm', 0)
    expect(modelOf(mm, 'items').columns.map((at) => at.label)).toEqual([
      'Floor ID', 'Floor', 'Design Option ID', 'Design Option', 'Renovation State', 'Item Design ID',
      'Item Design', 'Count', 'Width (mm)', 'Depth (mm)', 'Height (mm)',
    ])
    expect(modelOf(mm, 'cut-list').columns.map((at) => at.label)).toEqual([
      'Design Option ID', 'Design Option', 'Renovation State', 'Item Design ID', 'Item Design', 'Part',
      'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'Material', 'Qty per item', 'Item count',
      'Qty in scope', 'Notes',
    ])
    expect(modelOf(scene, 'comments').columns.map((at) => at.label)).toEqual([
      'Reference', 'Title', 'Body', 'Status', 'Priority', 'Created', 'Updated', 'Resolved', 'Scope',
      'Floor', 'Design Option', 'Target type', 'Target',
    ])
  })

  test('the ID columns are printed columns too, and aligned with the text they sit beside', () => {
    // Criterion 3: a reader has to be able to tie a printed row to a CSV row, and the ID is the tie.
    const ids = modelOf(basicProject(), 'items').columns.filter((at) => at.header.endsWith('_id'))
    expect(ids.map((at) => at.header)).toEqual(['floor_id', 'design_option_id', 'item_design_id'])
    expect(ids.every((at) => at.align === 'left' && !at.numeric)).toBe(true)
  })

  test('a measured column is right-aligned and unwrappable; a word column is neither', () => {
    const cuts = modelOf(basicProject(), 'cut-list').columns
    for (const at of cuts) {
      expect(at.align).toBe(at.numeric ? 'right' : 'left')
    }
    expect(cuts.filter((at) => at.numeric).map((at) => at.header)).toEqual([
      'length_mm', 'width_mm', 'thickness_mm', 'qty_per_item', 'item_count', 'qty_in_scope',
    ])
  })

  test('a length header carries the Project unit, so it agrees with the title block', () => {
    const expected: Record<DisplayUnit, string> = { mm: 'Width (mm)', cm: 'Width (cm)', m: 'Width (m)' }
    for (const unit of ['mm', 'cm', 'm'] as const) {
      const width = modelOf(displayed(basicProject(), unit, 1), 'items').columns[column('items', 'width_mm')]
      expect(width.label).toBe(expected[unit])
    }
    // A count is not a length and never takes a unit.
    expect(modelOf(displayed(basicProject(), 'cm', 1), 'items').columns[column('items', 'count')].label).toBe('Count')
  })
})

describe('the printed cells', () => {
  test('a length prints in the Project unit at the Project precision', () => {
    const at = (project: Project): string[] => {
      const model = modelOf(project, 'items')
      const row = model.rows[0]!
      return [row[column('items', 'width_mm')]!, row[column('items', 'height_mm')]!]
    }
    // The fixture's `Base Cabinet` is 24 mm wide and 34.5 mm high, and its own preference is cm at one
    // decimal — the pair the screen would show, which is the point of #84 criterion 7.
    expect(at(basicProject())).toEqual(['2.4', '3.5'])
    expect(at(displayed(basicProject(), 'mm', 0))).toEqual(['24', '35'])
    expect(at(displayed(basicProject(), 'mm', 2))).toEqual(['24.00', '34.50'])
    expect(at(displayed(basicProject(), 'm', 3))).toEqual(['0.024', '0.035'])
  })

  test('a stored code prints as the plain word and never as the code', async () => {
    expect(modelOf(basicProject(), 'items').rows[0]![column('items', 'renovation_state')]).toBe('Existing')

    const register = modelOf(scene, 'comments')
    const row = (reference: string): readonly string[] => register.rows.find((at) => at[0] === reference)!
    // C-004 is a high-priority Comment on a Placed Item in the Existing Model; C-005 is Resolved.
    expect(row('C-004')[column('comments', 'status')]).toBe('Open')
    expect(row('C-004')[column('comments', 'priority')]).toBe('High')
    expect(row('C-004')[column('comments', 'scope')]).toBe('Existing Model')
    expect(row('C-004')[column('comments', 'target_type')]).toBe('Element or Placed Item')
    expect(row('C-005')[column('comments', 'status')]).toBe('Resolved')
    expect(row('C-001')[column('comments', 'target_type')]).toBe('Project')
    expect(row('C-006')[column('comments', 'target_type')]).toBe('Feature')
    expect(row('C-003')[column('comments', 'target_type')]).toBe('Floor Point')
    expect(row('C-001')[column('comments', 'scope')]).toBe('All Options')

    // The negative half, column by column: no cell of a code column is ever the code itself.
    const CODE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
      items: ['renovation_state'],
      'cut-list': ['renovation_state'],
      comments: ['status', 'priority', 'scope', 'target_type'],
    }
    for (const [table, project] of [['items', basicProject()], ['cut-list', basicProject()], ['comments', scene]] as const) {
      const model = modelOf(project, table)
      const csv = (await csvOf(project, table)).slice(1)
      for (const header of CODE_COLUMNS[table]!) {
        const at = column(table, header)
        model.rows.forEach((printed, index) => {
          expect(printed[at]).not.toBe(csv[index]![at])
        })
      }
    }
  })

  test('a Material with no declared values prints what the Project says', () => {
    // `material` is an `enum` column whose values are the Project's own, so the only honest printing
    // is the word the person typed.
    const material = modelOf(basicProject(), 'cut-list').rows[0]![column('cut-list', 'material')]!
    expect(material).toBe('walnut')
  })

  test('a timestamp prints as a UTC date and time; a blank cell stays blank', () => {
    const register = modelOf(scene, 'comments')
    const row = register.rows.find((at) => at[0] === 'C-001')!
    expect(row[column('comments', 'created_at')]).toBe('2026-11-25 09:00 UTC')
    expect(row[column('comments', 'updated_at')]).toBe('2026-11-25 09:00 UTC')
    // An Open Comment has no resolution time, and the printed cell says nothing rather than `—` or
    // the epoch.
    expect(row[column('comments', 'resolved_at')]).toBe('')
    const resolved = register.rows.find((at) => at[0] === 'C-005')!
    expect(resolved[column('comments', 'resolved_at')]).toBe('2026-11-25 09:00 UTC')
  })

  test('lengthWords prints the fixed decimals a column needs to be read down', () => {
    expect(lengthWords(600, 'mm', 0)).toBe('600')
    expect(lengthWords(600, 'cm', 1)).toBe('60.0')
    expect(lengthWords(600, 'm', 3)).toBe('0.600')
    expect(lengthWords(605, 'cm', 1)).toBe('60.5')
    expect(lengthWords(605.5, 'mm', 0)).toBe('606')
    expect(lengthWords(0, 'm', 3)).toBe('0.000')
  })

  test('timestampWords never reads a clock and leaves what it cannot read alone', () => {
    expect(timestampWords('2026-11-25T09:00:00.000Z')).toBe('2026-11-25 09:00 UTC')
    expect(timestampWords('2026-11-25T09:00:00+05:30')).toBe('2026-11-25 09:00 UTC')
    expect(timestampWords('2026-11-25 09:00')).toBe('2026-11-25 09:00 UTC')
    expect(timestampWords('')).toBe('')
    expect(timestampWords('sometime last autumn')).toBe('sometime last autumn')
  })
})

describe('the rows are the CSV rows', () => {
  for (const [table, project] of [['items', basicProject()], ['cut-list', basicProject()], ['comments', scene]] as const) {
    test(`the ${table} model has one row per CSV row, in the CSV order`, async () => {
      const model = modelOf(project, table)
      const csv = await csvOf(project, table)
      // One header line, and one row after it per printed row: no grouping, no subtotal, no dropped
      // row, and no row the CSV does not have.
      expect(model.rows.length).toBe(csv.length - 1)
      const key = column(table, table === 'comments' ? 'reference' : table === 'items' ? 'item_design' : 'part')
      expect(model.rows.map((row) => row[key])).toEqual(csv.slice(1).map((row) => row[key]!))
    })
  }

  test('an empty scope prints no rows', () => {
    const model = modelOf(basicProject(), 'items', { floorIds: [] })
    expect(model.columns.length).toBe(ITEMS_TABLE.columns.length)
    expect(model.rows).toEqual([])
  })

  test('criterion 7: the display unit moves the printed numbers and leaves the CSV bytes alone', async () => {
    const mm = displayed(basicProject(), 'mm', 0)
    const cm = displayed(basicProject(), 'cm', 1)
    // Bytes, not fields: the CSV is millimetres at the contract's own precision whatever the Project
    // is set to show, so a byte-for-byte comparison is the claim criterion 7 makes.
    expect(Array.from(await csvBytesOf(cm, 'items'))).toEqual(Array.from(await csvBytesOf(mm, 'items')))
    expect(modelOf(cm, 'items').rows[0]).not.toEqual(modelOf(mm, 'items').rows[0])
    expect(modelOf(mm, 'items').rows[0]![column('items', 'width_mm')]).toBe('24')
    expect(modelOf(cm, 'items').rows[0]![column('items', 'width_mm')]).toBe('2.4')
  })

  test('the printed table covers every column the CSV writes, and no others', async () => {
    for (const [table, project] of [['items', basicProject()], ['cut-list', basicProject()], ['comments', scene]] as const) {
      const model = modelOf(project, table)
      const csv = await csvOf(project, table)
      expect(model.columns.length).toBe(csv[0]!.length)
      expect(model.columns.map((at) => at.header)).toEqual(csv[0])
    }
  })
})
