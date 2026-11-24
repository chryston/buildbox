/**
 * The vertical producers (#76 §5): the pair families, the never-list, and the order-freedom of
 * the output. The floors are hand-built `WarningFloor` records — the producers are pure functions
 * of that shape, so the geometry and the arithmetic can be checked without a Project under them.
 */
import { describe, expect, it } from 'vitest'
import type { ClosedPath } from '../../../geometry'
import type { ClearanceEnvelope, EntityId, ItemFootprint } from '../../../domain'
import { VERTICAL_PRODUCERS } from './vertical'
import type { WarningBeam, WarningCandidate, WarningFloor, WarningOpening, WarningPlacement, WarningService, WarningSkirting, WarningWall } from '../types'

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
  beams: [],
  skirtings: [],
  services: [],
  junctions: [],
  rooms: [],
  placements: [],
  limits: { lowerMm: null, upperMm: null },
  ...parts,
})

/**
 * A Skirting on the `left` face of `wallAlongX` — the face at y = −50 — with a body of `thickness`
 * stood off it. `bodies` defaults to one strip over the whole Wall, which is what a whole-face
 * Skirting derives to when nothing gaps it.
 */
const skirtingOn = (
  id: EntityId,
  label: string,
  bottom: number,
  top: number,
  thickness = 15,
  parts: Partial<WarningSkirting> = {},
): WarningSkirting => ({
  id,
  floorId: FLOOR,
  label,
  hostWallId: 'wall-1',
  side: 'left',
  bottom,
  top,
  thickness,
  hostLine: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
  innerOffset: -50,
  bodies: [rect(0, -50 - thickness, 4000, thickness)],
  ...parts,
})

