import { describe, expect, test } from 'vitest'
import { parseCsv } from '../testing'
import { CSV_BOM, writeCsv, type CsvRow } from './write'
import { CUT_LIST_TABLE, ITEMS_TABLE, headerLine, type TableSpec } from './tables'

/**
 * The bytes: BOM, CRLF, quoting, the injection guard, and the type errors that mean a row builder
 * has drifted from its table (#62 criteria 3, 5, 10).
 */

/** Every kind, in one table, so a cell of each is one row of the test. */
const EVERY_KIND: TableSpec = {
  id: 'kinds',
  columns: [
    { key: 'text', header: 'text', kind: 'text' },
    { key: 'id', header: 'id', kind: 'id' },
    { key: 'enum', header: 'enum', kind: 'enum' },
    { key: 'multi', header: 'multi', kind: 'multi' },
    { key: 'length', header: 'length_mm', kind: 'length_mm' },
    { key: 'area', header: 'area_m2', kind: 'area_m2' },
    { key: 'angle', header: 'angle_deg', kind: 'angle_deg' },
    { key: 'integer', header: 'integer', kind: 'integer' },
  ],
}

/** Decode without `TextDecoder`'s habit of swallowing a leading BOM: these tests count it. */
const text = (bytes: Uint8Array): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)

