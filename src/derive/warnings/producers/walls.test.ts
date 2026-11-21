/**
 * The two Wall producers (#22, #66 §8–§9) on the fixtures the issue names: crossing, collinear
 * overlap, joined, and touching — plus the one case that separates a junction that tidies a
 * meeting from a junction that merely exists somewhere on the pair.
 */
import { describe, expect, it } from 'vitest'
import type { Project, Wall, WallJunction } from '../../../domain'
import { domainFixture } from '../../testing'
import { deriveWarnings } from '../engine'
import { WALL_PRODUCERS, wallCrossing, wallOverlap } from './walls'

const FLOOR = 'floor-main'

const wall = (id: string, ref: string, start: { x: number; y: number }, end: { x: number; y: number }): Wall => ({
  id,
  ref,
  floorId: FLOOR,
  line: { kind: 'line', start, end },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

const join = (
  id: string,
  ends: readonly { wallId: string; end: 'start' | 'end' }[],
  host?: { wallId: string; at: number },
): WallJunction => ({
  id,
  floorId: FLOOR,
  ends: ends.map((member) => ({ ...member })),
  ...(host === undefined ? {} : { host }),
})

const model = (walls: readonly Wall[], junctions: readonly WallJunction[] = []): Project => {
  const base = domainFixture('v4/project-basic.json')
  return {
    ...base,
    existingModel: { ...base.existingModel, walls: [...walls], wallJunctions: [...junctions] },
    warningAcknowledgements: [],
  }
}

const warningsOf = (project: Project) => deriveWarnings(project, FLOOR, null).warnings
const types = (project: Project): string[] => warningsOf(project).map((warning) => warning.type)

/** W-2 west to east, W-5 square across it at x = 2000, nothing joining them. */
const CROSSING = model([
  wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 }),
  wall('wall-5', 'W-5', { x: 2000, y: -500 }, { x: 2000, y: 500 }),
])

describe('wall_crossing (#66 §8)', () => {
  it('fires on two unjoined Walls whose reference lines cross, measured to the tenth of a millimetre', () => {
    const rows = warningsOf(CROSSING)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('wall_crossing')
    expect(rows[0]?.measured).toEqual({ mm: 100 })
    expect(rows[0]?.params).toEqual({ a: 'W-2', b: 'W-5', mm: 100 })
  })

  it('names the lower ref first, whichever order the Walls were stored in', () => {
    const reversed = model([
      wall('wall-5', 'W-5', { x: 2000, y: -500 }, { x: 2000, y: 500 }),
      wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 }),
    ])
    expect(warningsOf(reversed)[0]?.params).toEqual({ a: 'W-2', b: 'W-5', mm: 100 })
  })

  it('measures the intrusion along the primary, not the length of the intruding Wall', () => {
    // W-5 is only 60 mm long, but it is 100 mm thick across W-2's line: the intrusion is 100 mm.
    const stub = model([
      wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 }),
      wall('wall-5', 'W-5', { x: 2000, y: -10 }, { x: 2000, y: 50 }),
    ])
    expect(warningsOf(stub)[0]?.measured).toEqual({ mm: 100 })
  })
})

describe('wall_overlap (#66 §9)', () => {
  it('fires on a 450 mm collinear overlap with the run length as the measurement', () => {
    const collinear = model([
      wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 }),
      wall('wall-5', 'W-5', { x: 3550, y: 0 }, { x: 8000, y: 0 }),
    ])
    const rows = warningsOf(collinear)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('wall_overlap')
    expect(rows[0]?.measured).toEqual({ mm: 450 })
    expect(rows[0]?.params).toEqual({ a: 'W-2', b: 'W-5', mm: 450 })
    expect(rows[0]?.messageKey).toBe('wall_overlap')
  })

  it('fires on a parallel overlap the reference lines never cross', () => {
    const parallel = model([
      wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 }),
      wall('wall-5', 'W-5', { x: 1000, y: 60 }, { x: 3000, y: 60 }),
    ])
    const rows = warningsOf(parallel)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('wall_overlap')
    expect(rows[0]?.measured).toEqual({ mm: 2000 })
  })
})

describe('the two producers partition every overlapping pair (#66 §8, §9)', () => {
  it('never reports one pair twice and never reports a pair in both types', () => {
    const both = model([
      wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 }),
      wall('wall-5', 'W-5', { x: 2000, y: -500 }, { x: 2000, y: 500 }),
      wall('wall-7', 'W-7', { x: 3550, y: 0 }, { x: 8000, y: 0 }),
    ])
    const rows = warningsOf(both)
    expect(rows.map((warning) => warning.type).sort()).toEqual(['wall_crossing', 'wall_overlap'])
    expect(rows.map((warning) => warning.subjects.map((subject) => subject.id).join('+')).sort()).toEqual([
      'wall-2+wall-5',
      'wall-2+wall-7',
    ])
    expect(new Set(rows.map((warning) => warning.key)).size).toBe(rows.length)
  })

  it('is registered in the order the engine runs it', () => {
    expect(WALL_PRODUCERS.map((producer) => producer.type)).toEqual(['wall_crossing', 'wall_overlap'])
    expect(wallCrossing.type).toBe('wall_crossing')
    expect(wallOverlap.type).toBe('wall_overlap')
  })
})

