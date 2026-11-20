import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  arcLengthOfChord,
  chordOfArcLength,
  facePointAt,
  fitOpening,
  gapChord,
  openingChord,
  openingEnd,
  pt,
  refLength,
  refRadius,
  usableIntervals,
  wallPieces,
  type JoinJunction,
  type JoinWall,
  type Pt,
  type UsableInterval,
  type WallJustification,
  type WallRefLine,
} from './index'

// --- the shapes the acceptance numbers are stated in --------------------------

const wall = (
  id: string,
  line: WallRefLine,
  thickness: number,
  justification: WallJustification = 'centre',
): JoinWall => ({ id, line, thickness, justification })

/** A Wall along the X axis from `from` to `to`. */
const along = (id: string, from: number, to: number, thickness = 100): JoinWall =>
  wall(id, { kind: 'line', start: pt(from, 0), end: pt(to, 0) }, thickness)

const endJoin = (id: string, ends: [string, 'start' | 'end'][], host?: { wallId: string; at: number }): JoinJunction => ({
  id,
  ends: ends.map(([wallId, end]) => ({ wallId, end })),
  ...(host === undefined ? {} : { host }),
})

/** A tidied reference-line distance, read at the resolution the tidied geometry has. */
const micron = (at: number): number => Math.round(at * 1000) / 1000

/** The one interval a set of Walls leaves for one Wall, or `null` when it has none. */
const intervalOf = (walls: readonly JoinWall[], junctions: readonly JoinJunction[], id: string): UsableInterval => {
  const found = usableIntervals(walls, junctions).get(id)
  if (found === undefined) throw new Error(`no usable interval for ${id}`)
  return found
}

/**
 * A 40° arc of radius 2 000 mm, run counter-clockwise from (2000, 0): the reference line of
 * criterion 4, whose length is 1 396 mm so a 900 mm chord spans 907.8 mm of it.
 */
const deg = (degrees: number): number => (degrees / 360) * Math.PI * 2
const onArc = (degrees: number): Pt => pt(2000 * Math.cos(deg(degrees)), 2000 * Math.sin(deg(degrees)))
const arcLine: WallRefLine = { kind: 'arc', start: onArc(0), through: onArc(20), end: onArc(40) }

describe('chord and arc length read off each other (#65 §4)', () => {
  it('stores a 900 mm door as 900 and reads 907.8 mm of arc off it', () => {
    expect(refRadius(arcLine)).toBeCloseTo(2000, 6)
    // 2000 · 2 · asin(0.225) — the issue's own number, to a tenth of a millimetre.
    expect(openingEnd(arcLine, 0, 900)).toBeCloseTo(2000 * 2 * Math.asin(0.225), 6)
    expect(openingEnd(arcLine, 0, 900)).toBeCloseTo(907.8, 1)
  })

  it('stores the width as it is stored on a straight Wall', () => {
    const line: WallRefLine = { kind: 'line', start: pt(0, 0), end: pt(3000, 0) }
    expect(refRadius(line)).toBeNull()
    expect(openingEnd(line, 1200, 900)).toBe(2100)
  })

  it('undoes itself: the chord of an arc length spans that arc length again', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 500, max: 50000, noNaN: true }),
        fc.double({ min: 0.01, max: 0.5, noNaN: true }),
        (radius, turn) => {
          // Up to a quarter turn: past a semicircle a chord stops being one-to-one with the
          // arc it cuts, and `asin` has no inverse to give back there.
          const arcLength = turn * Math.PI * radius
          const chord = chordOfArcLength(radius, arcLength)
          // A chord is never longer than the arc it cuts across, and reading it back as arc
          // length returns the arc it came from — to a hundredth of a millimetre.
          expect(chord).toBeLessThanOrEqual(arcLength + 1e-9)
          expect(arcLengthOfChord(radius, chord)).toBeCloseTo(arcLength, 2)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('holds less chord than arc across a gap of arc', () => {
    const gap = { from: 0, to: 900 }
    expect(gapChord(arcLine, gap)).toBeLessThan(900)
    expect(gapChord(arcLine, gap)).toBeCloseTo(chordOfArcLength(2000, 900), 6)
  })

  it('puts the jambs of an opening on the reference line, not on the arc', () => {
    const chord = openingChord(arcLine, 100, 900)
    // Both jambs sit on the Wall itself, 2 000 mm from its centre; the 900 mm the Opening
    // stores is the straight line between them, which lies inside the arc.
    expect(Math.hypot(chord.from.x, chord.from.y)).toBeCloseTo(2000, 6)
    expect(Math.hypot(chord.to.x, chord.to.y)).toBeCloseTo(2000, 6)
    expect(Math.hypot(chord.to.x - chord.from.x, chord.to.y - chord.from.y)).toBeCloseTo(900, 6)
    expect(openingEnd(arcLine, 100, 900) - 100).toBeCloseTo(907.8, 1)
  })
})

