/**
 * The sentences the #76 §3 builder's keys grow into.
 *
 * The builder in `derive` picks the branch and hands over raw millimetres; the edge words and the
 * rounding happen here, in the one place a measurement becomes a word. These are the acceptance
 * sentences (criteria 1, 7, 8, 9, 10, 11, 13) checked word for word, and the banned-word scan runs
 * over every sentence the builder can produce for every pair of edge words, so a wording change
 * cannot smuggle one of the forbidden words in through a kind nobody thought to test.
 */
import { describe, expect, it } from 'vitest'
import { VERTICAL_MESSAGE_KEYS, type VerticalKind } from '../../derive'
import { VERTICAL_EDGE_WORDS, WARNING_COPY } from './index'

// The same eight words `strings.test.ts` keeps out of `ui` (#20 §2 keeps `lib` out of `ui`, so
// the list is carried here as it is there); the full scan over shipped strings runs in `app`.
const BANNED = ['compliant', 'safe', 'rated', 'approved', 'code', 'sized for', 'must', 'required']

describe('the vertical sentences (#76 §3)', () => {
  it('says the acceptance sentences exactly', () => {
    expect(WARNING_COPY.vertical_below?.({ a: 'Wall cabinet #1', b: 'Base cabinet #1', aKind: 'placedItem', bKind: 'placedItem', mm: 60 })).toBe(
      'Wall cabinet #1 bottom is 60 mm below Base cabinet #1 top.',
    )
    expect(WARNING_COPY.vertical_above?.({ a: 'Wall cabinet #1', b: 'Beam B-1', aKind: 'placedItem', bKind: 'beam', mm: 40 })).toBe(
      'Wall cabinet #1 top is 40 mm above Beam B-1 underside.',
    )
    expect(WARNING_COPY.vertical_overlap_height?.({ a: 'Shelf #1', b: 'Wall cabinet #1', aKind: 'placedItem', bKind: 'placedItem', mm: 100 })).toBe(
      'Shelf #1 overlaps Wall cabinet #1 over 100 mm of height.',
    )
    expect(WARNING_COPY.vertical_above?.({ a: 'Window WND-1', b: 'Beam B-1', aKind: 'opening', bKind: 'beam', mm: 50 })).toBe(
      'Window WND-1 top is 50 mm above Beam B-1 underside.',
    )
    expect(WARNING_COPY.floor_limit_above?.({ a: 'Beam B-1', aKind: 'beam', mm: 40 })).toBe(
      "Beam B-1 top is 40 mm above this Floor's upper limit.",
    )
    expect(WARNING_COPY.floor_limit_below?.({ a: 'Beam B-1', aKind: 'beam', mm: 30 })).toBe(
      "Beam B-1 underside is 30 mm below this Floor's lower limit.",
    )
    expect(WARNING_COPY.clearance_envelope_intrusion?.({ a: 'Beam B-1', b: 'Wall cabinet #1', m2: 0.4, pct: 12.4 })).toBe(
      "Beam B-1 takes up 0.40 m² (12%) of Wall cabinet #1's Clearance Envelope.",
    )
    expect(WARNING_COPY.floor_limit_above?.({ a: 'Island #1', aKind: 'placedItem', mm: 100 })).toBe(
      "Island #1 top is 100 mm above this Floor's upper limit.",
    )
    expect(WARNING_COPY.floor_limit_below?.({ a: 'Wall W-1', aKind: 'wall', mm: 50 })).toBe(
      "Wall W-1 base is 50 mm below this Floor's lower limit.",
    )
    expect(WARNING_COPY.host_range_above?.({ a: 'Window WND-1', b: 'Wall W-1', aKind: 'opening', mm: 100 })).toBe(
      'Window WND-1 top is 100 mm above host Wall W-1 top.',
    )
    expect(WARNING_COPY.host_range_below?.({ a: 'Hatch H-2', b: 'Wall W-3', aKind: 'opening', mm: 100 })).toBe(
      'Hatch H-2 bottom is 100 mm below host Wall W-3 base.',
    )
    expect(WARNING_COPY.item_into_wall?.({ a: 'Base cabinet #1', b: 'Wall W-1', mm: 40 })).toBe(
      'Base cabinet #1 runs 40 mm into Wall W-1.',
    )
    expect(WARNING_COPY.clearance_envelope_intrusion?.({ a: 'Island', b: 'Fridge', m2: 0.12, pct: 20.4 })).toBe(
      "Island takes up 0.12 m² (20%) of Fridge's Clearance Envelope.",
    )
  })

  it('rounds the same way every other sentence does', () => {
    expect(WARNING_COPY.vertical_overlap_height?.({ a: 'A', b: 'B', aKind: 'placedItem', bKind: 'placedItem', mm: 100.04 })).toBe(
      'A overlaps B over 100 mm of height.',
    )
    expect(WARNING_COPY.vertical_overlap_height?.({ a: 'A', b: 'B', aKind: 'placedItem', bKind: 'placedItem', mm: 100.25 })).toBe(
      'A overlaps B over 100.3 mm of height.',
    )
  })

  it('has a row for every key the builder can name', () => {
    for (const key of VERTICAL_MESSAGE_KEYS) expect(WARNING_COPY[key], `${key} has no copy`).toBeTypeOf('function')
  })

  it('gives every kind a bottom word', () => {
    const kinds: readonly VerticalKind[] = ['placedItem', 'opening', 'skirting', 'service', 'wall', 'beam']
    for (const kind of kinds) expect(VERTICAL_EDGE_WORDS[kind], kind).toBeTypeOf('string')
  })

  it('never says a banned word, in any kind’s sentence (#76 criterion 23)', () => {
    const kinds = Object.keys(VERTICAL_EDGE_WORDS)
    const sentences: string[] = []
    for (const a of kinds) {
      for (const b of kinds) {
        sentences.push(
          WARNING_COPY.vertical_above?.({ a: 'A', b: 'B', aKind: a, bKind: b, mm: 40 }) ?? '',
          WARNING_COPY.vertical_below?.({ a: 'A', b: 'B', aKind: a, bKind: b, mm: 60 }) ?? '',
          WARNING_COPY.vertical_overlap_height?.({ a: 'A', b: 'B', aKind: a, bKind: b, mm: 100 }) ?? '',
          WARNING_COPY.floor_limit_above?.({ a: 'A', aKind: a, mm: 100 }) ?? '',
          WARNING_COPY.floor_limit_below?.({ a: 'A', aKind: a, mm: 50 }) ?? '',
          WARNING_COPY.host_range_above?.({ a: 'A', b: 'W', aKind: a, mm: 100 }) ?? '',
          WARNING_COPY.host_range_below?.({ a: 'A', b: 'W', aKind: a, mm: 100 }) ?? '',
        )
      }
    }
    expect(sentences.length).toBe(kinds.length * kinds.length * 7)
    for (const sentence of sentences) {
      expect(BANNED.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(sentence)), sentence).toEqual([])
    }
  })
})
