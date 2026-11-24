/**
 * The five element goldens (#68 criteria 1, 2, 3, 5, 7, 9).
 *
 * `fixtures/e2e/preview-seed/tables-scene.json` is the scene these tables are exported from: the
 * odd-shaped Plan View plus the arc Wall, the three Openings, the crossing Placed Item and the
 * three warnings the issue names — drawn through real Intents by
 * `scripts/make-tables-scene-seed.ts`, which asserts the arc length, the 907.772 mm door span and
 * the one-warning-per-status the goldens below depend on.
 *
 * The goldens under `fixtures/export/golden/` are the bytes of that export, committed and never
 * regenerated silently:
 *
 *   UPDATE_GOLDEN=1 npx vitest run --project pure src/test/tablesGolden.test.ts
 *
 * …then read the diff. A column that moved is a major version of the export contract, not a
 * refresh, and a golden that disappears stops protecting anything.
 *
 * This test lives in `src/test` rather than beside the writer for one reason: the Warnings List's
 * `message` column is the strip's sentence, which lives in `ui/strings`, and `export` may not
 * import `ui`. Here the real `warningSentence` is injected into `tables`, so the golden holds the
 * bytes the app will write and not a test's paraphrase of them.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import type { Project } from '../domain'
import { RENOVATION_STATES, deriveWarnings, tables as deriveTables, warningMessages } from '../derive'
import type { QuantityScope, Tables } from '../derive'
import { TABLES, neutralise, quote, writeCsv } from '../export'
import type { CsvRow, TableId } from '../export'
import { warningSentence } from '../ui'

const UPDATE = process.env['UPDATE_GOLDEN'] === '1'
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const GOLDEN_DIR = join(fixturesRoot, 'export', 'golden')

const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'tables-scene.json'), 'utf8'),
) as { dbName: string; projects: { id: string; revision: number; schemaVersion: number; data: Project }[] }

const project = seed.projects[0]!.data
const floorId = project.floors[0]!.id

/** The five tables of #68, by the name their file carries. */
const TABLE_IDS = ['rooms', 'walls', 'openings', 'placed-items', 'warnings'] as const

/** Every Floor, the Existing Model only, every State, every Layer: the dialog's default scope. */
function scopeOf(over: Partial<QuantityScope> = {}): QuantityScope {
  return {
    floorIds: project.floors.map((floor) => floor.id),
    designOptionIds: 'existing-only',
    renovationStates: RENOVATION_STATES,
    drawingLayers: 'all',
    ...over,
  }
}

/** The row list of one table out of a whole {@link Tables}. */
function rowsOf(at: Tables, id: TableId): readonly CsvRow[] {
  if (id === 'rooms') return at.rooms
  if (id === 'walls') return at.walls
  if (id === 'openings') return at.openings
  if (id === 'placed-items') return at.placedItems
  return at.warnings
}

/** The CSV of one table of one Project, as the writer would put it in the ZIP. */
function bytesOf(source: Project, id: TableId, scope: QuantityScope = scopeOf()): Uint8Array {
  // The same seam `app` uses: the strip's sentences, rendered for this scope.
  const at = deriveTables(source, scope, { warningMessages: warningMessages(source, scope, warningSentence) })
  return writeCsv(TABLES[id], rowsOf(at, id))
}

/** One CSV's text, BOM and CRLFs and all. */
const textOf = (bytes: Uint8Array): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)

