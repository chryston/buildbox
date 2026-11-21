/**
 * Where the Door / window tool would put an Opening, and what it says when it cannot (#65 §5, §10).
 *
 * The sentences are asserted word for word because the sentence is the criterion: one plain line,
 * no coordinates, naming the preset and the Wall. The numbers are the issue's own — a 900 mm door
 * centred on a free 3 000 mm Wall, the same door 500 mm from either end, the same door on a Wall
 * too short to hold it.
 */
import { describe, expect, it } from 'vitest'
import type { Wall, WallJunction, WallRefLine } from '../../../domain'
import { pt, usableIntervals } from '../../../derive'
import { emptyOpeningDraft, openingAim, withEnd, withPreset, withTypedDistance } from './openingDraft'
import type { OpeningAimInput } from './openingDraft'
import { DEFAULT_OPENING_PRESET_ID, openingPresetRow, resolveOpeningPreset } from './openingPresets'

const FLOOR = 'floor-1'

const line = (x1: number, y1: number, x2: number, y2: number): WallRefLine => ({
  kind: 'line',
  start: pt(x1, y1),
  end: pt(x2, y2),
})

const wall = (id: string, ref: string, x1: number, y1: number, x2: number, y2: number, thickness = 100): Wall => ({
  id,
  ref,
  floorId: FLOOR,
  line: line(x1, y1, x2, y2),
  thickness,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

/** A corner: two Walls whose ends meet, tidied into one Junction. */
const corner = (id: string, a: string, b: string): WallJunction => ({
  id,
  floorId: FLOOR,
  ends: [
    { wallId: a, end: 'end' },
    { wallId: b, end: 'start' },
  ],
})

/** A branch meeting the middle of a host's reference line: the only shape that says "join". */
const tee = (id: string, host: string, branch: string, at: number): WallJunction => ({
  id,
  floorId: FLOOR,
  ends: [{ wallId: branch, end: 'start' }],
  host: { wallId: host, at },
})

const input = (walls: readonly Wall[], junctions: readonly WallJunction[], presetId: string): OpeningAimInput => ({
  walls,
  junctions,
  usable: usableIntervals(walls, junctions),
  preset: openingPresetRow(presetId),
  hostHeightOf: (wallId) => walls.find((each) => each.id === wallId)?.height ?? 0,
  reach: 200,
  refOf: (wallId) => walls.find((each) => each.id === wallId)?.ref ?? wallId,
  format: (mm) => `${Math.round(mm)} mm`,
})

const free = wall('wall-a', 'W-1', 0, 0, 3000, 0)
const at = (x: number, y = 0): { x: number; y: number } => ({ x, y })

describe('the Door / window tool’s aim', () => {
  it('centres the Opening on the pointer and says nothing else', () => {
    const aim = openingAim(at(1500), emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), input([free], [], DEFAULT_OPENING_PRESET_ID))
    expect(aim).not.toBeNull()
    expect(aim?.hostWallId).toBe('wall-a')
    expect(aim?.start).toBe(1050)
    expect(aim?.end).toBe(1950)
    expect(aim?.fits).toBe(true)
    expect(aim?.message).toBeNull()
    expect(aim?.violated).toBeNull()
  })

  it('measures a typed distance from the end the chip has highlighted', () => {
    const base = input([free], [], DEFAULT_OPENING_PRESET_ID)
    const fromStart = withTypedDistance(emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), 500)
    expect(openingAim(at(1500), fromStart, base)?.start).toBe(500)
    // Choosing the other end keeps the number the person typed only after they type it again:
    // `withEnd` clears it, because 500 from one end is not 500 from the other.
    expect(openingAim(at(1500), withEnd(fromStart, 'end'), base)?.start).toBe(1050)
    const fromEnd = withTypedDistance(withEnd(emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), 'end'), 500)
    expect(openingAim(at(1500), fromEnd, base)?.start).toBe(1600)
    // The pointer still chooses which Wall; the number only chooses where along it.
    expect(openingAim(at(1500), fromEnd, base)?.hostWallId).toBe('wall-a')
  })

  it('shows the room left to each usable end of the stretch it stands in', () => {
    const aim = openingAim(
      at(1500),
      withTypedDistance(emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), 500),
      input([free], [], DEFAULT_OPENING_PRESET_ID),
    )
    expect(aim?.chip).toEqual({ fromStart: '500 mm', fromEnd: '1600 mm' })
  })

  it('says which end a door would run past, in one sentence and no coordinate', () => {
    const aim = openingAim(at(2800), emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), input([free], [], DEFAULT_OPENING_PRESET_ID))
    expect(aim?.fits).toBe(false)
    expect(aim?.message).toBe("Bedroom door doesn't fit here: it would run past the end of W-1.")
    expect(aim?.violated).toEqual({ from: 0, to: 3000 })
  })

  it('says that a short Wall cannot hold the preset at all', () => {
    const stub = wall('wall-s', 'W-9', 0, 0, 750, 0)
    const aim = openingAim(at(375), emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), input([stub], [], DEFAULT_OPENING_PRESET_ID))
    expect(aim?.message).toBe('This wall is shorter than a 900 mm door.')
  })

  it('names the Wall on the other side of a join the Opening would cross', () => {
    const host = wall('wall-h', 'W-5', 0, 0, 6000, 0)
    const branch = wall('wall-b', 'W-6', 3000, 0, 3000, 3000)
    const aim = openingAim(
      at(2700),
      withTypedDistance(emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), 2300),
      input([host, branch], [tee('j-1', 'wall-h', 'wall-b', 3000)], DEFAULT_OPENING_PRESET_ID),
    )
    expect(aim?.fits).toBe(false)
    expect(aim?.message).toBe("Bedroom door doesn't fit here: it would cross the join with W-6.")
  })

  it('refuses to aim at nothing', () => {
    const base = input([free], [], DEFAULT_OPENING_PRESET_ID)
    expect(openingAim(null, emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), base)).toBeNull()
    // Far from every face: the pointer is over the room, not over a Wall.
    expect(openingAim(at(1500, 4000), emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), base)).toBeNull()
  })

  it('picks the nearer of two Walls the pointer could mean', () => {
    const near = wall('wall-n', 'W-1', 0, 0, 3000, 0)
    const far = wall('wall-f', 'W-2', 0, 1000, 3000, 1000)
    const aim = openingAim(at(1500, 960), emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), input([near, far], [], DEFAULT_OPENING_PRESET_ID))
    expect(aim?.hostWallId).toBe('wall-f')
  })

  it('starts the position again when another row is picked', () => {
    const typed = withTypedDistance(emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), 500)
    expect(withPreset(typed, 'window.standard')).toEqual({ presetId: 'window.standard', from: 'start', typed: null })
    expect(withEnd(typed, 'end')).toEqual({ presetId: DEFAULT_OPENING_PRESET_ID, from: 'end', typed: null })
  })

  it('carries the preset’s own sill and head into the ghost', () => {
    const base = input([free], [], 'window.standard')
    const aim = openingAim(at(1500), emptyOpeningDraft('window.standard'), base)
    // A 1,050 sill is above the floor, so the symbol is the same door-shaped gap: what differs is
    // the Intent's numbers, and the ghost must be standing on the Wall the aim names.
    expect(aim?.symbol.hostWallId).toBe('wall-a')
    expect(aim?.symbol.kind).toBe('window')
    expect(resolveOpeningPreset(openingPresetRow('window.standard'), 2600)).toEqual({
      kind: 'window',
      swing: undefined,
      width: 1200,
      sill: 1050,
      head: 2300,
    })
  })

  it('resolves a removed section against the host Wall’s own height', () => {
    const row = openingPresetRow('other.removed-section')
    expect(row.head).toBeNull()
    expect(resolveOpeningPreset(row, 2400).head).toBe(2400)
  })

  it('draws the corner’s trim into the aim, not into the message', () => {
    const a = wall('wall-a', 'W-1', 0, 0, 3000, 0)
    const b = wall('wall-b', 'W-2', 3000, 0, 3000, 3000)
    const aim = openingAim(at(2900), emptyOpeningDraft(DEFAULT_OPENING_PRESET_ID), input([a, b], [corner('j-1', 'wall-a', 'wall-b')], DEFAULT_OPENING_PRESET_ID))
    // The corner takes the last few centimetres of W-1, so a door centred at 2 900 is stopped
    // before it reaches the join — and the sentence says whose Wall it ran out of.
    expect(aim?.fits).toBe(false)
    expect(aim?.message).toContain('W-1')
  })
})
