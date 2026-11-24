/**
 * The published headers (#62 criterion 4).
 *
 * A CSV header is an identifier other people's spreadsheets and scripts come to depend on, so
 * the contract versions it: append a column in a minor version, rename, reorder or remove only in
 * a major, with a release note (export contract §10). Three things hold that line: the strings
 * below are the contract's own words, the golden files under `fixtures/export/golden/` hold the
 * same bytes for a reviewer who never opens TypeScript, and the scan says no other file in `src`
 * spells them, so there is nothing to drift from.
 *
 * Regenerate the goldens with
 * `UPDATE_GOLDEN=1 npx vitest run --project pure src/export/csv/tables.test.ts`,
 * then read the diff: a header that moved is a major version, not a refresh. The fixtures are
 * never deleted — a golden that disappears silently stops protecting anything.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { CSV_CONTRACT_VERSION, CUT_LIST_TABLE, ITEMS_TABLE, TABLES, headerLine } from './tables'
import { CSV_BOM, writeCsv } from './write'

const UPDATE = process.env['UPDATE_GOLDEN'] === '1'
const GOLDEN_DIR = fileURLToPath(new URL('../../../fixtures/export/golden', import.meta.url))
const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url))

/** The v1.0 headers, spelled from export contract §7 rather than from what the code happens to write. */
const V1_HEADERS: Readonly<Record<string, string>> = {
  items:
    'floor_id,floor,design_option_id,design_option,renovation_state,item_design_id,item_design,count,width_mm,depth_mm,height_mm',
  'cut-list':
    'design_option_id,design_option,renovation_state,item_design_id,item_design,part,length_mm,width_mm,thickness_mm,material,qty_per_item,item_count,qty_in_scope,notes',
  rooms:
    'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,name,area_m2,perimeter_mm,predecessor_ids',
  walls:
    'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,classification,construction_label,shape,length_mm,radius_mm,thickness_mm,justification,bottom_mm,top_mm,height_mm,predecessor_ids',
  openings:
    'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,kind,label,host_wall_id,start_mm,end_mm,width_mm,sill_mm,head_mm,height_mm,hinge_side,swing,predecessor_ids',
  beams:
    'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,label,length_mm,width_mm,depth_mm,underside_mm,top_mm,predecessor_ids',
  'placed-items':
    'stable_id,floor_id,floor,design_option_id,design_option,renovation_state,drawing_layer_id,drawing_layer,label,item_design_id,item_design,rotation_deg,bottom_mm,top_mm,room_id,room,room_relation,predecessor_ids',
  warnings:
    'status,floor_id,floor,design_option_id,design_option,warning_type,subject_type,subject_id,other_type,other_id,measured_mm,message,acknowledgement_note',
}

/** Every table the contract publishes, in ZIP order. */
const tables = Object.values(TABLES)

/**
 * The two tables whose golden is a header-only file.
 *
 * The five element goldens hold the rows of a whole scene and are compared by
 * `src/test/tablesGolden.test.ts`, which is the only place that can build their rows — writing
 * them from here would replace `rooms.csv` with its own first line.
 */
const headerOnlyGoldens = [ITEMS_TABLE, CUT_LIST_TABLE]

