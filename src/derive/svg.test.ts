/**
 * A closed path as SVG path data (#58 §8).
 *
 * The flags are the whole point of testing this: the kernel and SVG share a +Y-down frame
 * and a clockwise-positive sweep, so the mapping is direct. An arc drawn here is the same
 * analytic curve the kernel measured, which is why nothing is flattened for display and why
 * a wrong flag would show up as a shape on screen that disagrees with its own perimeter.
 */
import { describe, expect, it } from 'vitest'
import type { ClosedPath } from '../geometry'
import { evaluatePreset, perimeter } from '../geometry'
import { pathToSvg } from './index'

const ORIGIN = { x: 0, y: 0 }

const circlePath = (diameter: number, orientationDeg = 0): ClosedPath =>
  evaluatePreset({ kind: 'circle', diameter }, { centre: ORIGIN, orientationDeg })

describe('pathToSvg — lines (#58 §8)', () => {
  it('starts at the stored point and draws each Edge as an L', () => {
    const rect: ClosedPath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 1200, y: 0 } },
        { kind: 'line', to: { x: 1200, y: 600 } },
        { kind: 'line', to: { x: 0, y: 600 } },
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
    }
    expect(pathToSvg(rect)).toBe('M 0 0 L 1200 0 L 1200 600 L 0 600 L 0 0')
  })

  it('leaves a gap visible instead of closing the shape', () => {
    const open: ClosedPath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 100, y: 0 } },
        { kind: 'line', to: { x: 100, y: 100 } },
      ],
    }
    // An invalid proposal has to look invalid: `Z` would paint the missing Edge shut.
    expect(pathToSvg(open)).toBe('M 0 0 L 100 0 L 100 100')
    expect(pathToSvg(open)).not.toContain('Z')
  })
})

describe('pathToSvg — circular arcs (#58 §8)', () => {
  it('draws a Circle as four quarter arcs, each the small clockwise arc', () => {
    // `large-arc 0 sweep 1` on all four: a quarter turn is not the large arc, and a positive
    // sweep in a +Y-down frame is SVG's clockwise.
    expect(pathToSvg(circlePath(1600))).toBe(
      'M 0 -800 A 800 800 0 0 1 800 0 A 800 800 0 0 1 0 800 A 800 800 0 0 1 -800 0 A 800 800 0 0 1 0 -800',
    )
  })

  it('takes the radius from the centre it is given, not from the preset', () => {
    const data = pathToSvg(circlePath(1600))
    expect(data.match(/A 800 800/g)).toHaveLength(4)
  })

  it('flags a sweep past a half turn as the large arc', () => {
    const major: ClosedPath = {
      start: { x: 800, y: 0 },
      segments: [{ kind: 'arc', to: { x: 0, y: -800 }, center: ORIGIN, sweepDeg: 270 }],
    }
    expect(pathToSvg(major)).toBe('M 800 0 A 800 800 0 1 1 0 -800')
  })

  it('flags a negative sweep against the clock', () => {
    const back: ClosedPath = {
      start: { x: 800, y: 0 },
      segments: [{ kind: 'arc', to: { x: 0, y: -800 }, center: ORIGIN, sweepDeg: -90 }],
    }
    expect(pathToSvg(back)).toBe('M 800 0 A 800 800 0 0 0 0 -800')
  })

  it('keeps a half turn on the small-arc side, where equality is not large', () => {
    const half: ClosedPath = {
      start: { x: 800, y: 0 },
      segments: [{ kind: 'arc', to: { x: -800, y: 0 }, center: ORIGIN, sweepDeg: 180 }],
    }
    expect(pathToSvg(half)).toBe('M 800 0 A 800 800 0 0 1 -800 0')
  })
})

describe('pathToSvg — elliptical arcs (#58 §8)', () => {
  it('carries rx, ry and the ellipse\'s own rotation through', () => {
    const ellipse: ClosedPath = evaluatePreset(
      { kind: 'ellipse', width: 3200, depth: 1200 },
      { centre: ORIGIN, orientationDeg: 30 },
    )
    const data = pathToSvg(ellipse)
    // Every Edge of a turned Ellipse is the same ellipse, so every Edge carries 30°.
    expect(data.match(/A 1600 600 30 /g)).toHaveLength(4)
    expect(data).toContain('0 1 ')
  })

  it('leaves an unturned Ellipse with no rotation to carry', () => {
    const data = pathToSvg(evaluatePreset({ kind: 'ellipse', width: 3200, depth: 1200 }, { centre: ORIGIN, orientationDeg: 0 }))
    expect(data.match(/A 1600 600 0 0 1/g)).toHaveLength(4)
  })
})

describe('pathToSvg — numbers (#58 §8)', () => {
  it('writes a micrometre and no more', () => {
    const odd: ClosedPath = {
      start: { x: 1 / 3, y: 100.0004 },
      segments: [{ kind: 'line', to: { x: 1234.5678, y: -0.0004 } }],
    }
    expect(pathToSvg(odd)).toBe('M 0.333 100 L 1234.568 0')
  })

  it('never writes a negative zero', () => {
    const negZero: ClosedPath = {
      start: { x: -0.000001, y: 0 },
      segments: [{ kind: 'line', to: { x: 0, y: -0.000001 } }],
    }
    expect(pathToSvg(negZero)).toBe('M 0 0 L 0 0')
    expect(pathToSvg(negZero)).not.toContain('-0')
  })

  it('strips a trailing zero rather than padding coordinates', () => {
    expect(pathToSvg({ start: { x: 100.5, y: 200 }, segments: [{ kind: 'line', to: { x: 300, y: 400.25 } }] })).toBe(
      'M 100.5 200 L 300 400.25',
    )
  })
})

describe('pathToSvg — the outline and the measurement agree (#58 criterion 16)', () => {
  it('draws the same Circle it reports a perimeter for', () => {
    // Four `A` commands and nothing else: no polyline whose length depends on a zoom level.
    const data = pathToSvg(circlePath(1600))
    expect(data.split(' ').filter((token) => token === 'A')).toHaveLength(4)
    expect(data).not.toMatch(/L /)
    expect(perimeter(circlePath(1600))).toBeCloseTo(Math.PI * 1600, 6)
  })
})
