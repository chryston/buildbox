/**
 * The §3 copy builder (#76): every branch, the subject choice, the overlap measure.
 *
 * The sentences the keys grow into — and the banned-word scan over them — live beside the copy
 * table in `ui/strings/verticalCopy.test.ts`: `derive` may not reach `ui`, and the pair of a
 * branch here and a row there is only visible from the side that can see both.
 */
import { describe, expect, it } from 'vitest'
import {
  chooseVerticalSubject,
  floorLimitCopy,
  hostRangeCopy,
  verticalOverlap,
  verticalRelationCopy,
  VERTICAL_MESSAGE_KEYS,
  type VerticalSubject,
} from './verticalCopy'

const item = (id: string, label: string, bottom: number, top: number): VerticalSubject => ({
  id,
  kind: 'placedItem',
  label,
  extent: { bottom, top },
})

describe('the vertical relation copy (#76 §3)', () => {
  it('says above when the subject starts and ends below the other', () => {
    const cabinet = item('d1', 'Wall cabinet #1', 860, 1560)
    const beam: VerticalSubject = { id: 'b1', kind: 'beam', label: 'Beam B-1', extent: { bottom: 1520, top: 1720 } }
    const copy = verticalRelationCopy(cabinet, beam)
    expect(copy.messageKey).toBe('vertical_above')
    expect(copy.params).toEqual({ a: 'Wall cabinet #1', b: 'Beam B-1', aKind: 'placedItem', bKind: 'beam', mm: 40 })
    expect(copy.measured).toEqual({ mm: 40 })
  })

  it('says below when the subject starts and ends above the other', () => {
    const [s, o] = chooseVerticalSubject(item('wc', 'Wall cabinet #1', 860, 1560), item('bc', 'Base cabinet #1', 0, 920))
    const copy = verticalRelationCopy(s, o)
    expect(copy.messageKey).toBe('vertical_below')
    expect(copy.measured).toEqual({ mm: 60 })
  })

  it('says over when one extent contains the other end', () => {
    const shelf = item('sh', 'Shelf #1', 1600, 1700)
    const cabinet = item('wc', 'Wall cabinet #1', 1500, 2200)
    const [s, o] = chooseVerticalSubject(shelf, cabinet)
    expect(s.label).toBe('Shelf #1') // the higher bottom is the subject (criterion 7)
    const copy = verticalRelationCopy(s, o)
    expect(copy.messageKey).toBe('vertical_overlap_height')
    expect(copy.measured).toEqual({ mm: 100 })
  })

  it('keeps the millimetres unrounded for measured_mm', () => {
    const copy = verticalRelationCopy(item('a', 'A', 0, 100.25), item('b', 'B', 100.15, 200))
    expect(copy.measured.mm).toBeCloseTo(0.1, 10)
  })

  it('measures the overlap of two extents, zero for a pair that only touches', () => {
    expect(verticalOverlap({ bottom: 0, top: 100 }, { bottom: 100, top: 200 })).toBe(0)
    expect(verticalOverlap({ bottom: 0, top: 100 }, { bottom: 40, top: 200 })).toBe(60)
    expect(verticalOverlap({ bottom: 0, top: 100 }, { bottom: 120, top: 200 })).toBe(-20)
  })
})

describe('the subject choice for a symmetric pair (#76 §3)', () => {
  it('takes the higher bottom first', () => {
    const [s] = chooseVerticalSubject(item('low', 'Low', 0, 5000), item('high', 'High', 100, 200))
    expect(s.id).toBe('high')
  })

  it('takes the higher top when the bottoms are equal', () => {
    const [s] = chooseVerticalSubject(item('short', 'Short', 0, 500), item('tall', 'Tall', 0, 2000))
    expect(s.id).toBe('tall')
  })

  it('takes the lower stable ID when the extents are equal', () => {
    const [s] = chooseVerticalSubject(item('item-b', 'B', 0, 100), item('item-a', 'A', 0, 100))
    expect(s.id).toBe('item-a')
  })

  it('is symmetric: swapping the input order picks the same subject', () => {
    const a = item('a', 'A', 30, 90)
    const b = item('b', 'B', 10, 200)
    expect(chooseVerticalSubject(a, b)[0]!.id).toBe(chooseVerticalSubject(b, a)[0]!.id)
  })
})

describe('the Floor-limit and host-range copy (#76 §3)', () => {
  it('names the upper limit with the overshoot', () => {
    const copy = floorLimitCopy(item('i', 'Island #1', 2400, 2700), 'above', 100)
    expect(copy.messageKey).toBe('floor_limit_above')
    expect(copy.params).toEqual({ a: 'Island #1', aKind: 'placedItem', mm: 100 })
    expect(copy.measured).toEqual({ mm: 100 })
  })

  it('names the lower limit in the kind’s bottom word', () => {
    const wall: VerticalSubject = { id: 'w', kind: 'wall', label: 'Wall W-1', extent: { bottom: -50, top: 2600 } }
    const copy = floorLimitCopy(wall, 'below', 50)
    expect(copy.messageKey).toBe('floor_limit_below')
    expect(copy.params.aKind).toBe('wall')
  })

  it('names the host and the side it reaches past', () => {
    const window: VerticalSubject = { id: 'o', kind: 'opening', label: 'Window WND-1', extent: { bottom: 1500, top: 2700 } }
    const copy = hostRangeCopy(window, 'Wall W-1', 'above', 100)
    expect(copy.messageKey).toBe('host_range_above')
    expect(copy.params).toEqual({ a: 'Window WND-1', b: 'Wall W-1', aKind: 'opening', mm: 100 })
    expect(hostRangeCopy(window, 'Wall W-1', 'below', 100).messageKey).toBe('host_range_below')
  })

  it('names keys the copy table all has rows for', () => {
    expect([...VERTICAL_MESSAGE_KEYS].sort()).toEqual(
      [
        'floor_limit_above',
        'floor_limit_below',
        'host_range_above',
        'host_range_below',
        'vertical_above',
        'vertical_below',
        'vertical_overlap_height',
      ].sort(),
    )
  })
})
