/**
 * The vertical producers (#76 §5): the pair families, the never-list, and the order-freedom of
 * the output. The floors are hand-built `WarningFloor` records — the producers are pure functions
 * of that shape, so the geometry and the arithmetic can be checked without a Project under them.
 */
import { describe, expect, it } from 'vitest'
import type { ClosedPath } from '../../../geometry'
import type { ClearanceEnvelope, EntityId, ItemFootprint } from '../../../domain'
import { VERTICAL_PRODUCERS } from './vertical'
import type { WarningCandidate, WarningFloor, WarningOpening, WarningPlacement, WarningWall } from '../types'

const FLOOR = 'floor-main'

/** An axis-aligned rectangle, closed the way `ClosedPath` wants it closed. */
const rect = (x: number, y: number, w: number, h: number): ClosedPath => ({
  start: { x, y },
  segments: [
    { kind: 'line', to: { x: x + w, y } },
    { kind: 'line', to: { x: x + w, y: y + h } },
    { kind: 'line', to: { x, y: y + h } },
    { kind: 'line', to: { x, y } },
  ],
})

const box = (id: string, label: string, x: number, y: number, w: number, h: number, baseElevation = 0, height = 860): WarningPlacement => {
  const footprint: ItemFootprint = { kind: 'path', path: rect(0, 0, w, h) }
  return {
    id,
    itemDesignId: `design-${id}`,
    label,
    worldPath: rect(x, y, w, h),
    translation: { x, y },
    rotationDeg: 0,
    footprint,
    origin: { x: 0, y: 0 },
    baseElevation,
    height,
    clearanceEnvelope: null,
    envelopeWorldPath: null,
  }
}

/** A Wall along the x axis from (0,0) to (length,0), centred on its reference line. */
const wallAlongX = (
  id = 'wall-1',
  ref = 'W-1',
  length = 4000,
  thickness = 100,
  baseElevation = 0,
  height = 2600,
): WarningWall => ({
  id,
  ref,
  floorId: FLOOR,
  line: { kind: 'line', start: { x: 0, y: 0 }, end: { x: length, y: 0 } },
  thickness,
  justification: 'centre',
  outline: rect(0, -thickness / 2, length, thickness),
  baseElevation,
  height,
})

const opening = (
  id: EntityId,
  hostWallId: EntityId,
  label: string,
  start: number,
  width: number,
  sill: number,
  head: number,
): WarningOpening => ({ id, hostWallId, label, sill, head, start, width })

const floorWith = (parts: Partial<Omit<WarningFloor, 'floorId'>> = {}): WarningFloor => ({
  floorId: FLOOR,
  walls: [],
  openings: [],
  junctions: [],
  rooms: [],
  placements: [],
  limits: { lowerMm: null, upperMm: null },
  ...parts,
})

const produce = (type: string, floor: WarningFloor): WarningCandidate[] => {
  const producer = VERTICAL_PRODUCERS.find((candidate) => candidate.type === type)
  if (producer === undefined) throw new Error(`no producer named ${type}`)
  return producer.produce(floor, null)
}

