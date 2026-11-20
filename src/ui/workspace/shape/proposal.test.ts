/**
 * The invalid-proposal controller, as a state machine (#58 §6, criteria 8–11).
 *
 * Runs under Node on purpose: the controller is the part with the hardest rules against it
 * — one message, nothing written, Esc recovers — and none of them need a browser. The DOM
 * half (which element carries `aria-invalid`, where the message is mounted) is covered by
 * the jsdom tests over the Shape tab.
 */
import { describe, expect, it } from 'vitest'
import {
  canCommit,
  discard,
  ghostFootprint,
  markerPoint,
  markedField,
  needsPreview,
  openShape,
  propose,
  proposalFootprint,
  proposalMessage,
  shownFootprint,
} from './proposal'
import type { ShapeGesture, ShapeTarget } from './proposal'
import { rectangleFootprint } from '../../../domain'
import type { ItemFootprint, Project } from '../../../domain'

const MM: Project['preferences'] = { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 }

const CANVAS: ShapeGesture = { via: 'canvas' }
const field = (name: string): ShapeGesture => ({ via: 'field', field: name })

/** A target around one footprint, with as many placements as the test wants. */
function targetFor(current: ItemFootprint, placementCount = 1): ShapeTarget {
  return { itemDesignId: 'design-1', current, placementCount, format: { unit: MM.displayUnit, precision: MM.displayPrecision } }
}

/** Fixture 8: a Rounded Rectangle 2,000 × 3,000 with a radius at each of two top corners. */
const topRadii = (topRight: number): ItemFootprint => ({
  kind: 'preset',
  preset: {
    kind: 'roundedRectangle',
    width: 2000,
    depth: 3000,
    radii: { topLeft: 1000, topRight, bottomRight: 0, bottomLeft: 0 },
  },
  centre: { x: 1000, y: 1500 },
  orientationDeg: 0,
})

/** Four edges that cross themselves once, at (50, 50). */
const BOWTIE: ItemFootprint = {
  kind: 'path',
  path: {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'line', to: { x: 100, y: 100 } },
      { kind: 'line', to: { x: 100, y: 0 } },
      { kind: 'line', to: { x: 0, y: 100 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ],
  },
}

describe('opening a shape editor', () => {
  it('starts with nothing proposed and the committed shape kept back', () => {
    const target = targetFor(topRadii(1000))
    const draft = openShape(target)
    expect(draft.proposal.state).toBe('idle')
    expect(canCommit(draft)).toBe(false)
    expect(proposalMessage(draft)).toBeNull()
    expect(ghostFootprint(draft)).toBeNull()
    expect(proposalFootprint(draft)).toBeNull()
    expect(shownFootprint(draft, target.current)).toBe(target.current)
  })
})

describe('a valid proposal', () => {
  it('may be committed, and moves the ghost forward', () => {
    const target = targetFor(topRadii(1000))
    const draft = propose(target, openShape(target), field('topRight'), topRadii(900))
    expect(draft.proposal.state).toBe('valid')
    expect(canCommit(draft)).toBe(true)
    expect(proposalMessage(draft)).toBeNull()
    // A valid proposal is drawn as itself, not as a ghost.
    expect(ghostFootprint(draft)).toBeNull()
    expect(draft.lastValid).toEqual(topRadii(900))
  })

  it('is what the fields read back, so a second edit continues from it', () => {
    const target = targetFor(topRadii(1000))
    const draft = propose(target, openShape(target), field('topRight'), topRadii(900))
    expect(shownFootprint(draft, target.current)).toEqual(topRadii(900))
  })
})

describe('fixture 8 — the radius that overlaps (#58 criterion 8)', () => {
  const target = targetFor(topRadii(1000))
  const invalid = propose(target, openShape(target), field('topRight'), topRadii(1001))

  it('refuses 1,001 in the kernel\'s one sentence', () => {
    expect(invalid.proposal.state).toBe('invalid')
    expect(proposalMessage(invalid)).toBe('Corner radii on the top side overlap (1,000 + 1,001 > 2,000 mm)')
  })

  it('marks the field that was typed into', () => {
    expect(markedField(invalid)).toBe('topRight')
  })

  it('keeps the 1,000 version as the ghost', () => {
    expect(ghostFootprint(invalid)).toEqual(topRadii(1000))
    expect(proposalFootprint(invalid)).toEqual(topRadii(1001))
  })

  it('refuses to commit', () => {
    expect(canCommit(invalid)).toBe(false)
  })

  it('writes nothing: the target still holds the shape it was handed', () => {
    const before = target.current
    propose(target, invalid, field('topRight'), topRadii(1001))
    expect(target.current).toBe(before)
    expect(target.current).toEqual(topRadii(1000))
  })

  it('keeps showing the committed 1,000 after a second bad keystroke', () => {
    const worse = propose(target, invalid, field('topRight'), topRadii(1002))
    expect(ghostFootprint(worse)).toEqual(topRadii(1000))
  })

  it('recovers when the value is corrected', () => {
    const corrected = propose(target, invalid, field('topRight'), topRadii(1000))
    expect(canCommit(corrected)).toBe(true)
    expect(proposalMessage(corrected)).toBeNull()
    expect(markedField(corrected)).toBeNull()
  })

  it('recovers on Esc, and the field reads 1,000 again', () => {
    const escaped = discard(invalid)
    expect(escaped.proposal.state).toBe('idle')
    expect(shownFootprint(escaped, target.current)).toEqual(topRadii(1000))
    expect(proposalMessage(escaped)).toBeNull()
  })

  it('discards on selecting away, which is the same transition', () => {
    expect(discard(invalid)).toEqual(discard(invalid))
  })
})

