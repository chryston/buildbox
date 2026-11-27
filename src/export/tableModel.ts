/**
 * A list as a page reads it (#84 §1).
 *
 * One pure function, `(snapshot, recipe, table)`, and one answer: the columns — the CSV's own keys
 * and order, with the human label, the alignment and whether the cell wraps — and the rows as
 * *display strings*. Nothing in it knows about paper, fonts or pages, which is what lets the same
 * model be asserted in a Node test, drawn by the PDF renderer, and reused by any later writer.
 *
 * Two rules hold it together.
 *
 * **The rows are the CSV's rows.** They come from `listRows`, the same call `exportLists` makes, in
 * the same order, and this file formats them and nothing else — no quantity is recomputed here, and
 * no row is added, dropped, grouped or re-sorted. Criterion 1 is a property test over exactly that
 * identity.
 *
 * **The numbers are the Project's, the codes are the reader's.** Every measured cell is printed in
 * the Project's display unit at its display precision — the same formula the inspector on screen
 * uses, so a width is one number on the screen and on the paper — and every storage code becomes the
 * plain word `export/strings` holds for it. The CSV keeps the codes and the millimetres: #19 §6 makes
 * the display rounding a property of human output, which never feeds back into a file a program
 * reads.
 */
import { compareCodePoints } from '../lib'
import type { DisplayUnit } from '../domain'
import { LENGTH_DP, formatNumber } from './csv/format'
import { TABLES } from './csv/tables'
import type { Column, ColumnKind, ListTableId } from './csv/tables'
import type { Cell, CsvRow } from './csv/write'
import { listRows } from './rows'
import { CODE_LABELS, COLUMN_LABELS, UTC_SUFFIX } from './strings'
import type { ExportSnapshot, ListsRecipe } from './types'

/** Which way a column's cells stand against their rule. */
export type CellAlign = 'left' | 'right'

/** One printed column: the CSV's key, the reader's label, and how the cell sits. */
export interface TableColumn {
  /** The key in the row object, and the header in the CSV — the same identifier in both files. */
  readonly key: string
  /** The published CSV header, kept so a reader can tie a printed column to its CSV column. */
  readonly header: string
  /** The human label, with the unit on a length column: `Width (mm)`. */
  readonly label: string
  readonly align: CellAlign
  /**
   * Whether the cell is a number.
   *
   * One flag carries two promises the renderer depends on: a numeric column is right-aligned and
   * never wrapped, because a broken number is unreadable and a right-aligned column is what lets an
   * eye add a column up.
   */
  readonly numeric: boolean
}

/** A table as it prints: its columns, and its rows as the words and digits a person reads. */
export interface TableModel {
  readonly table: ListTableId
  /** The columns, in the CSV's order — ID columns included (#84 criterion 3). */
  readonly columns: readonly TableColumn[]
  /** One string per column per row, in the CSV's row order. */
  readonly rows: readonly (readonly string[])[]
  readonly unit: DisplayUnit
  readonly precision: number
}

/**
 * The Register's three timestamps, by `table:header`.
 *
 * They are `text` columns in the CSV — an ISO instant is a string a program compares — and a
 * timestamp on paper, and #84 Why fixes the printed shape: `YYYY-MM-DD HH:mm UTC`. Naming them here
 * rather than guessing from a value's shape is what keeps a Comment title that happens to read like
 * an ISO date a title.
 */
const TIMESTAMP_COLUMNS: Readonly<Record<string, true>> = {
  'comments:created_at': true,
  'comments:updated_at': true,
  'comments:resolved_at': true,
}

/** Decimals a printed area carries: a square centimetre, and no false precision (#84 §1.2). */
const AREA_DP = 2
/** Decimals a printed angle carries: finer than anyone sets a saw. */
const ANGLE_DP = 1

/** How many millimetres one display unit is — the same table `ui/workspace/displayUnits` uses. */
const UNIT_TO_MM: Readonly<Record<DisplayUnit, number>> = { mm: 1, cm: 10, m: 1000 }

/**
 * The printed model of one table for one recipe.
 *
 * The unit and the precision come from the Project, not from the recipe: they are a Project
 * preference (#13), and #84 criterion 7 is a claim about changing that preference — the PDF numbers
 * move, the CSV bytes do not.
 *
 * @throws TypeError when the recipe names a table this build has no rows for. A file of nothing
 * but a header row is what an empty *scope* writes; a file for a table nobody derived is a bug.
 */
export function tableModel(snapshot: ExportSnapshot, recipe: ListsRecipe, table: ListTableId): TableModel {
  const spec = TABLES[table]
  const { displayUnit: unit, displayPrecision: precision } = snapshot.project.preferences
  const rows = listRows(snapshot, recipe, [table], null)[table]
  if (rows === undefined) throw new TypeError(`no rows for the "${table}" table`)
  return {
    table,
    columns: spec.columns.map((column) => columnOf(table, column, unit)),
    rows: rows.map((row) => spec.columns.map((column) => displayCell(table, column, row, unit, precision))),
    unit,
    precision,
  }
}

