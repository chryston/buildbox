/**
 * The printed table as a file (#84 §3; criteria 2 to 6, 9 to 11).
 *
 * Two layers of assertion, because a PDF is hard to read and a page is not. `tableSheets` is the
 * layout on its own — the operations a page is made of — so every claim about what a reader sees
 * (which rows, in what order, under which header, on which page) is checked there, in plain strings.
 * `writeTablePdf` is then checked for the things only the file has: that two runs are the same bytes,
 * that the `/ID` moves when a printed value moves, and that a character the face has no glyph for
 * costs a box and a notice rather than the export.
 *
 * Regenerate the goldens with
 * `UPDATE_GOLDEN=1 npx vitest run --project pure src/export/tablePdf.test.ts`, then read the diff.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { QuantityScope } from '../derive'
import { basicProject } from '../derive/testing'
import { COMMENT_SCOPE_ALL, migrateProject, validateProject } from '../domain'
import type { Comment, DisplayUnit, Project } from '../domain'
import type { ListTableId } from './csv/tables'
import { commentScopeStatement } from './comments'
import { provenanceOf } from './provenance'
import { describeScope } from './scope'
import { TABLE_NAMES, ZERO_ROWS, unitStatement } from './strings'
import { tableModel } from './tableModel'
import { tableSheets, writeTablePdf } from './tablePdf'
import type { TablePdfInput } from './tablePdf'
import type { ExportClock, ExportDeps, ExportSnapshot, ListsRecipe } from './types'

const UPDATE = process.env['UPDATE_GOLDEN'] === '1'
const GOLDEN = new URL('../../fixtures/export/golden/', import.meta.url)
const FONT = new Uint8Array(readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url)))
const SCENE = new URL('../../fixtures/e2e/preview-seed/notes-review-scene.json', import.meta.url).pathname

const CLOCK: ExportClock = { now: () => '2026-11-28T09:00:00.000Z', localDate: () => '2026-11-28' }
const DEPS: ExportDeps = { clock: CLOCK, buildboxVersion: '0.0.0-test' }

function loadScene(): Project {
  const envelope = JSON.parse(readFileSync(SCENE, 'utf8')) as { projects: { schemaVersion: number; data: unknown }[] }
  const record = envelope.projects[0]!
  const migrated = migrateProject(record.data, record.schemaVersion, () => [])
  if (!migrated.ok) throw new Error(`the Notes scene no longer migrates: ${migrated.error.message}`)
  const project = migrated.project as Project
  const checked = validateProject(project)
  if (!checked.ok) throw new Error(`the Notes scene no longer validates: ${JSON.stringify(checked.problems)}`)
  return project
}

const scene = loadScene()

const scopeOf = (project: Project, over: Partial<QuantityScope> = {}): QuantityScope => ({
  floorIds: project.floors.map((floor) => floor.id),
  designOptionIds: 'existing-only',
  renovationStates: ['existing', 'demolition', 'proposed'],
  drawingLayers: 'all',
  ...over,
})

const snapshotOf = (project: Project): ExportSnapshot => ({ project, revision: 1 })

/** The scope in plain words, the way the dialog would hand it over. */
const statementOf = (project: Project, table: ListTableId, scope: QuantityScope): string =>
  table === 'comments'
    ? commentScopeStatement(project, scope, true)
    : describeScope(scope, project)

function inputOf(
  project: Project,
  table: ListTableId,
  options: { pageSize?: 'A4' | 'A3'; scope?: Partial<QuantityScope> } = {},
): TablePdfInput {
  const scope = scopeOf(project, options.scope ?? {})
  const recipe: ListsRecipe = { tables: [table], scope, includeResolvedComments: true }
  return {
    model: tableModel(snapshotOf(project), recipe, table),
    scopeStatement: statementOf(project, table, scope),
    projectName: 'Kitchen Renovation',
    provenance: provenanceOf(snapshotOf(project), recipe, DEPS),
    fontBytes: FONT,
    pageSize: options.pageSize ?? 'A4',
    clock: CLOCK,
  }
}

