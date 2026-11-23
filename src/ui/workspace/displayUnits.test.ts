/**
 * The display-unit contract of #55 criterion 11, stated as pure functions so the exact
 * numbers the criterion names are asserted where the rounding rules live.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRECISION, formatMm, parseMmInput, parseToMm } from './displayUnits'

describe('formatMm', () => {
  it('shows 605 mm as 60.5 cm at precision 1', () => {
    expect(formatMm(605, 'cm', 1)).toBe('60.5')
  })

  it('shows a 605.5 mm width as 606 at mm / precision 0, without touching the stored value', () => {
    expect(formatMm(605.5, 'mm', 0)).toBe('606')
  })

  it('shows metres at their default precision', () => {
    expect(formatMm(6055, 'm', DEFAULT_PRECISION.m)).toBe('6.055')
  })

  it('pads to the precision rather than trimming', () => {
    expect(formatMm(600, 'cm', 1)).toBe('60.0')
    expect(formatMm(1, 'm', 4)).toBe('0.0010')
  })
})

describe('parseToMm', () => {
  it('reads 60.55 cm as exactly 605.5 mm', () => {
    expect(parseToMm(60.55, 'cm')).toBe(605.5)
  })

  it('reads metres without float drift', () => {
    expect(parseToMm(0.6055, 'm')).toBe(605.5)
  })

  it('is the identity for mm', () => {
    expect(parseToMm(605.5, 'mm')).toBe(605.5)
  })

  it('round-trips a typed value through the display', () => {
    expect(parseToMm(Number(formatMm(605.5, 'cm', 2)), 'cm')).toBe(605.5)
  })
})

// #74 §5 criterion 16: the value in the box is the value that gets stored, at every unit. A Vertical
// Extent is compared against a Plan View Range at the 0.01 mm tolerance, so a stored 2159.9999999999995
// is a Top that is not quite where the person left it.
describe('parseMmInput', () => {
  it('reads 2.16 typed at m as exactly 2160 mm', () => {
    expect(parseMmInput('2.16', 'm')).toBe(2160)
  })

  it('reads a centimetre decimal without float drift', () => {
    expect(parseMmInput('60.55', 'cm')).toBe(605.5)
  })

  it('keeps a negative elevation, because a Sump box stands below the Floor Datum', () => {
    expect(parseMmInput('-150', 'mm')).toBe(-150)
    expect(parseMmInput('-0.15', 'm')).toBe(-150)
  })

  it('takes a leading plus and the spaces a paste brings with it', () => {
    expect(parseMmInput(' +12 ', 'mm')).toBe(12)
    expect(parseMmInput('  1.2  ', 'm')).toBe(1200)
  })

  it('says nothing is a number for the text that is not one', () => {
    for (const text of ['', '   ', 'abc', '1.2.3', '1e3', 'Infinity', 'NaN', '12,00', '12 00', '.']) {
      expect(parseMmInput(text, 'mm'), text).toBeNull()
    }
  })

  it('round-trips through the display at the unit default precision', () => {
    for (const unit of ['mm', 'cm', 'm'] as const) {
      expect(parseMmInput(formatMm(2160, unit, DEFAULT_PRECISION[unit]), unit)).toBe(2160)
    }
  })
})

describe('DEFAULT_PRECISION', () => {
  it('is mm 0, cm 1, m 3', () => {
    expect(DEFAULT_PRECISION).toEqual({ mm: 0, cm: 1, m: 3 })
  })
})
