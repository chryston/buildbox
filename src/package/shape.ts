/**
 * The one canonical shape-guard set for the `.buildbox` codec (#44). Everything that
 * enters `stageImport` is untrusted JSON, so it is narrowed here, once, and every field
 * keeps its own check afterwards.
 *
 * `package/legacy/guards.ts` holds the same idea for the frozen legacy reader. This is
 * deliberately a second file rather than a shared one: the legacy reader is deleted at
 * the S4 cutover and the codec outlives it (#20 §1).
 */

export type UnknownRecord = Record<string, unknown>

/** Narrows to an object with unknown fields — every field still needs its own check. */
export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Text, narrowed. Absence is `undefined`, checked by the caller. */
export const isText = (value: unknown): value is string => typeof value === 'string'

/** A whole number of `min` or more, which is what every count and version in v1 is. */
export const isWholeNumber = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min
