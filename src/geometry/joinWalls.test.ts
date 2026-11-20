import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { joinWalls } from './index'
import type { JoinJunction, JoinWall, JoinedWall, WallJustification } from './index'
import type { ClosedPath, Pt } from './types'
import { distance, pt } from './index'

/** The outline’s distinct corners: the path’s start and every segment end but the closing one. */
const corners = (path: ClosedPath): Pt[] => [path.start, ...path.segments.slice(0, -1).map((segment) => segment.to)]

/** Corners as comparable keys, rounded to a micron — the float slack of a derived circle. */
const keys = (list: readonly Pt[]): string[] =>
  list.map((at) => `${Math.round(at.x * 1000) / 1000},${Math.round(at.y * 1000) / 1000}`).sort()

const keyPoint = (key: string): Pt => {
  const [x, y] = key.split(',').map(Number)
  return pt(x!, y!)
}

const wall = (
  id: string,
  line: JoinWall['line'],
  thickness: number,
  justification: WallJustification = 'centre',
): JoinWall => ({ id, line, thickness, justification })

const straight = (id: string, from: Pt, to: Pt, thickness: number, justification?: WallJustification): JoinWall =>
  wall(id, { kind: 'line', start: from, end: to }, thickness, justification)

const join = (id: string, ends: [string, 'start' | 'end'][], host?: { wallId: string; at: number }): JoinJunction => ({
  id,
  ends: ends.map(([wallId, end]) => ({ wallId, end })),
  ...(host === undefined ? {} : { host }),
})

const byId = (joined: JoinedWall[]): Map<string, JoinedWall> => new Map(joined.map((item) => [item.id, item]))

