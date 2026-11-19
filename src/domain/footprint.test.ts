/**
 * The Item Footprint as one thing to ask questions of (#58 §3, §7).
 *
 * The numbers here are the ones the issue states as acceptance criteria — a Ø1,600 Circle
 * measuring 2.01 m² and 5,027 mm — and the sentences are the kernel's own, because the
 * editor shows the same string the strict validator reports on import.
 */
import { describe, expect, it } from 'vitest'
import { formatGeometryProblem, footprintArea, footprintAsPath, footprintBounds, footprintCentre, footprintIsValid, footprintMovedTo, footprintPath, footprintPerimeter, footprintProblems, footprintSize, rectangleFootprint } from './index'
import type { DisplayFormat, ItemFootprint, PresetItemFootprint } from './index'
import type { Pt } from '../geometry'

const MM: DisplayFormat = { unit: 'mm', precision: 0 }

/** The first reason a footprint is not a shape, in the words the editor will show. */
const firstProblem = (footprint: ItemFootprint): string => {
  const [problem] = footprintProblems(footprint)
  if (problem === undefined) throw new Error('expected the footprint to be refused')
  return `${problem.code}: ${formatGeometryProblem(problem, MM)}`
}

const circle = (diameter: number): PresetItemFootprint => ({
  kind: 'preset',
  preset: { kind: 'circle', diameter },
  centre: { x: diameter / 2, y: diameter / 2 },
  orientationDeg: 0,
})

const path = (points: readonly [Pt, Pt, Pt, ...Pt[]]): ItemFootprint => ({
  kind: 'path',
  path: { start: points[0], segments: points.slice(1).map((to) => ({ kind: 'line' as const, to })) },
})

describe('footprintPath — the outline a footprint describes (#58 §3)', () => {
  it('evaluates a preset from its own position and turn', () => {
    const footprint = rectangleFootprint(1200, 600)
    expect(footprintPath(footprint)).toEqual({
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 1200, y: 0 } },
        { kind: 'line', to: { x: 1200, y: 600 } },
        { kind: 'line', to: { x: 0, y: 600 } },
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
    })
  })

  it('hands back a Custom Path exactly as stored, gap and all', () => {
    const open: ItemFootprint = {
      kind: 'path',
      path: {
        start: { x: 0, y: 0 },
        segments: [
          { kind: 'line', to: { x: 100, y: 0 } },
          { kind: 'line', to: { x: 100, y: 100 } },
        ],
      },
    }
    expect(footprintPath(open)).toBe(open.path)
  })
})

describe('footprintSize — the size it draws, not the size its parameters name (#58 §3)', () => {
  it('is the local bounds of a Rectangle', () => {
    expect(footprintSize(rectangleFootprint(1820, 1980))).toEqual({ width: 1820, depth: 1980 })
  })

  it('swaps when the shape is turned a quarter turn', () => {
    const turned: ItemFootprint = {
      kind: 'preset',
      preset: { kind: 'rectangle', width: 1000, depth: 400 },
      centre: { x: 500, y: 200 },
      orientationDeg: 90,
    }
    expect(footprintSize(turned)).toEqual({ width: 400, depth: 1000 })
    // The parameters still say what the shape is; only the drawn size moved.
    expect(turned.preset).toEqual({ kind: 'rectangle', width: 1000, depth: 400 })
  })

  it('bounds a Circle by the square it fits in', () => {
    expect(footprintBounds(circle(1600))).toEqual({ minX: 0, minY: 0, maxX: 1600, maxY: 1600 })
  })
})

describe('footprintArea and footprintPerimeter (#58 criteria 15 and 16)', () => {
  it('measures a Ø1,600 Circle as 2.01 m² around 5,027 mm', () => {
    // The two numbers the issue prints in the Measurements tab, to the digit.
    expect((footprintArea(circle(1600)) / 1_000_000).toFixed(2)).toBe('2.01')
    expect(Math.round(footprintPerimeter(circle(1600)))).toBe(5027)
  })

  it('measures a Rectangle exactly', () => {
    expect(footprintArea(rectangleFootprint(1820, 1980))).toBeCloseTo(3_603_600, 6)
    expect(footprintPerimeter(rectangleFootprint(1820, 1980))).toBeCloseTo(7600, 6)
  })

  it('is 0 for a shape that encloses nothing', () => {
    // The bowtie crosses itself, so the signed areas cancel: the kernel calls it `no-area`,
    // and the Measurements tab has a real number to show rather than a crash.
    expect(footprintArea(path([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }]))).toBe(0)
  })

  it('does not change when the shape is turned', () => {
    const plain = rectangleFootprint(1000, 400)
    const turned: ItemFootprint = { ...plain, orientationDeg: 37 }
    expect(footprintArea(turned)).toBeCloseTo(footprintArea(plain), 6)
    expect(footprintPerimeter(turned)).toBeCloseTo(footprintPerimeter(plain), 6)
  })
})

