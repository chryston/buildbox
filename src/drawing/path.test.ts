/**
 * The kernel's segments as drawing commands (#60 §5).
 *
 * The two flags that pick *which* arc an `A` draws are the whole risk here: get `largeArc`
 * wrong and a 270° fillet renders as its own 90° complement, which is a picture that looks
 * plausible and is wrong. So the tests are the four corners of the flag arithmetic — under a
 * half turn, over it, negative, and a full turn, which SVG cannot express at all and which
 * has to come out as two arcs that can.
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { pt } from '../geometry'
import type { ClosedPath, Pt } from '../geometry'
import { lineCommands, pathToCommands, rectCommands, roundedRectCommands } from './path'
import type { PathCommand } from './types'

/** Every `to` of every command, in order: what the pen lands on. */
const landings = (commands: readonly PathCommand[]): Pt[] => commands.map((c) => c.to)

/** A path of one segment, for the tests that care about that segment alone. */
const oneSegment = (start: Pt, segment: ClosedPath['segments'][number]): ClosedPath => ({
  start,
  segments: [segment],
})

describe('pathToCommands', () => {
  it('starts at the path start and turns a line into an L', () => {
    const commands = pathToCommands({
      start: pt(0, 0),
      segments: [
        { kind: 'line', to: pt(100, 0) },
        { kind: 'line', to: pt(100, 50) },
      ],
    })
    expect(commands).toEqual([
      { k: 'M', to: pt(0, 0) },
      { k: 'L', to: pt(100, 0) },
      { k: 'L', to: pt(100, 50) },
    ])
  })

  it('takes a circular arc\'s radius from where it starts, not from its centre', () => {
    const commands = pathToCommands(
      oneSegment(pt(10, 0), { kind: 'arc', to: pt(0, 10), center: pt(0, 0), sweepDeg: 90 }),
    )
    expect(commands).toEqual([
      { k: 'M', to: pt(10, 0) },
      { k: 'A', to: pt(0, 10), r: 10, largeArc: false, sweep: true },
    ])
  })

  it('calls a sweep past a half turn the large arc', () => {
    const [, arc] = pathToCommands(
      oneSegment(pt(10, 0), { kind: 'arc', to: pt(0, -10), center: pt(0, 0), sweepDeg: 270 }),
    )
    expect(arc).toMatchObject({ k: 'A', largeArc: true, sweep: true })
  })

  it('calls a negative sweep the other way round, and still the large arc past a half turn', () => {
    const [, minor] = pathToCommands(
      oneSegment(pt(10, 0), { kind: 'arc', to: pt(0, -10), center: pt(0, 0), sweepDeg: -90 }),
    )
    const [, major] = pathToCommands(
      oneSegment(pt(10, 0), { kind: 'arc', to: pt(0, 10), center: pt(0, 0), sweepDeg: -270 }),
    )
    expect(minor).toMatchObject({ largeArc: false, sweep: false })
    expect(major).toMatchObject({ largeArc: true, sweep: false })
  })

  it('splits a full turn into two arcs, because one cannot be drawn', () => {
    const commands = pathToCommands(
      oneSegment(pt(10, 0), { kind: 'arc', to: pt(10, 0), center: pt(0, 0), sweepDeg: 360 }),
    )
    expect(commands).toHaveLength(3)
    const [, first, second] = commands
    expect(first).toMatchObject({ k: 'A', r: 10, largeArc: false, sweep: true })
    expect(second).toMatchObject({ k: 'A', r: 10, largeArc: false, sweep: true, to: pt(10, 0) })
    // Half of a clockwise full turn from (10, 0) about the origin is the far side of the
    // circle: the two halves meet there, which is the only reason either is drawable.
    expect(first.to.x).toBeCloseTo(-10, 9)
    expect(first.to.y).toBeCloseTo(0, 9)
  })

  it('splits a counter-clockwise full turn the same way, backwards', () => {
    const commands = pathToCommands(
      oneSegment(pt(10, 0), { kind: 'arc', to: pt(10, 0), center: pt(0, 0), sweepDeg: -360 }),
    )
    const [, first, second] = commands
    expect(first).toMatchObject({ sweep: false, largeArc: false })
    expect(second).toMatchObject({ sweep: false, largeArc: false, to: pt(10, 0) })
    expect(first.to.x).toBeCloseTo(-10, 9)
  })

  it('carries an elliptical arc\'s own radii and axis rotation', () => {
    const commands = pathToCommands(
      oneSegment(pt(20, 0), {
        kind: 'ellipticalArc',
        to: pt(0, 10),
        center: pt(0, 0),
        rx: 20,
        ry: 10,
        rotationDeg: 30,
        sweepDeg: 90,
      }),
    )
    expect(commands[1]).toEqual({
      k: 'E',
      to: pt(0, 10),
      rx: 20,
      ry: 10,
      xRotDeg: 30,
      largeArc: false,
      sweep: true,
    })
  })

  it('splits a full elliptical turn at the ellipse\'s own half sweep', () => {
    // The start is the ellipse's own +X vertex in its rotated frame, so its parametric angle
    // is zero and half a turn lands on the opposite vertex.
    const start = pt(20 * Math.cos(Math.PI / 6), 20 * Math.sin(Math.PI / 6))
    const commands = pathToCommands(
      oneSegment(start, {
        kind: 'ellipticalArc',
        to: start,
        center: pt(0, 0),
        rx: 20,
        ry: 10,
        rotationDeg: 30,
        sweepDeg: 360,
      }),
    )
    const [, first, second] = commands
    expect(first.k).toBe('E')
    expect(second.k).toBe('E')
    expect(first.to.x).toBeCloseTo(-20 * Math.cos(Math.PI / 6), 9)
    expect(first.to.y).toBeCloseTo(-20 * Math.sin(Math.PI / 6), 9)
    expect(second.to).toEqual(start)
  })

  it('leaves a path that does not close uncloseable, saying where it ended', () => {
    // `closed` is the display item's flag, not this module's guess: a proposal with a gap
    // draws the gap (#58 §8).
    const commands = pathToCommands({
      start: pt(0, 0),
      segments: [{ kind: 'line', to: pt(10, 0) }],
    })
    expect(commands[commands.length - 1]?.to).toEqual(pt(10, 0))
  })
})

