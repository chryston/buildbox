/**
 * Order-preserving sort (#20 §2): the output must not depend on the engine's sort
 * implementation, because cut-list and package bytes are hashed downstream.
 */

/**
 * Returns `items` sorted by `compare`, never mutating the input. Entries that compare
 * equal keep their input order, whatever `compare` does.
 */
export function stableSort<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map((entry) => entry.item)
}
