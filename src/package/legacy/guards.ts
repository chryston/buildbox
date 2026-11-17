/**
 * The one canonical shape guard for the legacy reader (#40 §1). Untrusted input enters
 * through `read.ts` and is narrowed here, once; `validate.ts`, `migrate.ts` and `read.ts`
 * all import this instead of writing their own.
 */

export type UnknownRecord = Record<string, unknown>

/** Narrows to an object with unknown fields — every field still needs its own check. */
export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * `undefined` and `null` both mean "not there". Immer keeps keys with an explicit
 * `undefined` (treeMutations' `splitNode` writes `spaceLabel: undefined`), so an
 * in-memory value and its JSON form have to agree on what absence means.
 */
export const isAbsent = (value: unknown): boolean => value === undefined || value === null
