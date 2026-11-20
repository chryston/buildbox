import type { Unit } from '../cabinetPayload'
import type { DisplayUnit } from '../project'

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

/** How many millimetres one Project display unit is (#13: a preference, never a rewrite). */
const MM_PER_DISPLAY_UNIT: Record<DisplayUnit, number> = { mm: 1, cm: 10, m: 1000 }

/**
 * One length in millimetres, shown in a Project display unit at a chosen number of decimal
 * places and with no unit suffix.
 *
 * `formatDisplay` above answers in the cabinet payload's units at a fixed precision; this is
 * the Project's own pair of `displayUnit` and `displayPrecision`, which is what a preset name
 * or a readout has to follow so that the same 900 mm reads `0.900` next to a metre-scale
 * drawing. The number is returned bare because a caller that writes `900 × 2100 mm` says the
 * unit once, at the end. Rounding is display-only: nothing here rewrites a stored millimetre.
 */
export function formatLength(mm: number, unit: DisplayUnit, precision: number): string {
  return (mm / MM_PER_DISPLAY_UNIT[unit]).toFixed(precision)
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
