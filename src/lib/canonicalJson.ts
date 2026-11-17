/**
 * Canonical JSON (RFC 8785 / JCS, #20 §2, §10 S2).
 *
 * Byte-stable serialisation of the plain-JSON value tree: the same value always produces
 * the same bytes, whatever order its object keys were inserted in. That is what makes
 * content hashes, dedupe keys and edit-transaction fingerprints reproducible.
 *
 * Anything that is not a plain-JSON value — `NaN`, `bigint`, functions, symbols,
 * `Date`/`Map`/`Set`/class instances, cycles — throws `CanonicalJsonError` naming the
 * offending path rather than silently serialising something lossy.
 */

/** Thrown for a value canonical JSON cannot represent. `path` locates it, e.g. `$.a[0]`. */
export class CanonicalJsonError extends Error {
  readonly path: string

  constructor(path: string, reason: string) {
    super(`${reason} (at ${path})`)
    this.name = 'CanonicalJsonError'
    this.path = path
  }
}

const encoder = new TextEncoder()

/** Serialise `value` as JCS: sorted keys, no whitespace, `JSON.stringify` primitives. */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$', new Set<object>())
}

/** The UTF-8 bytes of {@link canonicalJson}. */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalJson(value))
}

function serialize(value: unknown, path: string, active: Set<object>): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(path, `${value} is not a JSON number`)
      }
      // JSON.stringify maps -0 to "0", which is what JCS requires.
      return JSON.stringify(value)
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'undefined':
      throw new CanonicalJsonError(path, 'undefined has no JSON representation')
    case 'bigint':
      throw new CanonicalJsonError(path, 'bigint has no JSON representation')
    case 'function':
      throw new CanonicalJsonError(path, 'functions have no JSON representation')
    case 'symbol':
      throw new CanonicalJsonError(path, 'symbols have no JSON representation')
    default:
      break
  }

  if (Array.isArray(value)) {
    if (active.has(value)) throw new CanonicalJsonError(path, 'cyclic reference')
    active.add(value)
    const items = value.map((item, index) => serialize(item, `${path}[${index}]`, active))
    active.delete(value)
    return `[${items.join(',')}]`
  }

  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    const name = (value as object).constructor?.name ?? 'object'
    throw new CanonicalJsonError(path, `${name} is not a plain object`)
  }

  if (active.has(value)) throw new CanonicalJsonError(path, 'cyclic reference')
  active.add(value)

  const record = value as Record<string, unknown>
  // Default Array#sort compares by UTF-16 code units, which is exactly JCS ordering.
  const parts: string[] = []
  for (const key of Object.keys(record).sort()) {
    const child = record[key]
    if (child === undefined) continue
    parts.push(`${JSON.stringify(key)}:${serialize(child, `${path}.${key}`, active)}`)
  }

  active.delete(value)
  return `{${parts.join(',')}}`
}
