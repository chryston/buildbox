/**
 * The two lists as files (#62 §10, export contract §9).
 *
 * `derive` answers a scope with rows and `csv/` turns rows into bytes; this file is the last step,
 * which is where a scope becomes something a reader can open: one table is a bare CSV named after
 * the Project and the day, two or more are a ZIP with a `manifest.json` that says which table is
 * which, how many bytes each holds, and which version of the column contract wrote them.
 *
 * The rule the shape follows is the one #61 set: `export` owns the bytes. The dialog describes a
 * recipe and the app hands the bytes to the browser; neither formats a cell, names a file, or
 * digests an entry. That is also why the same recipe run twice writes the same bytes — criterion
 * 10 — and why a ZIP written on a Worker and one written on the main thread are the same file.
 *
 * A single CSV carries no provenance: there is nowhere in a bare table of numbers to put the
 * Project ID, the revision or the recipe without adding a row the reader would have to delete
 * before using the file. The dialog says so before the download (export contract §9), and two
 * tables in one ZIP is what buys the manifest.
 */
import { effectiveFloor, quantities, tables as deriveTables } from '../derive'
import type { QuantityScope } from '../derive'

import { sha256Hex } from '../lib'
import { TABLES } from './csv/tables'
import type { TableId } from './csv/tables'
import { writeCsv } from './csv/write'
import type { CsvRow } from './csv/write'
import { fileDate } from './format'
import { provenanceOf } from './provenance'
import { describeScope } from './scope'
import { listFileName, listsArchiveName } from './slug'
import { manifestBytes, manifestOf, zipOf } from './zip'
import type { ManifestFile } from './zip'
import type { ExportDeps, ExportFile, ExportResult, ExportSnapshot, ListsRecipe } from './types'

/** What a CSV is, as far as a browser is concerned. */
export const CSV_MEDIA_TYPE = 'text/csv'

/** What the Lists tab shows about a scope before anything is downloaded. */
export interface ListsSummary {
  /** The plain-words scope statement, updated live. */
  readonly statement: string
  /** Rows each table would hold for this scope; `0` is what the dialog calls `0 rows`. */
  readonly rows: Readonly<Record<TableId, number>>
  /** Whether a design with a cut list is in scope at all, which decides the Cut List checkbox. */
  readonly cutListCapable: boolean
}

/**
 * Whether a cut-list-capable design is in scope.
 *
 * A cabinet, and nothing else, has parts to cut today (architecture §15.2). The question is asked
 * of the placements rather than of the rows: a cabinet placed in a scope whose Renovation States
 * were narrowed to nothing still has a cut list, and the dialog should offer the table and show
 * `0 rows` rather than claim there is no cabinet there.
 */
function cutListCapable(project: ExportSnapshot['project'], revision: number, scope: QuantityScope): boolean {
  const optionIds: readonly (string | null)[] =
    scope.designOptionIds === 'existing-only' ? [null] : scope.designOptionIds
  return optionIds.some((optionId) =>
    scope.floorIds.some((floorId) =>
      effectiveFloor(project, revision, floorId, optionId).placements.some((placement) => placement.kind === 'cabinet'),
    ),
  )
}

/** The scope as the dialog reads it, with the row counts beside each table. */
export function listsSummary(snapshot: ExportSnapshot, scope: QuantityScope): ListsSummary {
  const counted = quantities(snapshot.project, snapshot.revision, scope)
  // The five #68 tables are derived here for their row counts alone: a count never depends on the
  // sentence a Warnings row carries, so no copy is rendered and no `ui` module is reached.
  const at = deriveTables(snapshot.project, scope, { warningMessages: null })
  return {
    statement: describeScope(scope, snapshot.project),
    rows: {
      items: counted.items.length,
      'cut-list': counted.cuts.length,
      rooms: at.rooms.length,
      walls: at.walls.length,
      openings: at.openings.length,
      'placed-items': at.placedItems.length,
      warnings: at.warnings.length,
    },
    cutListCapable: cutListCapable(snapshot.project, snapshot.revision, scope),
  }
}

