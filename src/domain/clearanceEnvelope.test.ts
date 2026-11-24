/**
 * `Zone off one edge` (#76 §4): the rectangle a picked straight edge and a entered Depth make,
 * standing outward from the Item Footprint — never across it, never a number nobody entered.
 */
import { describe, expect, it } from 'vitest'
import type { ClosedPath } from '../geometry'
import { area, containment } from '../geometry'
import { zoneOffEdgeEnvelope } from './clearanceEnvelope'

/** A 600 × 500 footprint, clockwise on screen (+Y down): start top-left. */
const FOOTPRINT: ClosedPath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 600, y: 0 } },
    { kind: 'line', to: { x: 600, y: 500 } },
    { kind: 'line', to: { x: 0, y: 500 } },
    { kind: 'line', to: { x: 0, y: 0 } },
  ],
}

describe('zoneOffEdgeEnvelope', () => {
  it('stands the rectangle outward from the picked edge', () => {
    // Edge 2 is the bottom (600,500) → (0,500): the zone hangs below the shape.
    const zone = zoneOffEdgeEnvelope(FOOTPRINT, 2, 300)
    expect(zone).not.toBeNull()
    expect(zone!.start).toEqual({ x: 600, y: 500 })
    expect(zone!.segments.map((segment) => segment.to)).toEqual([
      { x: 0, y: 500 },
      { x: 0, y: 800 },
      { x: 600, y: 800 },
      { x: 600, y: 500 },
    ])
    expect(Math.abs(area(zone!))).toBeCloseTo(600 * 300, 6)
  })

  it('never reaches across the shape it stands off', () => {
    for (const edge of [0, 1, 2, 3]) {
      const zone = zoneOffEdgeEnvelope(FOOTPRINT, edge, 100)!
      // The zone shares the picked edge with the footprint and crosses no further in: the
      // footprint grown by the depth on every side holds it exactly.
      const grown: ClosedPath = {
        start: { x: -100, y: -100 },
        segments: [
          { kind: 'line', to: { x: 700, y: -100 } },
          { kind: 'line', to: { x: 700, y: 600 } },
          { kind: 'line', to: { x: -100, y: 600 } },
          { kind: 'line', to: { x: -100, y: -100 } },
        ],
      }
      expect(containment(zone, grown), `edge ${edge}`).toBe('inside')
    }
  })

  it('answers null for an arc edge, a missing edge, and a depth nobody entered', () => {
    const withArc: ClosedPath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'arc', to: { x: 600, y: 0 }, center: { x: 300, y: -200 }, sweepDeg: 60 },
        { kind: 'line', to: { x: 600, y: 500 } },
        { kind: 'line', to: { x: 0, y: 500 } },
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
    }
    expect(zoneOffEdgeEnvelope(withArc, 0, 300)).toBeNull()
    expect(zoneOffEdgeEnvelope(FOOTPRINT, 4, 300)).toBeNull()
    expect(zoneOffEdgeEnvelope(FOOTPRINT, -1, 300)).toBeNull()
    for (const depth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(zoneOffEdgeEnvelope(FOOTPRINT, 2, depth)).toBeNull()
    }
  })

  it('keeps the picked edge itself, so the zone meets the shape exactly', () => {
    const zone = zoneOffEdgeEnvelope(FOOTPRINT, 1, 250)!
    // Edge 1 is the right side (600,0) → (600,500): the zone starts on it and grows to x = 850.
    expect(zone.start).toEqual({ x: 600, y: 0 })
    expect(zone.segments[2]!.to.x).toBe(850)
  })
})