describe('item_item_overlap', () => {
  const overlapping = floorWith({
    placements: [box('pl-a', 'Base cabinet #1', 0, 0, 600, 600), box('pl-b', 'Base cabinet #2', 500, 0, 600, 600)],
  })

  it('names the higher-bottomed item first and measures to the other top', () => {
    // The acceptance example: a Wall cabinet whose bottom sits 60 mm under the Base top.
    const raised = floorWith({
      placements: [box('pl-a', 'Base cabinet #1', 0, 0, 600, 600), box('pl-b', 'Wall cabinet #1', 500, 0, 600, 600, 800, 700)],
    })
    const [candidate] = produce('item_item_overlap', raised)
    expect(candidate).toBeDefined()
    expect(candidate!.messageKey).toBe('vertical_below')
    expect(candidate!.params).toEqual({ a: 'Wall cabinet #1', b: 'Base cabinet #1', aKind: 'placedItem', bKind: 'placedItem', mm: 60 })
    expect(candidate!.subjects.map((subject) => subject.id)).toEqual(['pl-b', 'pl-a'])
  })

  it('falls to the lower ID when the extents are identical', () => {
    const [candidate] = produce('item_item_overlap', overlapping)
    expect(candidate!.messageKey).toBe('vertical_overlap_height')
    expect(candidate!.params.a).toBe('Base cabinet #1')
    expect(candidate!.params.mm).toBe(860)
  })

  it('reports an overlap band when one extent sits inside the other', () => {
    const crossing = floorWith({
      placements: [box('pl-a', 'Wall cabinet #1', 0, 0, 600, 600, 0, 860), box('pl-b', 'Shelf #1', 500, 0, 600, 600, 400, 300)],
    })
    const [candidate] = produce('item_item_overlap', crossing)
    expect(candidate!.messageKey).toBe('vertical_overlap_height')
    expect(candidate!.params.mm).toBe(300)
  })

  it('never warns about touching: zero plan area, or zero height overlap', () => {
    expect(produce('item_item_overlap', floorWith({
      placements: [box('pl-a', 'A', 0, 0, 600, 600), box('pl-b', 'B', 600, 0, 600, 600)],
    }))).toHaveLength(0)
    expect(produce('item_item_overlap', floorWith({
      placements: [box('pl-a', 'A', 0, 0, 600, 600, 0, 860), box('pl-b', 'B', 0, 0, 600, 600, 860, 400)],
    }))).toHaveLength(0)
  })

  it('treats a hundredth of a square millimetre as touching', () => {
    expect(produce('item_item_overlap', floorWith({
      placements: [box('pl-a', 'A', 0, 0, 600, 600), box('pl-b', 'B', 599.99, 0, 600, 600)],
    }))).toHaveLength(0)
  })

  it('does not care which order the placements arrive in', () => {
    const forward = produce('item_item_overlap', overlapping)
    const backward = produce('item_item_overlap', floorWith({ placements: [...overlapping.placements].reverse() }))
    expect(backward.map((c) => c.subjects.map((s) => s.id))).toEqual(forward.map((c) => c.subjects.map((s) => s.id)))
    expect(backward.map((c) => c.messageKey)).toEqual(forward.map((c) => c.messageKey))
  })
})

describe('item_into_wall', () => {
  const wall = wallAlongX()

  it('measures the penetration past the nearer face', () => {
    // The band is y ∈ [-50, 50]; the item reaches from y = -100 to y = 0, so it crosses the
    // nearer face by 50 mm and never reaches the far one.
    const floor = floorWith({ walls: [wall], placements: [box('pl-a', 'Base cabinet #1', 1000, -100, 600, 100)] })
    const [candidate] = produce('item_into_wall', floor)
    expect(candidate!.messageKey).toBe('item_into_wall')
    expect(candidate!.params).toEqual({ a: 'Base cabinet #1', b: 'Wall W-1', mm: 50 })
  })

  it('caps a full pass-through at the thickness', () => {
    const floor = floorWith({ walls: [wall], placements: [box('pl-a', 'A', 1000, -100, 600, 600)] })
    const [candidate] = produce('item_into_wall', floor)
    expect(candidate!.params.mm).toBe(100)
  })

  it('never warns about a footprint merely touching the face', () => {
    const floor = floorWith({ walls: [wall], placements: [box('pl-a', 'A', 1000, 50, 600, 600)] })
    expect(produce('item_into_wall', floor)).toHaveLength(0)
  })

  it('never warns when the extents only touch: the item stands on the wall top', () => {
    const floor = floorWith({ walls: [wall], placements: [box('pl-a', 'A', 1000, -100, 600, 600, 2600, 400)] })
    expect(produce('item_into_wall', floor)).toHaveLength(0)
  })

  it('lets an item through the gap of an Opening whose height range covers it', () => {
    const withGap = floorWith({
      walls: [wall],
      openings: [opening('op-1', 'wall-1', 'Door 1', 1000, 900, 0, 2100)],
      placements: [box('pl-a', 'Service run #1', 1100, -100, 600, 200)],
    })
    expect(produce('item_into_wall', withGap)).toHaveLength(0)
  })

  it('still warns when the item reaches above the Opening head', () => {
    const aboveGap = floorWith({
      walls: [wall],
      openings: [opening('op-1', 'wall-1', 'Window 1', 1000, 900, 900, 2100)],
      placements: [box('pl-a', 'Tall cupboard #1', 1100, -100, 600, 200, 0, 2400)],
    })
    expect(produce('item_into_wall', aboveGap).length).toBe(1)
  })

  it('warns beside the gap, not through it', () => {
    const besideGap = floorWith({
      walls: [wall],
      openings: [opening('op-1', 'wall-1', 'Door 1', 1000, 900, 0, 2100)],
      placements: [box('pl-a', 'Base cabinet #1', 2500, -100, 600, 200)],
    })
    expect(produce('item_into_wall', besideGap).length).toBe(1)
  })
})