/** Every string a page prints, in the order it was emitted. */
const printed = (input: TablePdfInput, pageNumber = 0): string[] =>
  tableSheets(input)[pageNumber]!.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : []))

/** A Project with `count` Comments on it, enough to run off the end of a page. */
function withRegister(project: Project, count: number): Project {
  const comments: Comment[] = []
  for (let index = 0; index < count; index++) {
    comments.push({
      id: `C-${String(100 + index)}`,
      reference: `C-${String(100 + index)}`,
      anchor: { kind: 'project' },
      title: `Register entry ${index + 1}`,
      body: `The ${index + 1}${ordinal(index + 1)} note, long enough to be worth reading but not to need a page.`,
      status: index % 4 === 0 ? 'resolved' : 'open',
      priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'normal' : 'low',
      createdAt: '2026-11-25T09:00:00.000Z',
      updatedAt: '2026-11-25T09:00:00.000Z',
      ...(index % 4 === 0 ? { resolvedAt: '2026-11-26T09:00:00.000Z' } : {}),
      scope: COMMENT_SCOPE_ALL,
    })
  }
  const next: Project = { ...project, comments, commentReferenceCounter: 100 + count }
  const checked = validateProject(next)
  if (!checked.ok) throw new Error(`the seeded Register is not a valid Project: ${JSON.stringify(checked.problems)}`)
  return next
}

