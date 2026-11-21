/**
 * The lists as files (#62 criteria 10, 11 and 12).
 *
 * What a reader holds is the thing under test here: the name on the download, the bytes inside it,
 * and — for a ZIP — the `manifest.json` that says which file is which. Criterion 10's
 * "byte-identical" and criterion 11's "SHA-256 and contract_version" are both claims about bytes,
 * so they are read back out of the archive rather than trusted from the writer's side.
 */
import { describe, expect, test } from 'vitest'
import { sha256Hex, unzipEntries } from '../lib'
import type { ZipLimits } from '../lib'
import { basicProject } from '../derive/testing'
import type { QuantityScope } from '../derive'
import type { Project } from '../domain'
import { CUT_LIST_TABLE, ITEMS_TABLE, headerLine } from './csv/tables'
import { exportLists, listsSummary } from './lists'
import { parseCsv } from './testing'
import type { ListsRecipe } from './types'

const LIMITS: ZipLimits = {
  maxEntries: 16,
  maxEntryBytes: 1 << 20,
  maxTotalBytes: 1 << 22,
  maxRatio: 200,
  ratioFloorBytes: 1024,
}

const project = basicProject()

/** One reading of the clock, so a file name is a fact of the test rather than of the machine. */
const clockAt = (instant: string) => ({
  now: () => instant,
  localDate: () => instant.slice(0, 10),
})
const deps = (instant = '2026-11-20T09:00:00.000Z') => ({
  clock: clockAt(instant),
  buildboxVersion: '0.0.0-test',
})

function scopeFor(over: Partial<QuantityScope> = {}): QuantityScope {
  return {
    floorIds: project.floors.map((floor) => floor.id),
    designOptionIds: 'existing-only',
    renovationStates: ['existing', 'demolition', 'proposed'],
    drawingLayers: 'all',
    ...over,
  }
}

const recipeOf = (tables: ListsRecipe['tables'], over: Partial<QuantityScope> = {}): ListsRecipe => ({
  tables,
  scope: scopeFor(over),
})

/** The archive as a reader opens it: name → bytes. */
function entriesOf(bytes: Uint8Array): Map<string, Uint8Array> {
  const read = unzipEntries(bytes, LIMITS)
  if (!read.ok) throw new Error(`the archive did not read back: ${read.failure.code}`)
  return new Map(read.entries.map((entry) => [entry.name, entry.data]))
}

const manifestOf = (bytes: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(entriesOf(bytes).get('manifest.json')!)) as {
    contract_version: string
    project_revision: number
    exported_at: string
    recipe: ListsRecipe
    files: {
      path: string
      kind: string
      sha256?: string
      bytes?: number
      contract_version: string
    }[]
  }

