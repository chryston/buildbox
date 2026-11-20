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

/**
 * Unicode code-point order, which is what the export contract means by "code-point order"
 * (#62 §7): the `<` operator compares UTF-16 code units, and so sorts every astral
 * character — an emoji, a rare CJK ideograph — below U+FFFF, where a reader looking at a
 * code chart would put it above. Names, IDs and multi-value cells all sort this way, so
 * one comparator serves every table rather than one per call site.
 */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0
  const left = [...a]
  const right = [...b]
  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    const one = left[index]!.codePointAt(0)!
    const other = right[index]!.codePointAt(0)!
    if (one !== other) return one - other
  }
  return left.length - right.length
}