describe('the v1.0 tables', () => {
  test('carry the contract version every manifest and provenance block reads', () => {
    expect(CSV_CONTRACT_VERSION).toBe('1.0')
  })

  test.each(tables)('$id writes the header the contract publishes', (spec) => {
    expect(headerLine(spec)).toBe(V1_HEADERS[spec.id])
  })

  test.each(tables)('$id declares each column key once, in contract order', (spec) => {
    const keys = spec.columns.map((column) => column.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(V1_HEADERS[spec.id]!.split(',').length)
    // A header is a machine identifier: lower snake_case, never empty, never translated.
    for (const column of spec.columns) {
      expect(column.header).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(column.header).not.toContain('code')
    }
  })

  test('are the eight the contract names, in the order a ZIP writes them', () => {
    expect(Object.keys(TABLES)).toEqual(['items', 'cut-list', 'rooms', 'walls', 'openings', 'beams', 'placed-items', 'warnings'])
  })

  // #68 Scope 1: the four element tables are the prefix, their own columns, then the suffix. The
  // Warnings List shares none of it — it is a statement about two elements, not an element — and
  // the two counted lists predate it, published by #62 with their own first column.
  test.each(['rooms', 'walls', 'openings', 'placed-items'] as const)(
    '%s opens with the common prefix and closes with the common suffix',
    (id) => {
      const headers = headerLine(TABLES[id]).split(',')
      expect(headers.slice(0, 8)).toEqual([
        'stable_id',
        'floor_id',
        'floor',
        'design_option_id',
        'design_option',
        'renovation_state',
        'drawing_layer_id',
        'drawing_layer',
      ])
      expect(headers[headers.length - 1]).toBe('predecessor_ids')
    },
  )

  // #68 criterion 4: no table is a geometry interchange. A column named `x`, `position` or
  // `translation` would promise coordinates the contract keeps in `#87`, and a spreadsheet would
  // start depending on them.
  test('no header of any table names a coordinate', () => {
    for (const spec of tables) {
      for (const column of spec.columns) {
        expect(column.header).not.toMatch(/(^|_)(x|y)(_|$)|coord|vertex|translation|position/)
      }
    }
  })

  /**
   * #68 Scope 6: the codes are fixed here, next to the column that writes them.
   *
   * Every `enum` column declares its closed set — except `material`, which is a material's name
   * typed by a user and so has no set to declare. A code is a machine identifier like a header:
   * lower snake_case, and never a word the copy rules forbid.
   */
  test('every enum column declares its codes in contract words', () => {
    for (const spec of tables) {
      for (const column of spec.columns) {
        if (column.kind !== 'enum') continue
        if (column.key === 'material') {
          expect(column.values).toBeUndefined()
          continue
        }
        const values = column.values ?? []
        expect(values.length, column.header).toBeGreaterThan(0)
        expect(new Set(values).size).toBe(values.length)
        for (const value of values) {
          expect(value).toMatch(/^[a-z][a-z0-9_]*$/)
          expect(value).not.toContain('code')
        }
      }
    }
    const codesOf = (id: keyof typeof TABLES, header: string): readonly string[] =>
      TABLES[id].columns.find((column) => column.header === header)?.values ?? []
    expect(codesOf('walls', 'classification')).toEqual(['external', 'internal', 'partition'])
    expect(codesOf('warnings', 'subject_type')).toEqual(['wall', 'opening', 'room', 'placed_item', 'beam', 'skirting'])
    expect(codesOf('warnings', 'other_type')).toEqual(['wall', 'opening', 'room', 'placed_item', 'beam', 'skirting'])
    expect(codesOf('warnings', 'warning_type')).toEqual([
      'wall_crossing',
      'wall_overlap',
      'item_crosses_room',
      'item_item_overlap',
      'item_into_wall',
      'opening_host_above',
      'opening_host_below',
      'floor_limit_above',
      'floor_limit_below',
      'clearance_envelope_intrusion',
      'beam_placed_item',
      'beam_opening',
      'skirting_placed_item',
      'skirting_host_above',
      'skirting_host_below',
    ])
  })
})

describe('the golden headers', () => {
  test.each(headerOnlyGoldens)('$id is the bytes on disk', (spec) => {
    const bytes = writeCsv(spec, [])
    const golden = `${GOLDEN_DIR}/${spec.id}.csv`
    if (UPDATE) {
      writeFileSync(golden, bytes)
      return
    }
    // Read as a Buffer so a missing file is a test failure with a path in it, not a `undefined`
    // comparison three frames away.
    expect(Buffer.from(bytes)).toEqual(Buffer.from(readFileSync(golden)))
  })

  test('start with the BOM and end with one CRLF-terminated line', () => {
    for (const spec of headerOnlyGoldens) {
      const bytes = writeCsv(spec, [])
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
      expect(text.startsWith(`${CSV_BOM}${V1_HEADERS[spec.id]}\r\n`)).toBe(true)
      expect(text.slice(CSV_BOM.length).split('\r\n')).toHaveLength(2)
    }
  })
})

describe('the one declaration', () => {
  test('each header line is spelled in tables.ts and nowhere else in src', () => {
    const files = sourceFiles(SRC_DIR)
    expect(files.length).toBeGreaterThan(50)
    for (const header of Object.values(V1_HEADERS)) {
      const declared = files
        .filter((file) => readFileSync(file, 'utf8').includes(header))
        .map((file) => file.slice(SRC_DIR.length))
      expect(declared).toEqual(['export/csv/tables.ts'])
    }
  })
})

/** Every TypeScript source under `dir`, tests left out because a test may quote a header. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).flatMap((entry) => {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [`${entry.parentPath ?? dir}/${entry.name}`]
  })
}
