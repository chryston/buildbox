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

/** A column of a table: the row's key, the file's header, the kind of its cell. */
const col = (key: string, header: string, kind: ColumnKind): Column => ({ key, header, kind })

/**
 * The Item List: Placed Items grouped by Item Design (export contract §7).
 *
 * Width, depth and height are the Item Design's *local* extents, never the placement's bounding
 * box, so a design turned 90° on plan still reports the width the carpenter cuts.
 */
export const ITEMS_TABLE: TableSpec = {
  id: 'items',
  columns: [
    col('floorId', 'floor_id', 'id'),
    col('floor', 'floor', 'text'),
    col('designOptionId', 'design_option_id', 'id'),
    col('designOption', 'design_option', 'text'),
    col('renovationState', 'renovation_state', 'enum'),
    col('itemDesignId', 'item_design_id', 'id'),
    col('itemDesign', 'item_design', 'text'),
    col('count', 'count', 'integer'),
    col('widthMm', 'width_mm', 'length_mm'),
    col('depthMm', 'depth_mm', 'length_mm'),
    col('heightMm', 'height_mm', 'length_mm'),
  ],
}

/**
 * The Cut List: the panels of every cut-list-capable Item Design (export contract §7).
 *
 * There are no legacy-parity columns. The export contract §10 asked for frozen columns for edge
 * banding, grain and cutouts; the architecture's inventory (§8, §15.2) found the legacy cut list
 * emits none of those, so the list below is the whole of v1.0 — the same decision the manifest
 * took.
 */
export const CUT_LIST_TABLE: TableSpec = {
  id: 'cut-list',
  columns: [
    col('designOptionId', 'design_option_id', 'id'),
    col('designOption', 'design_option', 'text'),
    col('renovationState', 'renovation_state', 'enum'),
    col('itemDesignId', 'item_design_id', 'id'),
    col('itemDesign', 'item_design', 'text'),
    col('part', 'part', 'text'),
    col('lengthMm', 'length_mm', 'length_mm'),
    col('widthMm', 'width_mm', 'length_mm'),
    col('thicknessMm', 'thickness_mm', 'length_mm'),
    col('material', 'material', 'enum'),
    col('qtyPerItem', 'qty_per_item', 'integer'),
    col('itemCount', 'item_count', 'integer'),
    col('qtyInScope', 'qty_in_scope', 'integer'),
    col('notes', 'notes', 'text'),
  ],
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
