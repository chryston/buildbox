/**
 * Display-unit formatting for the Floor workspace (#55).
 *
 * The Project stores millimetres and nothing else (#13); the unit and precision in
 * `preferences` decide only how those millimetres are *shown* and what a typed number
 * *means*. Display rounding is never written back: a 605.5 mm width shown as `606` at
 * `mm` / 0 dp is still 605.5 mm in the Project.
 *
 * The factors are exact powers of ten, but `60.55 * 10` is not exactly 605.5 in binary
 * floating point, so a conversion is rounded to the nanometre — the finest resolution a
 * person can type at any supported unit — which keeps `60.55` cm exactly 605.5 mm.
 */
import type { DisplayUnit } from '../../domain'

/** How many millimetres one display unit is. */
export const UNIT_TO_MM: Record<DisplayUnit, number> = { mm: 1, cm: 10, m: 1000 }

/** The precision a unit starts with when the person switches to it (#55 criterion 5). */
export const DEFAULT_PRECISION: Record<DisplayUnit, number> = { mm: 0, cm: 1, m: 3 }

/** One measured length, shown in the Project's display unit at the Project's precision. */
export function formatMm(mm: number, unit: DisplayUnit, precision: number): string {
  return (mm / UNIT_TO_MM[unit]).toFixed(precision)
}

/** A number typed in the display unit, converted to exact millimetres. */
export function parseToMm(value: number, unit: DisplayUnit): number {
  return Number((value * UNIT_TO_MM[unit]).toFixed(6))
}

/**
 * A number being read rather than typed: grouped, with the unit after it.
 *
 * An input wants `5027` — group separators are characters a caret cannot sit between, and a
 * field has to hold what it parses. A readout wants the opposite: `5,027 mm` is scannable and
 * says what it is, and a Measurements panel with four bare numbers in it leaves the person
 * working out which of them are millimetres.
 */
export function readoutMm(mm: number, unit: DisplayUnit, precision: number): string {
  const value = mm / UNIT_TO_MM[unit]
  const grouped = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value)
  return `${grouped} ${unit}`
}