const ordinal = (value: number): string => (value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th')

function golden(name: string, bytes: Uint8Array): void {
  const file = new URL(`../../fixtures/export/golden/${name}`, import.meta.url)
  if (UPDATE) {
    mkdirSync(fileURLToPath(GOLDEN), { recursive: true })
    writeFileSync(file, bytes)
  }
  expect(Array.from(readFileSync(file))).toEqual(Array.from(bytes))
}

describe('the printed pages', () => {
  for (const table of ['items', 'cut-list', 'comments'] as const) {
    const project = table === 'comments' ? scene : basicProject()

    test(`the ${table} page carries every CSV row, in the CSV order, under the §2 headers`, () => {
      const input = inputOf(project, table)
      const model = input.model
      const sheets = tableSheets(input)
      const words = sheets.flatMap((sheet) => sheet.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : [])))
      // The header row is on every page, and it is the §2 header row.
      for (const sheet of sheets) {
        const onPage = sheet.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : []))
        for (const column of model.columns) expect(onPage, `${table} header ${column.label}`).toContain(column.label)
      }
      // Every cell of every row is printed, and the rows come in the order the CSV writes them. A cell
      // that wrapped is several operations, and a word longer than its column is broken mid-word, so
      // the page is read as one run of characters with the spaces taken out.
      const flat = words.join('').replace(/\s+/g, '')
      let cursor = 0
      for (const row of model.rows) {
        for (const cell of row) {
          const needle = cell.replace(/\s+/g, '')
          if (needle.length === 0) continue
          const at = flat.indexOf(needle, cursor)
          expect(at, `${table} cell ${cell}`).toBeGreaterThan(-1)
          cursor = at + needle.length
        }
      }
    })

    test(`the ${table} file is the golden`, async () => {
      golden(`table-${table}-a4.pdf`, (await writeTablePdf(inputOf(project, table))).bytes)
    })
  }

  test('the page numbers every page, and says which of how many', () => {
    const input = inputOf(withRegister(scene, 200), 'comments')
    const sheets = tableSheets(input)
    expect(sheets.length).toBeGreaterThan(1)
    sheets.forEach((sheet, at) => {
      const words = sheet.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : []))
      expect(words.some((word) => word.includes(`Page ${at + 1}/${sheets.length}`))).toBe(true)
    })
  })

  test('a two hundred row Register repeats its headers and never cuts a row', () => {
    const input = inputOf(withRegister(scene, 200), 'comments')
    const sheets = tableSheets(input)
    const references = input.model.rows.map((row) => row[0]!)
    const seen: string[] = []
    for (const sheet of sheets) {
      const words = sheet.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : []))
      // The header row repeats, so a reader three pages in still knows which column is which.
      for (const column of input.model.columns) expect(words).toContain(column.label)
      // No row is cut: the continuation marker belongs to a row taller than a page body, and none is.
      expect(words.some((word) => word.includes('(continued)'))).toBe(false)
      for (const word of words) if (/^C-\d+$/.test(word)) seen.push(word)
    }
    // Every row is printed exactly once, in the CSV order, across the whole file.
    expect(seen).toEqual(references)
  })

  test('the title block says whose table, which rows, on what unit, when and which page', () => {
    const input = inputOf(scene, 'comments')
    const words = printed(input)
    // Criterion 11: every one of these, and no author and no logo anywhere on the face.
    expect(words.some((one) => one.includes('Kitchen Renovation'))).toBe(true)
    expect(words.some((one) => one.includes(TABLE_NAMES.comments))).toBe(true)
    expect(words.some((one) => one.includes(input.scopeStatement))).toBe(true)
    expect(words.some((one) => one.includes(unitStatement(input.model.unit)))).toBe(true)
    expect(words.some((one) => one.includes(CLOCK.localDate()))).toBe(true)
    expect(words.some((one) => one.includes('0.0.0-test'))).toBe(true)
    expect(words.some((one) => one.includes('Page 1/'))).toBe(true)
    // Criterion 12: the Project's ID and revision are metadata, not page furniture.
    expect(words.some((one) => one.includes(scene.id))).toBe(false)
  })

  test('an empty scope still prints a page: the title block, the headers, and no rows', () => {
    const input = inputOf(basicProject(), 'items', { scope: { floorIds: [] } })
    const sheets = tableSheets(input)
    expect(sheets.length).toBe(1)
    const words = printed(input)
    expect(words).toContain(ZERO_ROWS)
    for (const column of input.model.columns) expect(words).toContain(column.label)
    expect(words.some((word) => word.includes('Scope:'))).toBe(true)
  })

  test('the page turns when the columns will not fit the tall sheet, and the sheet is chosen per file', () => {
    const size = (input: TablePdfInput): { widthMm: number; heightMm: number } => {
      const { widthMm, heightMm } = tableSheets(input)[0]!
      return { widthMm, heightMm }
    }
    // Eleven columns of long English headers — `Design Option ID`, `Renovation State` — are wider than
    // the tall A4's text width, so the Item List lies down. Nothing about the table's name decides this.
    expect(size(inputOf(basicProject(), 'items'))).toEqual({ widthMm: 297, heightMm: 210 })
    expect(size(inputOf(basicProject(), 'cut-list'))).toEqual({ widthMm: 297, heightMm: 210 })
    // On the bigger sheet both tables stand up: an A3 sheet standing has the same 277 mm text width as
    // an A4 sheet lying down, and four hundred millimetres of depth instead of a hundred and ninety.
    expect(size(inputOf(basicProject(), 'items', { pageSize: 'A3' }))).toEqual({ widthMm: 297, heightMm: 420 })
    expect(size(inputOf(basicProject(), 'cut-list', { pageSize: 'A3' }))).toEqual({ widthMm: 297, heightMm: 420 })
    // A wider sheet never turns a table the narrower sheet kept standing.
    for (const table of ['items', 'cut-list', 'comments'] as const) {
      const project = table === 'comments' ? scene : basicProject()
      const a4 = size(inputOf(project, table))
      const a3 = size(inputOf(project, table, { pageSize: 'A3' }))
      expect(a3.widthMm >= a4.widthMm && a3.heightMm >= a4.heightMm, `${table} on A3`).toBe(true)
    }
  })

  test('a row taller than the page body continues, and says so in its first cell', () => {
    const project: Project = {
      ...scene,
      comments: [
        {
          id: 'C-900',
          reference: 'C-900',
          anchor: { kind: 'project' },
          title: 'The whole flat, room by room',
          body: Array.from({ length: 120 }, (_, at) => `Line ${at + 1}: the skirting in the hall is 96 mm and the reveal is 12 mm.`).join('\n'),
          status: 'open',
          priority: 'high',
          createdAt: '2026-11-25T09:00:00.000Z',
          updatedAt: '2026-11-25T09:00:00.000Z',
          scope: COMMENT_SCOPE_ALL,
        },
      ],
    }
    const input = inputOf(project, 'comments')
    const sheets = tableSheets(input)
    expect(sheets.length).toBeGreaterThan(1)
    const words = sheets.flatMap((sheet) => sheet.ops.flatMap((op) => (op.kind === 'text' ? [op.text] : [])))
    expect(words.some((word) => word.includes('(continued)'))).toBe(true)
    // The body keeps its line breaks: a note written as a list prints as a list.
    expect(words).toContain('Line 1: the skirting in the hall is 96 mm and the reveal is 12 mm.')
  })

  test('a character the face has no glyph for costs a box and a notice, not the export', async () => {
    const project: Project = {
      ...scene,
      comments: [
        {
          id: 'C-901',
          reference: 'C-901',
          anchor: { kind: 'project' },
          title: '書櫃 ✓',
          body: 'A wardrobe, approved.',
          status: 'open',
          priority: 'normal',
          createdAt: '2026-11-25T09:00:00.000Z',
          updatedAt: '2026-11-25T09:00:00.000Z',
          scope: COMMENT_SCOPE_ALL,
        },
      ],
    }
    const result = await writeTablePdf(inputOf(project, 'comments'))
    expect(result.bytes.length).toBeGreaterThan(0)
    const characters = result.missingGlyphs.flatMap((glyph) => glyph.chars)
    expect(characters).toContain('書')
    expect(characters).toContain('櫃')
  })

  test('the file is the golden whatever the paper', async () => {
    golden('table-cut-list-a3.pdf', (await writeTablePdf(inputOf(basicProject(), 'cut-list', { pageSize: 'A3' }))).bytes)
    golden('table-comments-a4.pdf', (await writeTablePdf(inputOf(scene, 'comments'))).bytes)
  })
})

