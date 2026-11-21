/**
 * Rooms as they are drawn (#67 behaviours 3, 4, 20–21, 35).
 *
 * Three things these tests hold to account:
 *
 *  - **A label is inside the Room it names.** The prototype put it at a bounding-box corner, which
 *    for an L-shaped Room is a point in the neighbouring Room — so the anchor is tested against the
 *    Outline itself with `classifyPoint`, and against obstacles, rather than against a number that
 *    would agree with the implementation for the wrong reason.
 *  - **The overlap region is the intersection**, not one Room painted twice: it is drawn only when a
 *    proposal actually shares area, and it is drawn as the shared region.
 *  - **The area answers a pointer.** A Room's outline is one device pixel, so the click target is a
 *    second, invisible shape over the same area.
 */
import { describe, expect, it } from 'vitest'
import { classifyPoint, pt } from '../geometry'
import type { ClosedPath } from '../geometry'
import type { Project, Room } from '../domain'
import { deriveRooms } from '../derive'
import type { FloorRooms } from '../derive'
import { domainFixture } from '../derive/testing'
import { drawRooms, placeRoomLabel } from './rooms'
import type { RoomProposal } from './rooms'
import { layoutText } from './font/layoutText'
import type { DisplayItem, DisplayList, Rect } from './types'

const FLOOR = 'floor-main'
const sizing = { kind: 'screen', pxPerMm: 1 } as const

const rect = (minX: number, minY: number, maxX: number, maxY: number): ClosedPath => ({
  start: pt(minX, minY),
  segments: [
    { kind: 'line', to: pt(maxX, minY) },
    { kind: 'line', to: pt(maxX, maxY) },
    { kind: 'line', to: pt(minX, maxY) },
    { kind: 'line', to: pt(minX, minY) },
  ],
})

/** An L: a 4000 × 4000 square with its top-right quarter taken out. */
const L_SHAPE: ClosedPath = {
  start: pt(0, 0),
  segments: [
    { kind: 'line', to: pt(4000, 0) },
    { kind: 'line', to: pt(4000, 2000) },
    { kind: 'line', to: pt(2000, 2000) },
    { kind: 'line', to: pt(2000, 4000) },
    { kind: 'line', to: pt(0, 4000) },
    { kind: 'line', to: pt(0, 0) },
  ],
}

const room = (id: string, name: string, path: ClosedPath): Room => ({
  id,
  floorId: FLOOR,
  name,
  outline: { kind: 'path', path, segmentIds: path.segments.map((_, index) => `edge-${id}-${index + 1}`) },
  wallFaceRefs: [],
})

const model = (rooms: readonly Room[]): Project => ({
  ...domainFixture('v4/project-basic.json'),
  existingModel: { ...domainFixture('v4/project-basic.json').existingModel, rooms: [...rooms] },
})

const label = (name: string, squareMillimetres: number): string =>
  `${name} · ${(squareMillimetres / 1_000_000).toFixed(2)} m²`

const drawn = (rooms: FloorRooms, overrides: Partial<Parameters<typeof drawRooms>[1]> = {}) =>
  drawRooms(rooms, { sizing, formatLabel: label, ...overrides })

const withRole = (list: DisplayList, role: string): DisplayItem[] =>
  list.layers.flatMap((layer) => layer.items).filter((item) => item.ref?.role === role)

const KITCHEN = room('room-kitchen', 'Kitchen', rect(0, 0, 4000, 3000))
const BEDROOM = room('room-bedroom', 'Bedroom', rect(4200, 0, 8200, 3000))
const HALL = room('room-hall', 'Hall', L_SHAPE)

describe('drawRooms', () => {
  it('paints each Room once, with a hit shape over the same area', () => {
    const list = drawn(deriveRooms(model([KITCHEN, BEDROOM]), FLOOR))
    expect(withRole(list, 'room').map((item) => item.ref?.id)).toEqual(['room-kitchen', 'room-bedroom'])
    expect(withRole(list, 'room-hit').map((item) => item.ref?.id)).toEqual(['room-kitchen', 'room-bedroom'])
    // The hit shape is the same geometry as the area it stands for: it is the area, not a second
    // mark to see.
    const area = withRole(list, 'room')[0]
    const hit = withRole(list, 'room-hit')[0]
    expect(hit?.kind === 'path' ? hit.segments : null).toEqual(area?.kind === 'path' ? area.segments : null)
    expect(withRole(list, 'room-hit')[1]?.ref?.id).toBe('room-bedroom')
  })

  it('names each Room with its area, in the label layer', () => {
    const list = drawn(deriveRooms(model([KITCHEN]), FLOOR))
    const [text] = withRole(list, 'room-label')
    expect(text?.kind === 'text' ? text.text : null).toBe('Kitchen · 12.00 m²')
    expect(list.layers.map((layer) => layer.key)).toEqual(['rooms', 'room-labels'])
  })

  it('draws the selected Room heavier than its neighbours', () => {
    const list = drawn(deriveRooms(model([KITCHEN, BEDROOM]), FLOOR), { selectedRoomId: 'room-bedroom' })
    const styles = withRole(list, 'room').map((item) => item.kind === 'path' ? item.style : null)
    expect(styles).toEqual(['room', 'room:selected'])
  })

  it('keeps an L-shaped Room’s label inside the Room', () => {
    const derived = deriveRooms(model([HALL]), FLOOR)
    const [text] = withRole(drawn(derived), 'room-label')
    expect(text?.kind === 'text').toBe(true)
    const at = text?.kind === 'text' ? text.at : pt(0, 0)
    expect(classifyPoint(at, L_SHAPE)).not.toBe('outside')
    // Not the bounding-box centre, which for this L is the quarter that was taken out.
    expect(at).not.toEqual(pt(2000, 2000))
  })

  it('moves the label off a wall reference standing where it would sit', () => {
    const derived = deriveRooms(model([HALL]), FLOOR)
    const room = derived.rooms[0]
    expect(room).toBeDefined()
    const obstacle: Rect = {
      x: room.labelAnchor.x - 400,
      y: room.labelAnchor.y - 200,
      w: 800,
      h: 400,
    }
    const list = drawn(derived, { obstacles: [obstacle] })
    const at = withRole(list, 'room-label')[0]
    const moved = at?.kind === 'text' ? at.at : room!.labelAnchor
    expect(moved).not.toEqual(room!.labelAnchor)
    expect(classifyPoint(moved, L_SHAPE)).not.toBe('outside')
  })

  it('puts the label outside a Room too small to hold it, with a leader', () => {
    const tiny = room('room-tiny', 'Store', rect(0, 0, 600, 400))
    const derived = deriveRooms(model([tiny]), FLOOR)
    const bounds = derived.rooms[0]?.bounds
    expect(bounds).toBeDefined()
    // The whole Room blocked: nothing inside can hold the name, so it goes above with a leader.
    const list = drawn(derived, { obstacles: [bounds!] })
    const [text] = withRole(list, 'room-label')
    const at = text?.kind === 'text' ? text.at : null
    expect(at).not.toBeNull()
    expect(at!.y).toBeLessThan(bounds!.y)
    expect(withRole(list, 'room-label-leader')).toHaveLength(1)
  })
})