/** One column's printed label, alignment and wrap rule. */
function columnOf(table: ListTableId, column: Column, unit: DisplayUnit): TableColumn {
  const label = COLUMN_LABELS[table][column.header]
  if (label === undefined) {
    // A CSV column with no printed label is a column added to the contract without #84 §2 being
    // asked what it is called on paper. Printing `width_mm` would be quieter, and worse.
    throw new TypeError(`${table}: no printed label for the "${column.header}" column`)
  }
  const numeric = isNumeric(column.kind)
  return {
    key: column.key,
    header: column.header,
    // The unit belongs in the heading and nowhere else on the page: it is one fact per column, and
    // it is the same fact the title block states (#84 §2).
    label: column.kind === 'length_mm' ? `${label} (${unit})` : label,
    align: numeric ? 'right' : 'left',
    numeric,
  }
}

/** The kinds whose cells are numbers, and so right-aligned and unwrappable. */
const isNumeric = (kind: ColumnKind): boolean =>
  kind === 'length_mm' || kind === 'area_m2' || kind === 'angle_deg' || kind === 'integer'

/** One cell as the page shows it. */
function displayCell(
  table: ListTableId,
  column: Column,
  row: CsvRow,
  unit: DisplayUnit,
  precision: number,
): string {
  const value: Cell = row[column.key]
  if (value === null || value === undefined) return ''
  if (TIMESTAMP_COLUMNS[`${table}:${column.header}`] === true) {
    if (typeof value !== 'string') throw new TypeError(`${column.header}: expected a timestamp, got ${typeof value}`)
    return timestampWords(value)
  }
  switch (column.kind) {
    case 'length_mm':
      return lengthWords(number(column, value), unit, precision)
    case 'area_m2':
      // Always square metres to two decimals, whatever the Project's unit — the rule the Room
      // inspector's own field and the plan's Room label both follow.
      return (number(column, value) / 1_000_000).toFixed(AREA_DP)
    case 'angle_deg':
      return number(column, value).toFixed(ANGLE_DP)
    case 'integer':
      return formatNumber(number(column, value), 0)
    case 'enum':
      return codeWords(table, column, value)
    case 'multi': {
      if (!Array.isArray(value)) throw new TypeError(`${column.header}: expected an array of values`)
      return [...value].sort(compareCodePoints).join(';')
    }
    case 'id':
    case 'text':
      return text(column, value)
  }
}

/**
 * One measured length in the Project's unit at the Project's precision, with no suffix.
 *
 * `toFixed` and not the CSV's `formatNumber`: a printed column is read by eye down its length, so
 * `60.0` and `60.5` have to line up on the point, and the trailing zero is what puts them there.
 * This is the same formula `ui/workspace/displayUnits.formatMm` applies on screen (#84 criterion 7:
 * `600` mm prints `60.0` at cm).
 *
 * The millimetres are first taken to the three decimals the CSV itself writes. A printed page is a
 * reformatting of the file it is read beside, and must never disagree with it in the last digit: at
 * a fine display precision the raw double and the CSV's rounded text can round opposite ways across
 * a unit division, and the page would then show a number the CSV does not contain.
 */
export function lengthWords(mm: number, unit: DisplayUnit, precision: number): string {
  return (Number(formatNumber(mm, LENGTH_DP)) / UNIT_TO_MM[unit]).toFixed(precision)
}

/**
 * An ISO instant as `YYYY-MM-DD HH:mm UTC`.
 *
 * Read off the string rather than through `Date`: the stored shape is UTC by construction, and a
 * `Date` would put the host's time zone between the record and the page — the one thing this
 * formatting exists to avoid. Anything that is not that shape is printed as it was written, because
 * a Comment body or a title that merely looks like a timestamp is not this column's business, and a
 * blank cell stays blank.
 */
export function timestampWords(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso)
  return match === null ? iso : `${match[1]} ${match[2]} ${UTC_SUFFIX}`
}

/** An enum code as the plain word #84 §1.2 gives it, or the code itself when no word is declared. */
function codeWords(table: ListTableId, column: Column, value: Exclude<Cell, null>): string {
  const code = text(column, value)
  return CODE_LABELS[`${table}:${column.header}`]?.[code] ?? code
}

function text(column: Column, value: Exclude<Cell, null>): string {
  if (typeof value !== 'string') throw new TypeError(`${column.header}: expected text, got ${typeof value}`)
  return value
}

function number(column: Column, value: Exclude<Cell, null>): number {
  if (typeof value !== 'number') throw new TypeError(`${column.header}: expected a number, got ${typeof value}`)
  return value
}
