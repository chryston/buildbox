/**
 * The derived Room picture (#67 §3, §15).
 *
 * Two things these tests hold to account:
 *
 *  - **Every figure is analytic.** Area, perimeter and the outside-area of a crossing are the
 *    same integrals `geometry` uses everywhere else, so they are asserted against closed-form
 *    values for shapes whose area is known — a half-disc, a circular segment, a sliced ellipse
 *    — rather than against a flattened polygon that would agree with itself for the wrong
 *    reason. The prototype's crossing measure was sampled vertices times perimeter and printed
 *    the identical figure for two different rotations of one item; a test that only checked
 *    "some positive number" would not have caught it.
 *  - **The label anchor is inside the Room**, not inside its bounding box, which is the whole
 *    reason an L-shaped Room needs a pole of inaccessibility rather than a midpoint.
 */
import { describe, expect, it } from 'vitest'
import { area, distanceToOutline, pt } from '../geometry'
import type { ClosedPath, Pt } from '../geometry'
import type { Project, Room } from '../domain'
import { createDeriveCache } from './cache'
import { deriveRooms, roomMembershipOf } from './rooms'
import type { MeasurableRoom, RoomMembership } from './rooms'
import { domainFixture } from './testing'

const FLOOR = 'floor-main'

/** A rectangle as a Custom Path Outline, because that is the shape every measurement reads. */
const rect = (minX: number, minY: number, maxX: number, maxY: number): ClosedPath => ({
  start: pt(minX, minY),
  segments: [
    { kind: 'line', to: pt(maxX, minY) },
    { kind: 'line', to: pt(maxX, maxY) },
    { kind: 'line', to: pt(minX, maxY) },
    { kind: 'line', to: pt(minX, minY) },
  ],
})

const room = (id: string, name: string, path: ClosedPath): Room => ({
  id,
  floorId: FLOOR,
  name,
  outline: { kind: 'path', path, segmentIds: path.segments.map((_, index) => `edge-${id}-${index + 1}`) },
  wallFaceRefs: [],
})

const model = (rooms: readonly Room[], project: Project = domainFixture('v4/project-basic.json')): Project => ({
  ...project,
  existingModel: { ...project.existingModel, rooms: [...rooms] },
})

/** The Kitchen: 4000 × 3000 from the origin. The Bedroom: the same, 200 mm to the right of it. */
const KITCHEN = room('room-kitchen', 'Kitchen', rect(0, 0, 4000, 3000))
const BEDROOM = room('room-bedroom', 'Bedroom', rect(4200, 0, 8200, 3000))

/** The same Rooms as `roomMembershipOf` sees them: an Outline is the only thing it reads. */
const measurable = (rooms: readonly Room[]): MeasurableRoom[] =>
  rooms.map((item) => {
    if (item.outline.kind !== 'path') throw new Error(`${item.id} is not a Custom Path Outline`)
    return { id: item.id, name: item.name, path: item.outline.path }
  })

const rowsOf = (footprint: ClosedPath, rooms: readonly Room[] = [KITCHEN, BEDROOM]): RoomMembership[] =>
  roomMembershipOf(footprint, measurable(rooms))

const rowFor = (footprint: ClosedPath, roomId: string, rooms: readonly Room[] = [KITCHEN, BEDROOM]) =>
  rowsOf(footprint, rooms).find((row) => row.roomId === roomId)

