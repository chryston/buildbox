/**
 * Keeping a view's name and far edge on the screen (#75 §3).
 *
 * A view line near the edge of a Floor is normal, and so is zooming in until the whole prism is off
 * the canvas. Neither may take the label with it: the name is how a person finds the view again, and
 * the far-edge handle is the only way to change the depth without the card. The keep-out band is
 * stated in screen pixels, which is what makes the same rule hold at `Fit` and at 400% — the two
 * zooms every case below runs at.
 */
import { describe, expect, it } from 'vitest'
import type { Viewport } from '../viewport'
import { canvasBounds, clampPointToCanvas } from './elevationDraft'

const VIEWPORT = (zoom: number, panX = 0, panY = 0): Viewport => ({ zoom, panX, panY })

/** A canvas 800 × 600 CSS pixels, which is the size the e2e workspace opens at. */
const W = 800
const H = 600
const MARGIN = 48

describe('the visible rectangle of a canvas', () => {
  it('is the whole Floor at zoom 1 with no pan', () => {
    expect(canvasBounds(VIEWPORT(1), W, H, 0)).toEqual({ left: 0, top: 0, right: W, bottom: H })
  })

  it('moves with the pan and scales with the zoom', () => {
    // Half a millimetre per pixel, panned 200 px right and 100 px down.
    expect(canvasBounds(VIEWPORT(0.5, 200, 100), W, H, 0)).toEqual({
      left: -400,
      top: -200,
      right: 1200,
      bottom: 1000,
    })
  })

  it('answers nothing before the host has a size, or when the margins leave no inside', () => {
    expect(canvasBounds(VIEWPORT(1), 0, 600, MARGIN)).toBeNull()
    expect(canvasBounds(VIEWPORT(1), 60, 600, MARGIN)).toBeNull()
  })
})

describe('a point kept inside the canvas', () => {
  it('is left alone when it is already inside', () => {
    expect(clampPointToCanvas({ x: 400, y: 300 }, VIEWPORT(1), W, H, MARGIN)).toEqual({ x: 400, y: 300 })
  })

  it('comes back to the same margin from the same edge at either zoom', () => {
    // y=200 is inside both canvases; 300 would be off the bottom of the 400 × 300 mm one.
    const offRight = { x: 10_000, y: 200 }
    const atOne = clampPointToCanvas(offRight, VIEWPORT(1), W, H, MARGIN)
    // Twice the zoom halves the Floor visible in the same 800 px, so the same screen margin is half
    // as many millimetres — and the point lands 48 px from the edge in Floor terms either way.
    const atTwo = clampPointToCanvas(offRight, VIEWPORT(2), W, H, MARGIN)
    expect(atOne.x).toBe(W - MARGIN)
    expect(atTwo.x).toBe((W - MARGIN) / 2)
    expect(atOne.y).toBe(200)
    expect(atTwo.y).toBe(200)
  })

  it('pulls a label back from above and from below by the same screen distance', () => {
    const above = clampPointToCanvas({ x: 400, y: -5000 }, VIEWPORT(1), W, H, MARGIN)
    const below = clampPointToCanvas({ x: 400, y: 5000 }, VIEWPORT(1), W, H, MARGIN)
    expect(above.y).toBe(MARGIN)
    expect(below.y).toBe(H - MARGIN)
  })

  it('stays where it is when there is no canvas to be inside yet', () => {
    expect(clampPointToCanvas({ x: 900, y: 900 }, VIEWPORT(1), 0, 0, MARGIN)).toEqual({ x: 900, y: 900 })
  })

  it('follows a pan, so a label clamped while panning does not jump back', () => {
    // Panning the paper 300 px to the left moves the visible window 300 mm to the right.
    const panned = VIEWPORT(1, -300, 0)
    const at = clampPointToCanvas({ x: -10_000, y: 300 }, panned, W, H, MARGIN)
    expect(at.x).toBe(300 + MARGIN)
  })
})
