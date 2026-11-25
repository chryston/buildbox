/**
 * The warnings engine (#66 §1–§4, criteria 1, 2, 10): keys, signatures, statuses, order, and
 * the two properties the whole feature rests on — the output is a function of the model alone,
 * and a signature is a hash of model fields, never of the sentence about them.
 */
import { describe, expect, it } from 'vitest'
import type { Acknowledgement, Project, Wall, WallJunction } from '../../domain'
import { warningKey } from '../../domain'
import { domainFixture } from '../testing'
import { compareWarnings, countUnacknowledged, deriveWarnings, warningFloorOf, warningSignature } from './engine'
import type { Warning, WarningFloor } from './types'

const FLOOR = 'floor-main'

/** W-2 runs west to east; W-5 crosses it square at x = 2000. No Junction anywhere. */
const CROSSING_WALLS: readonly Wall[] = [
  {
    id: 'wall-2', ref: 'W-2', floorId: FLOOR,
    line: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
    thickness: 100, justification: 'centre', baseElevation: 0, height: 2600,
  },
  {
    id: 'wall-5', ref: 'W-5', floorId: FLOOR,
    line: { kind: 'line', start: { x: 2000, y: -500 }, end: { x: 2000, y: 500 } },
    thickness: 100, justification: 'centre', baseElevation: 0, height: 2600,
  },
]

const projectWith = (walls: readonly Wall[], junctions: readonly WallJunction[] = []): Project => {
  const base = domainFixture('v4/project-basic.json')
  return {
    ...base,
    // The fixture's Placed Items sit on y = 0, which is where these Walls run: lift them clear,
    // or the #76 item-into-wall producer answers every case below beside the Walls it is about.
    existingModel: {
      ...base.existingModel,
      placedItems: base.existingModel.placedItems.map((placed) => ({ ...placed, translation: { x: placed.translation.x, y: placed.translation.y + 2000 } })),
      walls: [...walls],
      wallJunctions: [...junctions],
    },
    warningAcknowledgements: [],
    comments: [],
    commentReferenceCounter: 0,
  }
}

const crossingProject = (): Project => projectWith(CROSSING_WALLS)

/** The one warning of the crossing fixture, whatever its status. */
const onlyWarning = (project: Project): Warning => {
  const { warnings } = deriveWarnings(project, FLOOR, null)
  expect(warnings).toHaveLength(1)
  return warnings[0]!
}

/** Acknowledge a warning exactly as the edit layer will: the parts beside the key, never the key alone. */
const acknowledge = (warning: Warning, note = '', signature = warning.signature): Project => {
  const project = crossingProject()
  const acknowledgement: Acknowledgement = {
    id: 'ack-1',
    warningType: warning.type,
    subjectIds: warning.subjects.map((subject) => subject.id),
    designOptionId: warning.optionId,
    signature,
    note,
    acknowledgedAt: '2026-01-01T00:00:00.000Z',
  }
  return { ...project, warningAcknowledgements: [acknowledgement] }
}

describe('warningKey', () => {
  it('joins type, sorted subject IDs and the option token with pipes (#66 §2)', () => {
    expect(warningKey('wall_crossing', ['wall-2', 'wall-5'], null)).toBe('wall_crossing|wall-2,wall-5|existing')
    expect(warningKey('wall_crossing', ['wall-2', 'wall-5'], 'option-1')).toBe('wall_crossing|wall-2,wall-5|option-1')
  })

  it('sorts the subject IDs, so the subject order of a producer cannot change the key', () => {
    expect(warningKey('wall_crossing', ['wall-5', 'wall-2'], null)).toBe(warningKey('wall_crossing', ['wall-2', 'wall-5'], null))
  })
})

describe('warningSignature', () => {
  it('is 16 lower-case hex characters', () => {
    expect(warningSignature({ a: 1 })).toMatch(/^[0-9a-f]{16}$/)
  })

  it('ignores the order the fields were written in (#66 §2)', () => {
    expect(warningSignature({ thickness: 100, line: { x: 0 } })).toBe(warningSignature({ line: { x: 0 }, thickness: 100 }))
  })

  it('separates two different model states', () => {
    expect(warningSignature({ thickness: 100 })).not.toBe(warningSignature({ thickness: 101 }))
  })
})

