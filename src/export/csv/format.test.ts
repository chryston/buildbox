import { describe, expect, test } from 'vitest'
import {
  ANGLE_DP,
  AREA_DP,
  INTEGER_DP,
  LENGTH_DP,
  formatNumber,
  neutralise,
  quote,
} from './format'

/**
 * The number format every CSV cell goes through (#62 criterion 1, export contract §6), and the
 * text guard that keeps a spreadsheet from acting on a name (criterion 3).
 */
describe('formatNumber', () => {
  test('writes the decimals a length has, and no others', () => {
    expect(formatNumber(1200, LENGTH_DP)).toBe('1200')
    expect(formatNumber(1200.5, LENGTH_DP)).toBe('1200.5')
    expect(formatNumber(1200.05, LENGTH_DP)).toBe('1200.05')
    expect(formatNumber(1200.005, LENGTH_DP)).toBe('1200.005')
  })

  test('writes a big length as digits, never as a separator or an exponent', () => {
    expect(formatNumber(1234567.5, LENGTH_DP)).toBe('1234567.5')
    // `String(1e21)` is `'1e+21'`; a length cell has to survive a spreadsheet's parser.
    expect(formatNumber(1e21, LENGTH_DP)).toBe('1000000000000000000000')
    expect(formatNumber(1e21 + 0.5, LENGTH_DP)).toBe('1000000000000000000000')
  })

  test('drops the decimals that are not there rather than padding them', () => {
    expect(formatNumber(18, INTEGER_DP)).toBe('18')
    expect(formatNumber(18.4, INTEGER_DP)).toBe('18')
    expect(formatNumber(18.6, INTEGER_DP)).toBe('19')
    expect(formatNumber(0.5, ANGLE_DP)).toBe('0.5')
  })

  test('rounds half away from zero on exactly representable halves', () => {
    expect(formatNumber(1.0625, LENGTH_DP)).toBe('1.063')
    expect(formatNumber(-1.0625, LENGTH_DP)).toBe('-1.063')
    expect(formatNumber(0.0005, LENGTH_DP)).toBe('0.001')
    expect(formatNumber(-0.0005, LENGTH_DP)).toBe('-0.001')
    expect(formatNumber(2.5, INTEGER_DP)).toBe('3')
    expect(formatNumber(-2.5, INTEGER_DP)).toBe('-3')
  })

  test('keeps a negative that survives rounding and loses one that does not', () => {
    expect(formatNumber(-150, LENGTH_DP)).toBe('-150')
    expect(formatNumber(-0.0000001, LENGTH_DP)).toBe('0')
    expect(formatNumber(-0, LENGTH_DP)).toBe('0')
    expect(formatNumber(-0.0004, LENGTH_DP)).toBe('0')
  })

  test('trims a length that only looks longer because of floating-point noise', () => {
    expect(formatNumber(600.0004, LENGTH_DP)).toBe('600')
    expect(formatNumber(0.1 + 0.2, LENGTH_DP)).toBe('0.3')
    expect(formatNumber(3 * 0.1, LENGTH_DP)).toBe('0.3')
  })

  test('expands the exponent notation a double prints, in both directions', () => {
    expect(formatNumber(1e-7, LENGTH_DP)).toBe('0')
    expect(formatNumber(9.9e-7, AREA_DP)).toBe('0.000001')
    expect(formatNumber(-9.9e-7, AREA_DP)).toBe('-0.000001')
    expect(formatNumber(1.5e-8, AREA_DP)).toBe('0')
    // 2^53 is where a double stops holding integers exactly; above it there is no fraction at all.
    expect(formatNumber(Number.MAX_SAFE_INTEGER + 1, LENGTH_DP)).toBe('9007199254740992')
  })

  test('writes an area to six decimals', () => {
    // A Ø1,600 circle is π · 800² mm², which is 2.010619298… m² (#62 criterion 2).
    const squareMetres = (Math.PI * 800 * 800) / 1_000_000
    expect(formatNumber(squareMetres, AREA_DP)).toBe('2.010619')
    expect(formatNumber(0.0000005, AREA_DP)).toBe('0.000001')
    expect(formatNumber(1 / 3, AREA_DP)).toBe('0.333333')
  })

  test('writes a leading zero where a spreadsheet would want one', () => {
    expect(formatNumber(0.25, LENGTH_DP)).toBe('0.25')
    expect(formatNumber(-0.25, LENGTH_DP)).toBe('-0.25')
    expect(formatNumber(0.0000001, LENGTH_DP)).toBe('0')
  })

  test('refuses a number that has no digits', () => {
    expect(() => formatNumber(Number.NaN, LENGTH_DP)).toThrow(TypeError)
    expect(() => formatNumber(Number.POSITIVE_INFINITY, LENGTH_DP)).toThrow(TypeError)
    expect(() => formatNumber(Number.NEGATIVE_INFINITY, LENGTH_DP)).toThrow(TypeError)
    expect(() => formatNumber(1, -1)).toThrow(RangeError)
    expect(() => formatNumber(1, 2.5)).toThrow(RangeError)
  })
})

describe('neutralise', () => {
  test.each(['=SUM(A1:A9)', '+1', '-1', '@SUM(A1)', '\tTab first', '\rCR first'])(
    'prefixes a cell a spreadsheet would act on: %j',
    (text) => {
      expect(neutralise(text)).toBe(`'${text}`)
    },
  )

  test('leaves everything else exactly as it was', () => {
    for (const text of ['櫥櫃 600', 'Base Cabinet', '1200', '', ' existing space', 'oak', 'a=b']) {
      expect(neutralise(text)).toBe(text)
    }
  })
})

describe('quote', () => {
  test('quotes only what RFC 4180 says has to be quoted', () => {
    expect(quote('Base Cabinet')).toBe('Base Cabinet')
    expect(quote('Kitchen, ground')).toBe('"Kitchen, ground"')
    expect(quote('Say "hello"')).toBe('"Say ""hello"""')
    expect(quote('two\r\nlines')).toBe('"two\r\nlines"')
    expect(quote('a\nb')).toBe('"a\nb"')
    expect(quote('')).toBe('')
    expect(quote('=SUM(A1:A9)')).toBe('=SUM(A1:A9)')
  })
})
