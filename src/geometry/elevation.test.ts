/**
 * The Elevation View's band and what it does to a shape (#75 §4), measured against the four things the
 * issue states about it: which side the view looks from, that the far edge is included, that content
 * beyond an end of the line is clipped at the view edge, and that a line at any angle projects to the
 * expected place — criterion 6's 0.01 mm, criterion 7's arrow inside the band, criterion 10's two
 * boundary cases and criterion 13's heavier outline.
 */
import { describe, expect, it } from 'vitest'
import {
  alongElevation,
  elevationCoords,
  elevationDistance,
  elevationFrame,
  insideElevationBand,
  projectElevationOutline,
  wallBodyOutline,
} from './index'
import type { Pt } from './index'

/** The Kitchen elevation of the #75 scene: a line across the room at y = 1 400, 2 000 deep. */
const KITCHEN = elevationFrame({ start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } }, 'left', 2000)

const rect = (xMin: number, yMin: number, xMax: number, yMax: number): Pt[] => [
  { x: xMin, y: yMin },
  { x: xMax, y: yMin },
  { x: xMax, y: yMax },
  { x: xMin, y: yMax },
]

const near = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(0.01)
}

describe('the frame (#75 §4)', () => {
  it('takes its along-axis from the line and its normal from the side, on the Wall-face convention', () => {
    // u = (1, 0): the reference normal of a Wall running that way is (-u.y, u.x) = (0, 1), so `right`
    // is +y and `left` is -y — the same reading a Wall's two faces get (#64).
    expect(KITCHEN.u).toEqual({ x: 1, y: 0 })
    expect(KITCHEN.n).toEqual({ x: 0, y: -1 })
    expect(KITCHEN.length).toBe(4000)
    const right = elevationFrame({ start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } }, 'right', 2000)
    expect(right.n).toEqual({ x: 0, y: 1 })
  })

  it('turns the pair with the line, so any angle is the same arithmetic', () => {
    const frame = elevationFrame({ start: { x: 0, y: 0 }, end: { x: 1000, y: 1000 } }, 'left', 500)
    near(frame.u.x, Math.SQRT1_2)
    near(frame.u.y, Math.SQRT1_2)
    near(frame.n.x, Math.SQRT1_2)
    near(frame.n.y, -Math.SQRT1_2)
    near(alongElevation(frame, { x: 1000, y: 1000 }), Math.hypot(1000, 1000))
    near(elevationDistance(frame, { x: 1000, y: 1000 }), 0)
  })

  it('bounds a band of no width for a line of no length, which the validator refuses outright', () => {
    const frame = elevationFrame({ start: { x: 10, y: 10 }, end: { x: 10, y: 10 } }, 'left', 500)
    expect(frame.length).toBe(0)
    expect(insideElevationBand(frame, { x: 10, y: 10 })).toBe(true)
    expect(insideElevationBand(frame, { x: 11, y: 10 })).toBe(false)
  })
})

describe('the band (#75 criterion 7, criterion 10)', () => {
  it('holds everything between the line and the far edge, the far edge included', () => {
    expect(insideElevationBand(KITCHEN, { x: 0, y: 1400 })).toBe(true)
    expect(insideElevationBand(KITCHEN, { x: 2000, y: 1400 })).toBe(true)
    expect(insideElevationBand(KITCHEN, { x: 2000, y: 1400 - 1999 })).toBe(true)
    // Touching the far edge exactly is in; a millimetre past it is out.
    expect(insideElevationBand(KITCHEN, { x: 2000, y: 1400 - 2000 })).toBe(true)
    expect(insideElevationBand(KITCHEN, { x: 2000, y: 1400 - 2001 })).toBe(false)
    // The other side of the line is not the view at all.
    expect(insideElevationBand(KITCHEN, { x: 2000, y: 1401 })).toBe(false)
  })

  it('ends at the ends of the line, not at the room', () => {
    expect(insideElevationBand(KITCHEN, { x: -1, y: 1000 })).toBe(false)
    expect(insideElevationBand(KITCHEN, { x: 4001, y: 1000 })).toBe(false)
    expect(insideElevationBand(KITCHEN, { x: 0, y: 1000 })).toBe(true)
    expect(insideElevationBand(KITCHEN, { x: 4000, y: 1000 })).toBe(true)
  })

  it('keeps the plan marker’s arrow tip inside it, whichever side the view looks from', () => {
    for (const side of ['left', 'right'] as const) {
      const frame = elevationFrame({ start: { x: 400, y: 200 }, end: { x: 2598, y: 1460 } }, side, 2400)
      // The marker's arrow stands at the line's midpoint and points along `n`, into the band.
      const tip = { x: (400 + 2598) / 2 + frame.n.x * 200, y: (200 + 1460) / 2 + frame.n.y * 200 }
      expect(insideElevationBand(frame, tip)).toBe(true)
    }
  })
})