describe('deriveWarnings — the crossing fixture', () => {
  it('reports one wall_crossing whose subjects are ordered by ref and whose measurement is the intrusion', () => {
    const warning = onlyWarning(crossingProject())
    expect(warning.type).toBe('wall_crossing')
    expect(warning.key).toBe('wall_crossing|wall-2,wall-5|existing')
    expect(warning.subjects.map((subject) => subject.id)).toEqual(['wall-2', 'wall-5'])
    expect(warning.subjects.every((subject) => subject.type === 'wall')).toBe(true)
    expect(warning.measured).toEqual({ mm: 100 })
    expect(warning.messageKey).toBe('wall_crossing')
    expect(warning.params).toEqual({ a: 'W-2', b: 'W-5', mm: 100 })
    expect(warning.signature).toMatch(/^[0-9a-f]{16}$/)
    expect(warning.floorId).toBe(FLOOR)
    expect(warning.optionId).toBeNull()
  })

  it('starts every fresh warning open, with no acknowledgement beside it', () => {
    const warning = onlyWarning(crossingProject())
    expect(warning.status).toBe('open')
    expect(warning.acknowledgement).toBeNull()
  })
})

describe('status transitions (#66 §3)', () => {
  it('is acknowledged when the stored signature still matches', () => {
    const warning = onlyWarning(crossingProject())
    const next = onlyWarning(acknowledge(warning, 'Builder to check'))
    expect(next.status).toBe('acknowledged')
    expect(next.acknowledgement?.note).toBe('Builder to check')
  })

  it('reopens when the model moves, even though the sentence is identical (criterion 1)', () => {
    const warning = onlyWarning(crossingProject())
    const seen = acknowledge(warning, 'Builder to check')
    // W-2 slides 200 mm along its own length: same angle, same 100 mm depth, same copy.
    const moved = projectWith([
      { ...CROSSING_WALLS[0]!, line: { kind: 'line', start: { x: 200, y: 0 }, end: { x: 4200, y: 0 } } },
      CROSSING_WALLS[1]!,
    ])
    const reopened = deriveWarnings({ ...moved, warningAcknowledgements: seen.warningAcknowledgements }, FLOOR, null)
    expect(reopened.warnings).toHaveLength(1)
    const row = reopened.warnings[0]!
    expect(row.params).toEqual(warning.params)
    expect(row.status).toBe('reopened')
    expect(row.acknowledgement?.note).toBe('Builder to check')
  })

  it('is reopened rather than acknowledged when the signature drifted', () => {
    const warning = onlyWarning(crossingProject())
    expect(onlyWarning(acknowledge(warning, '', '0000000000000000')).status).toBe('reopened')
  })

  it('leaves a warning about other entities untouched by an unrelated acknowledgement', () => {
    const warning = onlyWarning(crossingProject())
    const seen = acknowledge(warning)
    const unrelated: Acknowledgement = { ...seen.warningAcknowledgements[0]!, id: 'ack-2', warningType: 'wall_overlap' }
    const next = onlyWarning({ ...crossingProject(), warningAcknowledgements: [unrelated] })
    expect(next.status).toBe('open')
  })
})

describe('view state cannot reach a producer (criterion 2)', () => {
  it('exposes nothing but the Floor, its Walls, their Junctions, its Rooms, its Beams, its Skirting and its Placed Items', () => {
    expect(Object.keys(warningFloorOf(crossingProject(), FLOOR)).sort()).toEqual([
      'beams',
      'floorId',
      'junctions',
      'limits',
      'openings',
      'placements',
      'rooms',
      'services',
      'skirtings',
      'walls',
    ])
  })

  it('has no field to read a view, a Layer, a Range, a viewport or a pane layout', () => {
    const floor = warningFloorOf(crossingProject(), FLOOR)
    // @ts-expect-error a WarningFloor has no views
    void floor.views
    // @ts-expect-error a WarningFloor has no layers
    void floor.layers
    // @ts-expect-error a WarningFloor has no range
    void floor.range
    // @ts-expect-error a WarningFloor has no viewport
    void floor.viewport
    // @ts-expect-error a WarningFloor has no panes
    void floor.panes
    // @ts-expect-error a WarningFloor has no revision
    void floor.revision
    expect(Object.keys(floor).sort()).toEqual([
      'beams',
      'floorId',
      'junctions',
      'limits',
      'openings',
      'placements',
      'rooms',
      'services',
      'skirtings',
      'walls',
    ])
  })

  it('leaves an acknowledgement acknowledged across every view-only change of the Project', () => {
    const warning = onlyWarning(crossingProject())
    const seen = acknowledge(warning)
    // Pan, zoom, the active view, Layer visibility and a Range are all Plan View state: none of
    // them is a model field, so none of them is in the signature.
    const panned: Project = {
      ...seen,
      views: seen.views.map((view) => ({ ...view })),
      preferences: { ...seen.preferences, displayUnit: 'cm', displayPrecision: 2 },
    }
    expect(onlyWarning(panned).status).toBe('acknowledged')
  })
})

