/// <reference types="vite/client" />
/**
 * Room overlap pairs, and the box prefilter that decides which pairs are clipped (#69 §8 bench).
 *
 * `roomOverlaps` is quadratic in the Rooms of a Project and the clipper behind it is a general
 * curve engine, so the pair loop now rejects two outlines whose axis-aligned boxes cannot meet
 * before asking for an intersection. That is only sound while the box is exact, so these tests pin
 * the fast answer to the slow one: the same pairs, the same areas, on hand-built outlines chosen so
 * that a prefilter bug has somewhere to show — a near miss whose boxes do overlap, an arc that
 * bulges past every one of its endpoints — and on every Room of every fixture Project on disk.
 */
import { describe, expect, it } from 'vitest'
import { overlap, pt } from '../geometry'
import { FF_RENOVATION } from '../lib'
import { MIN_ROOM_OVERLAP_MM2, roomOutlinePath, roomOverlapWith, roomOverlaps } from './rooms'
import type { Room, RoomOutline } from './project'

const texts = Object.entries(
  import.meta.glob<string>('/fixtures/{domain,bench}/**/*.json', { eager: true, query: '?raw', import: 'default' }),
)
  .filter(([path]) => FF_RENOVATION || !path.includes('/v8/'))
  .map(([path, text]) => ({ path, text }))

const rect = (x: number, y: number, width: number, height: number): RoomOutline => ({
  kind: 'path',
  path: {
    start: pt(x, y),
    segments: [
      { kind: 'line', to: pt(x + width, y) },
      { kind: 'line', to: pt(x + width, y + height) },
      { kind: 'line', to: pt(x, y + height) },
      { kind: 'line', to: pt(x, y) },
    ],
  },
  segmentIds: [],
})

/** A rectangle whose right side is a half-circle on the chord: it bows half a height past it. */
const bulged = (x: number, y: number, height: number): RoomOutline => {
  const midY = y + height / 2
  return {
    kind: 'path',
    path: {
      start: pt(x, y),
      segments: [
        { kind: 'arc', to: pt(x, y + height), center: pt(x, midY), sweepDeg: -180 },
        { kind: 'line', to: pt(x, y) },
      ],
    },
    segmentIds: [],
  }
}

const room = (id: string, outline: RoomOutline): Room => ({ id, floorId: 'floor', name: id, outline, wallFaceRefs: [] })

interface Pair {
  first: string
  second: string
  area: number
}

/** The same question with no prefilter at all: clip every pair, keep the positive-area ones. */
function clipped(rooms: readonly Room[]): Pair[] {
  const found: Pair[] = []
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const shared = overlap(roomOutlinePath(rooms[i]!.outline), roomOutlinePath(rooms[j]!.outline))
      if (shared.kind === 'positive' && shared.area > MIN_ROOM_OVERLAP_MM2) {
        found.push({ first: rooms[i]!.id, second: rooms[j]!.id, area: shared.area })
      }
    }
  }
  return found
}

const pairsOf = (overlaps: { first: string; second: string; area: number }[]): Pair[] =>
  overlaps.map(({ first, second, area }) => ({ first, second, area }))

describe('the overlap pair list is the clipped pair list', () => {
  const cases: [string, Room[]][] = [
    ['far apart', [room('a', rect(0, 0, 1000, 1000)), room('b', rect(50_000, 50_000, 1000, 1000))]],
    [
      'sharing a collinear edge',
      [room('a', rect(0, 0, 1000, 1000)), room('b', rect(1000, 0, 1000, 1000))],
    ],
    ['touching at a corner', [room('a', rect(0, 0, 1000, 1000)), room('b', rect(1000, 1000, 1000, 1000))]],
    ['overlapping by a strip', [room('a', rect(0, 0, 1000, 1000)), room('b', rect(990, 10, 1000, 980))]],
    ['one inside the other', [room('a', rect(0, 0, 10_000, 10_000)), room('b', rect(4000, 4000, 1000, 1000))]],
    ['the same outline twice', [room('a', rect(0, 0, 1000, 1000)), room('b', rect(0, 0, 1000, 1000))]],
    [
      'boxes that overlap while the outlines miss',
      [room('a', rect(0, 0, 1000, 200)), room('b', rect(500, 800, 1000, 200)), room('c', rect(200, 300, 200, 400))],
    ],
    [
      'an arc bowing past every endpoint of its own chord',
      [room('a', bulged(0, 0, 1000)), room('b', rect(300, 300, 400, 400)), room('c', rect(-800, 300, 400, 400))],
    ],
    [
      'a Floor of tiled Rooms and one clash',
      [
        room('a', rect(0, 0, 3000, 4000)),
        room('b', rect(3000, 0, 3000, 4000)),
        room('c', rect(6000, 0, 3000, 4000)),
        room('d', rect(0, 4000, 3000, 4000)),
        room('e', rect(2900, 3900, 3000, 4000)),
      ],
    ],
  ]

  for (const [name, rooms] of cases) {
    it(`agrees on ${name}`, () => {
      expect(pairsOf(roomOverlaps(rooms))).toEqual(clipped(rooms))
    })
  }

  it('the arc case really does reach one of its neighbours', () => {
    // Whichever way the half-circle bows, it crosses exactly one of the two Rooms placed either
    // side of the chord: a prefilter that trusted the endpoints would find neither.
    const rooms = [room('a', bulged(0, 0, 1000)), room('b', rect(300, 300, 400, 400)), room('c', rect(-800, 300, 400, 400))]
    expect(clipped(rooms)).toHaveLength(1)
    expect(pairsOf(roomOverlaps(rooms))).toHaveLength(1)
  })

  it('agrees pair by pair against each Room of every fixture Project', () => {
    const lists: { path: string; rooms: Room[] }[] = []
    for (const { path, text } of texts) {
      const project = (JSON.parse(text) as { project?: Record<string, unknown> }).project
      if (project === undefined) continue
      const existing = (project.existingModel as { rooms?: Room[] } | undefined)?.rooms ?? []
      const options = (project.designOptions as { proposed?: { rooms?: Room[] } }[] | undefined) ?? []
      if (existing.length > 0) lists.push({ path, rooms: existing })
      options.forEach((option, i) => {
        const proposed = option.proposed?.rooms ?? []
        if (proposed.length > 0) lists.push({ path: `${path}#option-${String(i)}`, rooms: [...existing, ...proposed] })
      })
    }
    // The reference Project alone is 90 Rooms and 4 005 pairs; the fixtures together are more.
    expect(lists.length).toBeGreaterThan(0)
    for (const { path, rooms } of lists) {
      expect(pairsOf(roomOverlaps(rooms)), path).toEqual(clipped(rooms))
      // A handful of Rooms per list against all the rest: the unfiltered comparison is itself
      // quadratic, and this loop would be cubic across the reference Project's 90.
      for (const each of rooms.slice(0, 3)) {
        const others = rooms.filter((other) => other.id !== each.id)
        // `roomOverlapWith` answers for one outline against the rest, so the reference keeps the
        // pairs naming it and drops the ones the rest have with each other.
        const involving = clipped([each, ...others])
          .filter((pair) => pair.first === each.id || pair.second === each.id)
          .map((pair) => ({ first: each.id, second: pair.first === each.id ? pair.second : pair.first, area: pair.area }))
        expect(pairsOf(roomOverlapWith(each.id, each.outline, others)), `${path} ${each.id}`).toEqual(involving)
      }
    }
  })
})
