/**
 * Records leave this adapter frozen (#45 case 8): a port never hands out something its
 * caller can mutate, because `session` compares what it saved against what it read.
 *
 * IndexedDB already did the expensive half. Every value crossing the store boundary is a
 * structured clone, so a read is a private copy that shares nothing with the store or with
 * the object that was written; all that is left is to freeze that copy in place. A `Blob` is
 * immutable already and is left exactly as it is.
 */
export function frozen<T>(value: T): T {
  return freezeDeep(value) as T
}

function freezeDeep(value: unknown): unknown {
  if (value instanceof Blob || Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item)
    return Object.freeze(value)
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) freezeDeep(record[key])
    return Object.freeze(record)
  }
  return value
}
