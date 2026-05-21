import { describe, it, expect } from 'vitest'
import { toMm, fromMm, formatDisplay } from './unitConversion'

describe('toMm', () => {
  it('converts mm → mm', () => expect(toMm(100, 'mm')).toBe(100))
  it('converts cm → mm', () => expect(toMm(10, 'cm')).toBe(100))
  it('converts in → mm', () => expect(toMm(1, 'in')).toBeCloseTo(25.4))
})

describe('fromMm', () => {
  it('mm → mm', () => expect(fromMm(100, 'mm')).toBe(100))
  it('mm → cm', () => expect(fromMm(100, 'cm')).toBe(10))
  it('mm → in', () => expect(fromMm(25.4, 'in')).toBeCloseTo(1))
})

describe('formatDisplay', () => {
  it('formats mm', () => expect(formatDisplay(100, 'mm')).toBe('100 mm'))
  it('formats cm to 1dp', () => expect(formatDisplay(105, 'cm')).toBe('10.5 cm'))
  it('formats whole inches', () => expect(formatDisplay(25.4, 'in')).toBe('1"'))
  it('formats fractional inches with GCD reduction', () =>
    expect(formatDisplay(38.1, 'in')).toBe('1 1/2"'))
  it('formats fractional inches 7/8', () =>
    expect(formatDisplay(47.625, 'in')).toBe('1 7/8"'))
  it('formats fractional inches 7/16', () =>
    expect(formatDisplay(11.1125, 'in')).toBe('7/16"'))
  it('formats mixed inches', () => expect(formatDisplay(25.4 * 2.25, 'in')).toBe('2 1/4"'))
})
