/**
 * The CSV writer: a table and its rows, as bytes (#62 §1, export contract §6).
 *
 * RFC 4180 with three additions the contract makes for a spreadsheet reader rather than a
 * parser: a UTF-8 BOM, so Excel opens a design named `櫥櫃 600` as the words it is instead of
 * mojibake; CRLF line endings, which is what RFC 4180 says and what Excel expects; and exactly
 * one header row, always — an empty scope writes a header-only file rather than a zero-byte one,
 * because a file that is not even a table is the thing that makes someone doubt the rest.
 *
 * Nothing here reads a Project, a clock or a display preference. A row is a record of cells and a
 * `TableSpec` says which column each one is and what kind it is, so the same rows written twice
 * are the same bytes, and the same rows written by a Project set to metres are the same bytes as
 * one set to millimetres. That independence is criterion 2, and it holds because this file has no
 * way to ask what unit the Project displays.
 *
 * Every later table — the element tables, the Warnings List, the Comment Register — arrives
 * through this one function with its own `TableSpec`.
 */

import { compareCodePoints } from '../../lib'
import { ANGLE_DP, AREA_DP, INTEGER_DP, LENGTH_DP, formatNumber, neutralise, quote } from './format'
import { headerLine, type Column, type ColumnKind, type TableSpec } from './tables'

/** The UTF-8 byte order mark, so Excel reads the file as UTF-8 and not as its own default. */
export const CSV_BOM = '\uFEFF'

/** RFC 4180's line terminator, and the only one this writer emits. */
const CRLF = '\r\n'

/**
 * One cell.
 *
 * `null` — and a key the row leaves out altogether — is a not-applicable cell, which the contract
 * writes empty rather than `n/a` or `0`. A `multi` cell arrives as the values themselves: the
 * writer joins them with `;` and sorts them, because that is a rule about the file format and not
 * about any one table, and two row builders getting it differently would be two file formats.
 */
export type Cell = string | number | readonly string[] | null

/** A row: a value per column key. Extra keys are a bug and throw; absent ones write empty cells. */
export interface CsvRow {
  readonly [key: string]: Cell
}

/**
 * The whole file: BOM, one header row, one line per row, each line ended CRLF.
 *
 * `rows` is written in the order given — the caller owns the sort, because the sort is a rule
 * about the table and not about the format.
 *
 * @throws TypeError when a row holds a key no column declares, a kind meets the wrong type of
 * value, or a number is not finite. Both are programming errors, and the export contract §11
 * turns a thrown writer into an output failure that names the file.
 */
export function writeCsv(spec: TableSpec, rows: readonly CsvRow[]): Uint8Array {
  const keys = new Set(spec.columns.map((column) => column.key))
  const lines: string[] = [headerLine(spec)]
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.has(key)) {
        throw new TypeError(`${spec.id}: no column ${key} in table ${spec.id}`)
      }
    }
    lines.push(spec.columns.map((column) => cell(column, row[column.key])).join(','))
  }
  return new TextEncoder().encode(`${CSV_BOM}${lines.join(CRLF)}${CRLF}`)
}

/**
 * One cell as its column's kind says.
 *
 * The header row goes through none of this: headers are declared constants, never user text, so
 * they are written verbatim and a stray `=` in one would be a bug in `tables.ts` rather than a
 * neutralised cell.
 */
function cell(column: Column, value: Cell): string {
  if (value === null || value === undefined) return ''
  const kind: ColumnKind = column.kind
  switch (kind) {
    case 'text':
      return quote(neutralise(text(column, value)))
    case 'id':
    case 'enum':
      // Machine-readable: verbatim, so a reader's `=` still matches. A code is chosen by the
      // program, not typed by a user, so §6's injection rule has nothing to guard here.
      return quote(text(column, value))
    case 'multi': {
      if (!Array.isArray(value)) throw new TypeError(`${column.header}: expected an array of values`)
      const sorted = [...value].sort(compareCodePoints)
      return quote(sorted.join(';'))
    }
    case 'length_mm':
      return formatNumber(number(column, value), LENGTH_DP)
    case 'area_m2':
      return formatNumber(number(column, value), AREA_DP)
    case 'angle_deg':
      return formatNumber(number(column, value), ANGLE_DP)
    case 'integer':
      return formatNumber(number(column, value), INTEGER_DP)
  }
}

function text(column: Column, value: Exclude<Cell, null>): string {
  if (typeof value !== 'string') throw new TypeError(`${column.header}: expected text, got ${typeof value}`)
  return value
}

function number(column: Column, value: Exclude<Cell, null>): number {
  if (typeof value !== 'number') throw new TypeError(`${column.header}: expected a number, got ${typeof value}`)
  return value
}
