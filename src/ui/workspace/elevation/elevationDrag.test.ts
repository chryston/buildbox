import { describe, expect, it } from 'vitest'
import {
  draggedEdges,
  draggedEdgesAreInvalid,
  elevationChipText,
  elevationCommit,
  elevationHandleKinds,
} from './elevationDrag'

/** A cabinet base at 0 and a top at 860 mm, the shape the issue's examples are written on. */
const CABINET = { bottom: 0, top: 860 }

describe('the handles an entity offers', () => {
  it('gives an entity that owns its height three, and a Placed Item only the move', () => {
    // Criterion 10: a Placed Item's size belongs to its Item Design, so its top is never a handle.
    expect(elevationHandleKinds('wall')).toEqual(['top', 'bottom', 'body'])
    expect(elevationHandleKinds('opening')).toEqual(['top', 'bottom', 'body'])
    expect(elevationHandleKinds('item')).toEqual(['body'])
  })
})

describe('a drag on one handle', () => {
  it('moves only the edge that handle owns', () => {
    expect(draggedEdges('top', CABINET, -40)).toEqual({ bottom: 0, top: 820 })
    expect(draggedEdges('bottom', CABINET, -640)).toEqual({ bottom: -640, top: 860 })
    // A body drag keeps the height: both edges take the same delta.
    expect(draggedEdges('body', CABINET, 200)).toEqual({ bottom: 200, top: 1060 })
  })

  it('refuses a resize that would turn the extent inside out', () => {
    expect(draggedEdgesAreInvalid('top', { bottom: 800, top: 200 })).toBe(true)
    expect(draggedEdgesAreInvalid('bottom', { bottom: 800, top: 200 })).toBe(true)
    expect(draggedEdgesAreInvalid('body', { bottom: 800, top: 200 })).toBe(false)
    expect(draggedEdgesAreInvalid('top', CABINET)).toBe(false)
  })
})

describe('the field a finished drag writes', () => {
  it('writes the base for a move, and the bottom for a drag that holds the top', () => {
    expect(elevationCommit('body', 'wall', { bottom: 200, top: 1060 })).toEqual({ field: 'base', value: 200 })
    // A bottom drag resizes with the top fixed (#75 §6 behaviour 11), which is not the move the
    // inspector's `base` box makes — the height is what changes, and the handler needs to know that.
    expect(elevationCommit('bottom', 'wall', { bottom: -640, top: 860 })).toEqual({ field: 'bottom', value: -640 })
    expect(elevationCommit('bottom', 'opening', { bottom: 550, top: 2100 })).toEqual({ field: 'bottom', value: 550 })
  })

  it('writes the height for a top drag on an entity that owns one', () => {
    // The bottom is fixed, so the change is the distance between the edges — the field the entity owns.
    expect(elevationCommit('top', 'wall', { bottom: 0, top: 2300 })).toEqual({ field: 'height', value: 2300 })
    expect(elevationCommit('top', 'opening', { bottom: 860, top: 2160 })).toEqual({ field: 'height', value: 1300 })
  })

  it('writes the top for a Placed Item, which owns no height of its own', () => {
    expect(elevationCommit('body', 'item', { bottom: 200, top: 1060 })).toEqual({ field: 'top', value: 1060 })
    expect(elevationCommit('top', 'item', { bottom: 0, top: 900 })).toEqual({ field: 'top', value: 900 })
  })

  it('rounds to the millimetre the document stores', () => {
    expect(elevationCommit('bottom', 'wall', { bottom: 859.6, top: 1860 })).toEqual({ field: 'bottom', value: 860 })
  })
})

describe('the chip beside the ghost', () => {
  it('shows the base and its change for a body and a bottom drag', () => {
    // The issue's own examples, separator and minus sign included.
    expect(elevationChipText('body', { bottom: 220, top: 1080 }, CABINET)).toBe('Base 220 mm · Δ 220')
    // A bottom drag is a resize, so it carries the height the drag left behind.
    expect(elevationChipText('bottom', { bottom: -640, top: 860 }, { bottom: 0, top: 860 }))
      .toBe('Base −640 mm · Δ −640 · Height 1500 mm')
  })

  it('shows the top for a top drag, and the height only when the drag changes it', () => {
    expect(elevationChipText('top', { bottom: 0, top: 2160 }, { bottom: 0, top: 2200 }))
      .toBe('Top 2160 mm · Δ −40 · Height 2160 mm')
    // A move leaves the height alone, so saying so would be noise.
    expect(elevationChipText('body', { bottom: 100, top: 960 }, CABINET)).toBe('Base 100 mm · Δ 100')
  })

  it('writes a rise without a plus sign', () => {
    expect(elevationChipText('top', { bottom: 0, top: 900 }, CABINET)).toBe('Top 900 mm · Δ 40 · Height 900 mm')
  })
})
