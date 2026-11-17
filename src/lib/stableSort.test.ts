import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { stableSort } from './index'

/**
 * Decorate-sort-undecorate reference, written independently of `stableSort`: binary
 * insertion into an ever-sorted list, with the input index breaking every tie.
 */
function decorateSortUndecorate<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  const decorated = items.map((item, index) => ({ item, index }))
  const sorted: typeof decorated = []
  for (const entry of decorated) {
    let low = 0
    let high = sorted.length
    while (low < high) {
      const mid = (low + high) >> 1
      const ordering = compare(sorted[mid].item, entry.item)
      if (ordering > 0 || (ordering === 0 && sorted[mid].index > entry.index)) high = mid
      else low = mid + 1
    }
    sorted.splice(low, 0, entry)
  }
  return sorted.map((entry) => entry.item)
}

describe('stableSort', () => {
  it('sorts without mutating its input', () => {
    const input = [3, 1, 2]
    const sorted = stableSort(input, (a, b) => a - b)
    expect(sorted).toEqual([1, 2, 3])
    expect(input).toEqual([3, 1, 2])
  })

  it('returns a new array even when the input is already ordered', () => {
    const input = [1, 2, 3]
    expect(stableSort(input, (a, b) => a - b)).not.toBe(input)
  })

  it('keeps tied entries in input order', () => {
    const input = [
      { key: 1, name: 'a' },
      { key: 0, name: 'b' },
      { key: 1, name: 'c' },
      { key: 0, name: 'd' },
    ]
    expect(stableSort(input, (a, b) => a.key - b.key).map((e) => e.name)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('matches a decorate-sort-undecorate reference with an index tie-break', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ key: fc.integer({ min: -4, max: 4 }), label: fc.string() })),
        (items) => {
          const compare = (a: { key: number }, b: { key: number }) => a.key - b.key
          const before = [...items]
          expect(stableSort(items, compare)).toEqual(decorateSortUndecorate(items, compare))
          expect(items).toEqual(before)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('matches the reference for numbers too', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (items) => {
        const compare = (a: number, b: number) => a - b
        expect(stableSort(items, compare)).toEqual(decorateSortUndecorate(items, compare))
      }),
      { numRuns: 300 },
    )
  })
})
