/**
 * One-dimensional intervals (#54 §8).
 *
 * Corner radii, chamfers and any two lengths that have to share a side all reduce to two
 * intervals along that side: whether they overlap, touch or leave a straight run between
 * them is the same question, and it is the only place that question gets answered. This
 * prepares Vertical Extents for #74.
 */
import { TOLERANCE_MM } from './types'

/** A closed interval on a line, `lo` never above `hi`. */
export interface Interval {
  lo: number
  hi: number
}

/** The interval between two numbers, whichever way round they came. */
export const interval = (a: number, b: number): Interval => ({ lo: Math.min(a, b), hi: Math.max(a, b) })

/** How much of a line two intervals cover together, which is zero when they only touch. */
export const overlapLength = (a: Interval, b: Interval): number =>
  Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo))

/**
 * Whether two intervals are apart, meet at a point, or run together, all decided at
 * `TOLERANCE_MM`. Touching is not overlap: two corner radii whose sum exactly equals the
 * side between them are valid and simply leave no straight (#54 behaviour 7).
 */
export const classify = (a: Interval, b: Interval): 'separate' | 'touch' | 'overlap' => {
  if (overlapLength(a, b) > TOLERANCE_MM) return 'overlap'
  return Math.max(a.lo, b.lo) - Math.min(a.hi, b.hi) <= TOLERANCE_MM ? 'touch' : 'separate'
}
