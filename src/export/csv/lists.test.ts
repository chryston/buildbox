/**
 * Rows to bytes, over the repository's own Projects (#62 criteria 2, 3, 5, 10).
 *
 * The claim under test is a narrow one with wide consequences: a CSV is a statement about the
 * Project, not about the screen it was exported from. Nothing between a Placed Item and a cell
 * reads a display unit, a decimal precision, a zoom level or a selection, so the same Project
 * written twice is the same bytes, and a Floor with nothing on it is a file with a header and
 * nothing else.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { basicProject, referenceProject } from '../../derive/testing'
import { quantities } from '../../derive'
import type { Project } from '../../domain'
import { parseCsv } from '../testing'
import { CUT_LIST_TABLE, ITEMS_TABLE, headerLine } from './tables'
import { CSV_BOM, writeCsv } from './write'
import type { QuantityScope } from '../../derive'

const GOLDEN_DIR = fileURLToPath(new URL('../../../fixtures/export/golden', import.meta.url))

/** Every Floor, the Existing Model alone, every Renovation State, every layer: the contract's defaults. */
function scopeFor(project: Project, over: Partial<QuantityScope> = {}): QuantityScope {
  return {
    floorIds: project.floors.map((floor) => floor.id),
    designOptionIds: 'existing-only',
    renovationStates: ['existing', 'demolition', 'proposed'],
    drawingLayers: 'all',
    ...over,
  }
}

const project = basicProject()
const bytes = (target: Project, scope: QuantityScope): Uint8Array =>
  writeCsv(ITEMS_TABLE, quantities(target, 7, scope).items)

describe('a file is a statement about the Project', () => {
  test('the same Project and scope write the same bytes, twice (#62 criterion 10)', () => {
    const scope = scopeFor(project)
    expect(bytes(project, scope)).toEqual(bytes(project, scope))
    const cuts = quantities(project, 7, scope).cuts
    expect(writeCsv(CUT_LIST_TABLE, cuts)).toEqual(writeCsv(CUT_LIST_TABLE, quantities(project, 7, scope).cuts))
  })

  test('millimetres at 0 decimals and metres at 3 write the same file (#62 criterion 2)', () => {
    // A recipe's `unit` and `precision` decide what a panel shows; a cell is written by
    // `formatNumber` at the decimals its column kind names — a `_mm` cell at three, always. There
    // is no parameter a display setting could reach, which is the whole of the guarantee: a
    // 900-wide chest is `900` in the file, not `0.9` and not `1`.
    const scope = scopeFor(project)
    const rowNamed = (name: string): readonly string[] | undefined =>
      parseCsv(bytes(project, scope)).rows.find((row) => row[6] === name)
    // The Tall Chest is 900 × 450 × 1100 in the Project, and the file says so in millimetres.
    expect(rowNamed('Tall Chest')?.[8]).toBe('900')
    expect(rowNamed('Tall Chest')?.[10]).toBe('1100')
    // A length that only looks longer because of floating-point noise still reads as a whole
    // millimetre through the file (#62 criterion 1).
    const widened = quantities(project, 7, scope).items.map((each) => ({ ...each, widthMm: 900.0004 }))
    const widenedRow = parseCsv(writeCsv(ITEMS_TABLE, widened)).rows.find((row) => row[6] === 'Tall Chest')
    expect(widenedRow?.[8]).toBe('900')
  })

  test('the revision is a cache key, not content (#62 criterion 10)', () => {
    const scope = scopeFor(project)
    const rows = (revision: number): Uint8Array => writeCsv(ITEMS_TABLE, quantities(project, revision, scope).items)
    expect(rows(1)).toEqual(rows(9_999))
  })

  test('a scope with no Floor is a header and nothing else (#62 criterion 5)', () => {
    const empty = quantities(project, 7, scopeFor(project, { floorIds: [] }))
    expect(empty.items).toEqual([])
    expect(empty.cuts).toEqual([])
    for (const spec of [ITEMS_TABLE, CUT_LIST_TABLE]) {
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(writeCsv(spec, []))
      expect(text).toBe(`${CSV_BOM}${headerLine(spec)}\r\n`)
    }
  })

  test('a Floor with no Placed Items writes no row', () => {
    const cleared: Project = { ...project, existingModel: { ...project.existingModel, placedItems: [] } }
    const scope = scopeFor(cleared)
    expect(quantities(cleared, 7, scope).items).toEqual([])
    expect(quantities(cleared, 7, scope).cuts).toEqual([])
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes(cleared, scope))
    expect(text.split('\r\n')).toHaveLength(2)
  })
})

describe('a name is a name', () => {
  /** One Item List row of the fixture, with the name under test in it. */
  const rowNamed = (name: string): Record<string, string | number> => {
    const [row] = quantities(project, 7, scopeFor(project, { floorIds: [project.floors[0]!.id] })).items
    return { ...row, itemDesign: name }
  }

  test('a CJK name survives the file intact (#62 criterion 3)', () => {
    const written = writeCsv(ITEMS_TABLE, [rowNamed('櫥櫃 600')])
    expect(new TextDecoder().decode(written.slice(3))).toContain('櫥櫃 600')
    expect(parseCsv(written).rows[1]?.[6]).toBe('櫥櫃 600')
  })

  test('a name that starts like a formula arrives as text (#62 criterion 3)', () => {
    const parsed = parseCsv(writeCsv(ITEMS_TABLE, [rowNamed('=SUM(A1:A9)')]))
    expect(parsed.rows[1]?.[6]).toBe("'=SUM(A1:A9)")
  })

  test('a Cut List note is neutralised the same way', () => {
    const [row] = quantities(project, 7, scopeFor(project)).cuts
    const parsed = parseCsv(writeCsv(CUT_LIST_TABLE, [{ ...row, notes: '@cmd|power' }]))
    expect(parsed.rows[1]?.[13]).toBe("'@cmd|power")
  })
})

describe('the reference Project', () => {
  const reference = referenceProject()

  test('writes both tables, and every row reads back', () => {
    const scope = scopeFor(reference)
    const { items, cuts } = quantities(reference, 1, scope)
    expect(items.length).toBeGreaterThan(0)
    expect(cuts.length).toBeGreaterThan(0)
    for (const [spec, rows] of [[ITEMS_TABLE, items], [CUT_LIST_TABLE, cuts]] as const) {
      const parsed = parseCsv(writeCsv(spec, rows))
      expect(parsed.bom).toBe(true)
      expect(parsed.rows[0]).toEqual(headerLine(spec).split(','))
      expect(parsed.rows).toHaveLength(rows.length + 1)
      for (const cells of parsed.rows.slice(1)) expect(cells).toHaveLength(spec.columns.length)
    }
  })

  test('starts with the header the golden file holds', () => {
    for (const spec of [ITEMS_TABLE, CUT_LIST_TABLE]) {
      const written = writeCsv(spec, [])
      expect(Buffer.from(written)).toEqual(Buffer.from(readFileSync(`${GOLDEN_DIR}/${spec.id}.csv`)))
    }
  })
})
