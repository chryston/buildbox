/**
 * Numbers and dates as a sheet writes them (#61 §5, §8).
 *
 * The Project stores millimetres and nothing else; the recipe's `unit` and `precision` decide
 * only how a length is *shown*, exactly as the Project's own preferences do on screen. The
 * formula is the one `ui/workspace/displayUnits.ts` uses, repeated here rather than imported
 * because `export` may not import `ui` — and because a drawing that disagreed with the screen
 * about what 605.5 mm is called would be worse than a duplicated division.
 */

import type { DisplayUnit } from '../domain'

/** How many millimetres one display unit is. */
const UNIT_TO_MM: Record<DisplayUnit, number> = { mm: 1, cm: 10, m: 1000 }

/** One measured length, in the recipe's unit at the recipe's precision, with no unit suffix. */
export function formatLength(mm: number, unit: DisplayUnit, precision: number): string {
  return (mm / UNIT_TO_MM[unit]).toFixed(precision)
}

/**
 * The local calendar date as a file name wants it.
 *
 * The clock hands over `YYYY-MM-DD` — the same shape `session`'s `ClockPort.dayKey` answers with
 * — and a file name wants `20261120`. Nothing is parsed or reformatted, because a date that went
 * through `Date` would come out in UTC and a drawing exported at 11 p.m. would be dated tomorrow.
 */
export function fileDate(localDate: string): string {
  return localDate.replace(/-/g, '')
}

/** The local calendar date as the title block prints it. */
export function titleDate(localDate: string): string {
  return localDate
}
