/**
 * The Room producer: a Placed Item straddling a Room boundary (#67 §16, D7).
 *
 * The fixture is the issue's own picture — a `Base 600` with two Placed Items on one Floor,
 * one of them 125 mm of the way out of the Bedroom — because the sentence names both the item
 * and the Room and prints two figures, and every one of those four things comes from a
 * different place: the ordinal from the engine, the name from the Room, the area from
 * `geometry.overlap`, the percentage from the footprint's own area.
 */
import { describe, expect, it } from 'vitest'
import type { Acknowledgement, GenericItemDesign, PlacedItem, Project, Room, Wall } from '../../../domain'
import { deriveWarnings } from '../engine'
import type { Warning } from '../types'
import { domainFixture } from '../../testing'
import { ROOM_PRODUCERS, itemCrossesRoom } from './rooms'

const FLOOR = 'floor-main'

const room = (id: string, name: string, minX: number, maxX: number): Room => ({
  id,
  floorId: FLOOR,
  name,
  outline: {
    kind: 'path',
    path: {
      start: { x: minX, y: 0 },
      segments: [
        { kind: 'line', to: { x: maxX, y: 0 } },
        { kind: 'line', to: { x: maxX, y: 3000 } },
        { kind: 'line', to: { x: minX, y: 3000 } },
        { kind: 'line', to: { x: minX, y: 0 } },
      ],
    },
    segmentIds: [`edge-${id}-1`, `edge-${id}-2`, `edge-${id}-3`, `edge-${id}-4`],
  },
  wallFaceRefs: [],
})

const KITCHEN = room('room-kitchen', 'Kitchen', 0, 4000)
const BEDROOM = room('room-bedroom', 'Bedroom', 4200, 8200)

/** 600 × 400 about its Item Origin, which sits at the footprint's own centre. */
const BASE_600: GenericItemDesign = {
  id: 'design-base-600',
  kind: 'generic',
  name: 'Base 600',
  footprint: {
    kind: 'preset',
    preset: { kind: 'rectangle', width: 600, depth: 400 },
    centre: { x: 300, y: 200 },
    orientationDeg: 0,
  },
  origin: { x: 300, y: 200 },
  height: 720,
  heightIsTypical: true,
  color: '#c8b49a',
}

const placed = (id: string, x: number, y: number, rotationDeg = 0): PlacedItem => ({
  id,
  floorId: FLOOR,
  itemDesignId: BASE_600.id,
  baseElevation: 0,
  translation: { x, y },
  rotationDeg,
})

const walls: Wall[] = [
  {
    id: 'wall-2',
    ref: 'W-2',
    floorId: FLOOR,
    line: { kind: 'line', start: { x: 0, y: -5000 }, end: { x: 20000, y: -5000 } },
    thickness: 100,
    justification: 'centre',
    baseElevation: 0,
    height: 2600,
  },
]

const model = (items: readonly PlacedItem[], rooms: readonly Room[] = [KITCHEN, BEDROOM]): Project => {
  const base = domainFixture('v4/project-basic.json')
  return {
    ...base,
    itemDesigns: [...base.itemDesigns, BASE_600],
    existingModel: {
      ...base.existingModel,
      walls: [...walls],
      wallJunctions: [],
      placedItems: [...items],
      rooms: [...rooms],
    },
    warningAcknowledgements: [],
    comments: [],
    commentReferenceCounter: 0,
  }
}

/** One item well inside the Kitchen, one 125 mm of the way out of the Bedroom. */
const CROSSING = model([placed('place-600-a', 1000, 1000), placed('place-600-b', 4375, 1500)])

const crossings = (project: Project): Warning[] =>
  deriveWarnings(project, FLOOR, null).warnings.filter((warning) => warning.type === 'item_crosses_room')

const only = (project: Project): Warning => {
  const rows = crossings(project)
  expect(rows).toHaveLength(1)
  return rows[0]!
}