describe('roomMembershipOf (#67 §15)', () => {
  it('calls a footprint wholly within one Room inside it, and says nothing about the others', () => {
    const rows = rowsOf(rect(100, 100, 700, 500))
    expect(rows).toEqual([{ roomId: 'room-kitchen', roomName: 'Kitchen', relation: 'inside', outsideAreaMm2: 0 }])
  })

  it('calls a footprint that misses every Room outside, and lists no Room for it', () => {
    expect(rowsOf(rect(20_000, 20_000, 20_600, 20_400))).toEqual([])
  })

  it('measures the strip outside a straight Room edge exactly', () => {
    // 600 × 400 with 200 mm of it past the Kitchen's east edge: 160 000 of 240 000 mm² outside.
    const strip = rect(3800, 1300, 4400, 1700)
    const row = rowFor(strip, 'room-kitchen')
    expect(row?.relation).toBe('crosses')
    expect(row?.outsideAreaMm2).toBeCloseTo(400 * 400, 9)
    expect(row?.outsideAreaMm2).toBeCloseTo(area(strip) - 200 * 400, 9)
  })

  it('reports one row per Room an item straddles, each with its own area', () => {
    // 1200 wide across the 200 mm gap: 400 mm inside the Kitchen, 600 inside the Bedroom.
    const astride = rect(3600, 1000, 4800, 1400)
    const rows = rowsOf(astride)
    expect(rows.map((row) => [row.roomId, row.relation])).toEqual([
      ['room-kitchen', 'crosses'],
      ['room-bedroom', 'crosses'],
    ])
    expect(rows[0]?.outsideAreaMm2).toBeCloseTo(800 * 400, 9)
    expect(rows[1]?.outsideAreaMm2).toBeCloseTo(600 * 400, 9)
  })

  it('treats a footprint flush against a Room edge as inside, not crossing', () => {
    const flush = rect(3400, 1000, 4000, 1400)
    expect(rowFor(flush, 'room-kitchen')?.relation).toBe('inside')
  })

  it('measures a circular arc footprint against a straight edge as the circular segment it is', () => {
    // A circle of radius 100 centred at (−50, 0), cut by the Room's east edge at x = 0 — a
    // chord 50 mm from the centre, so the part outside is
    // r²·acos(d/r) − d·√(r² − d²) = 10 000·π/3 − 50·√7 500.
    const circle: ClosedPath = {
      start: pt(50, 0),
      segments: [
        { kind: 'arc', to: pt(-150, 0), center: pt(-50, 0), sweepDeg: 180 },
        { kind: 'arc', to: pt(50, 0), center: pt(-50, 0), sweepDeg: 180 },
      ],
    }
    expect(area(circle)).toBeCloseTo(Math.PI * 100 * 100, 6)
    const halfPlane = room('room-west', 'West', rect(-5000, -1000, 0, 1000))
    const row = rowFor(circle, 'room-west', [halfPlane])
    expect(row?.relation).toBe('crosses')
    expect(row?.outsideAreaMm2).toBeCloseTo(10_000 * (Math.PI / 3) - 50 * Math.sqrt(7500), 6)
  })

  it('measures an elliptical arc footprint as the elliptic segment it is', () => {
    // rx 200, ry 100 about the origin, cut at x = 100:
    // ab·[π/2 − arcsin(c/a) − (c/a)·√(1 − c²/a²)] with a = 200, b = 100, c = 100.
    const ellipse: ClosedPath = {
      start: pt(200, 0),
      segments: [
        { kind: 'ellipticalArc', to: pt(-200, 0), center: pt(0, 0), rx: 200, ry: 100, rotationDeg: 0, sweepDeg: 180 },
        { kind: 'ellipticalArc', to: pt(200, 0), center: pt(0, 0), rx: 200, ry: 100, rotationDeg: 0, sweepDeg: 180 },
      ],
    }
    expect(area(ellipse)).toBeCloseTo(Math.PI * 200 * 100, 4)
    const sliced = room('room-sliced', 'Sliced', rect(-1000, -1000, 100, 1000))
    const row = rowFor(ellipse, 'room-sliced', [sliced])
    expect(row?.relation).toBe('crosses')
    const expected = 20_000 * (Math.PI / 2 - Math.asin(0.5) - 0.5 * Math.sqrt(0.75))
    expect(row?.outsideAreaMm2).toBeCloseTo(expected, 3)
  })

  it('never leaves the range [0, footprint area], and reaches 0 only for an inside item', () => {
    const footprint = rect(3800, 1300, 4400, 1700)
    const total = area(footprint)
    for (const shift of [-600, -300, -1, 0, 1, 300, 600]) {
      const moved: ClosedPath = {
        start: pt(footprint.start.x + shift, footprint.start.y),
        segments: footprint.segments.map((segment) =>
          segment.kind === 'line' ? { kind: 'line', to: pt(segment.to.x + shift, segment.to.y) } : segment,
        ),
      }
      const row = rowFor(moved, 'room-kitchen', [KITCHEN])
      const outside = row?.outsideAreaMm2 ?? total
      expect(outside).toBeGreaterThanOrEqual(0)
      expect(outside).toBeLessThanOrEqual(total + 1e-9)
      expect(row?.relation === 'inside').toBe(outside === 0)
    }
  })
})