/** The tables in the contract's order, without repeats: a recipe is data, and data repeats. */
function orderedTables(tables: readonly TableId[]): TableId[] {
  return (Object.keys(TABLES) as TableId[]).filter((id) => tables.includes(id))
}

/**
 * The lists, as files.
 *
 * All-or-nothing in the same shape #61's `exportFiles` answers with: either every table was
 * written — one bare CSV, or an archive with its manifest — or nothing was, and `failures` says
 * which output and why. A CSV writer that cannot write a row throws rather than skipping it, so
 * the only failure this can report is a recipe that named no table at all.
 */
export async function exportLists(
  snapshot: ExportSnapshot,
  recipe: ListsRecipe,
  deps: Pick<
    ExportDeps,
    'clock' | 'buildboxVersion' | 'contractVersion' | 'unsavedChanges' | 'onProgress' | 'warningMessages'
  >,
): Promise<ExportResult> {
  const provenance = provenanceOf(snapshot, recipe, deps)
  const date = fileDate(deps.clock.localDate())
  const tables = orderedTables(recipe.tables)
  const name = snapshot.project.meta.name
  if (tables.length === 0) {
    return { ok: false, failures: [{ output: name, reason: 'empty-tables' }] }
  }
  if (tables.includes('warnings') && deps.warningMessages === undefined) {
    // An empty `message` column would be a Warnings List that says nothing is wrong.
    throw new TypeError('exportLists needs deps.warningMessages to write the Warnings List')
  }

  const counted = quantities(snapshot.project, snapshot.revision, recipe.scope)
  // The tables this function can write, by name. A `TableId` added to the contract before its rows
  // are wired up here fails by name: the `id === 'items' ? items : cuts` this replaces would have
  // written Cut List rows into a `rooms.csv` the moment a third table appeared (#68).
  const rowsOf: Partial<Record<TableId, readonly CsvRow[]>> = { items: counted.items, 'cut-list': counted.cuts }
  if (tables.some((id) => id !== 'items' && id !== 'cut-list')) {
    const at = deriveTables(snapshot.project, recipe.scope, { warningMessages: deps.warningMessages ?? null })
    rowsOf.rooms = at.rooms
    rowsOf.walls = at.walls
    rowsOf.openings = at.openings
    rowsOf['placed-items'] = at.placedItems
    rowsOf.warnings = at.warnings
  }
  const files: ExportFile[] = []
  const entries: ManifestFile[] = []
  for (const [index, id] of tables.entries()) {
    const rows = rowsOf[id]
    if (rows === undefined) throw new TypeError(`exportLists has no rows for the "${id}" table`)
    const fileName = listFileName(name, id, date)
    deps.onProgress?.({
      stage: 'file',
      done: index,
      total: tables.length,
      label: fileName,
    })
    const bytes = writeCsv(TABLES[id], rows)
    files.push({ name: fileName, mediaType: CSV_MEDIA_TYPE, bytes })
    entries.push({
      path: fileName,
      kind: 'list',
      format: 'csv',
      media_type: CSV_MEDIA_TYPE,
      bytes: bytes.length,
      sha256: await sha256Hex(bytes),
      contract_version: provenance.contract_version,
      warnings: [],
    })
  }

  if (files.length === 1) return { ok: true, kind: 'single', file: files[0]!, missingGlyphs: [] }

  const manifestFile: ExportFile = {
    name: 'manifest.json',
    mediaType: 'application/json',
    bytes: manifestBytes(
      await manifestOf(snapshot, recipe, provenance, [
        ...entries,
        {
          path: 'manifest.json',
          kind: 'manifest',
          format: 'json',
          media_type: 'application/json',
          contract_version: provenance.contract_version,
          warnings: [],
        },
      ]),
    ),
  }
  const archive = listsArchiveName(name, date)
  deps.onProgress?.({
    stage: 'archive',
    done: tables.length,
    total: tables.length,
    label: archive,
  })
  return {
    ok: true,
    kind: 'archive',
    files,
    missingGlyphs: [],
    manifest: manifestFile,
    archive: {
      name: archive,
      mediaType: 'application/zip',
      bytes: zipOf([...files, manifestFile]),
    },
  }
}