describe('where the one message goes', () => {
  it('marks no field for a canvas gesture, which has none', () => {
    const target = targetFor(BOWTIE)
    const draft = propose(target, openShape(target), CANVAS, rectangleFootprint(0, 400))
    expect(markedField(draft)).toBeNull()
    expect(proposalMessage(draft)).toBe('The size needs to be more than zero')
  })

  it('says it once, and never with a coordinate pair (criterion 11)', () => {
    const twoEdges: ItemFootprint = {
      kind: 'path',
      path: {
        start: { x: 0, y: 0 },
        segments: [
          { kind: 'line', to: { x: 100, y: 0 } },
          { kind: 'line', to: { x: 0, y: 0 } },
        ],
      },
    }
    const target = targetFor(topRadii(1000))
    const messages = [BOWTIE, topRadii(1001), rectangleFootprint(0, 400), twoEdges].map(
      (footprint) => proposalMessage(propose(target, openShape(target), CANVAS, footprint)),
    )
    expect(messages).toEqual([
      'Edges 1 and 3 cross here',
      'Corner radii on the top side overlap (1,000 + 1,001 > 2,000 mm)',
      'The size needs to be more than zero',
      'A shape needs at least 3 edges',
    ])
    for (const message of messages) {
      expect(message).not.toMatch(/\(\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*\)/)
    }
  })

  it('marks the crossing point on the canvas', () => {
    const target = targetFor(topRadii(1000))
    expect(markerPoint(propose(target, openShape(target), CANVAS, BOWTIE))).toEqual({ x: 50, y: 50 })
  })

  it('marks the middle of the side whose radii overlap', () => {
    const target = targetFor(topRadii(1000))
    const refused = propose(target, openShape(target), field('topRight'), topRadii(1001))
    // The failure is a side, not a point, so the place is its middle: the top side of a
    // 2,000 × 3,000 Rounded Rectangle whose origin sits at (1,000, 1,500) runs at y = 0.
    expect(markerPoint(refused)).toEqual({ x: 1000, y: 0 })
  })

  it('has no marker when the failure has no place', () => {
    const target = targetFor(topRadii(1000))
    expect(markerPoint(propose(target, openShape(target), CANVAS, rectangleFootprint(0, 400)))).toBeNull()
  })
})

describe('an adapter that refuses for its own reasons', () => {
  it('says the adapter\'s sentence, once, with no marker', () => {
    const target: ShapeTarget = {
      ...targetFor(rectangleFootprint(600, 400)),
      refuse: () => 'A cabinet\'s Item Footprint comes from its construction',
    }
    const draft = propose(target, openShape(target), field('width'), rectangleFootprint(700, 400))
    expect(canCommit(draft)).toBe(false)
    expect(proposalMessage(draft)).toBe('A cabinet\'s Item Footprint comes from its construction')
    expect(markerPoint(draft)).toBeNull()
    expect(markedField(draft)).toBe('width')
  })

  it('lets a valid shape through when the adapter is content', () => {
    const target: ShapeTarget = { ...targetFor(rectangleFootprint(600, 400)), refuse: () => null }
    expect(canCommit(propose(target, openShape(target), CANVAS, rectangleFootprint(700, 400)))).toBe(true)
  })
})

describe('the shared-placement rule (#57 D3)', () => {
  it('commits one placement directly and previews two', () => {
    const footprint = rectangleFootprint(600, 400)
    expect(needsPreview(targetFor(footprint, 0))).toBe(false)
    expect(needsPreview(targetFor(footprint, 1))).toBe(false)
    expect(needsPreview(targetFor(footprint, 2))).toBe(true)
  })
})