describe('the usable interval of a Wall (#65 §3)', () => {
  it('reaches a square end with nothing to trim', () => {
    const usable = intervalOf([along('w1', 0, 3000)], [], 'w1')
    expect(usable.length).toBe(3000)
    expect(usable.blocks).toEqual([])
    expect(usable.gaps).toEqual([{ from: 0, to: 3000 }])
  })

  it('ends the interval 50 mm before an L-joined end', () => {
    const a = along('w1', 0, 3000)
    const b = wall('w2', { kind: 'line', start: pt(3000, 0), end: pt(3000, 2700) }, 100)
    const usable = intervalOf([a, b], [endJoin('j1', [['w1', 'end'], ['w2', 'start']])], 'w1')
    expect(usable.gaps).toEqual([{ from: 0, to: 2950 }])
    expect(usable.blocks).toEqual([{ from: 2950, to: 3000, cause: { kind: 'host-end', end: 'end' } }])
  })

  it('trims by the deeper face when the two Walls differ in thickness', () => {
    const a = along('w1', 0, 3000, 100)
    const b = wall('w2', { kind: 'line', start: pt(3000, 0), end: pt(3000, 2700) }, 200)
    const usable = intervalOf([a, b], [endJoin('j1', [['w1', 'end'], ['w2', 'start']])], 'w1')
    // The thinner Wall ends on the thicker one's faces, 100 mm before its own end — the
    // deeper of its two face trims, not half of its own thickness.
    expect(usable.gaps).toEqual([{ from: 0, to: 2900 }])
  })

  it('leaves both ends of a Wall free when it is joined at one of them only', () => {
    const usable = intervalOf([along('w1', 0, 3000), along('w2', 0, 2000)], [], 'w1')
    expect(usable.gaps).toEqual([{ from: 0, to: 3000 }])
  })

  it('blocks the branch footprint across a T-attached host', () => {
    const host = along('w1', 0, 3000)
    const branch = wall('w6', { kind: 'line', start: pt(1500, 900), end: pt(1500, 2400) }, 100)
    const junctions = [endJoin('j1', [['w6', 'start']], { wallId: 'w1', at: 1500 })]
    const usable = intervalOf([host, branch], junctions, 'w1')
    // A tidied face end lands a micron off the round number it was built from, so the
    // blocked band is read at the same resolution `joinWalls` itself is asserted at.
    expect(usable.blocks.map((block) => ({ from: micron(block.from), to: micron(block.to), cause: block.cause }))).toEqual([
      { from: 1450, to: 1550, cause: { kind: 'junction', junctionId: 'j1', wallId: 'w6' } },
    ])
    expect(usable.gaps.map((gap) => ({ from: micron(gap.from), to: micron(gap.to) }))).toEqual([
      { from: 0, to: 1450 },
      { from: 1550, to: 3000 },
    ])
    // The branch keeps its whole length: a host is not trimmed where a branch meets it.
    expect(intervalOf([host, branch], junctions, 'w6').gaps).toEqual([{ from: 0, to: 1500 }])
  })

  it('measures an arc Wall as an arc', () => {
    const usable = intervalOf([wall('arc', arcLine, 100)], [], 'arc')
    expect(usable.length).toBeCloseTo(refLength(arcLine), 6)
    expect(usable.length).toBeGreaterThan(1390)
    expect(usable.length).toBeLessThan(1400)
  })
})

