import { describe, expect, it } from 'vitest'
import { deriveWarnings } from '../index'
import type { Acknowledgement, DesignOption, Project, Wall } from '../../domain'
import roomsFixture from '../../../fixtures/domain/v7/rooms.json?raw'

// Warnings run per Design Option (#69 §6): the producers see that Option's standing model, and an
// acknowledgement is half-keyed by the Option it was made in. This file runs in the `renovation`
// project (`npm run test:renovation`) because a build without the flag cannot read an Option.
//
// The base is the v7 rooms fixture, whose W-1 and W-2 cross at (2000, 0) with no Junction — the
// one `wall_crossing` warning the fixture already carries an acknowledgement for, under no Option.

const envelope = JSON.parse(roomsFixture) as { project: Project }
const base = envelope.project
const FLOOR = 'floor-0'

const crossing = (project: Project, optionId: string | null) =>
  deriveWarnings(project, FLOOR, optionId).warnings.filter((warning) => warning.type === 'wall_crossing')

function withOptions(project: Project, options: readonly DesignOption[]): Project {
  return { ...project, designOptions: [...options] }
}

/** The fixture's own acknowledgement, made in one named Option instead of none. */
function ackIn(optionId: string | null): Acknowledgement {
  const stored = base.warningAcknowledgements[0]
  return { ...stored, id: `ack-${optionId ?? 'none'}`, designOptionId: optionId }
}

/** `Change nothing.` — the Option that sees the Existing Model exactly as it stands. */
const leaveIt: DesignOption = {
  id: 'option-a',
  name: 'Leave it',
  demolishedIds: [],
  proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] },
}

/** `Knock W-2 out.` — the crossing Wall gone, so nothing crosses any more. */
const removeCrossingWall: DesignOption = {
  id: 'option-b',
  name: 'Open plan',
  demolishedIds: ['wall-2'],
  proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] },
}

/** `Keep everything, and run a new Wall straight through W-1.` */
const addCrossingWall: DesignOption = {
  id: 'option-c',
  name: 'New spine',
  demolishedIds: [],
  proposed: {
    walls: [
      {
        id: 'wall-9',
        ref: 'W-9',
        floorId: FLOOR,
        line: { kind: 'line', start: { x: 1000, y: -1000 }, end: { x: 1000, y: 1000 } },
        thickness: 100,
        justification: 'centre',
        baseElevation: 0,
        height: 2600,
        predecessorIds: [],
      } as Wall,
    ],
    wallJunctions: [],
    openings: [],
    rooms: [],
    placedItems: [],
  },
}

describe('warnings per Design Option (#69 §6)', () => {
  const project = withOptions(base, [leaveIt, removeCrossingWall, addCrossingWall])
  const subjectsOf = (optionId: string | null) =>
    crossing(project, optionId).map((warning) => warning.subjects.map((subject) => subject.id).join('+'))

  it('warns about the crossing the Existing Model carries', () => {
    const warnings = crossing(base, null)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.subjects.map((subject) => subject.id)).toEqual(['wall-1', 'wall-2'])
    expect(warnings[0]?.status).toBe('acknowledged')
  })

  it('leaves the same warning open in the other Option', () => {
    // Seen in `Leave it` is a decision about that alternative only: `New spine` still has the
    // crossing in front of it, and so does the Existing Model, whose acknowledgement was made
    // under no Option and therefore covers none of them.
    const acknowledged = { ...project, warningAcknowledgements: [ackIn('option-a')] }
    expect(crossing(acknowledged, 'option-a')[0]?.status).toBe('acknowledged')
    expect(crossing(acknowledged, 'option-c')[0]?.status).toBe('open')
    expect(crossing(acknowledged, null)[0]?.status).toBe('open')
  })

  it('loses the warning in the Option that demolishes one of the crossing Walls', () => {
    expect(subjectsOf('option-b')).toEqual([])
    expect(subjectsOf('option-a')).toEqual(['wall-1+wall-2'])
    expect(subjectsOf(null)).toEqual(['wall-1+wall-2'])
  })

  it('warns about a crossing the Option itself introduces, in that Option only', () => {
    expect(subjectsOf('option-c')).toEqual(['wall-1+wall-2', 'wall-1+wall-9'])
    expect(subjectsOf('option-a')).not.toContain('wall-1+wall-9')
  })

  it('keys the two Options apart, so one warning is two warnings', () => {
    const keyNone = crossing(project, null)[0]?.key
    expect(crossing(project, 'option-a')[0]?.key).not.toBe(keyNone)
    expect(crossing(project, 'option-c')[0]?.key).not.toBe(keyNone)
  })
})