describe('engine order and determinism (#66 §2, criterion 10)', () => {
  it('sorts by Floor, option, subject IDs and type', () => {
    const at = (floorId: string, optionId: string | null, ids: string[], type: string): Warning =>
      ({ key: '', type, floorId, optionId, subjects: ids.map((id) => ({ type: 'wall', id })), measured: {}, messageKey: type, params: {}, signature: '', status: 'open', acknowledgement: null })
    const order = [
      at('floor-2', null, ['a'], 'wall_crossing'),
      at('floor-1', 'option-1', ['a'], 'wall_crossing'),
      at('floor-1', null, ['b'], 'wall_crossing'),
      at('floor-1', null, ['a', 'b'], 'wall_crossing'),
      at('floor-1', null, ['a'], 'wall_overlap'),
      at('floor-1', null, ['a'], 'wall_crossing'),
    ]
    expect(order.sort(compareWarnings).map((warning) => `${warning.floorId}/${warning.optionId}/${warning.subjects.map((subject) => subject.id).join('+')}/${warning.type}`)).toEqual([
      'floor-1/null/a/wall_crossing',
      'floor-1/null/a/wall_overlap',
      'floor-1/null/a+b/wall_crossing',
      'floor-1/null/b/wall_crossing',
      'floor-1/option-1/a/wall_crossing',
      'floor-2/null/a/wall_crossing',
    ])
  })

  it('gives the identical warnings when the same model is stored in another entity order', () => {
    const forward = deriveWarnings(crossingProject(), FLOOR, null)
    const shuffled = projectWith([...CROSSING_WALLS].reverse(), [
      { id: 'j-2', floorId: FLOOR, ends: [{ wallId: 'wall-9', end: 'start' }] },
      { id: 'j-1', floorId: FLOOR, ends: [{ wallId: 'wall-8', end: 'start' }] },
    ])
    const back = deriveWarnings(shuffled, FLOOR, null)
    expect(back.warnings.map((warning) => warning.key)).toEqual(forward.warnings.map((warning) => warning.key))
    expect(back.warnings.map((warning) => warning.signature)).toEqual(forward.warnings.map((warning) => warning.signature))
  })

  it('runs the producers in registration order, so two warnings about one pair keep their order', () => {
    const keys = deriveWarnings(crossingProject(), FLOOR, null).warnings.map((warning) => warning.key)
    expect(keys).toEqual([...keys].sort())
  })
})

describe('countUnacknowledged (#66 §15)', () => {
  it('counts open and reopened warnings, and never an acknowledged one', () => {
    const project = crossingProject()
    expect(countUnacknowledged(project, [FLOOR], [null])).toBe(1)
    const seen = acknowledge(onlyWarning(project))
    expect(countUnacknowledged(seen, [FLOOR], [null])).toBe(0)
    const moved = projectWith([
      { ...CROSSING_WALLS[0]!, line: { kind: 'line', start: { x: 200, y: 0 }, end: { x: 4200, y: 0 } } },
      CROSSING_WALLS[1]!,
    ])
    expect(countUnacknowledged({ ...moved, warningAcknowledgements: seen.warningAcknowledgements }, [FLOOR], [null])).toBe(1)
  })

  it('counts each Floor of the scope once and ignores Floors outside it', () => {
    const project = crossingProject()
    expect(countUnacknowledged(project, [], [null])).toBe(0)
    expect(countUnacknowledged(project, [FLOOR, 'floor-missing'], [null])).toBe(1)
  })
})

describe('warningFloorOf', () => {
  it('holds only the named Floor, sorted by id', () => {
    const base = domainFixture('v4/project-basic.json')
    const foreign: Wall = { ...CROSSING_WALLS[0]!, id: 'wall-z', floorId: 'floor-other' }
    const project: Project = {
      ...base,
      existingModel: { ...base.existingModel, walls: [...CROSSING_WALLS, foreign], wallJunctions: [] },
      warningAcknowledgements: [],
      comments: [],
      commentReferenceCounter: 0,
    }
    const floor: WarningFloor = warningFloorOf(project, FLOOR)
    expect(floor.floorId).toBe(FLOOR)
    expect(floor.walls.map((wall) => wall.id)).toEqual(['wall-2', 'wall-5'])
    expect(floor.walls.every((wall) => wall.outline.segments.length > 0)).toBe(true)
    expect(floor.junctions).toEqual([])
  })
})