describe('joinWalls — the eight clean-up cases (#64 §5)', () => {
  it('an L of two 100 mm Walls mitres both members', () => {
    const a = straight('a', pt(0, 0), pt(4000, 0), 100)
    const b = straight('b', pt(4000, 0), pt(4000, 2700), 100)
    const joined = byId(joinWalls([a, b], [join('j1', [['a', 'end'], ['b', 'start']])]))
    // The two shared corners are the face intersections: the outer one where the two outer
    // faces cross, the inner one where the two inner faces cross.
    expect(keys(corners(joined.get('a')!.outline))).toEqual(
      keys([pt(0, -50), pt(0, 50), pt(4050, -50), pt(3950, 50)]).sort(),
    )
    expect(keys(corners(joined.get('b')!.outline))).toEqual(
      keys([pt(4050, -50), pt(3950, 50), pt(4050, 2700), pt(3950, 2700)]).sort(),
    )
    expect(joined.get('a')!.capEnd).toBe(true)
    expect(joined.get('b')!.capStart).toBe(true)
  })

  it('an L of a 100 mm Wall into a 150 mm Wall ends the thinner one on the thicker faces', () => {
    const a = straight('a', pt(0, 0), pt(4000, 0), 100)
    const b = straight('b', pt(4000, 0), pt(4000, 2700), 150)
    const joined = byId(joinWalls([a, b], [join('j1', [['a', 'end'], ['b', 'start']])]))
    // One cap end on each of the thicker Wall’s faces, and the same two points for both
    // members: the band is split by one diagonal, so the union has neither gap nor overlap.
    const shared = [pt(4075, -50), pt(3925, 50)]
    expect(keys(corners(joined.get('a')!.outline))).toEqual(
      keys([pt(0, -50), pt(0, 50), ...shared]).sort(),
    )
    expect(keys(corners(joined.get('b')!.outline))).toEqual(
      keys([...shared, pt(4075, 2700), pt(3925, 2700)]).sort(),
    )
  })

  it('a T cuts the branch on the host’s near face and leaves the host unbroken', () => {
    const host = straight('host', pt(0, 0), pt(6000, 0), 150)
    const branch = straight('branch', pt(3000, 2000), pt(3000, 0), 100)
    const joined = byId(
      joinWalls([host, branch], [join('j1', [['branch', 'end']], { wallId: 'host', at: 3000 })]),
    )
    // The host keeps its full band: a T never trims, and never splits, the host.
    expect(keys(corners(joined.get('host')!.outline))).toEqual(
      keys([pt(0, -75), pt(6000, -75), pt(6000, 75), pt(0, 75)]).sort(),
    )
    // Both branch faces stop on the host’s near face, y = +75, one thickness apart.
    expect(keys(corners(joined.get('branch')!.outline))).toEqual(
      keys([pt(2950, 2000), pt(3050, 2000), pt(2950, 75), pt(3050, 75)]).sort(),
    )
    expect(joined.get('branch')!.capEnd).toBe(true)
  })

  it('a run-through pair loses the cap and keeps both faces continuous', () => {
    const a = straight('a', pt(0, 0), pt(4000, 0), 150)
    const b = straight('b', pt(4000, 0), pt(8000, 0), 150)
    const joined = byId(joinWalls([a, b], [join('j1', [['a', 'end'], ['b', 'start']])]))
    expect(joined.get('a')!.capEnd).toBe(false)
    expect(joined.get('b')!.capStart).toBe(false)
    expect(joined.get('a')!.capStart).toBe(true)
    // Neither face stops short: the two Walls read as one 8,000 mm band.
    expect(keys(corners(joined.get('a')!.outline))).toEqual(
      keys([pt(0, -75), pt(4000, -75), pt(4000, 75), pt(0, 75)]).sort(),
    )
    expect(keys(corners(joined.get('b')!.outline))).toEqual(
      keys([pt(4000, -75), pt(8000, -75), pt(8000, 75), pt(4000, 75)]).sort(),
    )
  })

  it('an X is two run-through pairs, each continuous through the crossing', () => {
    const east = straight('east', pt(0, 0), pt(4000, 0), 150)
    const eastOn = straight('eastOn', pt(4000, 0), pt(8000, 0), 150)
    const south = straight('south', pt(4000, -2000), pt(4000, 0), 150)
    const southOn = straight('southOn', pt(4000, 0), pt(4000, 2000), 150)
    const joined = joinWalls(
      [east, eastOn, south, southOn],
      [join('j1', [['east', 'end'], ['eastOn', 'start']]), join('j2', [['south', 'end'], ['southOn', 'start']])],
    )
    const map = byId(joined)
    expect(joined.map((item) => item.id)).toEqual(['east', 'eastOn', 'south', 'southOn'])
    for (const [id, capStart, capEnd] of [
      ['east', true, false],
      ['eastOn', false, true],
      ['south', true, false],
      ['southOn', false, true],
    ] as const) {
      expect([map.get(id)!.capStart, map.get(id)!.capEnd]).toEqual([capStart, capEnd])
    }
    // Each band keeps its own full span; the crossing is the two bands overlapping, which is
    // what a wall that goes through another wall is.
    expect(keys(corners(map.get('south')!.outline))).toEqual(
      keys([pt(3925, -2000), pt(4075, -2000), pt(4075, 0), pt(3925, 0)]).sort(),
    )
  })

  it('a three-way mitres all three members and shares every corner', () => {
    const turn = (deg: number): Pt => pt(3000 * Math.cos((deg * Math.PI) / 180), 3000 * Math.sin((deg * Math.PI) / 180))
    const a = straight('a', pt(0, 0), turn(0), 150)
    const b = straight('b', pt(0, 0), turn(120), 150)
    const c = straight('c', pt(0, 0), turn(240), 150)
    const joined = byId(joinWalls([a, b, c], [join('j', [['a', 'start'], ['b', 'start'], ['c', 'start']])]))
    // Symmetric Y: each member’s two corners sit 75 / tan 60° out along its own axis, which
    // is where the two neighbour bands cross it.
    const inset = 75 / Math.tan((60 * Math.PI) / 180)
    expect(keys(corners(joined.get('a')!.outline))).toEqual(
      keys([pt(inset, -75), pt(inset, 75), pt(3000, -75), pt(3000, 75), pt(0, 0)]).sort(),
    )
    // Every corner belongs to two members: no seam, no sliver of Floor left between them.
    // Each pair shares its mitre corner, and all three share the Junction vertex the caps
    // turn through, which is what splits the middle between them.
    const bCorners = keys(corners(joined.get('b')!.outline))
    const cCorners = keys(corners(joined.get('c')!.outline))
    const aCorners = keys(corners(joined.get('a')!.outline))
    for (const [other, far] of [
      [bCorners, keys([pt(inset, 75)])[0]],
      [cCorners, keys([pt(inset, -75)])[0]],
    ] as const) {
      const shared = aCorners.filter((key) => other.includes(key))
      expect(shared.length).toBe(2)
      expect(shared).toContain('0,0')
      expect(shared).toContain(far)
    }
    expect(bCorners.filter((key) => cCorners.includes(key)).length).toBe(2)
  })

  it('joins an arc into a straight Wall at any angle', () => {
    // A 2,000 mm arc reference line arriving at (4000,0) heading 37° down-east, and a
    // straight Wall leaving in the same direction: the join is the two face intersections.
    const arc = wall('arc', { kind: 'arc', start: pt(0, 0), through: pt(1800, -900), end: pt(4000, 0) }, 150)
    const line = straight('line', pt(4000, 0), pt(4000 + 2000 * Math.cos((37 * Math.PI) / 180), 2000 * Math.sin((37 * Math.PI) / 180)), 150)
    const joined = byId(joinWalls([arc, line], [join('j', [['arc', 'end'], ['line', 'start']])]))
    const arcCorners = corners(joined.get('arc')!.outline)
    const lineCorners = corners(joined.get('line')!.outline)
    const shared = keys(arcCorners).filter((key) => keys(lineCorners).includes(key))
    expect(shared.length).toBe(2)
    // Both corners are near the junction — within ten thicknesses, the kernel’s own limit —
    // and the two members agree on them exactly.
    for (const key of shared) {
      const [x, y] = key.split(',').map(Number)
      expect(distance(pt(x!, y!), pt(4000, 0))).toBeLessThan(1500)
    }
    expect(joined.get('arc')!.capEnd).toBe(true)
    expect(joined.get('line')!.capStart).toBe(true)
  })

  it('ends both members square when the faces meet 17 km down the line', () => {
    // Half a degree off a run-through, with the faces 25 mm apart because the Walls are 100
    // and 150: the face intersection lies 25 / tan 0.5° ≈ 2.9 m away, ten thicknesses beyond
    // the Junction, so the fallback is the honest answer.
    const a = straight('a', pt(0, 0), pt(4000, 0), 100)
    const deg = (0.5 * Math.PI) / 180
    const b = straight('b', pt(4000, 0), pt(4000 + 3000 * Math.cos(deg), 3000 * Math.sin(deg)), 150)
    const joined = byId(joinWalls([a, b], [join('j', [['a', 'end'], ['b', 'start']])]))
    expect(keys(corners(joined.get('a')!.outline))).toEqual(
      keys([pt(0, -50), pt(0, 50), pt(4000, -50), pt(4000, 50)]).sort(),
    )
    expect(joined.get('a')!.capEnd).toBe(true)
    expect(joined.get('b')!.capStart).toBe(true)
    // The square end is perpendicular to the reference: both corners one half-thickness from
    // the Junction, and a full thickness apart.
    const bCorners = corners(joined.get('b')!.outline).filter((at) => distance(at, pt(4000, 0)) < 100)
    expect(bCorners.length).toBe(2)
    for (const at of bCorners) expect(distance(at, pt(4000, 0))).toBeCloseTo(75, 1)
    expect(distance(bCorners[0]!, bCorners[1]!)).toBeCloseTo(150, 1)
  })
})