describe('deriveRooms (#67 §3)', () => {
  const project = model([KITCHEN, BEDROOM])
  const derived = deriveRooms(project, FLOOR)

  it('measures area in square metres and perimeter in millimetres, analytically', () => {
    expect(derived.rooms.map((item) => item.name)).toEqual(['Kitchen', 'Bedroom'])
    expect(derived.rooms[0]?.areaM2).toBeCloseTo(12, 12)
    expect(derived.rooms[0]?.perimeterMm).toBeCloseTo(14_000, 9)
  })

  it('keeps an arc Room\'s area on the arc, not on the chord across it', () => {
    // A half-disc of radius 1000: π·1000²/2 = 1 570 796.33 mm², where the two chords alone
    // would bound 1 000 000 mm².
    const apse = room('room-apse', 'Apse', {
      start: pt(0, 0),
      segments: [
        { kind: 'arc', to: pt(0, 2000), center: pt(0, 1000), sweepDeg: 180 },
        { kind: 'line', to: pt(0, 0) },
      ],
    })
    const apseRoom = deriveRooms(model([apse]), FLOOR).rooms[0]
    expect(apseRoom?.areaM2).toBeCloseTo(Math.PI / 2, 9)
    expect(apseRoom?.perimeterMm).toBeCloseTo(Math.PI * 1000 + 2000, 6)
  })

  it('puts the label anchor inside an L-shaped Room, where its bounding-box centre is not', () => {
    const path: ClosedPath = {
      start: pt(0, 0),
      segments: [
        { kind: 'line', to: pt(4000, 0) },
        { kind: 'line', to: pt(4000, 1000) },
        { kind: 'line', to: pt(1000, 1000) },
        { kind: 'line', to: pt(1000, 4000) },
        { kind: 'line', to: pt(0, 4000) },
        { kind: 'line', to: pt(0, 0) },
      ],
    }
    const anchor = deriveRooms(model([room('room-l', 'L', path)]), FLOOR).rooms[0]?.labelAnchor as Pt
    expect(distanceToOutline(anchor, path)).toBeGreaterThan(0)
    // The bounding box's own centre sits in the notch the Room does not have.
    expect(distanceToOutline(pt(2000, 2000), path)).toBeLessThan(0)
  })

  it('bounds the Rooms separately from the Floor', () => {
    expect(derived.roomBounds).toEqual({ x: 0, y: 0, w: 8200, h: 3000 })
    expect(derived.floorBounds).not.toBeNull()
  })

  it('answers nothing for a Floor with no Rooms', () => {
    const empty = deriveRooms(model([]), FLOOR)
    expect(empty.rooms).toEqual([])
    expect(empty.roomBounds).toBeNull()
    expect(empty.membership.size).toBe(0)
  })

  it('keys membership by Placed Item and ignores Rooms of another Floor', () => {
    const onFloor = project.existingModel.placedItems
      .filter((item) => item.floorId === FLOOR)
      .map((item) => item.id)
    const other = { ...BEDROOM, id: 'room-other', floorId: 'floor-mezz' }
    const withOther = deriveRooms(model([KITCHEN, other]), FLOOR)
    expect(withOther.rooms.map((item) => item.id)).toEqual(['room-kitchen'])
    for (const roomId of withOther.membership.keys()) expect(onFloor).toContain(roomId)
  })
})

describe('the Rooms cache entry (#67 §3)', () => {
  const project = model([KITCHEN, BEDROOM])

  it('answers the same object for the same Project and revision, and a new one for a new revision', () => {
    const cache = createDeriveCache()
    const first = cache.rooms(project, 1, FLOOR)
    expect(cache.rooms(project, 1, FLOOR)).toBe(first)
    expect(cache.rooms(project, 2, FLOOR)).not.toBe(first)
  })

  it('never answers one Floor from another Floor\'s entry', () => {
    const cache = createDeriveCache()
    const mezz = cache.rooms(project, 1, 'floor-mezz')
    expect(cache.rooms(project, 1, FLOOR).floorId).toBe(FLOOR)
    expect(cache.rooms(project, 1, 'floor-mezz')).toBe(mezz)
  })
})
