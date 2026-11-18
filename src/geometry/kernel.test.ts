/**
 * The #54 acceptance fixtures: every numeric claim in the issue is asserted here against
 * the shared fixtures, so a later change to the kernel cannot quietly move a documented
 * number. Criteria are named in the test titles.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TOLERANCE_MM,
  area,
  editLineEdge,
  evaluate,
  fillet,
  isTangentFillet,
  classifyPoint,
  lengthOf,
  normaliseOrientation,
  perimeter,
  roundAllCorners,
  segmentStart,
  setFilletRadius,
  signedArea,
  validateLoop,
} from './index'
import type { ClosedPath, Pt } from './index'
import { kitchenFixture } from './testing'

const rect = (width: number, depth: number): ClosedPath => ({
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: width, y: 0 } },
    { kind: 'line', to: { x: width, y: depth } },
    { kind: 'line', to: { x: 0, y: depth } },
    { kind: 'line', to: { x: 0, y: 0 } },
  ],
})

const rounded = (width: number, depth: number, radii: [number, number, number, number]): ClosedPath => {
  const corners: Pt[] = [
    { x: -width / 2, y: -depth / 2 },
    { x: width / 2, y: -depth / 2 },
    { x: width / 2, y: depth / 2 },
    { x: -width / 2, y: depth / 2 },
  ]
  const dirs: Pt[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]
  const arcStart = (i: number): Pt => {
    const back = dirs[(i + 3) % 4]
    return { x: corners[i].x - back.x * radii[i], y: corners[i].y - back.y * radii[i] }
  }
  const arcEnd = (i: number): Pt => ({
    x: corners[i].x + dirs[i].x * radii[i],
    y: corners[i].y + dirs[i].y * radii[i],
  })
  const arcCentre = (i: number): Pt => ({
    x: arcStart(i).x + dirs[i].x * radii[i],
    y: arcStart(i).y + dirs[i].y * radii[i],
  })
  const start = arcStart(0)
  const segments = [] as ClosedPath['segments']
  for (let i = 0; i < 4; i += 1) {
    if (radii[i] > 0) {
      segments.push({ kind: 'arc', to: arcEnd(i), center: arcCentre(i), sweepDeg: 90 })
    }
    const next = i === 3 ? start : arcStart(i + 1)
    const from = radii[i] > 0 ? arcEnd(i) : arcStart(i)
    if (Math.hypot(next.x - from.x, next.y - from.y) > 0) {
      segments.push({ kind: 'line', to: next })
    }
  }
  return { start, segments }
}

const lengths = (path: ClosedPath): number[] =>
  path.segments.map((segment, i) => lengthOf(segment, segmentStart(path, i)))

describe('#54 criterion 1 / 11: the corner-radius equality case', () => {
  it('accepts two radii that exactly meet and omits the zero-length straight', () => {
    const path = rounded(2000, 3000, [1000, 1000, 0, 0])
    expect(validateLoop(path)).toEqual([])
    expect(path.segments.map((segment) => segment.kind)).toEqual(['arc', 'arc', 'line', 'line', 'line'])
    expect(lengths(path).every((length) => length > TOLERANCE_MM)).toBe(true)
  })

  it('rejects 1,000 + 1,001 on a 2,000 mm side with one problem', () => {
    const problems = validateLoop({
      preset: { kind: 'roundedRectangle', width: 2000, depth: 3000, radii: { topLeft: 1000, topRight: 1001, bottomRight: 0, bottomLeft: 0 } },
      placement: { centre: { x: 0, y: 0 }, orientationDeg: 0 },
    })
    expect(problems).toHaveLength(1)
    expect(problems[0].code).toBe('corner-radii-overlap')
    expect(problems[0].values).toEqual([1000, 1001, 2000])
    expect(problems[0].side).toBe('top')
  })
})

describe('#54 criterion 5: the self-crossing fixture', () => {
  it('yields exactly one edges-cross with the crossing point', () => {
    const path: ClosedPath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 1000, y: 1000 } },
        { kind: 'line', to: { x: 1000, y: 0 } },
        { kind: 'line', to: { x: 0, y: 1000 } },
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
    }
    const crossings = validateLoop(path).filter((problem) => problem.code === 'edges-cross')
    expect(crossings).toHaveLength(1)
    expect(crossings[0].edges).toEqual([1, 3])
    expect(crossings[0].at).toEqual({ x: 500, y: 500 })
  })
})

describe('#54 criterion 7: D2 line-edge propagation', () => {
  const kitchen = kitchenFixture()

  it('shortens edge 2 and takes edge 4 with it, leaving edge 3 alone', () => {
    const result = editLineEdge(kitchen, 2, { length: 3200 }, 'start')
    expect(result.problems).toEqual([])
    const edges = lengths(result.path)
    expect(edges[1]).toBeCloseTo(3200, 9)
    expect(edges[2]).toBeCloseTo(1500, 9)
    expect(edges[3]).toBeCloseTo(1100, 9)
    expect(result.path.segments.every((segment) => segment.kind === 'line')).toBe(true)
    expect(area(result.path)).toBeCloseTo(13_830_000, 2)
  })

  it('moves nothing when the absorbing edge would vanish', () => {
    for (const length of [4300, 4301]) {
      const result = editLineEdge(kitchen, 2, { length }, 'start')
      expect(result.path).toBe(kitchen)
      expect(result.problems).toHaveLength(1)
      expect(result.problems[0].code).toBe('edge-no-length')
      expect(result.problems[0].edges).toEqual([4])
    }
  })

  it('keeps the fixed end fixed', () => {
    const start = editLineEdge(kitchen, 2, { length: 3200 }, 'start')
    expect(start.path.segments[1].to).toEqual({ x: 4800, y: 1300 + 3200 })
    const end = editLineEdge(kitchen, 2, { length: 3200 }, 'end')
    expect(end.path.segments[1].to).toEqual({ x: 4800, y: 4000 })
    expect(lengths(end.path)[1]).toBeCloseTo(3200, 9)
  })
})

describe('#54 criteria 4, 9 and 14: fillets', () => {
  const kitchen = kitchenFixture()
  const r250 = fillet(kitchen, 2, 250)

  it('trims 250 off both edges and cuts the area by r²(1 − π/4)', () => {
    expect(r250.problems).toEqual([])
    const edges = lengths(r250.path)
    expect(edges[0]).toBeCloseTo(3350, 9)
    expect(edges[2]).toBeCloseTo(2450, 9)
    const arc = r250.path.segments[1]
    expect(arc.kind).toBe('arc')
    expect(arc.kind === 'arc' ? lengthOf(arc, segmentStart(r250.path, 1)) : 0).toBeCloseTo(392.70, 2)
    expect(area(r250.path)).toBeCloseTo(13_066_587.39, 2)
    expect(area(r250.path)).toBeLessThan(area(kitchen))
    expect(isTangentFillet(r250.path, 2)).toBe(true)
  })

  it('re-fillets at R 400 and reproduces R 250 exactly on the way back', () => {
    const r400 = setFilletRadius(r250.path, 2, 400)
    expect(r400.problems).toEqual([])
    expect(isTangentFillet(r400.path, 2)).toBe(true)
    const edges = lengths(r400.path)
    expect(edges[0]).toBeCloseTo(3200, 9)
    expect(edges[2]).toBeCloseTo(2300, 9)
    const arc = r400.path.segments[1]
    expect(arc.kind === 'arc' ? lengthOf(arc, segmentStart(r400.path, 1)) : 0).toBeCloseTo(628.32, 2)
    const back = setFilletRadius(r400.path, 2, 250)
    expect(JSON.stringify(back.path)).toBe(JSON.stringify(r250.path))
  })

  it('rounds all six corners without ever growing the area', () => {
    const roundedKitchen = roundAllCorners(kitchen, 250)
    expect(roundedKitchen.problems).toEqual([])
    const arcs = roundedKitchen.path.segments.filter((segment) => segment.kind === 'arc')
    expect(arcs).toHaveLength(6)
    const radii = arcs.map((segment) => (segment.kind === 'arc'
      ? Math.hypot(segment.center.x - segmentStart(roundedKitchen.path, roundedKitchen.path.segments.indexOf(segment)).x,
        segment.center.y - segmentStart(roundedKitchen.path, roundedKitchen.path.segments.indexOf(segment)).y)
      : 0))
    expect(radii.every((radius) => Math.abs(radius - 250) < 1e-6)).toBe(true)
    expect(area(roundedKitchen.path)).toBeCloseTo(13_026_349.54, 2)
    expect(perimeter(roundedKitchen.path)).toBeCloseTo(15_156.19, 2)
    expect(area(roundedKitchen.path)).toBeLessThan(area(kitchen))
  })
})

describe('#54 criterion 13: major arcs survive', () => {
  it('round-trips a three-point arc with a sweep over 180°', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 1000, y: -1000 }
    const c = { x: 0, y: 200 }
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
    const centre: Pt = {
      x: ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d,
      y: ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d,
    }
    const radius = Math.hypot(a.x - centre.x, a.y - centre.y)
    const angle = (at: Pt): number => Math.atan2(at.y - centre.y, at.x - centre.x)
    let sweep = angle(c) - angle(a)
    if (angle(b) - angle(a) > 0 ? sweep <= angle(b) - angle(a) : sweep >= angle(b) - angle(a)) {
      sweep += sweep > 0 ? -Math.PI * 2 : Math.PI * 2
    }
    const path: ClosedPath = {
      start: a,
      segments: [
        { kind: 'arc', to: c, center: centre, sweepDeg: sweep * (180 / Math.PI) },
        { kind: 'line', to: a },
      ],
    }
    expect(Math.abs(sweep * (180 / Math.PI))).toBeGreaterThan(180)
    const theta = Math.abs(sweep)
    expect(perimeter(path)).toBeCloseTo(radius * theta + Math.hypot(c.x - a.x, c.y - a.y), 6)
    expect(Math.abs(signedArea(path))).toBeCloseTo((radius ** 2 * (theta - Math.sin(theta))) / 2, 4)
    const pieces = evaluate(path)
    expect(pieces[0].kind).toBe('arc')
    expect(pieces[0].kind === 'arc' ? pieces[0].largeArc : false).toBe(true)
  })
})

describe('#54 criteria 15 and 16: tolerance, not sampling', () => {
  /** Two concentric arcs a hair apart: a 20-sample polyline crosses, the curves do not. */
  const annulus = (gap: number): ClosedPath => {
    const at = (radius: number, deg: number): Pt => {
      const r = (deg * Math.PI) / 180
      return { x: radius * Math.cos(r), y: radius * Math.sin(r) }
    }
    const outer = 1000
    return {
      start: at(outer, 0),
      segments: [
        { kind: 'arc', to: at(outer, 270), center: { x: 0, y: 0 }, sweepDeg: 270 },
        { kind: 'line', to: at(outer + gap, 270) },
        { kind: 'arc', to: at(outer + gap, 0), center: { x: 0, y: 0 }, sweepDeg: -270 },
        { kind: 'line', to: at(outer, 0) },
      ],
    }
  }

  it('validates arcs 0.5 mm apart that a 20-sample polyline would cross', () => {
    expect(validateLoop(annulus(0.5))).toEqual([])
  })

  /** A slot sawn almost through a slab: the two facing edges are `gap` apart. */
  const slotted = (gap: number): ClosedPath => {
    const floor = 2000 - gap
    return {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 900, y: 0 } },
        { kind: 'line', to: { x: 900, y: floor } },
        { kind: 'line', to: { x: 1100, y: floor } },
        { kind: 'line', to: { x: 1100, y: 0 } },
        { kind: 'line', to: { x: 2000, y: 0 } },
        { kind: 'line', to: { x: 2000, y: 2000 } },
        { kind: 'line', to: { x: 0, y: 2000 } },
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
    }
  }

  it('calls a 0.0099 mm gap a touch and a 0.0101 mm gap valid', () => {
    const tight = validateLoop(slotted(0.0099))
    expect(tight.map((problem) => problem.edges.join(':'))).toContain('3:7')
    expect(tight.every((problem) => problem.code === 'edges-touch')).toBe(true)
    expect(validateLoop(slotted(0.0101))).toEqual([])
  })

  it('classifies a shared edge as boundary, never by ray parity', () => {
    const a = rect(2000, 2000)
    const b: ClosedPath = {
      start: { x: 2000, y: 0 },
      segments: [
        { kind: 'line', to: { x: 4000, y: 0 } },
        { kind: 'line', to: { x: 4000, y: 2000 } },
        { kind: 'line', to: { x: 2000, y: 2000 } },
        { kind: 'line', to: { x: 2000, y: 0 } },
      ],
    }
    expect(classifyPoint({ x: 2000, y: 1000 }, a)).toBe('boundary')
    expect(classifyPoint({ x: 2000, y: 1000 }, b)).toBe('boundary')
    expect(classifyPoint({ x: 1000, y: 1000 }, a)).toBe('inside')
    expect(classifyPoint({ x: 1000, y: 1000 }, b)).toBe('outside')
  })

  it('has exactly one tolerance constant in the module', () => {
    const files = readdirSync(new URL('.', import.meta.url), { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts') && !entry.includes('.test.'))
    expect(files.length).toBeGreaterThan(8)
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      const constants = [...source.matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=/gm)]
        .map((match) => match[1])
        .filter((name) => /TOLERANCE|EPSILON|EPS|FUZZ|SLACK|DELTA|THRESHOLD|CUTOFF/.test(name))
      expect(constants.filter((name) => !(file === 'types.ts' && name === 'TOLERANCE_MM')), file).toEqual([])
    }
    const types = readFileSync(new URL('types.ts', import.meta.url), 'utf8')
    expect(types).toMatch(/export const TOLERANCE_MM = 0\.01/)
  })

  it('never reaches for flatten from validation, area, overlap or containment', () => {
    const files = readdirSync(new URL('.', import.meta.url), { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts') && !entry.includes('.test.'))
    const importers = files
      .filter((file) => file !== 'measure.ts' && file !== 'index.ts')
      .filter((file) => /import[^;]*\bflatten/.test(readFileSync(new URL(file, import.meta.url), 'utf8')))
    expect(importers).toEqual([])
  })

  it('is orientation-independent and idempotent', () => {
    const kitchen = kitchenFixture()
    const first = validateLoop(kitchen)
    expect(first).toEqual([])
    expect(validateLoop(normaliseOrientation(kitchen))).toEqual(first)
    expect(validateLoop(normaliseOrientation(kitchen))).toEqual([])
  })
})
