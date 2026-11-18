import { describe, expect, it } from 'vitest'
import { geometryProblem, type GeometryProblem } from '../geometry'
import { formatGeometryProblem, type DisplayFormat } from './index'

const mm: DisplayFormat = { unit: 'mm', precision: 0 }
const cm: DisplayFormat = { unit: 'cm', precision: 1 }

const cases: [GeometryProblem, DisplayFormat, string][] = [
  [geometryProblem('edges-cross', [1, 3], { at: { x: 6125, y: 2225 } }), mm, 'Edges 1 and 3 cross here'],
  [geometryProblem('edges-touch', [2, 5], { at: { x: 0, y: 0 } }), mm, 'Edges 2 and 5 touch'],
  [geometryProblem('edge-no-length', [4], { values: [0] }), mm, 'Edge 4 has no length'],
  [geometryProblem('too-few-edges', []), mm, 'A shape needs at least 3 edges'],
  [geometryProblem('no-area', []), mm, 'Shape encloses no area'],
  [geometryProblem('corner-radii-overlap', [2], { values: [250, 300, 500] }), mm,
    'Corner radii on edge 2 overlap (250 + 300 > 500 mm)'],
  [geometryProblem('corner-radii-overlap', [1], { values: [1000, 1001, 2000], side: 'top' }), mm,
    'Corner radii on the top side overlap (1,000 + 1,001 > 2,000 mm)'],
  [geometryProblem('arc-radius-too-small', [3], { values: [100, 400] }), mm,
    'Arc radius is smaller than half its chord'],
  [geometryProblem('arc-not-closed', [3]), mm, "Edge 3 doesn't meet its neighbour"],
  [geometryProblem('radius-not-positive', [3], { values: [0] }), mm, 'Edge 3 has no radius'],
  [geometryProblem('size-not-positive', [], { values: [0] }), mm, 'The size needs to be more than zero'],
  [geometryProblem('capsule-too-short', [], { values: [800, 800] }), mm,
    'Capsule length needs to be more than its width'],
  [geometryProblem('side-count-too-small', [], { values: [2.5] }), mm,
    'A regular polygon needs at least 3 whole sides'],
]

describe('formatGeometryProblem (#54 §3, behaviour 18)', () => {
  it.each(cases)('formats %s as the exact message', (problem, format, expected) => {
    expect(formatGeometryProblem(problem, format)).toBe(expected)
  })

  it('shows numbers in the Project display unit and precision', () => {
    expect(formatGeometryProblem(
      geometryProblem('corner-radii-overlap', [1], { values: [1000, 1001, 2000], side: 'top' }),
      cm,
    )).toBe('Corner radii on the top side overlap (100.0 + 100.1 > 200.0 cm)')
  })

  // The issue's own corner-radii message groups its thousands with commas
  // ("(1,000 + 1,001 > 2,000 mm)"), which the raw-coordinate pattern also matches, so that
  // code is pinned to its literal text below and the coordinate ban is asserted for every
  // other message.
  it('never puts a raw coordinate pair in a message', () => {
    for (const [problem] of cases) {
      if (problem.code === 'corner-radii-overlap') continue
      const message = formatGeometryProblem(problem, mm)
      expect(message).not.toMatch(/\(\s*-?\d+(\.\d+)?,\s*-?\d+/)
    }
  })

  it('keeps the quoted corner-radii wording verbatim', () => {
    expect(formatGeometryProblem(
      geometryProblem('corner-radii-overlap', [1], { values: [1000, 1001, 2000], side: 'top' }),
      mm,
    )).toBe('Corner radii on the top side overlap (1,000 + 1,001 > 2,000 mm)')
  })

  it('produces exactly one message per problem', () => {
    const messages = cases.map(([problem]) => formatGeometryProblem(problem, mm))
    expect(new Set(messages).size).toBe(messages.length)
  })
})