describe('opening_host_above and opening_host_below', () => {
  const wall = wallAlongX()

  it('reports the reach past the host top', () => {
    const floor = floorWith({ walls: [wall], openings: [opening('op-1', 'wall-1', 'Window WND-1', 1500, 1200, 900, 2700)] })
    const [candidate] = produce('opening_host_above', floor)
    expect(candidate!.messageKey).toBe('host_range_above')
    expect(candidate!.params).toEqual({ a: 'Window WND-1', b: 'Wall W-1', aKind: 'opening', mm: 100 })
    expect(candidate!.subjects.map((subject) => subject.type)).toEqual(['opening', 'wall'])
  })

  it('reports the reach under the host base', () => {
    const floor = floorWith({ walls: [wall], openings: [opening('op-1', 'wall-1', 'Door DR-1', 1500, 900, -50, 2050)] })
    const [candidate] = produce('opening_host_below', floor)
    expect(candidate!.params.mm).toBe(50)
  })

  it('never warns about an Opening inside its host', () => {
    const floor = floorWith({ walls: [wall], openings: [opening('op-1', 'wall-1', 'Window 1', 1500, 1200, 900, 2100)] })
    expect(produce('opening_host_above', floor)).toHaveLength(0)
    expect(produce('opening_host_below', floor)).toHaveLength(0)
  })
})

describe('floor_limit_above and floor_limit_below', () => {
  const wall = wallAlongX('wall-1', 'W-1', 4000, 100, 0, 2700)

  it('reports a Wall reaching above the upper limit', () => {
    const floor = floorWith({ walls: [wall], limits: { lowerMm: null, upperMm: 2600 } })
    const [candidate] = produce('floor_limit_above', floor)
    expect(candidate!.messageKey).toBe('floor_limit_above')
    expect(candidate!.params).toEqual({ a: 'Wall W-1', aKind: 'wall', mm: 100 })
    expect(candidate!.subjects).toEqual([{ type: 'wall', id: 'wall-1' }])
  })

  it('reports an Opening and a Placed Item under the lower limit', () => {
    const floor = floorWith({
      openings: [opening('op-1', 'wall-1', 'Basement hatch BH-1', 100, 600, -500, 200)],
      placements: [box('pl-a', 'Sump box #1', 1000, 1000, 600, 500, -150, 200)],
      limits: { lowerMm: 0, upperMm: null },
    })
    const found = produce('floor_limit_below', floor)
    expect(found.map((c) => c.subjects[0]!.id).sort()).toEqual(['op-1', 'pl-a'])
  })

  it('never warns when no limit is set, and never about a thing that reaches exactly to it', () => {
    expect(produce('floor_limit_above', floorWith({ walls: [wall] }))).toHaveLength(0)
    const exact = wallAlongX('wall-1', 'W-1', 4000, 100, 0, 2600)
    expect(produce('floor_limit_above', floorWith({ walls: [exact], limits: { lowerMm: null, upperMm: 2600 } }))).toHaveLength(0)
  })
})

