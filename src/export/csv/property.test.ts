import { expect, test } from 'vitest'
import * as fc from 'fast-check'
import { formatNumber, neutralise } from './format'
import { writeCsv } from './write'
import type { TableSpec } from './tables'
import { parseCsv } from '../testing'

/**
 * The contract's rules as properties, over every number and every string a Project could hold
 * (#62 criteria 1, 3, 10).
 *
 * A table of examples shows the formatter was asked the right questions; these say it never
 * answers in a way a spreadsheet would misread, whatever the arithmetic upstream handed it. The
 * decimals each kind uses are the ones `write.ts` picks for that kind, so the property covers the
 * formatter as the writer actually calls it.
 */

/** Every kind, one column each, so a row of arbitrary cells is one arbitrary row. */
const ARBITRARY_KINDS: TableSpec = {
  id: 'arbitrary',
  columns: [
    { key: 'text', header: 'text', kind: 'text' },
    { key: 'multi', header: 'multi', kind: 'multi' },
    { key: 'length', header: 'length_mm', kind: 'length_mm' },
    { key: 'area', header: 'area_m2', kind: 'area_m2' },
    { key: 'angle', header: 'angle_deg', kind: 'angle_deg' },
    { key: 'integer', header: 'integer', kind: 'integer' },
  ],
}

/** A finite number of any magnitude a design could carry, negative elevations included. */
const magnitude = fc.double({ min: -1e15, max: 1e15, noNaN: true })
const decimals = fc.constantFrom(0, 3, 6)

/**
 * Text a name could hold: CJK, emoji, quotes, commas, newlines, control characters. Lone
 * surrogates are left out because no UTF-8 encoding of one exists, and the question here is what
 * survives a file, not what survives a broken string.
 */
const anyText = fc
  .array(fc.integer({ min: 0, max: 0x10_ff_ff }), { maxLength: 24 })
  .map((codes) => String.fromCodePoint(...codes.filter((code) => code < 0xd800 || code > 0xdfff)))
/**
 * The same, minus what a `multi` cell cannot hold: the semicolon that joins its values, and the
 * empty value that would make one cell indistinguishable from no cell at all.
 */
const multiValue = anyText.filter((each) => each !== '' && !each.includes(';'))

test('writes a number as digits, whatever it is', () => {
  fc.assert(
    fc.property(magnitude, decimals, (value, dp) => {
      const cell = formatNumber(value, dp)
      // No exponent, no separator, no sign on a zero, no trailing zero, no bare point.
      expect(cell).toMatch(/^-?(0|[1-9]\d*)(\.\d*[1-9])?$/)
      expect(cell).not.toBe('-0')
      expect(Number.isNaN(Number(cell))).toBe(false)
    }),
    { numRuns: 20_000 },
  )
})

test('loses nothing a reader could notice', () => {
  fc.assert(
    fc.property(magnitude, decimals, (value, dp) => {
      const cell = formatNumber(value, dp)
      const back = Number(cell)
      // The cell is the number to within half the last kept decimal, plus the sliver of
      // floating-point slack in reading the digits back.
      expect(Math.abs(back - value)).toBeLessThanOrEqual(0.5 * 10 ** -dp + Math.abs(value) * 1e-15)
    }),
    { numRuns: 20_000 },
  )
})

test('is the same function twice: the same number writes the same cell', () => {
  fc.assert(
    fc.property(magnitude, decimals, (value, dp) => {
      expect(formatNumber(value, dp)).toBe(formatNumber(value, dp))
    }),
    { numRuns: 5_000 },
  )
})

test('never hands a spreadsheet something to act on', () => {
  fc.assert(
    fc.property(anyText, (text) => {
      const bytes = writeCsv(ARBITRARY_KINDS, [{ text }])
      const row = parseCsv(bytes).rows[1]
      expect(row).toHaveLength(ARBITRARY_KINDS.columns.length)
      // What the reader sees is the text, or the text with the guard in front of it — and never a
      // character a formula bar would run.
      const cell = row?.[0] ?? ''
      expect(cell === text || cell === `'${text}`).toBe(true)
      expect(cell).not.toMatch(/^[=+\-@\t\r]/)
    }),
    { numRuns: 5_000 },
  )
})

test('round-trips a whole file of arbitrary cells', () => {
  const rows = fc.array(
    fc.record({
      text: anyText,
      multi: fc.uniqueArray(multiValue, { maxLength: 4 }),
      length: magnitude,
      area: magnitude,
      angle: magnitude,
      integer: fc.integer({ min: -1e9, max: 1e9 }),
    }),
    { maxLength: 6 },
  )
  fc.assert(
    fc.property(rows, (sources) => {
      const parsed = parseCsv(writeCsv(ARBITRARY_KINDS, sources))
      expect(parsed.bom).toBe(true)
      expect(parsed.rows).toHaveLength(sources.length + 1)
      sources.forEach((source, index) => {
        const cell = parsed.rows[index + 1]
        expect(cell?.[0]).toBe(neutralise(source.text))
        // The order is the writer's rule; that the values survived quoting at all is this one.
        expect((cell?.[1] ?? '').split(';').filter((each) => each !== '').sort())
          .toEqual([...source.multi].sort())
        for (const [column, value] of [[2, source.length], [3, source.area], [4, source.angle]] as const) {
          expect(Math.abs(Number(cell?.[column]) - value)).toBeLessThanOrEqual(0.0005 + Math.abs(value) * 1e-15)
        }
        expect(Number(cell?.[5])).toBe(source.integer)
      })
    }),
    { numRuns: 500 },
  )
})
