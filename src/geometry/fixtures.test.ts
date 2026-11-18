/**
 * The numeric fixtures of #54 (acceptance criteria 1–16), in one file so later issues reuse
 * exactly this geometry. Each test names the criterion it settles.
 */
import { describe, expect, it } from 'vitest'
import { area, evaluatePreset, perimeter, signedArea, vertices } from './index'
import { PRESET_KINDS, presetArea, presetPerimeter, regularPolygonMetrics } from './index'
import { base600Fixture, bedroomFixture, kitchenFixture } from './testing'

describe('Kitchen fixture (criterion 8)', () => {
  const kitchen = kitchenFixture()

  it('has edge 2 at 2,700 mm, area 13,080,000 mm² and perimeter 15,800 mm', () => {
    expect(kitchen.segments).toHaveLength(6)
    expect(area(kitchen)).toBeCloseTo(13_080_000, 6)
    expect(perimeter(kitchen)).toBeCloseTo(15_800, 9)
    expect(signedArea(kitchen)).toBeGreaterThan(0)
  })

  it('has six vertex handles, one per segment endpoint', () => {
    expect(vertices(kitchen)).toHaveLength(6)
  })
})

describe('Bedroom and Base 600 fixtures', () => {
  it('places the Bedroom as Rectangle 3,400 × 2,400 centred at (7000, 5600)', () => {
    const bedroom = bedroomFixture()
    expect(area(bedroom)).toBeCloseTo(3400 * 2400, 6)
    expect(bedroom.start).toEqual({ x: 5300, y: 4400 })
  })

  it('puts Base 600 as a 600 × 400 Item Footprint about the Item Origin', () => {
    expect(area(base600Fixture())).toBeCloseTo(600 * 400, 6)
  })
})

describe('Preset catalog (criteria 2 and 3)', () => {
  const at = { centre: { x: 0, y: 0 }, orientationDeg: 0 }

  it('exports exactly the eight #16 kinds, with no L or U (#54 criterion 3, D5)', () => {
    expect([...PRESET_KINDS].sort()).toEqual([
      'capsule',
      'circle',
      'ellipse',
      'rectangle',
      'regularPolygon',
      'roundedRectangle',
      'square',
      'triangle',
    ])
  })

  it('evaluates Circle Ø1,600 as four 90° circular arcs (criterion 2, D1)', () => {
    const circle = evaluatePreset({ kind: 'circle', diameter: 1600 }, at)
    expect(circle.segments).toHaveLength(4)
    for (const segment of circle.segments) {
      expect(segment.kind).toBe('arc')
      expect(segment.kind === 'arc' && Math.abs(segment.sweepDeg)).toBe(90)
    }
    expect(area(circle)).toBeCloseTo(2_010_619.3, 2)
    expect(perimeter(circle)).toBeCloseTo(5026.548, 2)
    expect(area(circle)).toBeCloseTo(presetArea({ kind: 'circle', diameter: 1600 }), 6)
    expect(perimeter(circle)).toBeCloseTo(presetPerimeter({ kind: 'circle', diameter: 1600 }), 6)
  })

  it('evaluates Ellipse 2,100 × 1,260 as four quarter elliptical arcs (criterion 2, D1)', () => {
    const ellipse = evaluatePreset({ kind: 'ellipse', width: 2100, depth: 1260 }, at)
    expect(ellipse.segments).toHaveLength(4)
    for (const segment of ellipse.segments) expect(segment.kind).toBe('ellipticalArc')
    expect(area(ellipse)).toBeCloseTo(presetArea({ kind: 'ellipse', width: 2100, depth: 1260 }), 3)
    expect(perimeter(ellipse)).toBeCloseTo(presetPerimeter({ kind: 'ellipse', width: 2100, depth: 1260 }), 2)
  })

  it('derives the Capsule end radius as width ÷ 2 (criterion 2, D5)', () => {
    const capsule = evaluatePreset({ kind: 'capsule', length: 2400, width: 800 }, at)
    expect(capsule.segments.map((s) => s.kind)).toEqual(['line', 'arc', 'line', 'arc'])
    const arcs = capsule.segments.filter((s) => s.kind === 'arc')
    for (const arc of arcs) expect(arc.kind === 'arc' && arc.sweepDeg).toBe(180)
    expect(area(capsule)).toBeCloseTo(presetArea({ kind: 'capsule', length: 2400, width: 800 }), 6)
    expect(perimeter(capsule)).toBeCloseTo(presetPerimeter({ kind: 'capsule', length: 2400, width: 800 }), 9)
  })

  it('gives a Triangle with apexOffset 0 a 90° base-left corner (criterion 3, D5)', () => {
    const triangle = evaluatePreset({ kind: 'triangle', baseWidth: 2000, depth: 1500, apexOffset: 0 }, at)
    const [baseLeft, apex, baseRight] = vertices(triangle)
    const up = { x: apex.x - baseLeft.x, y: apex.y - baseLeft.y }
    const along = { x: baseRight.x - baseLeft.x, y: baseRight.y - baseLeft.y }
    expect(up.x * along.x + up.y * along.y).toBeCloseTo(0, 6)
    expect(area(triangle)).toBeCloseTo(1_500_000, 6)
  })

  it('sizes a Regular Polygon by side length (criterion 3, D5)', () => {
    const hex = { kind: 'regularPolygon' as const, sideCount: 6, sideLength: 1000 }
    const metrics = regularPolygonMetrics(6, 1000)
    expect(metrics.acrossCorners).toBeCloseTo(2000, 6)
    expect(metrics.acrossFlats).toBeCloseTo(1732.05, 2)
    const octagon = { kind: 'regularPolygon' as const, sideCount: 8, sideLength: 1000 }
    expect(perimeter(evaluatePreset(octagon, at))).toBeCloseTo(8000, 6)
    expect(area(evaluatePreset(hex, at))).toBeCloseTo(presetArea(hex), 4)
    expect(perimeter(evaluatePreset(hex, at))).toBeCloseTo(presetPerimeter(hex), 6)
  })

  it('matches the closed-form area and perimeter of every rectangular preset', () => {
    const presets = [
      { kind: 'square' as const, side: 900 },
      { kind: 'rectangle' as const, width: 2000, depth: 3000 },
      { kind: 'roundedRectangle' as const, width: 2000, depth: 3000, radius: 250 },
      { kind: 'roundedRectangle' as const, width: 2000, depth: 3000, radii: { topLeft: 400, topRight: 700, bottomRight: 0, bottomLeft: 150 } },
    ]
    for (const preset of presets) {
      const path = evaluatePreset(preset, at)
      expect(area(path)).toBeCloseTo(presetArea(preset), 6)
      expect(perimeter(path)).toBeCloseTo(presetPerimeter(preset), 9)
      expect(signedArea(path)).toBeGreaterThan(0)
    }
  })
})
