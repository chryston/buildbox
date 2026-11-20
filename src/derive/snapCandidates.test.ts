/**
 * The snap candidate sources (#59 §5, criteria 21 and 23): what the tools put on offer
 * before `resolveSnap` chooses. The numbers follow the issue's examples — a Kitchen corner
 * reads `Corner of Kitchen`, a Wall fixture yields face corners but never a centreline
 * point, and the `Snaps ▾` rows map onto the ten kinds.
 */
import { describe, expect, it } from 'vitest'
import { kitchenFixture } from '../geometry/testing'
import type { ClosedPath, Pt, SnapCandidate, SnapKind } from './index'
import { enabledSnapKinds, pt, snapCandidates } from './index'
import type { SnapGeometry, WallFaceSource } from './index'

const ALL = enabledSnapKinds({
  grid: true,
  endpoints: true,
  centres: true,
  intersections: true,
  wallFaces: true,
  axis: true,
  angle: true,
  perpendicular: true,
  tangent: true,
})

const kitchen: SnapGeometry = { path: kitchenFixture(), name: 'Kitchen' }

/** A plain run of the sources with everything on and no draft. */
const offered = (geometry: readonly SnapGeometry[], cursor: Pt, extra: object = {}): SnapCandidate[] =>
  snapCandidates({
    geometry,
    cursor,
    gridSpacingMm: 100,
    angleIncrementDeg: 0,
    enabled: ALL,
    ...extra,
  })

const withKind = (found: SnapCandidate[], kind: SnapKind): SnapCandidate[] =>
  found.filter((candidate) => candidate.kind === kind)

const at = (found: SnapCandidate[], x: number, y: number): boolean =>
  found.some((candidate) => candidate.point.x === x && candidate.point.y === y)

/** The upper half of the circle r 500 about the origin, closed by its chord. */
const halfDisc = (): ClosedPath => ({
  start: pt(-500, 0),
  segments: [
    { kind: 'arc', to: pt(500, 0), center: pt(0, 0), sweepDeg: 180 },
    { kind: 'line', to: pt(-500, 0) },
  ],
})

/** A full circle r 500 about the origin: two half sweeps, since |sweep| < 360. */
const circle = (): ClosedPath => ({
  start: pt(-500, 0),
  segments: [
    { kind: 'arc', to: pt(500, 0), center: pt(0, 0), sweepDeg: 180 },
    { kind: 'arc', to: pt(-500, 0), center: pt(0, 0), sweepDeg: 180 },
  ],
})

const rectangle = (): ClosedPath => ({
  start: pt(0, 0),
  segments: [
    { kind: 'line', to: pt(1000, 0) },
    { kind: 'line', to: pt(1000, 600) },
    { kind: 'line', to: pt(0, 600) },
    { kind: 'line', to: pt(0, 0) },
  ],
})

describe('named geometry (#59 criterion 21)', () => {
  it('names every Kitchen corner and numbers each edge midpoint', () => {
    const found = offered([kitchen], pt(3000, 3000))
    const corners = withKind(found, 'endpoint')
    expect(corners.some((c) => c.label === 'Corner of Kitchen' && c.point.x === 4800 && c.point.y === 1300)).toBe(true)
    expect(withKind(found, 'midpoint').some((c) => c.label === 'Midpoint of edge 1')).toBe(true)
  })

  it('takes the arc midpoint on the curve, not the chord, and offers the centre', () => {
    const found = offered([{ path: halfDisc(), name: 'Half' }], pt(3000, 3000))
    const edge1 = withKind(found, 'midpoint').find((c) => c.label === 'Midpoint of edge 1')
    expect(edge1).toBeDefined()
    // On the curve at the half sweep, not the chord midpoint (0, 0).
    expect(edge1!.point.x).toBeCloseTo(0, 6)
    expect(edge1!.point.y).toBeCloseTo(-500, 6)
    const centre = withKind(found, 'centre')
    expect(centre.some((c) => c.label === 'Centre of arc' && c.point.x === 0 && c.point.y === 0)).toBe(true)
  })
})

describe('tangent and perpendicular', () => {
  it('gives the two tangent points from a cursor outside a circle, and none on a line', () => {
    const found = offered([{ path: circle(), name: 'Disc' }], pt(2000, 0), { from: pt(0, 2000) })
    const tangents = withKind(found, 'tangent')
    expect(tangents.length).toBeGreaterThanOrEqual(2)
    for (const t of tangents) expect(Math.hypot(t.point.x, t.point.y)).toBeCloseTo(500, 6)
    expect(withKind(offered([kitchen], pt(2000, 0), { from: pt(0, 2000) }), 'tangent')).toHaveLength(0)
  })

  it('projects the cursor onto a straight edge for the perpendicular foot', () => {
    const found = offered([{ path: rectangle(), name: 'Room' }], pt(500, 300), { from: pt(0, 0) })
    expect(at(withKind(found, 'perpendicular'), 500, 0)).toBe(true)
  })
})