describe('the file is a fact about the rows', () => {
  test('two runs of the same rows are the same bytes', async () => {
    const first = await writeTablePdf(inputOf(scene, 'comments'))
    const second = await writeTablePdf(inputOf(scene, 'comments'))
    expect(Array.from(second.bytes)).toEqual(Array.from(first.bytes))
  })

  test('the /ID moves when a printed value moves, and only then', async () => {
    const idOf = (bytes: Uint8Array): string => {
      const text = new TextDecoder('latin1').decode(bytes)
      const found = /\/ID \[ <([0-9a-f]+)>/.exec(text)
      if (found === null) throw new Error('the file carries no /ID')
      return found[1]!
    }
    const again = await writeTablePdf(inputOf(scene, 'comments'))
    const same = await writeTablePdf(inputOf(scene, 'comments'))
    expect(idOf(same.bytes)).toBe(idOf(again.bytes))
    // One Comment's title is a printed value: the file that carries a different one is a different file.
    const renamed: Project = {
      ...scene,
      comments: scene.comments.map((comment) => (comment.reference === 'C-001' ? { ...comment, title: `${comment.title} (checked)` } : comment)),
    }
    const changed = await writeTablePdf(inputOf(renamed, 'comments'))
    expect(idOf(changed.bytes)).not.toBe(idOf(again.bytes))
  })

  test('the display unit reaches the page and not the file name of the numbers', () => {
    const at = (displayUnit: DisplayUnit, displayPrecision: number): string[] => {
      const project: Project = {
        ...basicProject(),
        preferences: { ...basicProject().preferences, displayUnit, displayPrecision },
      }
      return printed(inputOf(project, 'items'))
    }
    expect(at('mm', 0)).toContain('24')
    expect(at('m', 3)).toContain('0.024')
    // The header carries the unit the title block says the page is in.
    expect(at('m', 3)).toContain('Width (m)')
    expect(at('mm', 0)).toContain('Width (mm)')
  })
})
