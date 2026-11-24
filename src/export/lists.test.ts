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
import { warningMessages } from '../derive'
import type { QuantityScope } from '../derive'
import { basicProject } from '../derive/testing'
import type { Project, Wall } from '../domain'
import { CUT_LIST_TABLE, ITEMS_TABLE, TABLES, headerLine } from './csv/tables'
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

const wall = (id: string, ref: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
  id,
  ref,
  floorId: 'floor-main',
  line: { kind: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

/** The basic Project with two Walls crossing each other: Walls rows and one warning to write. */
const crossing: Project = {
  ...project,
  existingModel: {
    ...project.existingModel,
    // Lift the Placed Items off y = 0, where these Walls run: the #76 item-into-wall producer
    // would otherwise answer beside the one wall_crossing this fixture is about.
    placedItems: project.existingModel.placedItems.map((placed) => ({ ...placed, translation: { x: placed.translation.x, y: placed.translation.y + 2000 } })),
    walls: [wall('wall-a', 'W-A', 0, 0, 4000, 0), wall('wall-b', 'W-B', 2000, -500, 2000, 500)],
  },
}

/** Sentences a reader could not mistake for the app's: each names the key it was built from. */
const sentences = (at: Project, scope: QuantityScope): Record<string, string> =>
  warningMessages(at, scope, (messageKey) => `sentence:${messageKey}`)

const depsAt = (at: Project, scope: QuantityScope) => ({
  ...deps(),
  warningMessages: sentences(at, scope),
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

/**
 * The five tables of #68 through the packaging #62 built: the name on each file, the ZIP that holds
 * them together, the header a narrowed scope still writes, and the fact that none of it is written
 * into the Project. What the rows themselves say is `src/test/tablesGolden.test.ts`'s business.
 */
describe('the five tables of #68', () => {
  const NEW = ['rooms', 'walls', 'openings', 'placed-items', 'warnings'] as const

  test('each table alone is a CSV named after its own contract id (#68 criterion 7)', async () => {
    for (const id of NEW) {
      const recipe = recipeOf([id])
      const result = await exportLists({ project: crossing, revision: 3 }, recipe, depsAt(crossing, recipe.scope))
      if (!result.ok || result.kind !== 'single') throw new Error(`"${id}" alone should give one file`)
      expect(result.file.name).toBe(`Maple-Street-Kitchen_${id}_20261120.csv`)
      expect(result.file.mediaType).toBe('text/csv')
      const parsed = parseCsv(result.file.bytes)
      expect(parsed.bom).toBe(true)
      expect(parsed.rows[0]).toEqual(headerLine(TABLES[id]).split(','))
    }
  })

  test('the Warnings List writes the sentence it was given, never its own English (#68 criterion 5)', async () => {
    const recipe = recipeOf(['warnings'])
    const result = await exportLists({ project: crossing, revision: 3 }, recipe, depsAt(crossing, recipe.scope))
    if (!result.ok || result.kind !== 'single') throw new Error('one table should give one file')
    const [, ...rows] = parseCsv(result.file.bytes).rows
    expect(rows).toHaveLength(1)
    // `wall_crossing` is the warning two Walls crossing each other raise, and the column holds the
    // caller's sentence for it — the strip's copy, which `export` may not read and may not rewrite.
    expect(rows[0]?.[5]).toBe('wall_crossing')
    expect(rows[0]?.[11]).toBe('sentence:wall_crossing')
    expect(rows[0]?.[10]).toBe('100')
  })

  test('a Warnings List nobody gave sentences to is refused, not written with an empty column', async () => {
    await expect(exportLists({ project: crossing, revision: 3 }, recipeOf(['warnings']), deps())).rejects.toThrow(
      /warningMessages/,
    )
  })

  test('every table checked is one ZIP of seven CSVs and the manifest, in the contract order', async () => {
    const recipe = recipeOf(['warnings', 'items', 'rooms', 'cut-list', 'walls', 'openings', 'placed-items'])
    const result = await exportLists({ project: crossing, revision: 3 }, recipe, depsAt(crossing, recipe.scope))
    if (!result.ok || result.kind !== 'archive') throw new Error('seven tables should give an archive')
    expect(result.archive.name).toBe('Maple-Street-Kitchen_lists_20261120.zip')
    const entries = entriesOf(result.archive.bytes)
    // The recipe's order is the dialog's; the ZIP's is the contract's, whatever was clicked first.
    expect([...entries.keys()]).toEqual([
      'Maple-Street-Kitchen_items_20261120.csv',
      'Maple-Street-Kitchen_cut-list_20261120.csv',
      'Maple-Street-Kitchen_rooms_20261120.csv',
      'Maple-Street-Kitchen_walls_20261120.csv',
      'Maple-Street-Kitchen_openings_20261120.csv',
      'Maple-Street-Kitchen_placed-items_20261120.csv',
      'Maple-Street-Kitchen_warnings_20261120.csv',
      'manifest.json',
    ])
    const manifest = manifestOf(result.archive.bytes)
    expect(manifest.files.map((file) => [file.path, file.kind])).toEqual([
      ...[...entries.keys()].filter((name) => name !== 'manifest.json').map((name) => [name, 'list']),
      ['manifest.json', 'manifest'],
    ])
    expect(manifest.recipe).toEqual(recipe)
  })

  test('a scope with nothing in it writes a header and nothing else, beside every table checked', async () => {
    // #68 criterion 7: an empty table is an answer, not a failure, so the file exists and says so.
    // The Project has no warning to ignore the narrowed scope with — the Warnings List is scoped by
    // Floor and Design Option only, so no emptying of States or Layers would ever empty it.
    const scope = scopeFor({ renovationStates: [] })
    const recipe: ListsRecipe = { tables: [...NEW], scope }
    const result = await exportLists({ project, revision: 3 }, recipe, depsAt(project, scope))
    if (!result.ok || result.kind !== 'archive') throw new Error('five tables should give an archive')
    const entries = entriesOf(result.archive.bytes)
    for (const id of NEW) {
      const bytes = entries.get(`Maple-Street-Kitchen_${id}_20261120.csv`)
      if (bytes === undefined) throw new Error(`"${id}" was left out of the archive`)
      // `ignoreBOM` so the byte order mark is part of what is compared: it is the first thing a
      // spreadsheet reads and the reason Excel opens the file as UTF-8 at all.
      expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(`\uFEFF${headerLine(TABLES[id])}\r\n`)
    }
  })

  test('exporting the five tables changes nothing about the Project or its revision (#68 criterion 10)', async () => {
    // Frozen all the way down: a writer that tried to normalise a Wall, sort an array in place or
    // stamp a revision would throw here rather than leave a Project the session never intended.
    const frozen = JSON.parse(JSON.stringify(crossing)) as Project
    const deepFreeze = (value: unknown): unknown => {
      if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child)
        return Object.freeze(value)
      }
      return value
    }
    deepFreeze(frozen)
    const recipe = recipeOf(['items', 'cut-list', ...NEW])
    const result = await exportLists({ project: frozen, revision: 12 }, recipe, depsAt(frozen, recipe.scope))
    expect(result.ok).toBe(true)
    expect(frozen).toEqual(crossing)
    // The snapshot is what the session handed over, unchanged: no revision bump, no new history.
    expect(recipe.scope).toEqual(scopeFor())
  })
})

describe('listsSummary', () => {
  test('names the scope and counts the rows each table would hold', () => {
    const summary = listsSummary({ project, revision: 3 }, scopeFor(), null)
    expect(summary.statement).toBe(
      'All Floors · Existing Model only · Existing, Demolition, Proposed · all layers incl. Unlayered',
    )
    expect(summary.rows.items).toBe(3)
    expect(summary.rows['cut-list']).toBeGreaterThan(0)
    expect(summary.cutListCapable).toBe(true)
  })

  test('a Floor with no cabinet on it has no Cut List to offer', () => {
    const empty: Project = {
      ...project,
      existingModel: { placedItems: [], walls: [], wallJunctions: [], openings: [], rooms: [], beams: [] },
    }
    const summary = listsSummary({ project: empty, revision: 1 }, scopeFor(), null)
    expect(summary.cutListCapable).toBe(false)
    expect(summary.rows.items).toBe(0)
    expect(summary.rows['cut-list']).toBe(0)
  })

  test('counts the five tables of #68 beside the two that were here first', () => {
    const summary = listsSummary({ project: crossing, revision: 1 }, scopeFor(), null)
    expect({ ...summary.rows, 'cut-list': 0 }).toEqual({
      items: 3,
      // Every placement is counted, cabinet or not — which is why this is not the Items table.
      'placed-items': 4,
      'cut-list': 0,
      rooms: 0,
      walls: 2,
      openings: 0,
      beams: 0,
      warnings: 1,
    })
    expect(summary.rows['cut-list']).toBeGreaterThan(0)
    // Counting needs no copy: the sentences are rendered for a file, never for a number.
    expect(listsSummary({ project: crossing, revision: 1 }, scopeFor({ floorIds: ['floor-mezz'] }), null).rows.walls).toBe(
      0,
    )
  })
})
