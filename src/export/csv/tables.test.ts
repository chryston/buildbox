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
}

const tables = [ITEMS_TABLE, CUT_LIST_TABLE]

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

  test('are the two the contract names, in the order a ZIP writes them', () => {
    expect(Object.keys(TABLES)).toEqual(['items', 'cut-list'])
  })
})

describe('the golden headers', () => {
  test.each(tables)('$id is the bytes on disk', (spec) => {
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
    for (const spec of tables) {
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