describe('the proposal', () => {
  const proposal = (overrides: Partial<RoomProposal> = {}): RoomProposal => ({
    id: 'room-new',
    path: rect(1000, 1000, 5000, 4000),
    blocked: false,
    overlaps: [],
    ...overrides,
  })

  it('draws a proposal that can be committed in the accent and a blocked one in danger', () => {
    const empty = deriveRooms(model([]), FLOOR)
    const ok = withRole(drawn(empty, { proposal: proposal() }), 'room-proposal')
    expect(ok).toHaveLength(1)
    expect(ok[0]?.kind === 'path' ? ok[0].style : null).toBe('room:proposal')
    const bad = withRole(drawn(empty, { proposal: proposal({ blocked: true }) }), 'room-proposal')
    expect(bad[0]?.kind === 'path' ? bad[0].style : null).toBe('room:proposal-blocked')
  })

  it('hatches only the area actually shared', () => {
    const empty = deriveRooms(model([]), FLOOR)
    const clean = drawn(empty, { proposal: proposal() })
    expect(withRole(clean, 'room-overlap')).toHaveLength(0)
    const shared = drawn(empty, { proposal: proposal({ overlaps: [rect(4200, 1000, 5000, 3000)] }) })
    const regions = withRole(shared, 'room-overlap')
    expect(regions).toHaveLength(1)
    expect(regions[0]?.kind === 'path' ? regions[0].style : null).toBe('room-overlap')
    // The bounds cover the shared region too, so it is on screen and not clipped away.
    expect(shared.bounds.x).toBeLessThanOrEqual(4200)
  })
})

describe('placeRoomLabel', () => {
  it('shrinks the name before it moves out of the Room', () => {
    const derived = deriveRooms(model([HALL]), FLOOR)
    const hall = derived.rooms[0]
    expect(hall).toBeDefined()
    // The top arm is taken, leaving a 2000 × 2000 corner: a name drawn 400 mm tall fits nowhere
    // in it, one drawn 60 mm tall does, and the Room keeps its name rather than losing it to the
    // outside.
    const full = layoutText(label('Hall', 12_000_000), 400)
    const small = layoutText(label('Hall', 12_000_000), 60)
    expect(full.width).toBeGreaterThan(2000)
    expect(small.width).toBeLessThan(2000)
    const placed = placeRoomLabel(hall!, full, small, [{ x: 0, y: 0, w: 4000, h: 2000 }], 40)
    expect(placed.outside).toBe(false)
    expect(placed.shrunk).toBe(true)
    expect(classifyPoint(placed.at, L_SHAPE)).not.toBe('outside')
  })
})

describe('the anchor badge', () => {
  const anchored = (over: Partial<Room> = {}): Room => ({
    ...room('room-kitchen', 'Kitchen', rect(0, 0, 4000, 3000)),
    wallFaceRefs: [{ segmentId: 'edge-room-kitchen-1', wallId: 'wall-a', side: 'left' }],
    ...over,
  })

  it('marks the Edge that claims a face, and only that Edge', () => {
    const list = drawn(deriveRooms(model([anchored(), room('room-bath', 'Bathroom', rect(5000, 0, 7000, 2000))]), FLOOR))
    expect(withRole(list, 'room-anchor').map((item) => item.ref?.id)).toEqual(['room-kitchen#edge-room-kitchen-1'])
  })

  it('sits at the middle of the Edge it marks, at a size that does not change with the drawing', () => {
    const list = drawn(deriveRooms(model([anchored()]), FLOOR))
    const [badge] = withRole(list, 'room-anchor')
    // Edge 1 runs (0,0) → (4000,0); the badge is a diamond of the screen-constant 7 mm about it.
    expect(badge?.kind === 'path' ? badge.segments.map((s) => ('to' in s ? s.to : null)) : null).toEqual([
      pt(2000, -3.5),
      pt(2003.5, 0),
      pt(2000, 3.5),
      pt(1996.5, 0),
    ])
    expect(badge?.kind === 'path' ? badge.closed : false).toBe(true)
  })

  it('says nothing when no Edge claims a face', () => {
    const list = drawn(deriveRooms(model([KITCHEN, BEDROOM]), FLOOR))
    expect(withRole(list, 'room-anchor')).toEqual([])
  })
})