/** One CSV line, with the quoting of `csv/format`'s `quote` undone. */
function parseLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  let at = 0
  while (at < line.length) {
    const char = line[at]!
    if (quoted) {
      if (char === '"' && line[at + 1] === '"') {
        cell += '"'
        at += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
    at += 1
  }
  return [...cells, cell]
}

/** A CSV body as rows of unquoted cells: the header line and the trailing blank line left out. */
function cellsOf(id: TableId, source: Project = project): string[][] {
  return textOf(bytesOf(source, id))
    .slice(1)
    .split('\r\n')
    .slice(1, -1)
    .map(parseLine)
}

const headerOf = (id: TableId): string[] => TABLES[id].columns.map((column) => column.header)
const columnOf = (id: TableId, header: string): number => headerOf(id).indexOf(header)
/** The cell of `header` in `row`, written the way the file writes it. */
const cell = (id: TableId, row: string[], header: string): string => row[columnOf(id, header)] ?? ''

describe('the five element goldens (#68 criterion 1)', () => {
  it.each(TABLE_IDS)('%s.csv is the bytes on disk', (id) => {
    const bytes = bytesOf(project, id)
    const golden = join(GOLDEN_DIR, `${id}.csv`)
    if (UPDATE) writeFileSync(golden, bytes)
    expect(Buffer.from(bytes)).toEqual(Buffer.from(readFileSync(golden)))
  })

  it.each(TABLE_IDS)('%s.csv starts with the BOM and ends with one CRLF', (id) => {
    const text = textOf(bytesOf(project, id))
    expect(text.startsWith(`\uFEFF${headerOf(id).join(',')}\r\n`)).toBe(true)
    expect(text.endsWith('\r\n')).toBe(true)
  })
})

describe('the values the scene was drawn to prove (#68 criterion 2)', () => {
  const rowFor = (id: TableId, stableId: string): string[] =>
    cellsOf(id).find((row) => cell(id, row, 'stable_id') === stableId) ?? []
  const wall = (ref: string): string[] =>
    rowFor('walls', project.existingModel.walls.find((each) => each.ref === ref)!.id)
  const opening = (label: string): string[] =>
    cellsOf('openings').find((row) => cell('openings', row, 'label') === label) ?? []

  it('gives the arc Wall its arc length and its radius, and the straight Walls none', () => {
    const arc = wall('W-6')
    expect(cell('walls', arc, 'shape')).toBe('arc')
    expect(cell('walls', arc, 'radius_mm')).not.toBe('')
    // The radius is reconstructed from the arc's own endpoints and bulge on every derivation, so
    // the file carries the float it settles on — 1999.999 of the 2000 that was drawn.
    expect(Number(cell('walls', arc, 'radius_mm'))).toBeCloseTo(2000, 2)
    expect(cell('walls', arc, 'length_mm')).toBe('3141.593')
    expect(cell('walls', arc, 'classification')).toBe('external')
    expect(cell('walls', arc, 'construction_label')).toBe('Face brick')
    expect(cell('walls', arc, 'bottom_mm')).toBe('0')
    expect(cell('walls', arc, 'top_mm')).toBe('2600')
    expect(cell('walls', arc, 'height_mm')).toBe('2600')
    // A straight Wall has no radius to write, and a `0` would be read as a very large one. A Wall
    // nobody classified leaves `classification` empty rather than guessing `internal`.
    for (const ref of ['W-1', 'W-2', 'W-3', 'W-4', 'W-5', 'W-7']) {
      expect(cell('walls', wall(ref), 'shape')).toBe('straight')
      expect(cell('walls', wall(ref), 'radius_mm')).toBe('')
    }
    expect(cell('walls', wall('W-1'), 'classification')).toBe('')
    expect(cell('walls', wall('W-1'), 'construction_label')).toBe('')
  })

  it('measures the 900 door along the curve it is cut into', () => {
    const door = opening('Door 1')
    const start = Number(cell('openings', door, 'start_mm'))
    expect(cell('openings', door, 'width_mm')).toBe('900')
    expect(Number(cell('openings', door, 'end_mm')) - start).toBeCloseTo(907.772, 3)
    expect(cell('openings', door, 'hinge_side')).toBe('start')
    expect(cell('openings', door, 'swing')).toBe('left')
    expect(cell('openings', door, 'height_mm')).toBe('2100')
  })

  it('leaves the Window without a hinge or a swing, and the sliding door without a hinge', () => {
    const window = opening('Window 1')
    expect(cell('openings', window, 'kind')).toBe('window')
    expect(cell('openings', window, 'hinge_side')).toBe('')
    expect(cell('openings', window, 'swing')).toBe('')
    expect(cell('openings', window, 'sill_mm')).toBe('900')
    expect(cell('openings', window, 'head_mm')).toBe('2400')
    expect(cell('openings', window, 'height_mm')).toBe('1500')
    const sliding = opening('Kitchen door')
    expect(cell('openings', sliding, 'swing')).toBe('sliding')
    expect(cell('openings', sliding, 'hinge_side')).toBe('')
    expect(cell('openings', sliding, 'end_mm')).toBe('2100')
  })

  it('names a Room only beside an item that is inside one', () => {
    const rows = cellsOf('placed-items')
    const kitchenId = project.existingModel.rooms.find((each) => each.name === 'Kitchen')!.id
    const rowOf = (placementId: string): string[] =>
      rows.find((row) => cell('placed-items', row, 'stable_id') === placementId)!
    // The item drawn to cross a Room boundary: `crosses`, and no Room named beside it. The two
    // legacy items the warnings are about cross the Kitchen too.
    expect(cell('placed-items', rowOf('seed-tbl-006'), 'room_relation')).toBe('crosses')
    expect(cell('placed-items', rowOf('seed-tbl-006'), 'room_id')).toBe('')
    expect(cell('placed-items', rowOf('seed-tbl-006'), 'room')).toBe('')
    expect(cell('placed-items', rowOf('seed-tbl-006'), 'label')).toBe('Base 600 #3')
    for (const id of ['fp-wardrobe', 'seed-item-026']) {
      expect(cell('placed-items', rowOf(id), 'room_relation')).toBe('crosses')
    }
    const inside = rows.filter((row) => cell('placed-items', row, 'room_relation') === 'inside')
    expect(inside.map((row) => cell('placed-items', row, 'room')).sort()).toEqual(['Kitchen', 'Kitchen', 'Kitchen'])
    expect(inside.every((row) => cell('placed-items', row, 'room_id') === kitchenId)).toBe(true)
    // No `outside` row names a Room, and every row is exactly one of the three relations.
    expect(rows.filter((row) => cell('placed-items', row, 'room') !== '')).toHaveLength(inside.length)
    expect(new Set(rows.map((row) => cell('placed-items', row, 'room_relation')))).toEqual(
      new Set(['inside', 'crosses', 'outside']),
    )
  })

  it('labels the three Base 600s the way the strip does', () => {
    const labels = cellsOf('placed-items').map((row) => cell('placed-items', row, 'label'))
    expect(labels.filter((label) => label.startsWith('Base 600'))).toEqual(['Base 600 #1', 'Base 600 #2', 'Base 600 #3'])
  })

  it('measures each Room the way the inspector does', () => {
    const rows = cellsOf('rooms')
    expect(rows).toHaveLength(2)
    const kitchen = rows.find((row) => cell('rooms', row, 'name') === 'Kitchen')!
    expect(cell('rooms', kitchen, 'area_m2')).toBe('10.195')
    expect(cell('rooms', kitchen, 'perimeter_mm')).toBe('14300')
  })
})

describe('the S7 defaults (#68 criterion 3)', () => {
  it.each(['rooms', 'walls', 'openings', 'placed-items'] as const)(
    'every %s row is existing, unlayered and optionless',
    (id) => {
      const rows = cellsOf(id)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(cell(id, row, 'design_option_id')).toBe('')
        expect(cell(id, row, 'design_option')).toBe('')
        expect(cell(id, row, 'renovation_state')).toBe('existing')
        expect(cell(id, row, 'drawing_layer_id')).toBe('')
        expect(cell(id, row, 'drawing_layer')).toBe('Unlayered')
        expect(cell(id, row, 'predecessor_ids')).toBe('')
      }
    },
  )
})

