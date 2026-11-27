/**
 * The rows one recipe writes, for every table it names (#84 §1.3).
 *
 * This is the row source. `exportLists` takes its CSV cells from here and `tableModel` takes its
 * printed strings from here, which is the only way #84 criterion 1 — the PDF's rows *are* the CSV's
 * rows — can be true rather than merely very likely: there is no second derivation to drift, because
 * there is one derivation and two writers.
 *
 * Nothing here formats anything. A row is the record `derive` returned, keyed by the keys the
 * `TableSpec` names, at the contract's own precision and in the contract's own units; the CSV writer
 * rounds it one way and the table model formats it the other. That is also why a Project switched
 * from mm to cm leaves every CSV byte-identical while its PDF prints `60.0` (#84 criterion 7): the
 * unit is a question about the page, and this file is not asked.
 *
 * The order is the file's order. `quantities` sorts the Item List and the Cut List, the Register
 * sorts itself by reference, and neither is re-sorted here — a caller that sorted would be a second
 * answer to a question the derivation already settled.
 */
import { quantities, tables as deriveTables } from '../derive'
import { commentRegisterRows } from './comments'
import type { CsvRow } from './csv/write'
import type { TableId } from './csv/tables'
import type { ExportSnapshot, ListsRecipe } from './types'

/**
 * The rows of each named table, keyed by table.
 *
 * `warningMessages` is required exactly when the Warnings List is named — an empty `message` column
 * would be a Warnings List that says nothing is wrong — and ignored otherwise. A table this build
 * has no rows for is absent from the answer rather than empty in it, so a caller cannot write a file
 * of nothing and call it a table.
 */
export function listRows(
  snapshot: ExportSnapshot,
  recipe: ListsRecipe,
  tables: readonly TableId[],
  warningMessages: Readonly<Record<string, string>> | null = null,
): Partial<Record<TableId, readonly CsvRow[]>> {
  const rows: Partial<Record<TableId, readonly CsvRow[]>> = {}
  if (tables.includes('items') || tables.includes('cut-list')) {
    const counted = quantities(snapshot.project, snapshot.revision, recipe.scope)
    if (tables.includes('items')) rows.items = counted.items
    if (tables.includes('cut-list')) rows['cut-list'] = counted.cuts
  }
  if (tables.includes('comments')) {
    rows.comments = commentRegisterRows(snapshot.project, recipe.scope, recipe.includeResolvedComments === true)
  }
  // The five #68 tables and the Warnings List are derived in one call: they share the model walk,
  // and a per-table call would walk the Project once per table for a recipe that named all eight.
  if (tables.some((id) => id !== 'items' && id !== 'cut-list' && id !== 'comments')) {
    const at = deriveTables(snapshot.project, recipe.scope, { warningMessages })
    rows.rooms = at.rooms
    rows.walls = at.walls
    rows.openings = at.openings
    rows.beams = at.beams
    rows.skirting = at.skirting
    rows.services = at.services
    rows['placed-items'] = at.placedItems
    rows.warnings = at.warnings
  }
  return rows
}
