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
import type { PlanView } from '../domain'

import { sha256Hex } from '../lib'
import { commentRegisterRows, commentScopeStatement } from './comments'
import { TABLES } from './csv/tables'
import type { ListTableId, TableId } from './csv/tables'
import { writeCsv } from './csv/write'
import { fileDate } from './format'
import { hiddenInView } from './hiddenInView'
import type { HiddenInView } from './hiddenInView'
import { provenanceOf } from './provenance'
import { listRows } from './rows'
import { describeScope } from './scope'
import { listFileName, listsArchiveName, MEDIA_TYPE } from './slug'
import { tableModel } from './tableModel'
import { writeTablePdf } from './tablePdf'
import { manifestBytes, manifestOf, zipOf } from './zip'
import type { ManifestFile } from './zip'
import type { ExportDeps, ExportFailure, ExportFile, ExportResult, ExportSnapshot, ListFormat, ListsRecipe } from './types'

/**
 * What shape one table takes in this recipe.
 *
 * Absent is `csv`, which is what every recipe written before #84 asked for, and what a recipe that
 * says nothing about a table still means: the CSV is the rows, and the printed table is a rendering
 * of them a person has to ask for.
 */
function formatOf(recipe: ListsRecipe, table: TableId): ListFormat {
  return isListTable(table) ? recipe.formats?.[table] ?? 'csv' : 'csv'
}

/** The tables with a column layout, and so with a printed form to ask for. */
const LIST_TABLES: Readonly<Partial<Record<TableId, true>>> = { items: true, 'cut-list': true, comments: true }

function isListTable(table: TableId): table is ListTableId {
  return LIST_TABLES[table] === true
}

/** What a CSV is, as far as a browser is concerned. */
export const CSV_MEDIA_TYPE = 'text/csv'