describe('exportLists', () => {
  test('one table is a bare CSV named after the Project, the table and the day (#62 criterion 11)', async () => {
    const result = await exportLists({ project, revision: 3 }, recipeOf(['items']), deps())
    if (!result.ok || result.kind !== 'single') throw new Error('a single table should give one file')
    expect(result.file.name).toBe('Maple-Street-Kitchen_items_20261120.csv')
    expect(result.file.mediaType).toBe('text/csv')
    const parsed = parseCsv(result.file.bytes)
    expect(parsed.bom).toBe(true)
    expect(parsed.rows[0]).toEqual(headerLine(ITEMS_TABLE).split(','))
  })

  test("the Cut List alone is named `cut-list`, the contract's own id", async () => {
    const result = await exportLists({ project, revision: 3 }, recipeOf(['cut-list']), deps())
    if (!result.ok || result.kind !== 'single') throw new Error('a single table should give one file')
    expect(result.file.name).toBe('Maple-Street-Kitchen_cut-list_20261120.csv')
    expect(parseCsv(result.file.bytes).rows[0]).toEqual(headerLine(CUT_LIST_TABLE).split(','))
  })

  test('two tables are a ZIP whose manifest carries both entries, their SHA-256 and the contract version (#62 criterion 11)', async () => {
    const result = await exportLists({ project, revision: 3 }, recipeOf(['items', 'cut-list']), deps())
    if (!result.ok || result.kind !== 'archive') throw new Error('two tables should give an archive')
    expect(result.archive.name).toBe('Maple-Street-Kitchen_lists_20261120.zip')
    expect(result.archive.mediaType).toBe('application/zip')

    const entries = entriesOf(result.archive.bytes)
    expect([...entries.keys()]).toEqual([
      'Maple-Street-Kitchen_items_20261120.csv',
      'Maple-Street-Kitchen_cut-list_20261120.csv',
      'manifest.json',
    ])
    // The manifest is the same JSON the dialog's own file list came from, and it describes the
    // archive it sits in — including itself, which cannot carry its own digest.
    const manifest = manifestOf(result.archive.bytes)
    expect(manifest.contract_version).toBe('1.0')
    expect(manifest.project_revision).toBe(3)
    expect(manifest.recipe).toEqual(recipeOf(['items', 'cut-list']))
    expect(manifest.files.map((file) => file.path)).toEqual([...entries.keys()])
    for (const file of manifest.files.filter((each) => each.kind !== 'manifest')) {
      const bytes = entries.get(file.path)!
      expect(file.bytes).toBe(bytes.length)
      expect(file.sha256).toBe(await sha256Hex(bytes))
      expect(file.contract_version).toBe('1.0')
    }
    expect(manifest.files.find((file) => file.kind === 'manifest')?.sha256).toBeUndefined()
  })

  test('the same revision and recipe write the same bytes; the ZIP differs only in the manifest (#62 criterion 10)', async () => {
    const first = await exportLists({ project, revision: 3 }, recipeOf(['items', 'cut-list']), deps())
    const second = await exportLists(
      { project, revision: 3 },
      recipeOf(['items', 'cut-list']),
      deps('2026-11-20T11:30:00.000Z'),
    )
    if (!first.ok || !second.ok || first.kind !== 'archive' || second.kind !== 'archive') {
      throw new Error('two tables should give an archive')
    }
    const a = entriesOf(first.archive.bytes)
    const b = entriesOf(second.archive.bytes)
    for (const name of [...a.keys()].filter((each) => each !== 'manifest.json')) {
      expect([...a.get(name)!]).toEqual([...b.get(name)!])
    }
    // The archive's own bytes move because one entry inside them does: the manifest's instant.
    expect([...first.archive.bytes]).not.toEqual([...second.archive.bytes])
    const earlier = manifestOf(first.archive.bytes)
    const later = manifestOf(second.archive.bytes)
    expect(earlier.exported_at).toBe('2026-11-20T09:00:00.000Z')
    expect(later.exported_at).toBe('2026-11-20T11:30:00.000Z')
    expect({ ...earlier, exported_at: '' }).toEqual({
      ...later,
      exported_at: '',
    })
  })

  test('writing lists never touches the Project it read (#62 criterion 12)', async () => {
    const before = structuredClone(project)
    const result = await exportLists({ project, revision: 7 }, recipeOf(['items', 'cut-list']), deps())
    expect(result.ok).toBe(true)
    expect(project).toEqual(before)
    expect(structuredClone(project)).toEqual(before)
  })

  test('a recipe with no table says so instead of writing an empty archive', async () => {
    const result = await exportLists({ project, revision: 3 }, recipeOf([]), deps())
    expect(result).toEqual({
      ok: false,
      failures: [{ output: 'Maple Street Kitchen', reason: 'empty-tables' }],
    })
  })

  test('a Cut List from an Item Detail View is that design, counted once', async () => {
    const result = await exportLists(
      { project, revision: 3 },
      recipeOf(['cut-list'], { itemDesignId: 'design-base-cabinet' }),
      deps(),
    )
    if (!result.ok || result.kind !== 'single') throw new Error('a single table should give one file')
    const [, ...rows] = parseCsv(result.file.bytes).rows
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row[4]).toBe('Base Cabinet')
      expect(row[11]).toBe('1')
    }
  })
})

describe('listsSummary', () => {
  test('names the scope and counts the rows each table would hold', () => {
    const summary = listsSummary({ project, revision: 3 }, scopeFor())
    expect(summary.statement).toBe(
      'All Floors · Existing only · Existing, Demolition, Proposed · all layers incl. Unlayered',
    )
    expect(summary.items).toBe(3)
    expect(summary.cutList).toBeGreaterThan(0)
    expect(summary.cutListCapable).toBe(true)
  })

  test('a Floor with no cabinet on it has no Cut List to offer', () => {
    const empty: Project = {
      ...project,
      existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [], rooms: [] },
    }
    const summary = listsSummary({ project: empty, revision: 1 }, scopeFor())
    expect(summary.cutListCapable).toBe(false)
    expect(summary.items).toBe(0)
    expect(summary.cutList).toBe(0)
  })
})