describe('footprintProblems — why a footprint is not a shape (#58 §6)', () => {
  it('says nothing about a valid one', () => {
    expect(footprintProblems(rectangleFootprint(1820, 1980))).toEqual([])
    expect(footprintIsValid(circle(1600))).toBe(true)
  })

  it('names the side whose corner radii overlap, in the kernel\'s sentence', () => {
    const rounded = (topRight: number): ItemFootprint => ({
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
    // 1,000 + 1,000 fits the 2,000 mm side exactly; one more millimetre does not.
    expect(footprintIsValid(rounded(1000))).toBe(true)
    expect(firstProblem(rounded(1001))).toBe(
      'corner-radii-overlap: Corner radii on the top side overlap (1,000 + 1,001 > 2,000 mm)',
    )
  })

  it('reports one problem per side a shared radius is too big for', () => {
    const tooRound: ItemFootprint = {
      kind: 'preset',
      preset: { kind: 'roundedRectangle', width: 100, depth: 100, radius: 60 },
      centre: { x: 50, y: 50 },
      orientationDeg: 0,
    }
    expect(footprintProblems(tooRound).map((problem) => problem.code)).toEqual([
      'corner-radii-overlap',
      'corner-radii-overlap',
      'corner-radii-overlap',
      'corner-radii-overlap',
    ])
  })

  it('refuses a size that is not positive, a Capsule shorter than it is wide and a 2-sided polygon', () => {
    expect(firstProblem(rectangleFootprint(0, 100))).toBe('size-not-positive: The size needs to be more than zero')
    const short: ItemFootprint = {
      kind: 'preset',
      preset: { kind: 'capsule', length: 100, width: 200 },
      centre: { x: 50, y: 100 },
      orientationDeg: 0,
    }
    expect(firstProblem(short)).toBe('capsule-too-short: Capsule length needs to be more than its width')
    const thin: ItemFootprint = {
      kind: 'preset',
      preset: { kind: 'regularPolygon', sideCount: 2, sideLength: 100 },
      centre: { x: 0, y: 0 },
      orientationDeg: 0,
    }
    expect(firstProblem(thin)).toBe('side-count-too-small: A regular polygon needs at least 3 whole sides')
  })

  it('refuses a path that does not close, and names the Edge that fails to meet', () => {
    const gapped = path([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 90 }])
    expect(firstProblem(gapped)).toBe("arc-not-closed: Edge 3 doesn't meet its neighbour")
  })

  it('refuses a path with too few Edges to be a shape', () => {
    expect(firstProblem(path([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]))).toBe(
      'too-few-edges: A shape needs at least 3 edges',
    )
  })

  it('refuses self-crossing, and says where', () => {
    const bowtie = path([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }])
    const [problem] = footprintProblems(bowtie)
    if (problem === undefined) throw new Error('expected the bowtie to be refused')
    expect(problem.code).toBe('edges-cross')
    // The marker the canvas draws the message against.
    expect(problem.at).toEqual({ x: 50, y: 50 })
  })
})

describe('footprintCentre, footprintMovedTo and footprintAsPath (#58 §3, §5)', () => {
  it('reads the point the Shape tab edits off a preset', () => {
    expect(footprintCentre(rectangleFootprint(1200, 600))).toEqual({ x: 600, y: 300 })
  })

  it('reads the centre of a Custom Path from its bounds', () => {
    expect(footprintCentre(footprintAsPath(rectangleFootprint(1200, 600)))).toEqual({ x: 600, y: 300 })
  })

  it('moves a preset by its position, leaving the shape and its turn alone', () => {
    const moved = footprintMovedTo(
      { kind: 'preset', preset: { kind: 'circle', diameter: 100 }, centre: { x: 50, y: 50 }, orientationDeg: 37 },
      { x: 0, y: 0 },
    )
    expect(moved).toEqual({ kind: 'preset', preset: { kind: 'circle', diameter: 100 }, centre: { x: 0, y: 0 }, orientationDeg: 37 })
  })

  it('shifts every point of a Custom Path, keeping its outline', () => {
    const before = footprintAsPath(rectangleFootprint(1200, 600))
    const moved = footprintMovedTo(before, { x: 0, y: 0 })
    expect(footprintCentre(moved)).toEqual({ x: 0, y: 0 })
    expect(footprintSize(moved)).toEqual({ width: 1200, depth: 600 })
    expect(footprintPerimeter(moved)).toBeCloseTo(footprintPerimeter(before), 6)
  })

  it('converts a preset to a Custom Path that measures the same shape', () => {
    const original = rectangleFootprint(1200, 600)
    const asPath = footprintAsPath(original)
    expect(asPath.kind).toBe('path')
    expect(footprintArea(asPath)).toBeCloseTo(footprintArea(original), 6)
    expect(footprintPerimeter(asPath)).toBeCloseTo(footprintPerimeter(original), 6)
    expect(footprintProblems(asPath)).toEqual([])
  })

  it('converts a turned Circle to a Custom Path that is still a circle', () => {
    const turned: ItemFootprint = { ...circle(1600), orientationDeg: 12 }
    const asPath = footprintAsPath(turned)
    expect(footprintProblems(asPath)).toEqual([])
    expect(footprintArea(asPath)).toBeCloseTo(footprintArea(turned), 1)
  })
})