describe('projecting a shape (#75 criterion 6, criterion 10, criterion 12)', () => {
  it('puts a Placed Item at the expected place along a line at 30° to the plan axes', () => {
    // The scene's Angled elevation: direction (2 198, 1 260), 29.86°, 2 531.6 mm long.
    const frame = elevationFrame({ start: { x: 400, y: 200 }, end: { x: 2598, y: 1460 } }, 'right', 2400)
    const at = { x: 600, y: 600 }
    const expectedS = (600 - 400) * frame.u.x + (600 - 200) * frame.u.y
    near(alongElevation(frame, at), expectedS)
    // The same place read off the projection of a footprint standing on it.
    const footprint = rect(600, 600, 1460, 1260)
    const seen = projectElevationOutline(frame, footprint)
    expect(seen.inside).toBe(true)
    expect(seen.sMin).toBeLessThanOrEqual(expectedS + 0.01)
    expect(seen.distance).toBeGreaterThanOrEqual(-0.01)
  })

  it('clips a shape that reaches past both ends of the line to the view edge', () => {
    // W-1 of the scene: 4 200 of Wall body across a 4 000 line, 1 300–1 500 into the band.
    const body = wallBodyOutline({ x: 0, y: 0 }, { x: 4000, y: 0 }, 200)
    const seen = projectElevationOutline(KITCHEN, body)
    expect(seen.inside).toBe(true)
    expect([seen.sMin, seen.sMax]).toEqual([0, 4000])
    near(seen.distance, 1300)
  })

  it('is not in the view at all when only the far side of the line holds it', () => {
    // The scene's Tall cupboard at y = 2 400: behind the viewer.
    const seen = projectElevationOutline(KITCHEN, rect(3000, 2400, 3600, 2500))
    expect(seen.inside).toBe(false)
    expect(seen.distance).toBe(Number.POSITIVE_INFINITY)
  })

  it('takes its distance from the nearest part of it, which is what painter’s order reads', () => {
    const near_ = projectElevationOutline(KITCHEN, rect(600, 1399, 700, 1400))
    const far = projectElevationOutline(KITCHEN, rect(600, -599, 700, -598))
    near(near_.distance, 0)
    near(far.distance, 1998)
    expect(near_.distance).toBeLessThan(far.distance)
  })

  it('includes a shape that touches the far edge exactly', () => {
    // Stands from 1 900 to 2 100 into the band: only its near edge is in, and that is enough.
    const touching = projectElevationOutline(KITCHEN, rect(600, -700, 700, -600))
    expect(touching.inside).toBe(true)
    near(touching.distance, 2000)
  })
})

describe('the heavier outline (#75 criterion 13)', () => {
  it('marks content the view line runs through, and content it runs along', () => {
    const wall = wallBodyOutline({ x: 0, y: 0 }, { x: 4000, y: 0 }, 200)
    // A Wall the band looks at from 1 300 mm away is seen whole, not cut.
    expect(projectElevationOutline(KITCHEN, wall).crossesLine).toBe(false)
    // A Wall the line itself passes through is cut.
    const cut = elevationFrame({ start: { x: 2000, y: -2000 }, end: { x: 2000, y: 2000 } }, 'left', 1000)
    expect(projectElevationOutline(cut, rect(1900, 500, 2100, 900)).crossesLine).toBe(true)
    // A shape the line lies along is cut too — its outline is on the line for its whole length.
    const along = elevationFrame({ start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } }, 'left', 1000)
    expect(projectElevationOutline(along, rect(1000, -100, 2000, 0)).crossesLine).toBe(true)
  })

  it('does not mark content beyond an end of the line, even where it straddles the line’s own run', () => {
    const seen = projectElevationOutline(KITCHEN, rect(-800, 1300, -200, 1500))
    expect(seen.crossesLine).toBe(false)
    expect(seen.inside).toBe(false)
  })

  it('marks a shape that swallows the whole view line', () => {
    const seen = projectElevationOutline(KITCHEN, rect(-100, -100, 4100, 1500))
    expect(seen.crossesLine).toBe(true)
  })
})

describe('the Wall body (#64 faces, #75 §4)', () => {
  it('stands centred on the reference line, half the thickness each side', () => {
    const body = wallBodyOutline({ x: 0, y: 0 }, { x: 4000, y: 0 }, 200)
    expect(body.map((p) => p.y).sort((a, b) => a - b)).toEqual([-100, -100, 100, 100])
    const turned = wallBodyOutline({ x: 0, y: 0 }, { x: 0, y: 3000 }, 200)
    expect(turned.map((p) => p.x).sort((a, b) => a - b)).toEqual([-100, -100, 100, 100])
  })

  it('reads the same distance from either end of the line', () => {
    // A line running +y looks to +x on its left and to -x on its right, and nothing else changes.
    const line = { start: { x: 0, y: 0 }, end: { x: 0, y: 3000 } }
    const at = { x: 500, y: 500 }
    near(elevationCoords(elevationFrame(line, 'left', 1000), at).s, 500)
    near(elevationCoords(elevationFrame(line, 'left', 1000), at).d, 500)
    near(elevationCoords(elevationFrame(line, 'right', 1000), at).d, -500)
  })
})