describe('wall faces (#59 criterion 21, the A-snap regression)', () => {
  /** Centreline (0,0)→(5000,0), thickness 200: faces at y = ±100. */
  const wall: WallFaceSource = {
    id: 'W-5',
    label: 'W-5 · face',
    corners: [
      { point: pt(0, -100), label: 'End of W-5' },
      { point: pt(5000, -100), label: 'Corner of W-5 and W-6' },
      { point: pt(0, 100), label: 'End of W-5' },
      { point: pt(5000, 100), label: 'Corner of W-5 and W-6' },
    ],
    faces: [
      { from: pt(0, -100), to: pt(5000, -100), segment: { kind: 'line', to: pt(5000, -100) } },
      { from: pt(0, 100), to: pt(5000, 100), segment: { kind: 'line', to: pt(5000, 100) } },
    ],
  }

  const only = (cursor: Pt, walls: readonly WallFaceSource[]): SnapCandidate[] =>
    snapCandidates({
      geometry: [],
      walls,
      cursor,
      gridSpacingMm: 100,
      angleIncrementDeg: 0,
      enabled: new Set<SnapKind>(['wallFace']),
    })

  it('offers face corners and face projections, never a centreline point', () => {
    const found = only(pt(2500, 0), [wall])
    for (const corner of wall.corners) expect(at(found, corner.point.x, corner.point.y)).toBe(true)
    expect(at(found, 0, 0)).toBe(false)
    expect(at(found, 5000, 0)).toBe(false)
    expect(found.some((c) => c.point.y === 0 && c.point.x >= 0 && c.point.x <= 5000)).toBe(false)
    expect(at(found, 2500, -100)).toBe(true)
  })

  it('names a corner after the Walls that meet and a face point after its Wall (#64 §7)', () => {
    const found = only(pt(2500, 0), [wall])
    expect(found.find((c) => c.point.x === 5000 && c.point.y === -100)?.label).toBe('Corner of W-5 and W-6')
    expect(found.find((c) => c.point.x === 0 && c.point.y === 100)?.label).toBe('End of W-5')
    expect(found.find((c) => c.point.x === 2500 && c.point.y === -100)?.label).toBe('W-5 · face')
    // No left/right wording, and no reference-line wording, anywhere in the list (#64 §7).
    for (const candidate of found) expect(candidate.label).not.toMatch(/left|right|centreline|centerline/i)
  })

  it('snaps an arc face onto the arc, not onto its chord', () => {
    // A quarter arc of radius 1000 about the origin, from (1000, 0) to (0, 1000).
    const curved: WallFaceSource = {
      id: 'W-9',
      label: 'W-9 · face',
      corners: [],
      faces: [
        {
          from: pt(1000, 0),
          to: pt(0, 1000),
          segment: { kind: 'arc', to: pt(0, 1000), center: pt(0, 0), sweepDeg: 90 },
        },
      ],
    }
    const found = only(pt(700, 700), [curved])
    expect(found).toHaveLength(1)
    const at = found[0]!.point
    expect(Math.hypot(at.x, at.y)).toBeCloseTo(1000, 6)
    expect(at.x).toBeCloseTo(at.y, 6)
    expect(at.x).toBeGreaterThan(0)
  })

  it('offers nothing while Walls do not exist', () => {
    expect(withKind(only(pt(2500, 0), []), 'wallFace')).toHaveLength(0)
  })
})

describe('grid, angle and axis', () => {
  it('rounds the grid candidate to the spacing and labels it plainly', () => {
    const found = withKind(offered([], pt(1234, 567)), 'grid')
    expect(found).toHaveLength(1)
    expect(found[0].point).toEqual(pt(1200, 600))
    expect(found[0].label).toBe('Grid')
  })

  it('snaps a 44° cursor onto the 45° ray', () => {
    const from = pt(0, 0)
    const cursor = pt(1000 * Math.cos(44 * Math.PI / 180), 1000 * Math.sin(44 * Math.PI / 180))
    const found = withKind(offered([], cursor, { from, angleIncrementDeg: 45 }), 'angle')
    expect(found.length).toBeGreaterThanOrEqual(1)
    for (const c of found) {
      expect(c.label).toBe('Angle 45°')
      expect(Math.abs(c.point.x - c.point.y)).toBeLessThan(1e-6)
    }
  })

  it('aligns the cursor horizontally with an existing corner', () => {
    const found = withKind(offered([kitchen], pt(2000, 3000)), 'axis')
    expect(found.some((c) => c.label === 'Horizontal from corner' && c.point.x === 2000 && c.point.y === 1300)).toBe(true)
  })
})

describe('the Snaps ▾ rows', () => {
  it('maps all nine rows onto all ten kinds', () => {
    expect(ALL.size).toBe(10)
    for (const kind of ['endpoint', 'intersection', 'midpoint', 'centre', 'tangent', 'perpendicular', 'wallFace', 'axis', 'angle', 'grid'] as SnapKind[]) {
      expect(ALL.has(kind)).toBe(true)
    }
  })

  it('drops endpoint and midpoint together with the `Endpoints and midpoints` row', () => {
    const found = enabledSnapKinds({
      grid: true,
      endpoints: false,
      centres: true,
      intersections: true,
      wallFaces: true,
      axis: true,
      angle: true,
      perpendicular: true,
      tangent: true,
    })
    expect(found.has('endpoint')).toBe(false)
    expect(found.has('midpoint')).toBe(false)
    expect(found.has('grid')).toBe(true)
  })
})