describe('the Warnings List (#68 criterion 5)', () => {
  const warnings = deriveWarnings(project, floorId, null).warnings
  // The scene earns #76's vertical warnings beside the two Room crossings it was drawn to prove;
  // this block is about the crossings — the vertical rows are the golden's and the shuffle's.
  const allRows = cellsOf('warnings')
  const rows = allRows.filter((row) => cell('warnings', row, 'warning_type') === 'item_crosses_room')

  it('holds one acknowledged warning with its note, one reopened and one open', () => {
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => cell('warnings', row, 'status'))).toEqual([
      'unacknowledged',
      'unacknowledged',
      'acknowledged',
    ])
    // The reopened row keeps the note it was acknowledged with (#66 §3); the open one has none.
    expect(rows.map((row) => cell('warnings', row, 'acknowledgement_note'))).toEqual([
      'Re-measure after the partition moves.',
      '',
      'Builder to check',
    ])
  })

  it('sorts unacknowledged first, then by subject', () => {
    const subjects = rows.map((row) => cell('warnings', row, 'subject_id'))
    expect(subjects).toEqual(['seed-item-026', 'seed-tbl-006', 'fp-wardrobe'])
  })

  it('writes the strip sentence byte for byte, and no millimetres for a percentage', () => {
    for (const row of rows) {
      const warning = warnings.find((each) => each.type === 'item_crosses_room' && each.subjects[0]?.id === cell('warnings', row, 'subject_id'))!
      expect(cell('warnings', row, 'message')).toBe(quote(neutralise(warningSentence(warning.messageKey, warning.params))))
      // Every warning here was measured in square metres and a percentage, so the column is empty
      // and the sentence carries the number (#68 Scope 3).
      expect(cell('warnings', row, 'measured_mm')).toBe('')
      expect(warning.measured.mm).toBeUndefined()
      expect(cell('warnings', row, 'subject_type')).toBe('placed_item')
      expect(cell('warnings', row, 'other_type')).toBe('room')
      expect(cell('warnings', row, 'warning_type')).toBe('item_crosses_room')
      expect(cell('warnings', row, 'floor')).toBe('Floor 1')
      expect(cell('warnings', row, 'design_option_id')).toBe('')
    }
  })
})