describe('joined Walls do not warn (criterion 5)', () => {
  it('says nothing about a crossing that was split and joined at the crossing', () => {
    const split = model(
      [
        wall('wall-2a', 'W-2', { x: 0, y: 0 }, { x: 2000, y: 0 }),
        wall('wall-2b', 'W-2', { x: 2000, y: 0 }, { x: 4000, y: 0 }),
        wall('wall-5a', 'W-5', { x: 2000, y: -500 }, { x: 2000, y: 0 }),
        wall('wall-5b', 'W-5', { x: 2000, y: 0 }, { x: 2000, y: 500 }),
      ],
      [join('junction-1', [
        { wallId: 'wall-2a', end: 'end' },
        { wallId: 'wall-2b', end: 'start' },
        { wallId: 'wall-5a', end: 'end' },
        { wallId: 'wall-5b', end: 'start' },
      ])],
    )
    expect(types(split)).toEqual([])
  })

  it('says nothing about an L corner joined at the meeting', () => {
    const corner = model(
      [wall('wall-1', 'W-1', { x: 0, y: 0 }, { x: 3000, y: 0 }), wall('wall-2', 'W-2', { x: 3000, y: 0 }, { x: 3000, y: 2000 })],
      [join('junction-1', [{ wallId: 'wall-1', end: 'end' }, { wallId: 'wall-2', end: 'start' }])],
    )
    expect(types(corner)).toEqual([])
  })

  it('says nothing about a T hosted on the middle of the other Wall', () => {
    const tee = model(
      [wall('wall-1', 'W-1', { x: 0, y: 0 }, { x: 4000, y: 0 }), wall('wall-2', 'W-2', { x: 2000, y: 0 }, { x: 2000, y: 2000 })],
      [join('junction-1', [{ wallId: 'wall-2', end: 'start' }], { wallId: 'wall-1', at: 2000 })],
    )
    expect(types(tee)).toEqual([])
  })
})

describe('touching is not overlapping (#66 §8)', () => {
  it('says nothing about two Walls butted end to end with no Junction', () => {
    const butted = model([
      wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 3000, y: 0 }),
      wall('wall-5', 'W-5', { x: 3000, y: 0 }, { x: 6000, y: 0 }),
    ])
    expect(types(butted)).toEqual([])
  })

  it('says nothing about two Walls that leave a half-millimetre gap between them', () => {
    const near = model([
      wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 3000, y: 0 }),
      wall('wall-5', 'W-5', { x: 3000.5, y: 0 }, { x: 6000, y: 0 }),
    ])
    expect(types(near)).toEqual([])
  })

  it('says nothing about a Wall standing alone', () => {
    expect(types(model([wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 })]))).toEqual([])
  })
})

describe('a Junction elsewhere does not excuse an overlap (#66 §9)', () => {
  it('warns about a pair joined at one point that still runs along one another beyond the cap', () => {
    // Both start at the origin and are joined there, but W-5 leaves at a shallow angle, so the
    // two 100 mm bands keep overlapping for metres after the tidied cap. §9 asks only that the
    // pair still warns; which of the two types it is stays decided by §8 and §9's own test —
    // these two reference lines do meet, at the shared origin, so it is a crossing.
    const joinedAndOverlapping = model(
      [wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 }), wall('wall-5', 'W-5', { x: 0, y: 0 }, { x: 4000, y: 100 })],
      [join('junction-1', [{ wallId: 'wall-2', end: 'start' }, { wallId: 'wall-5', end: 'start' }])],
    )
    const rows = warningsOf(joinedAndOverlapping)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('wall_crossing')
    expect(rows[0]?.measured.mm).toBeGreaterThan(1000)
  })

  it('counts a shared junction in the signature, so a new join reopens the pair', () => {
    const before = warningsOf(CROSSING)[0]!
    const joined = model(
      [
        wall('wall-2', 'W-2', { x: 0, y: 0 }, { x: 4000, y: 0 }),
        wall('wall-5', 'W-5', { x: 2000, y: -500 }, { x: 2000, y: 500 }),
        wall('wall-8', 'W-8', { x: 0, y: 40 }, { x: 4000, y: 40 }),
      ],
      [join('junction-1', [{ wallId: 'wall-8', end: 'start' }], { wallId: 'wall-2', at: 1000 })],
    )
    const after = warningsOf(joined).find((warning) => warning.key === before.key)
    expect(after).toBeDefined()
    expect(after?.signature).not.toBe(before.signature)
  })
})