/** What the Lists tab shows about a scope before anything is downloaded. */
export interface ListsSummary {
  /** The plain-words scope statement, updated live. */
  readonly statement: string
  /**
   * The Comment Register's own scope line (#83 §4.2): Floors · Design Options · status. It is not
   * `statement`, because Renovation States and Drawing Layers filter no Comment, and a sentence
   * naming them would promise a filter the Register does not apply.
   */
  readonly commentStatement: string
  /** Rows each table would hold for this scope; `0` is what the dialog calls `0 rows`. */
  readonly rows: Readonly<Record<TableId, number>>
  /** Whether a design with a cut list is in scope at all, which decides the Cut List checkbox. */
  readonly cutListCapable: boolean
  /**
   * How many of those rows the originating saved view hides, and who they are (#73 §2). The notice
   * is informational: a Data export never inherits view hiding, so these rows are in the file and
   * the person is told rather than stopped.
   */
  readonly hiddenInView: HiddenInView
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
export function listsSummary(
  snapshot: ExportSnapshot,
  scope: QuantityScope,
  view: PlanView | null,
  includeResolvedComments = false,
): ListsSummary {
  const counted = quantities(snapshot.project, snapshot.revision, scope)
  // The five #68 tables are derived here for their row counts alone: a count never depends on the
  // sentence a Warnings row carries, so no copy is rendered and no `ui` module is reached.
  const at = deriveTables(snapshot.project, scope, { warningMessages: null })
  return {
    statement: describeScope(scope, snapshot.project),
    commentStatement: commentScopeStatement(snapshot.project, scope, includeResolvedComments),
    rows: {
      items: counted.items.length,
      'cut-list': counted.cuts.length,
      rooms: at.rooms.length,
      walls: at.walls.length,
      openings: at.openings.length,
      beams: at.beams.length,
      skirting: at.skirting.length,
      services: at.services.length,
      'placed-items': at.placedItems.length,
      warnings: at.warnings.length,
      comments: commentRegisterRows(snapshot.project, scope, includeResolvedComments).length,
    },
    cutListCapable: cutListCapable(snapshot.project, snapshot.revision, scope),
    // #73 §2: the scope decides the rows and the view decides what a person can see, so the dialog
    // needs to know how many of these rows the view is hiding. It is a count of rows the writer is
    // about to write, which is why it is computed here and not guessed from the chips.
    hiddenInView: hiddenInView(snapshot.project, scope, view),
  }
}

/** The tables in the contract's order, without repeats: a recipe is data, and data repeats. */
/** The tables in contract order, which is also the order `exportLists` writes its files in. */
export function orderedTables(tables: readonly TableId[]): TableId[] {
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
    'clock' | 'buildboxVersion' | 'contractVersion' | 'unsavedChanges' | 'onProgress' | 'warningMessages' | 'font' | 'projectName'
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

  // The rows come from the one source the printed table reads too (#84 §1.3), so a PDF and a CSV of
  // one recipe cannot disagree about a row, a cell or an order. A `TableId` added to the contract
  // before its rows are wired up there fails by name: the `id === 'items' ? items : cuts` the
  // original replaced would have written Cut List rows into a `rooms.csv` the moment a third table
  // appeared (#68).
  const rowsOf = listRows(snapshot, recipe, tables, deps.warningMessages ?? null)
  // The scope in plain words is already computed for the manifest and the file's own metadata; the
  // title block prints that same sentence, so the page and the record cannot disagree about it.
  const statement = describeScope(recipe.scope, snapshot.project)
  const commentStatement = commentScopeStatement(snapshot.project, recipe.scope, recipe.includeResolvedComments === true)
  const pageSize = recipe.pageSize ?? 'A4'
  // A printed table sets text and so needs the face; a CSV never has. A recipe that asks for no PDF
  // is therefore not made to fail for want of one.
  const formats = new Map(tables.map((id) => [id, formatOf(recipe, id)]))
  const outputs = tables.reduce((total, id) => total + (formats.get(id) === 'both' ? 2 : 1), 0)
  const files: ExportFile[] = []
  const entries: ManifestFile[] = []
  const failures: ExportFailure[] = []
  const missingGlyphs: string[] = []
  let done = 0
  for (const id of tables) {
    const rows = rowsOf[id]
    if (rows === undefined) throw new TypeError(`exportLists has no rows for the "${id}" table`)
    const format = formats.get(id)!
    if (format !== 'pdf') {
      const fileName = listFileName(name, id, date)
      deps.onProgress?.({ stage: 'file', done, total: outputs, label: fileName })
      done += 1
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
    if (format !== 'csv' && isListTable(id)) {
      const fileName = listFileName(name, id, date, 'pdf')
      deps.onProgress?.({ stage: 'file', done, total: outputs, label: fileName })
      done += 1
      if (deps.font === undefined) {
        failures.push({ output: fileName, reason: 'no-font' })
        continue
      }
      const printed = await writeTablePdf({
        model: tableModel(snapshot, recipe, id),
        scopeStatement: id === 'comments' ? commentStatement : statement,
        projectName: deps.projectName ?? '',
        provenance,
        fontBytes: deps.font.bytes,
        pageSize,
        clock: deps.clock,
      })
      for (const glyph of printed.missingGlyphs) {
        if (!missingGlyphs.includes(glyph.text)) missingGlyphs.push(glyph.text)
      }
      files.push({ name: fileName, mediaType: MEDIA_TYPE.pdf, bytes: printed.bytes })
      entries.push({
        path: fileName,
        kind: 'list',
        format: 'pdf',
        media_type: MEDIA_TYPE.pdf,
        bytes: printed.bytes.length,
        sha256: await sha256Hex(printed.bytes),
        contract_version: provenance.contract_version,
        warnings: [],
      })
    }
  }
  // All-or-nothing: one output that could not be written means the download does not happen at all,
  // and the dialog names the output and the reason (#84 §3.7).
  if (failures.length > 0) return { ok: false, failures }

  if (files.length === 1) return { ok: true, kind: 'single', file: files[0]!, missingGlyphs }

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
    missingGlyphs,
    manifest: manifestFile,
    archive: {
      name: archive,
      mediaType: 'application/zip',
      // The manifest leads the archive (#85 §2.1).
      bytes: zipOf([manifestFile, ...files]),
    },
  }
}