describe('an empty scope (#68 criterion 7)', () => {
  it.each(TABLE_IDS)('%s of a Floor with nothing in it is a header-only file', (id) => {
    expect(textOf(bytesOf(project, id, scopeOf({ floorIds: [] })))).toBe(`\uFEFF${headerOf(id).join(',')}\r\n`)
  })
})

describe('determinism and display independence (#68 criterion 9)', () => {
  it.each(TABLE_IDS)('%s bytes do not depend on the display unit or precision', (id) => {
    const before = Buffer.from(bytesOf(project, id))
    for (const displayUnit of ['mm', 'cm', 'm'] as const) {
      for (const displayPrecision of [0, 1, 2, 3]) {
        const restyled: Project = { ...project, preferences: { ...project.preferences, displayUnit, displayPrecision } }
        expect(Buffer.from(bytesOf(restyled, id))).toEqual(before)
      }
    }
  })

  it.each(TABLE_IDS)('%s bytes are the same twice over', (id) => {
    expect(Buffer.from(bytesOf(project, id))).toEqual(Buffer.from(bytesOf(project, id)))
  })
})

describe('the tables of a shuffled scene (property)', { timeout: 60_000 }, () => {
  const expected = {
    rooms: project.existingModel.rooms.filter((room) => room.floorId === floorId).length,
    walls: project.existingModel.walls.filter((wall) => wall.floorId === floorId).length,
    openings: project.existingModel.openings.filter((opening) => opening.floorId === floorId).length,
    'placed-items': project.existingModel.placedItems.filter((placed) => placed.floorId === floorId).length,
    warnings: deriveWarnings(project, floorId, null).warnings.length,
  }

  /**
   * A table's bytes with its positional columns blanked.
   *
   * A same-design strip label is the item's position in the strip — `Base 600 #3` is the third
   * Base 600 placed — and a warning sentence quotes that label, so shuffling the entities
   * legitimately renumbers both. Everything else about a row, and the order the rows come out in,
   * must not move.
   */
  const POSITIONAL: Record<string, true> = { label: true, message: true }
  const signature = (id: TableId, rows: string[][]): string[] => {
    const positional = headerOf(id).map((header, index) => (POSITIONAL[header] === true ? index : -1))
    return rows.map((row) => row.map((value, index) => (positional.includes(index) ? '' : value)).join(','))
  }

  it('holds one row per element, in an order the drawing order cannot change', () => {
    const before = TABLE_IDS.map((id) => ({
      rows: cellsOf(id),
      labels: cellsOf(id).map((row) => cell(id, row, 'label')).sort(),
    }))
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seedValue) => {
        // The same scene with its entities in another order: `stable_id` order must undo it.
        for (const [index, id] of TABLE_IDS.entries()) {
          const rows = cellsOf(id, shuffleModel(project, seedValue))
          expect(rows, id).toHaveLength(expected[id])
          expect(signature(id, rows), id).toEqual(signature(id, before[index]!.rows))
          const at = columnOf(id, 'label')
          if (at >= 0) expect(rows.map((row) => row[at]!).sort(), id).toEqual(before[index]!.labels)
        }
      }),
      { numRuns: 8 },
    )
  })

  it('writes no row that carries the point a Placed Item sits at', () => {
    const points = project.existingModel.placedItems.map((placed) => placed.translation)
    for (const id of TABLE_IDS) {
      for (const row of cellsOf(id)) {
        const numbers = new Set(row.filter((value) => value !== '' && Number.isFinite(Number(value))).map(Number))
        // A leaked point arrives as a pair. No column of the contract can hold one (#68 criterion
        // 4), and a single number that happens to equal one coordinate is a measurement, not a
        // point — `fp-washer` stands at y 180 and rotates 180°.
        for (const point of points) expect(numbers.has(point.x) && numbers.has(point.y)).toBe(false)
      }
    }
  })
})

/** The same Project with each Existing-Model list in another order, chosen by `seedValue`. */
function shuffleModel(source: Project, seedValue: number): Project {
  let next = seedValue
  const shuffled = <T>(list: readonly T[]): T[] => {
    const copy = [...list]
    for (let index = copy.length - 1; index > 0; index -= 1) {
      next = (next * 1103515245 + 12345) % 2147483648
      const swap = next % (index + 1)
      const held = copy[index]!
      copy[index] = copy[swap]!
      copy[swap] = held
    }
    return copy
  }
  return {
    ...source,
    existingModel: {
      ...source.existingModel,
      walls: shuffled(source.existingModel.walls),
      openings: shuffled(source.existingModel.openings),
      rooms: shuffled(source.existingModel.rooms),
      placedItems: shuffled(source.existingModel.placedItems),
    },
  }
}
