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

/**
 * One column: the key in the row object, the header in the file, and how to write the cell.
 *
 * An `enum` column also carries the **codes** it may hold, because the export contract §6 fixes
 * them in v1.0 and a reader's script compares them byte for byte. Recording them here rather than
 * in a prose table is what lets `app/shippedStrings.test.ts` run the banned-word scan over every
 * code as well as every header, and what makes a code that no row can produce visible in the same
 * file as the column that writes it. A column whose values the user authors — the Cut List's
 * `material`, which is a material's name — declares none, because a closed list of them would be
 * a lie.
 */
export interface Column {
  readonly key: string
  readonly header: string
  readonly kind: ColumnKind
  readonly values?: readonly string[]
}

/** A table: its name in a file name, and its columns in contract order. */
export interface TableSpec {
  /** One of `TableId` for a table the contract names; a test may describe a table of its own. */
  readonly id: string
  readonly columns: readonly Column[]
}

/** The tables this build writes. Later issues add rows here, and nowhere else. */
export type TableId = 'items' | 'cut-list' | 'rooms' | 'walls' | 'openings' | 'beams' | 'skirting' | 'services' | 'placed-items' | 'warnings'

/**
 * A table's columns, in contract order: the header line supplies the file's words, the pairs
 * supply each column's row key, cell kind and — for an `enum` — the codes it publishes.
 */