describe('rectCommands', () => {
  it('walks the four corners clockwise from the top left', () => {
    expect(rectCommands(2, 3, 10, 4)).toEqual([
      { k: 'M', to: pt(2, 3) },
      { k: 'L', to: pt(12, 3) },
      { k: 'L', to: pt(12, 7) },
      { k: 'L', to: pt(2, 7) },
    ])
  })
})

describe('lineCommands', () => {
  it('is a move and one landing', () => {
    expect(lineCommands(pt(1, 2), pt(3, 4))).toEqual([
      { k: 'M', to: pt(1, 2) },
      { k: 'L', to: pt(3, 4) },
    ])
  })
})

describe('roundedRectCommands', () => {
  it('runs four quarter arcs between four straight runs', () => {
    const commands = roundedRectCommands(0, 0, 20, 10, 2)
    expect(commands.map((c) => c.k).join('')).toBe('MLALALALA')
    expect(commands[0]).toEqual({ k: 'M', to: pt(2, 0) })
    for (const command of commands) {
      if (command.k === 'A') expect(command).toMatchObject({ r: 2, largeArc: false, sweep: true })
    }
    // The last arc closes back on the first point, so a closed path needs no extra command.
    expect(commands[commands.length - 1]?.to).toEqual(pt(2, 0))
  })

  it('clamps the corner to half the shorter side, as an SVG rx does', () => {
    const commands = roundedRectCommands(0, 0, 6, 20, 9)
    const arcs = commands.filter((c) => c.k === 'A')
    expect(arcs).toHaveLength(4)
    for (const arc of arcs) {
      if (arc.k === 'A') expect(arc.r).toBe(3)
    }
    // A stadium, not a path that crosses itself: the straight runs meet at the corners.
    expect(commands[0]).toEqual({ k: 'M', to: pt(3, 0) })
    expect(commands[1]).toEqual({ k: 'L', to: pt(3, 0) })
  })

  it('draws a plain box when the corner is zero', () => {
    const commands = roundedRectCommands(1, 1, 8, 5, 0)
    const landingsOf = landings(commands)
    expect(landingsOf[0]).toEqual(pt(1, 1))
    expect(new Set(landingsOf.map((p) => `${p.x},${p.y}`)).size).toBe(4)
  })

  it('never lands a corner off the box, for any box and radius', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: 0.001, max: 1e4, noNaN: true }),
        fc.double({ min: 0.001, max: 1e4, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (x, y, w, h, r) => {
          const commands = roundedRectCommands(x, y, w, h, r)
          if (commands[0].k !== 'M') return false
          const right = x + w
          const bottom = y + h
          return landings(commands).every(
            (p) =>
              Number.isFinite(p.x) &&
              Number.isFinite(p.y) &&
              p.x >= x - 1e-9 &&
              p.x <= right + 1e-9 &&
              p.y >= y - 1e-9 &&
              p.y <= bottom + 1e-9,
          )
        },
      ),
      { numRuns: 500 },
    )
  })
})
