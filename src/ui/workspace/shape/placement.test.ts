/**
 * Placing a preset by hand (#58 criteria 2, 3 and the chip half of 22).
 *
 * Criterion 2 asks for a geometry test on the chip rectangles, and the geometry is decided here
 * rather than in markup — so the test that Variant B's defect is gone is arithmetic about two
 * sets of rectangles, not a screenshot someone eyeballed. `e2e/smoke/shape-editor.spec.ts`
 * repeats the same assertion against the boxes the browser actually drew, which is what catches
 * a chip that is placed correctly and then moved by a stylesheet.
 */
import { describe, expect, it } from 'vitest'
import { PRESET_KINDS } from '../../../derive'
import { rectangleFootprint } from '../../../domain'
import {
  CLICK_SLOP_MM,
  DEFAULT_FOOTPRINT_MM,
  chipsFor,
  dragBox,
  isClick,
  placementDefaults,
  placementFootprint,
} from './placement'
import type { DragBox, Rect } from './placement'

/** Two closed rectangles sharing any area at all. Touching along one edge is not sharing. */
const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const asRect = (box: DragBox): Rect => ({
  x: box.minX,
  y: box.minY,
  width: box.maxX - box.minX,
  height: box.maxY - box.minY,
})

const LABELS = { width: 'W 600', depth: 'D 400' }

describe('dragging a box', () => {
  it('proposes the rectangle the box describes, at the box centre (criterion 2)', () => {
    const box = dragBox({ x: 100, y: 100 }, { x: 700, y: 500 })
    const placed = placementFootprint('rectangle', { box }, placementDefaults(null))
    expect(placed).toEqual({
      kind: 'preset',
      preset: { kind: 'rectangle', width: 600, depth: 400 },
      centre: { x: 400, y: 300 },
      orientationDeg: 0,
    })
  })

  it('reads the box the same way whichever corner the drag started from', () => {
    const there = dragBox({ x: 100, y: 100 }, { x: 700, y: 500 })
    const back = dragBox({ x: 700, y: 500 }, { x: 100, y: 100 })
    expect(placementFootprint('rectangle', { box: back }, placementDefaults(null)))
      .toEqual(placementFootprint('rectangle', { box: there }, placementDefaults(null)))
  })

  it('gives every kind its own reading of the same box', () => {
    const box = dragBox({ x: 0, y: 0 }, { x: 1200, y: 400 })
    const size = (kind: (typeof PRESET_KINDS)[number]): unknown =>
      placementFootprint(kind, { box }, placementDefaults(null)).preset
    expect(size('square')).toEqual({ kind: 'square', side: 400 })
    expect(size('circle')).toEqual({ kind: 'circle', diameter: 400 })
    expect(size('capsule')).toEqual({ kind: 'capsule', length: 1200, width: 400 })
    expect(size('triangle')).toEqual({ kind: 'triangle', baseWidth: 1200, depth: 400 })
    expect(size('ellipse')).toEqual({ kind: 'ellipse', width: 1200, depth: 400 })
    // Across corners, not across flats: corners are the part that would poke outside the box.
    const hexagon = size('regularPolygon') as { sideCount: number; sideLength: number }
    expect(hexagon.sideCount).toBe(6)
    expect(hexagon.sideLength).toBeCloseTo(200, 10)
  })
})

describe('clicking', () => {
  it('places the default size centred on the point that was clicked (criterion 3)', () => {
    const placed = placementFootprint('circle', { point: { x: 1500, y: 900 } }, placementDefaults(null))
    expect(placed).toEqual({
      kind: 'preset',
      preset: { kind: 'circle', diameter: DEFAULT_FOOTPRINT_MM },
      centre: { x: 1500, y: 900 },
      orientationDeg: 0,
    })
  })

  it('takes the size the design already had, not a fixed one', () => {
    const defaults = placementDefaults(rectangleFootprint(2600, 1400))
    expect(defaults.size).toEqual({ width: 2600, depth: 1400 })
    const placed = placementFootprint('ellipse', { point: { x: 0, y: 0 } }, defaults)
    expect(placed.preset).toEqual({ kind: 'ellipse', width: 2600, depth: 1400 })
  })

  it('treats a drag shorter than the slop in both axes as the click it was', () => {
    expect(isClick(dragBox({ x: 500, y: 500 }, { x: 500 + CLICK_SLOP_MM, y: 500 }))).toBe(true)
    expect(isClick(dragBox({ x: 500, y: 500 }, { x: 500 + CLICK_SLOP_MM + 1, y: 500 }))).toBe(false)
    // One axis long and one short is still a drag: a thin box is a thing people mean to draw.
    expect(isClick(dragBox({ x: 500, y: 500 }, { x: 500 + CLICK_SLOP_MM, y: 500 + 900 }))).toBe(false)
  })
})

describe('the W and D chips (#58 criterion 22: never over the shape)', () => {
  it('puts W beyond the right edge and D beyond the bottom edge', () => {
    const box = dragBox({ x: 100, y: 100 }, { x: 700, y: 500 })
    const chips = chipsFor(box, LABELS, 1)
    expect(chips.width.label).toBe('W 600')
    expect(chips.depth.label).toBe('D 400')
    expect(chips.width.x).toBeGreaterThan(box.maxX)
    expect(chips.depth.y).toBeGreaterThan(box.maxY)
  })

  it('never meets the box, for any drag and any label', () => {
    const drags: DragBox[] = [
      dragBox({ x: 0, y: 0 }, { x: 1, y: 1 }),
      dragBox({ x: -900, y: -400 }, { x: 300, y: 700 }),
      dragBox({ x: 100, y: 500 }, { x: 700, y: 100 }),
      dragBox({ x: 0, y: 0 }, { x: 24000, y: 18000 }),
      dragBox({ x: 400, y: 400 }, { x: 400, y: 400 }),
    ]
    const labels = [LABELS, { width: 'W 0', depth: 'D 0' }, { width: 'W 24,000', depth: 'D 18,000' }]
    for (const box of drags) {
      for (const label of labels) {
        for (const mmPerPx of [0.2, 1, 7.5]) {
          const chips = chipsFor(box, label, mmPerPx)
          const shape = asRect(box)
          expect(intersects(chips.width, shape), `W over ${JSON.stringify(box)} at ${mmPerPx}`).toBe(false)
          expect(intersects(chips.depth, shape), `D over ${JSON.stringify(box)} at ${mmPerPx}`).toBe(false)
        }
      }
    }
  })

  it('keeps both chips clear of the proposal they describe, not just of the box', () => {
    // The proposal is the shape at the box's size and centre, so its bounds are the box's.
    const box = dragBox({ x: 100, y: 100 }, { x: 700, y: 500 })
    const placed = placementFootprint('rectangle', { box }, placementDefaults(null))
    expect(placed.centre).toEqual({ x: 400, y: 300 })
    const chips = chipsFor(box, LABELS, 3)
    const proposal: Rect = { x: 100, y: 100, width: 600, height: 400 }
    expect(intersects(chips.width, proposal)).toBe(false)
    expect(intersects(chips.depth, proposal)).toBe(false)
  })
})