describe('fitting an Opening into the usable interval (#65 §2, §3)', () => {
  const line: WallRefLine = { kind: 'line', start: pt(0, 0), end: pt(3000, 0) }
  const free = intervalOf([along('w3', 0, 3000)], [], 'w3')
  const lJoined = intervalOf(
    [along('w3', 0, 3000), wall('w4', { kind: 'line', start: pt(3000, 0), end: pt(3000, 2700) }, 100)],
    [endJoin('j1', [['w3', 'end'], ['w4', 'start']])],
    'w3',
  )
  const tJoined = intervalOf(
    [along('w2', 0, 3000), wall('w6', { kind: 'line', start: pt(1500, 900), end: pt(1500, 2400) }, 100)],
    [endJoin('j1', [['w6', 'start']], { wallId: 'w2', at: 1500 })],
    'w2',
  )

  it('lets a 900 door end exactly on a free end and refuses one millimetre past it', () => {
    expect(fitOpening(line, free, 2100, 900)).toMatchObject({ fits: true, reason: 'ok' })
    expect(fitOpening(line, free, 2101, 900)).toMatchObject({
      fits: false,
      reason: 'blocked',
      cause: { kind: 'host-end', end: 'end' },
    })
  })

  it('refuses the same door on the L-joined Wall and lets it back 50 mm', () => {
    expect(fitOpening(line, lJoined, 2100, 900)).toMatchObject({
      fits: false,
      reason: 'blocked',
      cause: { kind: 'host-end', end: 'end' },
    })
    expect(fitOpening(line, lJoined, 2050, 900)).toMatchObject({ fits: true, reason: 'ok' })
  })

  it('refuses a door across a T-junction and lets it up to either face', () => {
    const tLine: WallRefLine = { kind: 'line', start: pt(0, 0), end: pt(3000, 0) }
    expect(fitOpening(tLine, tJoined, 1050, 900)).toMatchObject({
      fits: false,
      reason: 'blocked',
      cause: { kind: 'junction', wallId: 'w6' },
    })
    expect(fitOpening(tLine, tJoined, 550, 900)).toMatchObject({ fits: true }) // end 1450
    expect(fitOpening(tLine, tJoined, 1550, 900)).toMatchObject({ fits: true }) // start 1550
    // A door that only touches the blocked band at one jamb is not crossing it.
    expect(fitOpening(tLine, tJoined, 550, 900).fits && fitOpening(tLine, tJoined, 551, 900).fits).toBe(false)
  })

  it('says there is no room at all when the Wall cannot hold the Opening anywhere', () => {
    const short: WallRefLine = { kind: 'line', start: pt(0, 0), end: pt(800, 0) }
    const usable = intervalOf([along('w9', 0, 800)], [], 'w9')
    expect(fitOpening(short, usable, 0, 900)).toMatchObject({ fits: false, reason: 'no-room', cause: null })
  })

  it('runs out of arc before it runs out of Wall', () => {
    const usable = intervalOf([wall('arc', arcLine, 100)], [], 'arc')
    const length = usable.length
    // The last door that fits ends its chord at the end of the arc, which is 7.8 mm of arc
    // earlier than a straight Wall of the same length would allow.
    expect(fitOpening(arcLine, usable, length - 900, 900).fits).toBe(false)
    expect(fitOpening(arcLine, usable, length - 907.8, 900).fits).toBe(true)
  })
})

describe('cutting a Wall band at its Openings (#65 §4)', () => {
  const line: WallRefLine = { kind: 'line', start: pt(0, 0), end: pt(3000, 0) }

  it('leaves one unbroken piece when nothing is cut', () => {
    const pieces = wallPieces(line, [-50, 50], 3000, [])
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ from: 0, to: 3000 })
    // The band runs out along the second face and back along the first, closed at both ends.
    expect(pieces[0]!.outline.start).toEqual(pt(0, 50))
    expect(pieces[0]!.outline.segments.map((segment) => segment.to)).toEqual([
      pt(3000, 50),
      pt(3000, -50),
      pt(0, -50),
      pt(0, 50),
    ])
  })

  it('cuts the band where an Opening is, so the gap is the chord it was fitted to', () => {
    const pieces = wallPieces(line, [-50, 50], 3000, [{ lo: 1200, hi: 2100 }])
    expect(pieces.map((piece) => [piece.from, piece.to])).toEqual([
      [0, 1200],
      [2100, 3000],
    ])
    // The jamb of a piece is square across the band, at the reference-line distance the fit
    // rule checked.
    expect(facePointAt(line, -50, 1200)).toEqual(pt(1200, -50))
    expect(pieces[0]!.outline.segments[1].to).toEqual(pt(1200, -50))
  })

  it('keeps the faces of a piece concentric on an arc', () => {
    const pieces = wallPieces(arcLine, [-50, 50], refLength(arcLine), [{ lo: 400, hi: 900 }])
    expect(pieces).toHaveLength(2)
    const corners = [pieces[0]!.outline.start, ...pieces[0]!.outline.segments.map((segment) => segment.to)]
    const radii = corners.map((at) => micron(Math.hypot(at.x, at.y)))
    // Every corner of the piece lies on one of the two concentric faces, and both of them
    // are used: the piece is a band, not a wedge.
    expect(new Set(radii)).toEqual(new Set([1950, 2050]))
  })
})
