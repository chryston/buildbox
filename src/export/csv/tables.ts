/**
 * The table contracts, in one file, in contract order (#62 §5, export contract §7).
 *
 * This is the only place a CSV header is written. A header is a published identifier: the
 * contract allows a column to be *appended* in a minor version and makes a rename, a reorder or
 * a removal a major version with a release note (§10), so the list below is an API surface that
 * outlives every row builder. `tables.test.ts` reads the rest of `src` and fails if one of these
 * strings is spelled anywhere else, and the golden files under `fixtures/export/golden/` hold
 * the same bytes again for a reviewer who never opens TypeScript.
 *
 * Headers are stable English identifiers, never translated and never derived from a UI string
 * (§10) — the dialog's copy lives in `ui/strings` and `export/strings` and cannot reach a file.
 * None of them contains the word the export contract §12 bans from a header.
 *
 * Each column also names the **key** its row object carries. The keys are the row shapes
 * `derive` returns, so a table's columns and the rows written into them are checked against each
 * other by the compiler rather than by a mapping function that could drop one in silence.
 */

/**
 * The CSV contract this build writes, and the version every provenance block and manifest
 * carries. One constant for the whole export contract (§10): a drawing and a CSV exported in the
 * same minute agree because they read the same value, not because two literals match.
 */
export const CSV_CONTRACT_VERSION = '1.0'

/**
 * How a cell is written.
 *
 * `text` is the only kind that is neutralised against formula injection, because it is the only
 * kind that carries words a user typed. `id`, `enum` and `multi` are machine-readable codes a
 * reader compares byte for byte; `integer` and the three measured kinds go through the number
 * formatter, which is never prefixed.
 */
export type ColumnKind =
  | 'text'
  | 'length_mm'
  | 'area_m2'
  | 'angle_deg'
  | 'integer'
  | 'enum'
  | 'id'
  | 'multi'

/** One column: the key in the row object, the header in the file, and how to write the cell. */
export interface Column {
  readonly key: string
  readonly header: string
  readonly kind: ColumnKind
}

/** A table: its name in a file name, and its columns in contract order. */
export interface TableSpec {
  /** One of `TableId` for a table the contract names; a test may describe a table of its own. */
  readonly id: string
  readonly columns: readonly Column[]
}

/** The tables this build writes. Later issues add rows here, and nowhere else. */
export type TableId = 'items' | 'cut-list'

/**
 * A table's columns, in contract order: the header line supplies the file's words, the pairs
 * supply each column's row key and cell kind.
 */
function columnsFor(header: string, columns: readonly (readonly [key: string, kind: ColumnKind])[]): Column[] {
  const headers = header.split(',')
  // A header and a column list of different lengths is a table that lost a column at one end,
  // which the contract calls a major version — so it throws rather than write a file whose first
  // line and rows describe different tables.
  if (headers.length !== columns.length) {
    throw new TypeError(`${String(headers.length)} headers for ${String(columns.length)} columns: ${header}`)
  }
  return columns.map(([key, kind], index) => ({ key, header: headers[index]!, kind }))
}

/**
 * The Item List header, one published identifier (#62 §5, export contract §7).
 *
 * It is written as the line the file starts with, because that is the thing the contract's
 * versioning rule is about — append a column in a minor version, rename or reorder only in a
 * major — and because a reviewer should be able to grep for it. `tables.test.ts` fails if this
 * line is spelled in any other non-test file, and the golden under `fixtures/export/golden/`
 * holds the same bytes for a reviewer who never opens TypeScript.
 *
 * Width, depth and height are the Item Design's *local* extents, never the placement's bounding
 * box, so a design turned 90° on plan still reports the width the carpenter cuts.
 */
const ITEMS_HEADER = 'floor_id,floor,design_option_id,design_option,renovation_state,item_design_id,item_design,count,width_mm,depth_mm,height_mm'

export const ITEMS_TABLE: TableSpec = {
  id: 'items',
  columns: columnsFor(ITEMS_HEADER, [
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum'],
    ['itemDesignId', 'id'],
    ['itemDesign', 'text'],
    ['count', 'integer'],
    ['widthMm', 'length_mm'],
    ['depthMm', 'length_mm'],
    ['heightMm', 'length_mm'],
  ]),
}

/**
 * The Cut List header (export contract §7).
 *
 * There are no legacy-parity columns. The export contract §10 asked for frozen columns for edge
 * banding, grain and cutouts; the architecture's inventory (§8, §15.2) found the legacy cut list
 * emits none of those, so the list below is the whole of v1.0 — the same decision the manifest
 * took.
 */
const CUT_LIST_HEADER =
  'design_option_id,design_option,renovation_state,item_design_id,item_design,part,length_mm,width_mm,thickness_mm,material,qty_per_item,item_count,qty_in_scope,notes'

export const CUT_LIST_TABLE: TableSpec = {
  id: 'cut-list',
  columns: columnsFor(CUT_LIST_HEADER, [
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum'],
    ['itemDesignId', 'id'],
    ['itemDesign', 'text'],
    ['part', 'text'],
    ['lengthMm', 'length_mm'],
    ['widthMm', 'length_mm'],
    ['thicknessMm', 'length_mm'],
    ['material', 'enum'],
    ['qtyPerItem', 'integer'],
    ['itemCount', 'integer'],
    ['qtyInScope', 'integer'],
    ['notes', 'text'],
  ]),
}

/** Every table by name, in the order a ZIP writes them. */
export const TABLES: Readonly<Record<TableId, TableSpec>> = {
  items: ITEMS_TABLE,
  'cut-list': CUT_LIST_TABLE,
}

/** The header row, exactly as the file's first line reads. */
export function headerLine(spec: TableSpec): string {
  return spec.columns.map((column) => column.header).join(',')
}