/** A Service Run along the x axis from (0,0) to (4000,0), `width` wide and centred on the axis. */
const runOf = (
  id: EntityId,
  label: string,
  bottom: number,
  top: number,
  width = 50,
  parts: Partial<WarningService> = {},
): WarningService => ({
  id,
  floorId: FLOOR,
  label,
  bottom,
  top,
  centrelineElevation: (bottom + top) / 2,
  shape: 'run',
  kind: 'water',
  section: 'round',
  outsideDiameter: width,
  width: null,
  depth: null,
  name: undefined,
  body: rect(0, -width / 2, 4000, width),
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
  it('carries the §5, #77, #78 and #79 types exactly once', () => {
    const types = VERTICAL_PRODUCERS.map((producer) => producer.type)
    expect(types).toEqual([
      'item_item_overlap',
      'item_into_wall',
      'opening_host_above',
      'opening_host_below',
      'floor_limit_above',
      'floor_limit_below',
      'clearance_envelope_intrusion',
      'beam_placed_item',
      'beam_opening',
      'beam_clearance_envelope_intrusion',
      'skirting_placed_item',
      'skirting_host_above',
      'skirting_host_below',
      'service_placed_item',
      'service_opening',
      'service_beam',
      'service_clearance_envelope',
    ])
  })

  it('has no Service–Wall, Service–Service or Service–Skirting producer (#79 §6 criterion 26)', () => {
    const types = VERTICAL_PRODUCERS.map((producer) => producer.type)
    expect(types.filter((type) => type.startsWith('service_'))).toEqual([
      'service_placed_item',
      'service_opening',
      'service_beam',
      'service_clearance_envelope',
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

/** A Beam along the x axis from (0,0) to (length,0), centred, `underside` to `underside + depth`. */
const beamAlongX = (
  id = 'beam-1',
  label = 'Beam B-1',
  length = 4000,
  width = 200,
  underside = 2300,
  depth = 300,
): WarningBeam => ({
  id,
  floorId: FLOOR,
  label,
  line: { start: { x: 0, y: 0 }, end: { x: length, y: 0 } },
  width,
  justification: 'centre',
  underside,
  top: underside + depth,
})

describe('the Beam producers (#77 §2 criterion 5)', () => {
  const envelope = (path: ClosedPath, bottomOffset: number, height: number): ClearanceEnvelope => ({ path, bottomOffset, height })

  it('says a Placed Item reaches past the Underside, naming the item first', () => {
    // The acceptance example: a Wall cabinet whose top is 40 mm into a Beam standing at 2 300.
    const [candidate] = produce('beam_placed_item', floorWith({
      beams: [beamAlongX()],
      placements: [box('pl-a', 'Wall cabinet #1', 500, -100, 600, 200, 0, 2340)],
    }))
    expect(candidate).toBeDefined()
    expect(candidate!.messageKey).toBe('vertical_above')
    expect(candidate!.params).toEqual({ a: 'Wall cabinet #1', b: 'Beam B-1', aKind: 'placedItem', bKind: 'beam', mm: 40 })
    expect(candidate!.subjects.map((subject) => subject.id)).toEqual(['pl-a', 'beam-1'])
  })

  it('says an Opening reaches past the Underside through its host Wall', () => {
    const [candidate] = produce('beam_opening', floorWith({
      walls: [wallAlongX()],
      openings: [opening('open-1', 'wall-1', 'Window WND-1', 1000, 900, 1000, 2350)],
      beams: [beamAlongX()],
    }))
    expect(candidate).toBeDefined()
    expect(candidate!.messageKey).toBe('vertical_above')
    expect(candidate!.params).toEqual({ a: 'Window WND-1', b: 'Beam B-1', aKind: 'opening', bKind: 'beam', mm: 50 })
  })

  it('says nothing about a Beam that only touches, or only passes beside', () => {
    // Touching is not overlapping: a cabinet top exactly at the Underside is a cabinet under a Beam.
    expect(produce('beam_placed_item', floorWith({
      beams: [beamAlongX()],
      placements: [box('pl-a', 'Wall cabinet #1', 500, -100, 600, 200, 0, 2300)],
    }))).toEqual([])
    // The plan has to meet as well as the height: a Beam in another part of the Floor says nothing.
    expect(produce('beam_placed_item', floorWith({
      beams: [beamAlongX('beam-1', 'Beam B-1', 1000)],
      placements: [box('pl-a', 'Wall cabinet #1', 3000, -100, 600, 200, 0, 2340)],
    }))).toEqual([])
  })

  it('never warns Beam against Wall, nor Beam against Beam (#77 §2 criterion 5)', () => {
    // A Beam under a Wall, and two Beams crossing, are both ordinary drawings of one thing.
    const crossed = floorWith({
      walls: [wallAlongX('wall-1', 'W-1', 4000, 100, 0, 2600)],
      beams: [beamAlongX(), beamAlongX('beam-2', 'Beam B-2', 4000, 200, 2300, 300)],
    })
    for (const type of ['beam_placed_item', 'beam_opening', 'beam_clearance_envelope_intrusion']) {
      expect(produce(type, crossed), type).toEqual([])
    }
    // A Beam crossing another at the same height is the whole point of drawing two of them.
    expect(produce('beam_placed_item', floorWith({ beams: [beamAlongX(), beamAlongX('beam-2', 'Beam B-2')] }))).toEqual([])
  })

  it('measures a Beam taking up a Clearance Envelope in area and share', () => {
    const owner = {
      ...box('pl-a', 'Wall cabinet #1', 0, 0, 600, 600, 0, 2000),
      clearanceEnvelope: envelope(rect(0, 0, 1000, 1000), 0, 2600),
      envelopeWorldPath: rect(0, 0, 1000, 1000),
    }
    const [candidate] = produce('beam_clearance_envelope_intrusion', floorWith({ beams: [beamAlongX()], placements: [owner] }))
    expect(candidate).toBeDefined()
    expect(candidate!.messageKey).toBe('clearance_envelope_intrusion')
    expect(candidate!.params.a).toBe('Beam B-1')
    expect(candidate!.params.b).toBe('Wall cabinet #1')
    // Half the Beam's 200 width lies inside the 1 m² envelope, over 1 000 mm of its length.
    expect(candidate!.params.m2).toBeCloseTo(0.1, 10)
    expect(candidate!.params.pct).toBeCloseTo(10, 10)
    expect(candidate!.subjects.map((subject) => subject.type)).toEqual(['beam', 'placedItem'])
  })

  it('carries a Beam past the Floor’s own limits in both directions', () => {
    const high = produce('floor_limit_above', floorWith({ beams: [beamAlongX()], limits: { lowerMm: 0, upperMm: 2560 } }))
    expect(high[0]!.params).toEqual({ a: 'Beam B-1', aKind: 'beam', mm: 40 })
    const low = produce('floor_limit_below', floorWith({ beams: [beamAlongX('beam-1', 'Beam B-1', 4000, 200, -130)], limits: { lowerMm: -100, upperMm: null } }))
    expect(low[0]!.params).toEqual({ a: 'Beam B-1', aKind: 'beam', mm: 30 })
    // A Floor with no limit set invents no rule.
    expect(produce('floor_limit_above', floorWith({ beams: [beamAlongX()], limits: { lowerMm: null, upperMm: null } }))).toEqual([])
  })
})

describe('the Skirting producers (#78 §6)', () => {
  it('says how far the body stands in a footprint it cannot stand in', () => {
    // The cabinet's back edge lies on the host face at y = −50 and runs into the room, so the whole
    // 15 mm of the body is inside it.
    const floor = floorWith({ skirtings: [skirtingOn('sk-1', 'Skirting SK-1', 0, 100)], placements: [box('pl-a', 'Base cabinet #1', 0, -650, 2000, 600)] })
    const [candidate] = produce('skirting_placed_item', floor)
    expect(candidate).toBeDefined()
    expect(candidate!.messageKey).toBe('skirting_placed_item')
    expect(candidate!.params).toEqual({ a: 'Skirting SK-1', b: 'Base cabinet #1', mm: 15 })
    expect(candidate!.measured).toEqual({ mm: 15 })
    expect(candidate!.subjects.map((subject) => subject.type)).toEqual(['skirting', 'placedItem'])
  })

  it('measures the depth actually inside, never more than the thickness', () => {
    // The cabinet only reaches 6 mm past the face: 6 mm of the 15 mm body is inside it.
    const floor = floorWith({ skirtings: [skirtingOn('sk-1', 'Skirting SK-1', 0, 100)], placements: [box('pl-a', 'Base cabinet #1', 0, -56, 2000, 6)] })
    expect(produce('skirting_placed_item', floor)[0]!.params.mm).toBeCloseTo(6, 9)
  })

  it('says nothing where the cabinet is off the face, above the Skirting, or beside it', () => {
    const skirtings = [skirtingOn('sk-1', 'Skirting SK-1', 0, 100)]
    // 15 mm off the face: the back edge lies on the exposed face, which is touching, not overlapping.
    expect(produce('skirting_placed_item', floorWith({ skirtings, placements: [box('pl-a', 'Base cabinet #1', 0, -665, 2000, 600)] }))).toEqual([])
    // A wall cabinet that starts at the Skirting's top: touching in height is no warning either.
    expect(produce('skirting_placed_item', floorWith({ skirtings, placements: [box('pl-a', 'Wall cabinet #1', 0, -650, 2000, 600, 100, 2000)] }))).toEqual([])
    // A cabinet that runs past the end of the Skirting's body in plan.
    expect(produce('skirting_placed_item', floorWith({ skirtings, placements: [box('pl-a', 'Base cabinet #1', 4200, -650, 600, 600)] }))).toEqual([])
  })

  it('warns once per pair, over the deepest run', () => {
    const skirtings = [skirtingOn('sk-1', 'Skirting SK-1', 0, 100, 15, { bodies: [rect(0, -65, 1000, 15), rect(1200, -60, 1000, 10)] })]
    const candidates = produce('skirting_placed_item', floorWith({ skirtings, placements: [box('pl-a', 'Base cabinet #1', 0, -650, 3000, 600)] }))
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.params.mm).toBeCloseTo(15, 9)
  })

  it('words a Skirting reaching past its host with the shared host-range copy', () => {
    const floor = floorWith({ walls: [wallAlongX()], skirtings: [skirtingOn('sk-1', 'Skirting SK-1', -20, 80)] })
    expect(produce('skirting_host_below', floor)[0]!.params).toEqual({ a: 'Skirting SK-1', aKind: 'skirting', b: 'Wall W-1', mm: 20 })
    const tall = floorWith({ walls: [wallAlongX('wall-1', 'W-1', 4000, 100, 0, 100)], skirtings: [skirtingOn('sk-1', 'Skirting SK-1', 0, 130)] })
    expect(produce('skirting_host_above', tall)[0]!.params).toEqual({ a: 'Skirting SK-1', aKind: 'skirting', b: 'Wall W-1', mm: 30 })
    // A Skirting inside its host says nothing, and one with no host to measure against says nothing.
    expect(produce('skirting_host_below', floorWith({ walls: [wallAlongX()], skirtings: [skirtingOn('sk-2', 'Skirting SK-2', 0, 100)] }))).toEqual([])
    expect(produce('skirting_host_below', floorWith({ skirtings: [skirtingOn('sk-1', 'Skirting SK-1', -20, 80)] }))).toEqual([])
  })

  it('carries a Skirting past the Floor’s own limits in both directions', () => {
    const high = produce('floor_limit_above', floorWith({ skirtings: [skirtingOn('sk-1', 'Skirting SK-1', 0, 100)], limits: { lowerMm: 0, upperMm: 60 } }))
    expect(high[0]!.params).toEqual({ a: 'Skirting SK-1', aKind: 'skirting', mm: 40 })
    const low = produce('floor_limit_below', floorWith({ skirtings: [skirtingOn('sk-1', 'Skirting SK-1', -20, 80)], limits: { lowerMm: 0, upperMm: null } }))
    expect(low[0]!.params).toEqual({ a: 'Skirting SK-1', aKind: 'skirting', mm: 20 })
  })
})

describe('the Service producers (#79 §6 criterion 26)', () => {
  it('says a Service overlaps a Placed Item, naming the Service first', () => {
    const floor = floorWith({ services: [runOf('sv-1', 'W Ø50', 200, 250)], placements: [box('pl-a', 'Wall cabinet #1', 1000, -100, 600, 600, 0, 400)] })
    const [candidate] = produce('service_placed_item', floor)
    expect(candidate!.subjects).toEqual([{ type: 'service', id: 'sv-1' }, { type: 'placedItem', id: 'pl-a' }])
    expect(candidate!.messageKey).toBe('vertical_overlap_height')
    expect(candidate!.params).toEqual({ a: 'W Ø50', b: 'Wall cabinet #1', aKind: 'service', bKind: 'placedItem', mm: 50 })
    expect(candidate!.measured).toEqual({ mm: 50 })
  })

  it('says nothing for a Service that only touches a Placed Item, or passes beside it', () => {
    // Extents that meet at 200 and stop: touching, not overlapping.
    expect(produce('service_placed_item', floorWith({ services: [runOf('sv-1', 'W Ø50', 150, 200)], placements: [box('pl-a', 'C #1', 1000, -100, 600, 600, 200, 400)] }))).toEqual([])
    // A real height overlap, but the plan bodies are a metre apart in y.
    expect(produce('service_placed_item', floorWith({ services: [runOf('sv-1', 'W Ø50', 200, 250)], placements: [box('pl-a', 'C #1', 1000, 900, 600, 600, 0, 400)] }))).toEqual([])
  })

  it('signs a Service pair from the record, never from the measured number', () => {
    const near = produce('service_placed_item', floorWith({ services: [runOf('sv-1', 'W Ø50', 200, 250)], placements: [box('pl-a', 'C #1', 1000, -100, 600, 600, 0, 400)] }))
    const far = produce('service_placed_item', floorWith({ services: [runOf('sv-1', 'W Ø50', 200, 250)], placements: [box('pl-a', 'C #1', 3000, -100, 600, 600, 0, 400)] }))
    expect(JSON.stringify(near[0]!.signatureInputs)).not.toBe(JSON.stringify(far[0]!.signatureInputs))
    expect(near[0]!.signatureInputs).toMatchObject({ service: { id: 'sv-1', kind: 'water', shape: 'run', outsideDiameter: 50 } })
  })

  it('says a Service runs through an Opening in its path', () => {
    const floor = floorWith({
      walls: [wallAlongX()],
      openings: [opening('op-1', 'wall-1', 'Window O-1', 1000, 900, 200, 1200)],
      services: [runOf('sv-1', 'D Ø100', 210, 310)],
    })
    const [candidate] = produce('service_opening', floor)
    expect(candidate!.subjects).toEqual([{ type: 'service', id: 'sv-1' }, { type: 'opening', id: 'op-1' }])
    expect(candidate!.params.a).toBe('D Ø100')
    expect(candidate!.params.b).toBe('Window O-1')
  })

  it('says a Service clashes with a Beam at the same height', () => {
    const floor = floorWith({ beams: [beamAlongX('beam-1', 'Beam B-1', 4000, 200, 200, 300)], services: [runOf('sv-1', 'AC 80×60', 300, 360)] })
    const [candidate] = produce('service_beam', floor)
    expect(candidate!.subjects).toEqual([{ type: 'service', id: 'sv-1' }, { type: 'beam', id: 'beam-1' }])
    expect(candidate!.params.aKind).toBe('service')
    expect(candidate!.params.bKind).toBe('beam')
    // A Beam at ceiling height and a pipe at skirting height simply both exist.
    expect(produce('service_beam', floorWith({ beams: [beamAlongX('beam-1', 'Beam B-1', 4000, 200, 2300, 300)], services: [runOf('sv-1', 'AC 80×60', 300, 360)] }))).toEqual([])
  })

  it('says a Service stands in another Item’s Clearance Envelope', () => {
    const owner = { ...box('pl-a', 'Fridge #1', 1000, -400, 600, 600, 0, 1800), clearanceEnvelope: { path: rect(0, 0, 700, 700), bottomOffset: 0, height: 2000 }, envelopeWorldPath: rect(1000, -400, 700, 700) }
    const floor = floorWith({ services: [runOf('sv-1', 'W Ø50', 200, 250)], placements: [owner] })
    const [candidate] = produce('service_clearance_envelope', floor)
    expect(candidate!.subjects).toEqual([{ type: 'service', id: 'sv-1' }, { type: 'placedItem', id: 'pl-a' }])
    // A Service outside the envelope's plan region says nothing.
    expect(produce('service_clearance_envelope', floorWith({ services: [runOf('sv-1', 'W Ø50', 200, 250, 50, { body: rect(0, 5000, 4000, 50) })], placements: [owner] }))).toEqual([])
  })

  it('carries a Service past the Floor’s own limits in both directions', () => {
    const high = produce('floor_limit_above', floorWith({ services: [runOf('sv-1', 'E 80×60', 2500, 2680)], limits: { lowerMm: 0, upperMm: 2600 } }))
    expect(high[0]!.params).toEqual({ a: 'E 80×60', aKind: 'service', mm: 80 })
    const low = produce('floor_limit_below', floorWith({ services: [runOf('sv-1', 'W Ø50', -125, -75)], limits: { lowerMm: 0, upperMm: null } }))
    expect(low[0]!.params).toEqual({ a: 'W Ø50', aKind: 'service', mm: 125 })
  })

  it('warns about nothing when no Service stands on the Floor', () => {
    for (const type of ['service_placed_item', 'service_opening', 'service_beam', 'service_clearance_envelope']) {
      expect(produce(type, floorWith({ placements: [box('pl-a', 'C #1', 0, 0, 600, 600)] }))).toEqual([])
    }
  })
})