describe('item_crosses_room (#67 §16)', () => {
  it('is registered as a Room producer of exactly that type', () => {
    expect(ROOM_PRODUCERS).toEqual([itemCrossesRoom])
    expect(itemCrossesRoom.type).toBe('item_crosses_room')
  })

  it('warns once, about the item and the Room it straddles, and says nothing of the item inside', () => {
    const warning = only(CROSSING)
    expect(warning.subjects).toEqual([
      { type: 'placedItem', id: 'place-600-b' },
      { type: 'room', id: 'room-bedroom' },
    ])
    expect(warning.floorId).toBe(FLOOR)
    expect(warning.optionId).toBeNull()
  })

  it('measures the analytic area outside the Room and its share of the footprint', () => {
    // 125 mm of a 600 × 400 footprint lies west of the Bedroom's edge: 50 000 mm² of 240 000.
    const warning = only(CROSSING)
    expect(warning.measured.m2).toBeCloseTo(0.05, 12)
    expect(warning.measured.pct).toBeCloseTo((50_000 / 240_000) * 100, 9)
    expect(warning.params).toEqual({ a: 'Base 600 #2', b: 'Bedroom', m2: warning.measured.m2, pct: warning.measured.pct })
  })

  it('says the sentence the issue writes, to the character', () => {
    expect(only(CROSSING).messageKey).toBe('item_crosses_room')
  })

  it('numbers two Placed Items of one Design #1 and #2, and leaves a lone item unnumbered', () => {
    const lone = model([placed('place-600-b', 4375, 1500)])
    expect(only(lone).params.a).toBe('Base 600')
    expect(only(CROSSING).params.a).toBe('Base 600 #2')
  })

  it('produces one warning per Room an item straddles, each with its own figures', () => {
    // 600 wide from x = 3900: 500 mm of it outside the Kitchen, 300 outside the Bedroom.
    const astride = model([placed('place-600-a', 4200, 1500)])
    const rows = crossings(astride)
    expect(rows.map((row) => row.subjects[1]?.id)).toEqual(['room-bedroom', 'room-kitchen'])
    expect(rows[0]?.measured.m2).toBeCloseTo(0.12, 12)
    expect(rows[1]?.measured.m2).toBeCloseTo(0.2, 12)
    expect(rows.map((row) => row.subjects[0]?.id)).toEqual(['place-600-a', 'place-600-a'])
    expect(rows[0]?.key).not.toBe(rows[1]?.key)
  })

  it('says nothing about an item wholly outside every Room (#67 D7)', () => {
    expect(crossings(model([placed('place-600-a', 4100, 5000)]))).toEqual([])
  })

  it('says nothing about an item wholly inside one Room', () => {
    expect(crossings(model([placed('place-600-a', 1000, 1000)]))).toEqual([])
  })

  it('changes both figures when the item turns, and reopens the warning it was acknowledged under', () => {
    const at37 = model([placed('place-600-a', 4375, 1500, 37), placed('place-600-b', 1000, 1000)])
    const at52 = model([placed('place-600-b', 1000, 1000), placed('place-600-a', 4375, 1500, 52)])
    const first = only(at37)
    const second = only(at52)
    expect(second.measured.m2).not.toBeCloseTo(first.measured.m2 ?? 0, 6)
    expect(second.measured.pct).not.toBeCloseTo(first.measured.pct ?? 0, 6)
    expect(second.signature).not.toBe(first.signature)

    const acknowledgement: Acknowledgement = {
      id: 'ack-1',
      warningType: first.type,
      subjectIds: first.subjects.map((subject) => subject.id),
      designOptionId: first.optionId,
      signature: first.signature,
      note: '',
      acknowledgedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(only({ ...at37, warningAcknowledgements: [acknowledgement] }).status).toBe('acknowledged')
    expect(only({ ...at52, warningAcknowledgements: [acknowledgement] }).status).toBe('reopened')
  })

  it('leaves an acknowledgement standing when only the Room was renamed', () => {
    const warning = only(CROSSING)
    const acknowledgement: Acknowledgement = {
      id: 'ack-1',
      warningType: warning.type,
      subjectIds: warning.subjects.map((subject) => subject.id),
      designOptionId: warning.optionId,
      signature: warning.signature,
      note: '',
      acknowledgedAt: '2026-01-01T00:00:00.000Z',
    }
    const renamed = model(
      [placed('place-600-a', 1000, 1000), placed('place-600-b', 4375, 1500)],
      [KITCHEN, { ...BEDROOM, name: 'Study' }],
    )
    const row = only({ ...renamed, warningAcknowledgements: [acknowledgement] })
    expect(row.status).toBe('acknowledged')
    expect(row.params.b).toBe('Study')
  })

  it('does not depend on the order the entities were inserted', () => {
    const shuffled = model([placed('place-600-b', 4375, 1500), placed('place-600-a', 1000, 1000)], [BEDROOM, KITCHEN])
    const warning = only(shuffled)
    expect(warning.key).toBe(only(CROSSING).key)
    expect(warning.signature).toBe(only(CROSSING).signature)
  })
})