function columnsFor(
  header: string,
  columns: readonly (readonly [key: string, kind: ColumnKind, values?: readonly string[]])[],
): Column[] {
  const headers = header.split(',')
  // A header and a column list of different lengths is a table that lost a column at one end,
  // which the contract calls a major version — so it throws rather than write a file whose first
  // line and rows describe different tables.
  if (headers.length !== columns.length) {
    throw new TypeError(`${String(headers.length)} headers for ${String(columns.length)} columns: ${header}`)
  }
  return columns.map(([key, kind, values], index) => ({
    key,
    header: headers[index]!,
    kind,
    ...(values === undefined ? {} : { values }),
  }))
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
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
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
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
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

/**
 * The four element tables — Rooms, Walls, Openings, Placed Items — open with the same eight
 * columns and close with the same one (#68 Scope 1, export contract §7):
 *
 * ```text
 * stable_id, floor_id, floor, design_option_id, design_option, renovation_state,
 * drawing_layer_id, drawing_layer … predecessor_ids
 * ```
 *
 * Each header below is spelled out in full rather than built from those two strings, for the same
 * reason the two above are: the line a reader greps for is the line the file starts with, and a
 * header assembled at run time is a header no reviewer can find. `tables.test.ts` holds the
 * contract's own copy of all seven lines and fails if any of them is spelled anywhere else in
 * `src`.
 *
 * The eight leading columns are the S8 model arriving without a column moving (#68 Scope 2): until
 * Design Options and Drawing Layers exist, `design_option_id`, `drawing_layer_id` and
 * `predecessor_ids` are empty, `renovation_state` is `existing` and `drawing_layer` is
 * `Unlayered`. `#73` fills them from the model and touches nothing here.
 */
const ROOMS_HEADER =
  'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,name,area_m2,perimeter_mm,predecessor_ids'

/**
 * The Rooms table (export contract §7, #68 Scope 3).
 *
 * `area_m2` and `perimeter_mm` are the analytic measures of the Room's outline — the same numbers
 * the inspector shows — written at the contract's six and three decimal places by the column kind,
 * never by a display formatter.
 */
export const ROOMS_TABLE: TableSpec = {
  id: 'rooms',
  columns: columnsFor(ROOMS_HEADER, [
    ['stableId', 'id'],
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
    ['drawingLayerId', 'id'],
    ['drawingLayer', 'text'],
    ['name', 'text'],
    ['areaM2', 'area_m2'],
    ['perimeterMm', 'length_mm'],
    ['predecessorIds', 'multi'],
  ]),
}

/**
 * The Walls table (#68 Scope 3).
 *
 * `length_mm` runs along the reference line, so an arc's is its arc length and `radius_mm` holds
 * its radius; a straight Wall leaves `radius_mm` empty rather than writing a zero a reader would
 * have to distrust. `bottom_mm` and `top_mm` are the Wall's two heights above the Floor Datum, so
 * a split-level Floor needs no extra column.
 */
const WALLS_HEADER =
  'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,classification,construction_label,shape,length_mm,radius_mm,thickness_mm,justification,bottom_mm,top_mm,height_mm,predecessor_ids'

export const WALLS_TABLE: TableSpec = {
  id: 'walls',
  columns: columnsFor(WALLS_HEADER, [
    ['stableId', 'id'],
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
    ['drawingLayerId', 'id'],
    ['drawingLayer', 'text'],
    ['classification', 'enum', ['external', 'internal', 'partition']],
    ['constructionLabel', 'text'],
    ['shape', 'enum', ['straight', 'arc']],
    ['lengthMm', 'length_mm'],
    ['radiusMm', 'length_mm'],
    ['thicknessMm', 'length_mm'],
    ['justification', 'enum', ['left', 'centre', 'right']],
    ['bottomMm', 'length_mm'],
    ['topMm', 'length_mm'],
    ['heightMm', 'length_mm'],
    ['predecessorIds', 'multi'],
  ]),
}

/**
 * The Openings table (#68 Scope 3, #65 §2).
 *
 * `start_mm` and `end_mm` are measured along the host's reference line — arc length on a curved
 * Wall — while `width_mm` is the chord the joiner cuts, which is why the two differ on a curve and
 * agree on a straight Wall. `hinge_side` belongs to a hinged door alone: a Window, a removed
 * section and a sliding door have no hinge to have a side of, and leave it empty.
 */
const OPENINGS_HEADER =
  'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,kind,label,host_wall_id,start_mm,end_mm,width_mm,sill_mm,head_mm,height_mm,hinge_side,swing,predecessor_ids'

export const OPENINGS_TABLE: TableSpec = {
  id: 'openings',
  columns: columnsFor(OPENINGS_HEADER, [
    ['stableId', 'id'],
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
    ['drawingLayerId', 'id'],
    ['drawingLayer', 'text'],
    ['kind', 'enum', ['door', 'window', 'removed_section']],
    ['label', 'text'],
    ['hostWallId', 'id'],
    ['startMm', 'length_mm'],
    ['endMm', 'length_mm'],
    ['widthMm', 'length_mm'],
    ['sillMm', 'length_mm'],
    ['headMm', 'length_mm'],
    ['heightMm', 'length_mm'],
    ['hingeSide', 'enum', ['start', 'end']],
    ['swing', 'enum', ['left', 'right', 'sliding']],
    ['predecessorIds', 'multi'],
  ]),
}

/**
 * The Beams table (#77 §5).
 *
 * `depth_mm` is the interface's word for the stored Depth and `top_mm` is derived —
 * `underside_mm + depth_mm` — so a reader can check the file against a drawing without knowing
 * which of the two numbers BuildBox keeps. `length_mm` is measured along the reference line, never
 * along a face, which is the same rule the Walls table follows.
 */
const BEAMS_HEADER =
  'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,label,length_mm,width_mm,depth_mm,underside_mm,top_mm,predecessor_ids'

export const BEAMS_TABLE: TableSpec = {
  id: 'beams',
  columns: columnsFor(BEAMS_HEADER, [
    ['stableId', 'id'],
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
    ['drawingLayerId', 'id'],
    ['drawingLayer', 'text'],
    ['label', 'text'],
    ['lengthMm', 'length_mm'],
    ['widthMm', 'length_mm'],
    ['depthMm', 'length_mm'],
    ['undersideMm', 'length_mm'],
    ['topMm', 'length_mm'],
    ['predecessorIds', 'multi'],
  ]),
}

/**
 * The Skirting table (#78 §8).
 *
 * `side` is the Wall face the body stands on, in the same `left`/`right` words the Room face refs
 * use — never `L`/`R` and never a Room's name, which a reader cannot check against a file. The two
 * lengths are the pair the whole element exists for: `gross_length_mm` is the stored range
 * (`end_mm − start_mm`) and `net_length_mm` is what is left after the corner clips and the derived
 * gaps, so a buyer and a drawing disagree by exactly the openings in the Wall. `top_mm` is
 * `bottom_mm + height_mm`, derived and never stored.
 */
const SKIRTING_HEADER =
  'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,label,host_wall_id,side,start_mm,end_mm,gross_length_mm,net_length_mm,height_mm,thickness_mm,bottom_mm,top_mm,predecessor_ids'

export const SKIRTING_TABLE: TableSpec = {
  id: 'skirting',
  columns: columnsFor(SKIRTING_HEADER, [
    ['stableId', 'id'],
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
    ['drawingLayerId', 'id'],
    ['drawingLayer', 'text'],
    ['label', 'text'],
    ['hostWallId', 'id'],
    ['side', 'enum', ['left', 'right']],
    ['startMm', 'length_mm'],
    ['endMm', 'length_mm'],
    ['grossLengthMm', 'length_mm'],
    ['netLengthMm', 'length_mm'],
    ['heightMm', 'length_mm'],
    ['thicknessMm', 'length_mm'],
    ['bottomMm', 'length_mm'],
    ['topMm', 'length_mm'],
    ['predecessorIds', 'multi'],
  ]),
}

/**
 * The Services table (#79 §8).
 *
 * One file for both shapes, and the columns a shape does not have stay empty: `centreline_mm` is
 * blank for a Riser, which stores a Bottom and a Height, and `width_mm` and `depth_mm` are blank for
 * a round section. A zero in any of those would be a measurement nobody took. `length_mm` is the plan
 * length of a Run and the Height of a Riser — the one measurement each shape's inspector offers
 * under that name. `bottom_mm` and `top_mm` are derived for a Run from its centreline and section,
 * the same arithmetic every other surface shows.
 */
const SERVICES_HEADER =
  'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,label,kind,shape,section,outside_diameter_mm,width_mm,depth_mm,length_mm,centreline_mm,bottom_mm,top_mm,predecessor_ids'

export const SERVICES_TABLE: TableSpec = {
  id: 'services',
  columns: columnsFor(SERVICES_HEADER, [
    ['stableId', 'id'],
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
    ['drawingLayerId', 'id'],
    ['drawingLayer', 'text'],
    ['label', 'text'],
    ['kind', 'enum', ['water', 'drain', 'gas', 'electrical', 'air_con', 'other']],
    ['shape', 'enum', ['run', 'riser']],
    ['section', 'enum', ['round', 'rectangular']],
    ['outsideDiameterMm', 'length_mm'],
    ['widthMm', 'length_mm'],
    ['depthMm', 'length_mm'],
    ['lengthMm', 'length_mm'],
    ['centrelineMm', 'length_mm'],
    ['bottomMm', 'length_mm'],
    ['topMm', 'length_mm'],
    ['predecessorIds', 'multi'],
  ]),
}

/**
 * The Placed Items table (#68 Scope 3).
 *
 * One row per Placed Item, never one per Item Design — that is the Item List's job, and the two
 * tables answer different questions. `room_id` and `room` are filled only when the item is wholly
 * `inside` one Room: a `crosses` row leaves them empty rather than naming a Room the item is only
 * partly in, which is the mistake a reader cannot check from the row alone.
 */
const PLACED_ITEMS_HEADER =
  'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,label,item_design_id,item_design,rotation_deg,bottom_mm,top_mm,room_id,room,room_relation,predecessor_ids'

export const PLACED_ITEMS_TABLE: TableSpec = {
  id: 'placed-items',
  columns: columnsFor(PLACED_ITEMS_HEADER, [
    ['stableId', 'id'],
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['renovationState', 'enum', ['existing', 'demolition', 'proposed']],
    ['drawingLayerId', 'id'],
    ['drawingLayer', 'text'],
    ['label', 'text'],
    ['itemDesignId', 'id'],
    ['itemDesign', 'text'],
    ['rotationDeg', 'angle_deg'],
    ['bottomMm', 'length_mm'],
    ['topMm', 'length_mm'],
    ['roomId', 'id'],
    ['room', 'text'],
    ['roomRelation', 'enum', ['inside', 'crosses', 'outside']],
    ['predecessorIds', 'multi'],
  ]),
}

/**
 * The Warnings List (#68 Scope 3, export contract §5).
 *
 * It carries none of the element prefix: a warning is not an element, it is a statement about two
 * of them, so it names its `subject` and its `other` instead of a `stable_id`, and it is scoped by
 * Floor and Design Option alone — layers and Renovation States never filter it (§3).
 *
 * `measured_mm` is the producer's own millimetres, and empty for a warning measured in square
 * metres or percentages, because the `message` already carries that number in the unit the reader
 * reads it in. `message` is the same sentence the strip shows, byte for byte.
 */
const WARNINGS_HEADER =
  'status,floor_id,floor,design_option_id,design_option,warning_type,subject_type,subject_id,other_type,other_id,measured_mm,message,acknowledgement_note'

export const WARNINGS_TABLE: TableSpec = {
  id: 'warnings',
  columns: columnsFor(WARNINGS_HEADER, [
    ['status', 'enum', ['unacknowledged', 'acknowledged']],
    ['floorId', 'id'],
    ['floor', 'text'],
    ['designOptionId', 'id'],
    ['designOption', 'text'],
    ['warningType', 'enum', ['wall_crossing', 'wall_overlap', 'item_crosses_room', 'item_item_overlap', 'item_into_wall', 'opening_host_above', 'opening_host_below', 'floor_limit_above', 'floor_limit_below', 'clearance_envelope_intrusion', 'beam_placed_item', 'beam_opening', 'skirting_placed_item', 'skirting_host_above', 'skirting_host_below', 'service_placed_item', 'service_opening', 'service_beam', 'service_clearance_envelope']],
    ['subjectType', 'enum', ['wall', 'opening', 'room', 'placed_item', 'beam', 'skirting', 'service']],
    ['subjectId', 'id'],
    ['otherType', 'enum', ['wall', 'opening', 'room', 'placed_item', 'beam', 'skirting', 'service']],
    ['otherId', 'id'],
    ['measuredMm', 'length_mm'],
    ['message', 'text'],
    ['acknowledgementNote', 'text'],
  ]),
}

/** Every table by name, in the order a ZIP writes them. */
export const TABLES: Readonly<Record<TableId, TableSpec>> = {
  items: ITEMS_TABLE,
  'cut-list': CUT_LIST_TABLE,
  rooms: ROOMS_TABLE,
  walls: WALLS_TABLE,
  openings: OPENINGS_TABLE,
  beams: BEAMS_TABLE,
  skirting: SKIRTING_TABLE,
  services: SERVICES_TABLE,
  'placed-items': PLACED_ITEMS_TABLE,
  warnings: WARNINGS_TABLE,
}

/** The header row, exactly as the file's first line reads. */
export function headerLine(spec: TableSpec): string {
  return spec.columns.map((column) => column.header).join(',')
}
