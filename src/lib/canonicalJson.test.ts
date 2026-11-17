import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { CanonicalJsonError, canonicalJson, canonicalJsonBytes } from './index'

/** Rebuild `source` as a fresh object literal whose keys appear in `keys` order. */
function withKeys(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // defineProperty, not assignment: a `__proto__` key has to stay an own data property.
  for (const key of keys) {
    Object.defineProperty(out, key, {
      value: source[key],
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The same value with every object's key insertion order re-randomised. */
function reshuffleKeys(value: unknown, next: () => number): unknown {
  if (Array.isArray(value)) return value.map((item) => reshuffleKeys(item, next))
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of shuffled(Object.keys(source), next)) {
      Object.defineProperty(out, key, {
        value: reshuffleKeys(source[key], next),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return out
  }
  return value
}

function normaliseZeros(value: unknown): unknown {
  if (typeof value === 'number' && Object.is(value, -0)) return 0
  if (Array.isArray(value)) return value.map(normaliseZeros)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out = withKeys({}, Object.keys(source))
    for (const key of Object.keys(out)) out[key] = normaliseZeros(source[key])
    return out
  }
  return value
}

/** Runs `run`, asserts it rejected a plain-JSON value, and returns the reported path. */
function rejectionPath(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalJsonError)
    return (error as CanonicalJsonError).path
  }
  throw new Error('expected canonicalJson to throw CanonicalJsonError')
}

describe('canonicalJson', () => {
  it('sorts keys, drops whitespace and keeps nesting', () => {
    expect(canonicalJson({ b: 1, a: [3, { d: null, c: 'x' }] })).toBe('{"a":[3,{"c":"x","d":null}],"b":1}')
  })

  it('omits object properties whose value is undefined', () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}')
    expect(canonicalJson({ a: { b: undefined } })).toBe('{"a":{}}')
  })

  it('serialises -0 as 0', () => {
    expect(canonicalJson({ a: -0 })).toBe('{"a":0}')
    expect(canonicalJson([-0, 0])).toBe('[0,0]')
  })

  it('sorts keys by UTF-16 code units, not locale order', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, _: 4, '0': 5 })).toBe('{"0":5,"B":2,"_":4,"a":3,"b":1}')
  })

  it('accepts a null-prototype object as a plain object', () => {
    const value = Object.assign(Object.create(null), { b: 1, a: 2 })
    expect(canonicalJson(value)).toBe('{"a":2,"b":1}')
  })

  it('allows the same object to appear twice in sibling positions', () => {
    const shared = { a: 1 }
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}')
  })

  it('produces identical bytes for every key insertion order', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.infiniteStream(fc.nat(1_000_000)), (value, seeds) => {
        const draw = seeds[Symbol.iterator]()
        const next = () => (draw.next().value as number) / 1_000_001
        const reference = canonicalJson(value)
        for (let attempt = 0; attempt < 4; attempt++) {
          expect(canonicalJson(reshuffleKeys(value, next))).toBe(reference)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('round-trips through JSON.parse', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(normaliseZeros(value))
      }),
      { numRuns: 200 },
    )
  })

  it('rejects NaN and ±Infinity with the offending path', () => {
    expect(rejectionPath(() => canonicalJson(Number.NaN))).toBe('$')
    expect(rejectionPath(() => canonicalJson({ a: Number.NaN }))).toBe('$.a')
    expect(rejectionPath(() => canonicalJson({ a: [Number.POSITIVE_INFINITY] }))).toBe('$.a[0]')
    expect(rejectionPath(() => canonicalJson({ a: [1, Number.NEGATIVE_INFINITY] }))).toBe('$.a[1]')
  })

  it('rejects bigint, functions and symbols', () => {
    expect(rejectionPath(() => canonicalJson({ a: 10n }))).toBe('$.a')
    expect(rejectionPath(() => canonicalJson({ a: () => 1 }))).toBe('$.a')
    expect(rejectionPath(() => canonicalJson({ a: Symbol('s') }))).toBe('$.a')
  })

  it('rejects undefined inside an array but not inside an object', () => {
    expect(rejectionPath(() => canonicalJson([1, undefined]))).toBe('$[1]')
    expect(rejectionPath(() => canonicalJson({ a: [undefined] }))).toBe('$.a[0]')
    expect(rejectionPath(() => canonicalJson(undefined))).toBe('$')
  })

  it('rejects anything that is not a plain object', () => {
    expect(rejectionPath(() => canonicalJson(new Date()))).toBe('$')
    expect(rejectionPath(() => canonicalJson(new Map()))).toBe('$')
    expect(rejectionPath(() => canonicalJson(new Set([1])))).toBe('$')
    expect(rejectionPath(() => canonicalJson(new Uint8Array(2)))).toBe('$')
    expect(rejectionPath(() => canonicalJson({ a: new Error('boom') }))).toBe('$.a')
    expect(rejectionPath(() => canonicalJson({ a: [new (class Thing {})()] }))).toBe('$.a[0]')
  })

  it('rejects cyclic references', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(rejectionPath(() => canonicalJson(cyclic))).toBe('$.self')

    const list: unknown[] = []
    list.push(list)
    expect(rejectionPath(() => canonicalJson(list))).toBe('$[0]')

    const deep: Record<string, unknown> = {}
    deep.b = { back: deep }
    expect(rejectionPath(() => canonicalJson(deep))).toBe('$.b.back')
  })
})

describe('canonicalJsonBytes', () => {
  it('is the UTF-8 encoding of canonicalJson', () => {
    const value = { b: 1, a: 'héllo ✓' }
    expect(canonicalJsonBytes(value)).toEqual(new TextEncoder().encode(canonicalJson(value)))
  })
})