describe('clearance_envelope_intrusion', () => {
  const envelope = (path: ClosedPath, bottomOffset = 0, height = 850): ClearanceEnvelope => ({ path, bottomOffset, height })

  /** A 600 × 560 cabinet at (0,0) with a 600 × 300 zone off its far edge, y ∈ [560, 860]. */
  const owner = (): WarningPlacement => {
    const placed = box('pl-a', "Fridge's placement", 0, 0, 600, 560)
    return { ...placed, label: 'Fridge #1', clearanceEnvelope: envelope(rect(0, 560, 600, 300)), envelopeWorldPath: rect(0, 560, 600, 300) }
  }

  it('measures the taken-up area and its share of the envelope', () => {
    const intruder = { ...box('pl-b', 'Island #1', 100, 600, 400, 200), itemDesignId: 'design-other' }
    const [candidate] = produce('clearance_envelope_intrusion', floorWith({ placements: [owner(), intruder] }))
    expect(candidate!.messageKey).toBe('clearance_envelope_intrusion')
    expect(candidate!.params.a).toBe('Island #1')
    expect(candidate!.params.b).toBe('Fridge #1')
    expect(candidate!.params.m2).toBeCloseTo(0.08, 10)
    expect(candidate!.params.pct).toBeCloseTo((400 * 200) / (600 * 300) * 100, 10)
    expect(candidate!.measured.mm).toBeUndefined()
    expect(candidate!.subjects.map((subject) => subject.id)).toEqual(['pl-b', 'pl-a'])
  })

  it('never warns about the Design’s own placements', () => {
    const own = { ...box('pl-b', 'Fridge #2', 100, 600, 400, 200), itemDesignId: 'design-pl-a' }
    expect(produce('clearance_envelope_intrusion', floorWith({ placements: [owner(), own] }))).toHaveLength(0)
  })

  it('never warns about an envelope intruding on an envelope', () => {
    // The second envelope overlaps the first in plan; neither footprint touches either
    // envelope. Two clearances crossing is two facts, not a collision.
    const first = owner()
    const second = {
      ...owner(),
      id: 'pl-b',
      label: 'Fridge #2',
      itemDesignId: 'design-other',
      worldPath: rect(2000, 2000, 600, 560),
      translation: { x: 2000, y: 2000 },
    }
    expect(produce('clearance_envelope_intrusion', floorWith({ placements: [first, second] }))).toHaveLength(0)
  })

  it('never warns when the intruder stands above the envelope', () => {
    const above = { ...box('pl-b', 'Shelf #1', 100, 600, 400, 200, 900, 400), itemDesignId: 'design-other' }
    expect(produce('clearance_envelope_intrusion', floorWith({ placements: [owner(), above] }))).toHaveLength(0)
  })

  it('reports a Wall body taking up the envelope', () => {
    const wall: WarningWall = { ...wallAlongX(), outline: rect(500, 500, 100, 2000) }
    const [candidate] = produce('clearance_envelope_intrusion', floorWith({ walls: [wall], placements: [owner()] }))
    expect(candidate!.subjects.map((subject) => subject.type)).toEqual(['wall', 'placedItem'])
    expect(candidate!.params.a).toBe('Wall W-1')
  })
})

describe('the producer set', () => {
  it('carries the seven §5 types exactly once', () => {
    const types = VERTICAL_PRODUCERS.map((producer) => producer.type)
    expect(types).toEqual([
      'item_item_overlap',
      'item_into_wall',
      'opening_host_above',
      'opening_host_below',
      'floor_limit_above',
      'floor_limit_below',
      'clearance_envelope_intrusion',
    ])
  })

  it('signs every candidate from model fields, never from a measured number', () => {
    // The same pair twice as far along the wall: identical sentences, different signatures.
    const near = produce('item_into_wall', floorWith({ walls: [wallAlongX()], placements: [box('pl-a', 'A', 1000, -100, 600, 100)] }))
    const far = produce('item_into_wall', floorWith({ walls: [wallAlongX()], placements: [box('pl-a', 'A', 2000, -100, 600, 100)] }))
    expect(near[0]!.params.mm).toBe(far[0]!.params.mm)
    expect(JSON.stringify(near[0]!.signatureInputs)).not.toBe(JSON.stringify(far[0]!.signatureInputs))
  })
})
