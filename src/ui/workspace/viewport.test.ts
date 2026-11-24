/**
 * `Fit` and cursor-centred zoom, asserted as pure maths: the same numbers the canvas
 * applies, and the reason the cache can store a viewport as three plain numbers.
 */
import { describe, expect, it } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN, clampZoom, EMPTY_FLOOR_MM, fitViewport, planFitViewport, zoomAround } from './viewport'

describe('fitViewport', () => {
  it('centres the content with its margin and never exceeds 10×', () => {
    const vp = fitViewport(1000, 800, 600, 400)
    expect(vp.zoom).toBeCloseTo(1000 / 760, 10) // width-limited: 1000 / (600 + 160)
    expect(vp.panX).toBeCloseTo((1000 - 600 * vp.zoom) / 2, 10)
    expect(vp.panY).toBeCloseTo((800 - 400 * vp.zoom) / 2, 10)
  })

  it('caps a tiny Floor at 10×', () => {
    expect(fitViewport(10000, 8000, 10, 10).zoom).toBe(ZOOM_MAX)
  })

  it('shrinks below 1× for a Floor larger than the host', () => {
    expect(fitViewport(1000, 800, 4000, 3000).zoom).toBeLessThan(1)
  })
})

describe('planFitViewport', () => {
  // The #76 defect: an image-less 4 m floor was fitted to a phantom 800 × 600 box at the
  // origin, so the canvas opened at ~1× on its top-left corner and everything else — here
  // the second Base cabinet at x 1 400 — was drawn off the pane.
  const floorBounds = { x: 300, y: 350, w: 3300, h: 2550 }

  it('fits an image-less Floor to its own bounds, corner and all', () => {
    const vp = planFitViewport(567, 746, null, floorBounds)
    expect(vp.zoom).toBeLessThan(1)
    // The bounds' own box, not the origin's neighbourhood, sits centred in the host.
    const left = floorBounds.x * vp.zoom + vp.panX
    const right = (floorBounds.x + floorBounds.w) * vp.zoom + vp.panX
    const top = floorBounds.y * vp.zoom + vp.panY
    const bottom = (floorBounds.y + floorBounds.h) * vp.zoom + vp.panY
    expect(left).toBeCloseTo(567 - right, 6)
    expect(top).toBeCloseTo(746 - bottom, 6)
    // And the far corner is on the pane, not past it.
    expect(right).toBeLessThanOrEqual(567)
    expect(bottom).toBeLessThanOrEqual(746)
  })

  it('keeps the Plan Image box as the content when there is one', () => {
    const vp = planFitViewport(1000, 800, { w: 600, h: 400 }, floorBounds)
    expect(vp).toEqual(fitViewport(1000, 800, 600, 400))
  })

  it('falls back to the placeholder sheet only for an empty Floor with no image', () => {
    const vp = planFitViewport(1000, 800, null, null)
    expect(vp).toEqual(fitViewport(1000, 800, EMPTY_FLOOR_MM.w, EMPTY_FLOOR_MM.h))
  })
})

describe('zoomAround', () => {
  it('keeps the Floor point under the cursor fixed', () => {
    const vp = { zoom: 1, panX: -100, panY: -50 }
    const next = zoomAround(vp, 1.25, 300, 200)
    expect(next.zoom).toBe(1.25)
    // The Floor point under (300,200) before: (300+100)/1; after: (300-panX')/1.25.
    expect((300 - next.panX) / next.zoom).toBeCloseTo(400, 10)
    expect((200 - next.panY) / next.zoom).toBeCloseTo(250, 10)
  })

  it('clamps at the zoom limits', () => {
    const big = { zoom: 9, panX: 0, panY: 0 }
    expect(zoomAround(big, 1.25, 0, 0).zoom).toBe(ZOOM_MAX)
    const small = { zoom: 0.12, panX: 0, panY: 0 }
    expect(zoomAround(small, 0.8, 0, 0).zoom).toBe(ZOOM_MIN)
  })

  it('clamps plain zoom steps the same way', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN)
    expect(clampZoom(100)).toBe(ZOOM_MAX)
    expect(clampZoom(2)).toBe(2)
  })
})
