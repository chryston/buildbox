/**
 * `tables` on hand-built Projects (#68 criteria 1, 3, 5): the rows the scene golden cannot carry.
 *
 * `fixtures/export/golden/` holds one honest export of one real scene, and that scene deliberately
 * contains no Wall warning — a `wall_crossing` would break the Warnings List's "one open, one
 * reopened, one acknowledged". So the Wall warnings, the millimetres they measure, the note an
 * acknowledged row keeps, the fact that no Renovation State or Layer ever hides a warning, and the
 * scope's second Floor are pinned here, on the geometry the two Wall producers' own fixtures draw.
 */
import { describe, expect, it } from 'vitest'
import type { Acknowledgement, Project, Wall, WallJunction } from '../domain'
import { RENOVATION_STATES } from './quantities/scope'
import type { QuantityScope } from './quantities/scope'
import { tables, warningMessages } from './tables'
import type { TableDeps } from './tables'
import { domainFixture } from './testing'
import { deriveWarnings } from './warnings/engine'
import type { WarningParams } from './warnings/types'

const FLOOR = 'floor-main'
const OTHER_FLOOR = 'floor-mezz'

const wall = (id: string, ref: string, floorId: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
  id,
  ref,
  floorId,
  line: { kind: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

/** The basic fixture with only the Walls, Floors and acknowledgements a test names. */
function modelOf(
  walls: readonly Wall[],
  acknowledgements: readonly Acknowledgement[] = [],
  junctions: readonly WallJunction[] = [],
): Project {
  const base = domainFixture('v4/project-basic.json')
  return {
    ...base,
    existingModel: {
      ...base.existingModel,
      walls: [...walls],
      wallJunctions: [...junctions],
      openings: [],
      rooms: [],
      placedItems: [],
    },
    warningAcknowledgements: [...acknowledgements],
  }
}

/** W-2 west to east; W-5 square across it at x = 2000; W-7 lies on W-2's line from x = 3550. */
const CROSSING = modelOf([wall('wall-2', 'W-2', FLOOR, 0, 0, 4000, 0), wall('wall-5', 'W-5', FLOOR, 2000, -500, 2000, 500)])
const OVERLAP = modelOf([wall('wall-2', 'W-2', FLOOR, 0, 0, 4000, 0), wall('wall-7', 'W-7', FLOOR, 3550, 0, 8000, 0)])

const scopeOf = (over: Partial<QuantityScope> = {}): QuantityScope => ({
  floorIds: [FLOOR],
  designOptionIds: 'existing-only',
  renovationStates: RENOVATION_STATES,
  drawingLayers: 'all',
  ...over,
})

/** A sentence builder that could not be mistaken for the app's: it names its key and its subject. */
const message = (messageKey: string, params: WarningParams): string => `${messageKey}/${String(params.a)}`
const depsFor = (project: Project, scope: QuantityScope): TableDeps => ({
  warningMessages: warningMessages(project, scope, message),
})

const warningsOf = (project: Project, scope: QuantityScope = scopeOf()) =>
  tables(project, scope, depsFor(project, scope)).warnings

describe('the Warnings rows of a Wall warning (#68 criterion 5)', () => {
  it('carries both Walls and the millimetres the intrusion measured', () => {
    const rows = warningsOf(CROSSING)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.warningType).toBe('wall_crossing')
    expect(row.status).toBe('unacknowledged')
    expect(row.subjectType).toBe('wall')
    expect(row.subjectId).toBe('wall-2')
    expect(row.otherType).toBe('wall')
    expect(row.otherId).toBe('wall-5')
    expect(row.measuredMm).toBe(100)
    expect(row.acknowledgementNote).toBe('')
    expect(row.floorId).toBe(FLOOR)
    expect(row.floor).toBe('Floor 1')
    expect(row.designOptionId).toBe('')
    expect(row.designOption).toBe('')
    // The sentence is the injected builder's, never one `derive` wrote for itself.
    expect(row.message).toBe('wall_crossing/W-2')
  })

  it('names a collinear overlap by its own type and its run length', () => {
    const rows = warningsOf(OVERLAP)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.warningType).toBe('wall_overlap')
    expect(rows[0]!.measuredMm).toBe(450)
    expect(rows[0]!.message).toBe('wall_overlap/W-2')
  })

  it('writes both types of one Floor sorted unacknowledged then by subject and type', () => {
    const both = modelOf([
      wall('wall-2', 'W-2', FLOOR, 0, 0, 4000, 0),
      wall('wall-5', 'W-5', FLOOR, 2000, -500, 2000, 500),
      wall('wall-7', 'W-7', FLOOR, 3550, 0, 8000, 0),
    ])
    const rows = warningsOf(both)
    expect(rows.map((row) => `${row.subjectId}+${row.otherId}/${row.warningType}`)).toEqual([
      'wall-2+wall-5/wall_crossing',
      'wall-2+wall-7/wall_overlap',
    ])
  })

  it('marks an acknowledged warning and keeps the note it was acknowledged with', () => {
    const warning = deriveWarnings(CROSSING, FLOOR, null).warnings[0]!
    const acknowledgement: Acknowledgement = {
      id: 'ack-1',
      warningType: warning.type,
      subjectIds: warning.subjects.map((subject) => subject.id),
      designOptionId: null,
      signature: warning.signature,
      note: 'Checked on site',
      acknowledgedAt: '2026-11-22T00:00:00.000Z',
    }
    const rows = warningsOf(modelOf(CROSSING.existingModel.walls, [acknowledgement]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('acknowledged')
    expect(rows[0]!.acknowledgementNote).toBe('Checked on site')
  })

  it('keeps the note of a reopened warning, whose row is unacknowledged again', () => {
    const warning = deriveWarnings(CROSSING, FLOOR, null).warnings[0]!
    const acknowledgement: Acknowledgement = {
      id: 'ack-1',
      warningType: warning.type,
      subjectIds: warning.subjects.map((subject) => subject.id),
      designOptionId: null,
      signature: '0000000000000000',
      note: 'Checked on site',
      acknowledgedAt: '2026-11-22T00:00:00.000Z',
    }
    const rows = warningsOf(modelOf(CROSSING.existingModel.walls, [acknowledgement]))
    expect(rows[0]!.status).toBe('unacknowledged')
    expect(rows[0]!.acknowledgementNote).toBe('Checked on site')
  })

  it('lists a warning no Renovation State or Layer scope can hide', () => {
    // The Warnings List is scoped by Floor and Design Option only (export contract §3).
    const nothing = scopeOf({
      renovationStates: [],
      drawingLayers: { layerIds: [], includeUnlayered: false },
    })
    expect(warningsOf(CROSSING, nothing)).toHaveLength(1)
    expect(tables(CROSSING, nothing, depsFor(CROSSING, nothing)).walls).toEqual([])
  })

  it('lists nothing for a Floor with nothing wrong on it', () => {
    expect(warningsOf(modelOf([wall('wall-2', 'W-2', FLOOR, 0, 0, 4000, 0)]))).toEqual([])
  })
})

describe('the element rows of a hand-built Floor (#68 criteria 1, 3)', () => {
  const rows = tables(CROSSING, scopeOf(), depsFor(CROSSING, scopeOf()))

  it('writes one Walls row per Wall, in stable_id order, and nothing elsewhere', () => {
    expect(rows.walls.map((row) => row.stableId)).toEqual(['wall-2', 'wall-5'])
    expect(rows.openings).toEqual([])
    expect(rows.rooms).toEqual([])
    expect(rows.placedItems).toEqual([])
  })

  it('gives every row the S7 defaults', () => {
    for (const row of rows.walls) {
      expect(row.floor).toBe('Floor 1')
      expect(row.designOptionId).toBe('')
      expect(row.designOption).toBe('')
      expect(row.renovationState).toBe('existing')
      expect(row.drawingLayerId).toBe('')
      expect(row.drawingLayer).toBe('Unlayered')
      expect(row.predecessorIds).toEqual([])
      expect(row.classification).toBe('')
      expect(row.constructionLabel).toBe('')
      expect(row.shape).toBe('straight')
      expect(row.radiusMm).toBeNull()
      expect(row.justification).toBe('centre')
      expect(row.bottomMm).toBe(0)
      expect(row.topMm).toBe(2600)
      expect(row.heightMm).toBe(2600)
    }
    expect(rows.walls[0]!.lengthMm).toBe(4000)
    expect(rows.walls[1]!.lengthMm).toBe(1000)
  })

  it('writes nothing for a Floor the scope left out, and names the Floor it does write', () => {
    const twoFloors = modelOf([
      wall('wall-2', 'W-2', FLOOR, 0, 0, 4000, 0),
      wall('wall-9', 'W-9', OTHER_FLOOR, 0, 0, 1000, 0),
    ])
    expect(tables(twoFloors, scopeOf(), depsFor(twoFloors, scopeOf())).walls.map((row) => row.stableId)).toEqual([
      'wall-2',
    ])
    const bothScope = scopeOf({ floorIds: [FLOOR, OTHER_FLOOR] })
    const both = tables(twoFloors, bothScope, depsFor(twoFloors, bothScope)).walls
    expect(both.map((row) => `${row.floor}/${row.stableId}`)).toEqual(['Floor 1/wall-2', 'Mezzanine/wall-9'])
  })

  it('leaves a warning of the excluded Floor out too', () => {
    const twoFloors = modelOf([
      wall('wall-2', 'W-2', FLOOR, 0, 0, 4000, 0),
      wall('wall-5', 'W-5', FLOOR, 2000, -500, 2000, 500),
      wall('wall-8', 'W-8', OTHER_FLOOR, 0, 0, 4000, 0),
      wall('wall-6', 'W-6', OTHER_FLOOR, 2000, -500, 2000, 500),
    ])
    const scoped = warningsOf(twoFloors, scopeOf())
    expect(scoped).toHaveLength(1)
    expect(scoped[0]!.floorId).toBe(FLOOR)
    const both = warningsOf(twoFloors, scopeOf({ floorIds: [FLOOR, OTHER_FLOOR] }))
    expect(both).toHaveLength(2)
    // Floor order of the Project, then subject, whatever the two Floors hold.
    expect(both.map((row) => `${row.floor}/${row.subjectId}`)).toEqual(['Floor 1/wall-2', 'Mezzanine/wall-6'])
  })
})

/**
 * The Skirting table (#78 §8, criterion 17).
 *
 * The v13 fixture is the scene the issue describes: `Skirting SK-1` along `W-1`'s kitchen face for
 * the whole 9 m, and Option A proposing a second one on the other face. The two rows differ in one
 * pair of numbers, and that pair is the whole point of the table — the gross is the range drawn, the
 * net is what is left after the corners are clipped and the T-junction is gapped out.
 */
describe('the Skirting table (#78 §8)', () => {
  const SKIRTING_PROJECT = domainFixture('v13/skirting.json')
  const SK_FLOOR = 'seed-001'
  const skirtingScope = (over: Partial<QuantityScope> = {}): QuantityScope =>
    scopeOf({ floorIds: [SK_FLOOR], ...over })
  const rowsOf = (project: Project, scope: QuantityScope) => tables(project, scope, { warningMessages: null }).skirting

  it('carries every column of one whole-face Skirting', () => {
    const [row] = rowsOf(SKIRTING_PROJECT, skirtingScope())
    expect(row).toEqual({
      stableId: 'skirting-1',
      floorId: SK_FLOOR,
      floor: 'Floor 1',
      designOptionId: '',
      designOption: '',
      renovationState: 'existing',
      drawingLayerId: '',
      drawingLayer: 'Unlayered',
      label: 'Skirting SK-1',
      hostWallId: 'seed-wall-002',
      side: 'left',
      startMm: 0,
      endMm: 9000,
      grossLengthMm: 9000,
      netLengthMm: 9000,
      heightMm: 100,
      thicknessMm: 15,
      bottomMm: 0,
      topMm: 100,
      predecessorIds: [],
    })
    // The face the branch Wall butts against is the right one, so the left face keeps its 9 m: a
    // junction gap belongs to the face the branch covers, not to the Wall as a whole.
    expect(row!.netLengthMm).toBe(row!.grossLengthMm)
  })

  it('publishes the net after the corner clips and the junction gap, beside the demolition it replaces', () => {
    const rows = rowsOf(SKIRTING_PROJECT, skirtingScope({ designOptionIds: ['option-a'] }))
    expect(rows.map((row) => [row.stableId, row.renovationState, row.side, row.predecessorIds])).toEqual([
      ['skirting-1', 'demolition', 'left', []],
      ['skirting-2', 'proposed', 'right', ['skirting-1']],
    ])
    const proposed = rows.find((row) => row.stableId === 'skirting-2')!
    // 9 000 drawn, less 100 clipped at each end where the Wall turns and 150 where W-5 butts onto
    // this face: the number a buyer orders, and the number the Plan View paints.
    expect(proposed.grossLengthMm).toBe(9000)
    expect(proposed.netLengthMm).toBe(8650)
    expect(proposed.topMm).toBe(proposed.bottomMm + proposed.heightMm)
  })

  it('has no row for a Skirting whose host Wall is not standing', () => {
    const project: Project = {
      ...SKIRTING_PROJECT,
      existingModel: {
        ...SKIRTING_PROJECT.existingModel,
        walls: SKIRTING_PROJECT.existingModel.walls.filter((wall) => wall.id !== 'seed-wall-002'),
      },
    }
    expect(rowsOf(project, skirtingScope())).toEqual([])
  })

  it('hides a Skirting behind a Renovation State or a Layer the scope leaves out', () => {
    expect(rowsOf(SKIRTING_PROJECT, skirtingScope({ renovationStates: ['proposed'] }))).toEqual([])
    expect(rowsOf(SKIRTING_PROJECT, skirtingScope({ designOptionIds: ['option-a'], renovationStates: ['demolition'] }))).toHaveLength(1)
    expect(rowsOf(SKIRTING_PROJECT, skirtingScope({ drawingLayers: { layerIds: ['layer-nothing'], includeUnlayered: false } }))).toEqual([])
  })
})
