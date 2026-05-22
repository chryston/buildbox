import type { Unit } from '../types'

const MM_PER_INCH = 25.4

export function toMm(value: number, unit: Unit): number {
  if (unit === 'cm') return value * 10
  if (unit === 'in') return value * MM_PER_INCH
  return value
}

export function fromMm(mm: number, unit: Unit): number {
  if (unit === 'cm') return mm / 10
  if (unit === 'in') return mm / MM_PER_INCH
  return mm
}

export function formatDisplay(mm: number, unit: Unit): string {
  if (unit === 'mm') return `${Math.round(mm)} mm`
  if (unit === 'cm') return `${(mm / 10).toFixed(1)} cm`
  return formatInches(mm / MM_PER_INCH)
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function formatInches(inches: number): string {
  const whole = Math.floor(inches)
  const sixteenths = Math.round((inches - whole) * 16)

  if (sixteenths === 0) return `${whole}"`
  if (sixteenths === 16) return `${whole + 1}"`

  const g = gcd(sixteenths, 16)
  const num = sixteenths / g
  const den = 16 / g
  const prefix = whole > 0 ? `${whole} ` : ''

  return `${prefix}${num}/${den}"`
}