describe('joinWalls — the general properties (#64)', () => {
  const arbWall = (id: string, at: Pt, deg: number, length: number, thickness: number): JoinWall => ({
    id,
    line: { kind: 'line', start: at, end: pt(at.x + length * Math.cos((deg * Math.PI) / 180), at.y + length * Math.sin((deg * Math.PI) / 180)) },
    thickness,
    justification: 'centre',
  })

  /** Members meeting at the origin, spread round the Junction so each face has a neighbour. */
  const arbStar = fc.record({
    count: fc.integer({ min: 2, max: 4 }),
    first: fc.integer({ min: 0, max: 359 }),
    gaps: fc.array(fc.integer({ min: 20, max: 160 }), { minLength: 3, maxLength: 3 }),
    thickness: fc.constantFrom(100, 150),
    length: fc.integer({ min: 1000, max: 6000 }),
  })

  it('closes every outline and shares every junction corner', () => {
    fc.assert(
      fc.property(arbStar, (spec) => {
        // The gaps between successive members, closing the circle: every gap between 20° and
        // 160° keeps each face’s neighbour real and the mitres inside ten thicknesses.
        const angles: number[] = []
        for (let index = 0; index < spec.count; index += 1) {
          angles.push(index === 0 ? 0 : angles[index - 1]! + spec.gaps[index - 1]!)
        }
        const closing = 360 - angles[spec.count - 1]!
        fc.pre(spec.count === 2 || (closing >= 20 && closing <= 160))
        const centre = pt(0, 0)
        const walls = angles.map((angle, index) =>
          arbWall(`w${index}`, centre, spec.first + angle, Math.max(4000, spec.length), spec.thickness),
        )
        const joined = joinWalls(walls, [join('j', walls.map((wall2) => [wall2.id, 'start'] as [string, 'start']))])
        const all = joined.map((item) => keys(corners(item.outline)))
        for (const [index, item] of joined.entries()) {
          const path = corners(item.outline)
          // Closed: the last segment comes back to the start, and the band has four corners
          // plus the Junction vertex when the cap turns through it.
          expect(path.length).toBeGreaterThanOrEqual(4)
          expect(path.length).toBeLessThanOrEqual(5)
          const closing = item.outline.segments[item.outline.segments.length - 1]!
          expect(distance(closing.to, item.outline.start)).toBeLessThan(1e-9)
          // Tiled: every corner near the Junction belongs to a second member too, so no
          // sliver of Floor is left between two bands and no two bands claim the same point.
          const mine = all[index]!.filter((key) => distance(keyPoint(key), centre) < 2000)
          const others = all.filter((_, other) => other !== index).flat()
          for (const key of mine) expect(others.filter((at) => at === key).length).toBeGreaterThanOrEqual(1)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('is deterministic and depends on nothing but the Walls it was given', () => {
    fc.assert(
      fc.property(arbStar, (spec) => {
        const build = (): JoinedWall[] => {
          const centre = pt(0, 0)
          let angle = spec.first
          const walls = Array.from({ length: spec.count }, (_, index) => {
            const member = arbWall(`w${index}`, centre, angle, 4000, spec.thickness)
            angle += spec.gaps[index]!
            return member
          })
          return joinWalls(walls, [join('j', walls.map((wall2) => [wall2.id, 'start'] as [string, 'start']))])
        }
        expect(build()).toEqual(build())
        // A Wall in no Junction is its own plain band, whatever else the Floor holds.
        const lone = straight('lone', pt(0, 0), pt(3000, 0), 100)
        const withLone = joinWalls([lone], [])
        expect(withLone[0]!.outline).toEqual({
          start: pt(0, 50),
          segments: [
            { kind: 'line', to: pt(0, -50) },
            { kind: 'line', to: pt(3000, -50) },
            { kind: 'line', to: pt(3000, 50) },
            { kind: 'line', to: pt(0, 50) },
          ],
        })
      }),
      { numRuns: 40 },
    )
  })

  it('never lets a corner lie further from the Junction than ten thicknesses', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.2, max: 179.8, noNaN: true }), (turn) => {
        const rad = (turn * Math.PI) / 180
        const a = straight('a', pt(0, 0), pt(4000, 0), 150)
        const b = straight('b', pt(4000, 0), pt(4000 + 2000 * Math.cos(rad), 2000 * Math.sin(rad)), 150)
        const joined = joinWalls([a, b], [join('j', [['a', 'end'], ['b', 'start']])])
        for (const item of joined) {
          for (const corner of corners(item.outline)) {
            // Either a joint corner, held inside the ten-thickness limit, or a free end of a
            // Wall, which sits at that Wall’s own length. Nothing lies between.
            const at = distance(corner, pt(4000, 0))
            expect(at <= 10 * 150 || at >= 1900).toBe(true)
          }
        }
      }),
      { numRuns: 100 },
    )
  })
})