describe('writeCsv', () => {
  test('opens with the UTF-8 BOM, so Excel reads a CJK name as itself', () => {
    const bytes = writeCsv(ITEMS_TABLE, [])
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(text(bytes).startsWith(CSV_BOM)).toBe(true)
  })

  test('writes a header-only file for an empty scope, and nothing else', () => {
    const header = 'floor_id,floor,design_option_id,design_option,renovation_state,item_design_id,item_design,count,width_mm,depth_mm,height_mm'
    const bytes = writeCsv(ITEMS_TABLE, [])
    expect(text(bytes)).toBe(`${CSV_BOM}${header}\r\n`)
    expect(bytes.byteLength).toBe(3 + header.length + 2)
    expect(parseCsv(bytes)).toEqual({ bom: true, rows: [header.split(',')] })
  })

  test('ends every record with CRLF, including the last', () => {
    const bytes = writeCsv(ITEMS_TABLE, [
      {
        floorId: 'f1', floor: 'Ground Floor', designOptionId: '', designOption: '',
        renovationState: 'existing', itemDesignId: 'd1', itemDesign: 'Base\nCabinet',
        count: 2, widthMm: 600, depthMm: 560, heightMm: 720,
      },
    ])
    const body = text(bytes).slice(CSV_BOM.length)
    expect(body.endsWith('\r\n')).toBe(true)
    // Every record ends CRLF. The LF inside the quoted name is field content, which RFC 4180
    // allows; the separators are what a reader splits the file on.
    expect(body.split('\r\n')).toHaveLength(3)
    const parsed = parseCsv(bytes)
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[1]?.[6]).toBe('Base\nCabinet')
  })

  test('writes each kind the way its column says', () => {
    const bytes = writeCsv(EVERY_KIND, [
      {
        text: 'Base Cabinet',
        id: 'd-1',
        enum: 'oak',
        multi: ['walnut', 'oak'],
        length: 600.5,
        area: 0.336,
        angle: 45,
        integer: 3,
      },
    ])
    expect(text(bytes).slice(CSV_BOM.length)).toBe(
      'text,id,enum,multi,length_mm,area_m2,angle_deg,integer\r\n' +
      'Base Cabinet,d-1,oak,oak;walnut,600.5,0.336,45,3\r\n',
    )
  })

  test('sorts a multi-value cell and joins it with a semicolon', () => {
    const bytes = writeCsv(EVERY_KIND, [{ multi: ['b', 'a', 'C', '櫥', 'A', '1'] }])
    expect(parseCsv(bytes).rows[1]?.[3]).toBe('1;A;C;a;b;櫥')
  })

  test('sorts a multi-value cell by code point, not by code unit', () => {
    // U+1F600 is above U+FFFF; a UTF-16 comparison would put it first.
    const bytes = writeCsv(EVERY_KIND, [{ multi: ['\u{1F600}', '\uFFFF'] }])
    expect(parseCsv(bytes).rows[1]?.[3]).toBe('\uFFFF;\u{1F600}')
  })

  test('writes a not-applicable cell empty, whether it is null or absent', () => {
    const bytes = writeCsv(EVERY_KIND, [{ text: null }])
    expect(text(bytes).slice(CSV_BOM.length)).toBe(
      'text,id,enum,multi,length_mm,area_m2,angle_deg,integer\r\n,,,,,,,\r\n',
    )
  })

  test('quotes what RFC 4180 says and nothing it does not', () => {
    const bytes = writeCsv(EVERY_KIND, [{ text: 'Kitchen, ground' }, { text: 'Say "hi"' }, { text: 'Plain' }])
    const lines = text(bytes).slice(CSV_BOM.length).split('\r\n')
    expect(lines[1]).toBe('"Kitchen, ground",,,,,,,')
    expect(lines[2]).toBe('"Say ""hi""",,,,,,,')
    expect(lines[3]).toBe('Plain,,,,,,,')
  })

  test('prefixes a text cell a spreadsheet would act on', () => {
    const bytes = writeCsv(ITEMS_TABLE, [itemRow({ itemDesign: '=SUM(A1:A9)' })])
    expect(parseCsv(bytes).rows[1]?.[6]).toBe("'=SUM(A1:A9)")
    // The guard runs before the quoting, so a formula that also holds a comma survives both.
    const both = writeCsv(EVERY_KIND, [{ text: '=SUM(A1,B1)' }])
    expect(text(both).slice(CSV_BOM.length).split('\r\n')[1]).toBe("\"'=SUM(A1,B1)\",,,,,,,")
  })

  test.each(['=x', '+x', '-x', '@x', '\tx', '\rx'])('leaves a code that starts with %j alone', (code) => {
    const bytes = writeCsv(EVERY_KIND, [{ id: code, enum: code }])
    const row = parseCsv(bytes).rows[1]
    expect(row?.[1]).toBe(code)
    expect(row?.[2]).toBe(code)
  })

  test('never prefixes a number, however negative it is', () => {
    const bytes = writeCsv(EVERY_KIND, [{ length: -150, integer: -2, area: -0.5, angle: -1 }])
    expect(text(bytes).slice(CSV_BOM.length).split('\r\n')[1]).toBe(',,,,-150,-0.5,-1,-2')
  })

  test('writes a CJK name and reads it back intact', () => {
    const bytes = writeCsv(ITEMS_TABLE, [itemRow({ itemDesign: '櫥櫃 600' })])
    expect(parseCsv(bytes).rows[1]?.[6]).toBe('櫥櫃 600')
  })

  test('refuses a key no column declares', () => {
    expect(() => writeCsv(ITEMS_TABLE, [itemRow({ extra: 'x' })])).toThrow(TypeError)
    expect(() => writeCsv(ITEMS_TABLE, [itemRow({ extra: 'x' })])).toThrow('no column extra')
  })

  test('refuses a value of the wrong type for its kind', () => {
    expect(() => writeCsv(EVERY_KIND, [{ length: '600' }])).toThrow(TypeError)
    expect(() => writeCsv(EVERY_KIND, [{ text: 600 }])).toThrow(TypeError)
    expect(() => writeCsv(EVERY_KIND, [{ multi: 'oak;walnut' }])).toThrow(TypeError)
    expect(() => writeCsv(EVERY_KIND, [{ length: Number.NaN }])).toThrow(TypeError)
  })

  test('round-trips every field a spreadsheet could be given', () => {
    const nasty = [
      '櫥櫃 600',
      '=SUM(A1:A9)',
      'a,b',
      'he said "hi"',
      'line1\nline2',
      'tab\there',
      'trailing space ',
      '',
      '0',
      '-1',
      '𝓤𝓷𝓲𝓬𝓸𝓭𝓮',
    ]
    const bytes = writeCsv(ITEMS_TABLE, nasty.map((itemDesign) => itemRow({ itemDesign })))
    const parsed = parseCsv(bytes)
    expect(parsed.bom).toBe(true)
    expect(parsed.rows.slice(1).map((row) => row[6])).toEqual(
      nasty.map((itemDesign) => (/^[=+\-@\t\r]/.test(itemDesign) ? `'${itemDesign}` : itemDesign)),
    )
  })

  test('writes the same bytes for the same rows, twice', () => {
    const rows = [itemRow({ itemDesignId: 'b' }), itemRow({ itemDesignId: 'a' })]
    expect(text(writeCsv(ITEMS_TABLE, rows))).toBe(text(writeCsv(ITEMS_TABLE, rows)))
    expect(writeCsv(CUT_LIST_TABLE, [])).toEqual(writeCsv(CUT_LIST_TABLE, []))
  })

  test('writes the header the table declares, verbatim', () => {
    const bytes = writeCsv(CUT_LIST_TABLE, [])
    expect(text(bytes).slice(CSV_BOM.length)).toBe(`${headerLine(CUT_LIST_TABLE)}\r\n`)
  })
})

/** A complete Item List row with the odd field changed, because a row has eleven columns. */
function itemRow(over: CsvRow = {}): CsvRow {
  return {
    floorId: 'floor-1',
    floor: 'Ground Floor',
    designOptionId: '',
    designOption: '',
    renovationState: 'existing',
    itemDesignId: 'design-1',
    itemDesign: 'Base Cabinet',
    count: 1,
    widthMm: 600,
    depthMm: 560,
    heightMm: 720,
    ...over,
  }
}
