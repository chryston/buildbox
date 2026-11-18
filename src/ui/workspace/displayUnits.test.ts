/**
 * The display-unit contract of #55 criterion 11, stated as pure functions so the exact
 * numbers the criterion names are asserted where the rounding rules live.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRECISION, formatMm, parseToMm } from './displayUnits'

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

describe('DEFAULT_PRECISION', () => {
  it('is mm 0, cm 1, m 3', () => {
    expect(DEFAULT_PRECISION).toEqual({ mm: 0, cm: 1, m: 3 })
  })
})
