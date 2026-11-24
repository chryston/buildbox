/**
 * Skirting warnings through a real Project (#78 §6, criteria 13–15).
 *
 * The producers themselves are checked over hand-built `WarningFloor` records in
 * `producers/vertical.test.ts`; what this file checks is the whole road — the fixture's Skirting on
 * `W-1`'s kitchen face, a Placed Item standing against it, and the sentence the strip would show —
 * because the depth in the copy is only right if the derived body, the host face and the placement's
 * world footprint all agree, and each of those comes from a different module.
 */
import { describe, expect, it } from 'vitest'
import raw from '../../../../fixtures/domain/v13/skirting.json?raw'
import type { Project } from '../../../domain'
import { deriveWarnings } from '../../../derive'
import { warningSentence } from '../../strings'

const FLOOR = 'seed-001'
const SKIRTING = 'skirting-1'
/** The host Wall's id and the face the fixture's Skirting stands on: `W-1`'s left face at y = 500. */
const HOST = 'seed-wall-002'
const HOST_Y = 500
/** The body's exposed face: the host face stood off by the Skirting's 15 mm. */
const EXPOSED_Y = HOST_Y - 15

const parsed = JSON.parse(raw) as { project: Project }

/** The fixture with one Placed Item left standing: everything else would only add noise. */
function oneItem(overrides: { baseElevation?: number } = {}): Project {
  const project = structuredClone(parsed.project)
  const item = project.existingModel.placedItems.find((candidate) => candidate.id === 'seed-item-028')!
  project.designOptions = []
  project.existingModel.placedItems = [{ ...item, ...overrides }]
  return project
}

/**
 * The same cabinet's back edge — the edge nearest the host face — sits `BACK_OFFSET` mm past its
 * Base in local millimetres: `Base 600`'s local bounds run ±200 in y, and it is placed unrotated.
 */
const BACK_OFFSET = 200

/** The same scene with that cabinet's back edge sitting at `y`. */
function withBackEdge(y: number): Project {
  const project = oneItem()
  const item = project.existingModel.placedItems[0]!
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      placedItems: [{ ...item, translation: { x: item.translation.x, y: y - BACK_OFFSET } }],
    },
  }
}

const of = (project: Project, type: string) => deriveWarnings(project, FLOOR, null).warnings.filter((row) => row.type === type)

describe('Skirting against a Placed Item (#78 §6, criterion 13)', () => {
  it('says how far the body projects into the footprint, in the sentence the issue gives', () => {
    const warnings = of(withBackEdge(HOST_Y), 'skirting_placed_item')
    expect(warnings).toHaveLength(1)
    const [warning] = warnings
    expect(warning!.subjects.map((subject) => [subject.type, subject.id])).toEqual([
      ['skirting', SKIRTING],
      ['placedItem', 'seed-item-028'],
    ])
    expect(warning!.measured).toEqual({ mm: 15 })
    expect(warningSentence(warning!.messageKey, warning!.params)).toBe(
      `Skirting SK-1 projects 15 mm into ${warning!.params.b}'s footprint.`,
    )
  })

  it('clears when the item is moved off the face, because touching is not overlap', () => {
    // The same cabinet with its back edge exactly on the exposed face: the body touches the footprint
    // and covers none of it, which is a drawing the user likes (#66 §8).
    expect(of(withBackEdge(EXPOSED_Y), 'skirting_placed_item')).toEqual([])
    // One millimetre back over the line and it is a warning again, 1 mm deep.
    expect(of(withBackEdge(EXPOSED_Y + 1), 'skirting_placed_item')[0]!.measured).toEqual({ mm: 1 })
    // Flush with the host face the whole body is inside it.
    expect(of(withBackEdge(HOST_Y), 'skirting_placed_item')[0]!.measured).toEqual({ mm: 15 })
  })

  it('says nothing about a Placed Item that stands clear of the Skirting in height', () => {
    const project = withBackEdge(HOST_Y)
    const item = project.existingModel.placedItems[0]!
    // A wall-hung item whose bottom is at the Skirting's top shares the plan region and nothing else.
    project.existingModel.placedItems = [{ ...item, baseElevation: 100 }]
    expect(of(project, 'skirting_placed_item')).toEqual([])
  })
})

describe('Skirting against its host and the Floor (#78 §6, criterion 14)', () => {
  it('measures a Skirting hanging below its host Wall’s base', () => {
    const project = oneItem()
    project.existingModel.skirting = [{ ...project.existingModel.skirting![0]!, bottom: -20 }]
    const [warning] = of(project, 'skirting_host_below')
    expect(warning!.measured).toEqual({ mm: 20 })
    expect(warningSentence(warning!.messageKey, warning!.params)).toBe('Skirting SK-1 bottom is 20 mm below host Wall W-1 base.')
    expect(warning!.subjects.map((subject) => subject.type)).toEqual(['skirting', 'wall'])
  })

  it('measures a Skirting reaching above its host Wall’s top, and says nothing inside it', () => {
    const project = oneItem()
    project.existingModel.skirting = [{ ...project.existingModel.skirting![0]!, height: 2700 }]
    const warning = of(project, 'skirting_host_above')[0]!
    expect(warningSentence(warning.messageKey, warning.params)).toBe('Skirting SK-1 top is 100 mm above host Wall W-1 top.')
    expect(of(oneItem(), 'skirting_host_above')).toEqual([])
    expect(of(oneItem(), 'skirting_host_below')).toEqual([])
  })

  it('measures a Skirting past a Floor limit only when the Floor has one', () => {
    const project = oneItem()
    project.floors = project.floors.map((floor) => (floor.id === FLOOR ? { ...floor, limits: { lowerMm: 0, upperMm: 60 } } : floor))
    const above = of(project, 'floor_limit_above').find((row) => row.subjects[0]!.id === SKIRTING)
    expect(warningSentence(above!.messageKey, above!.params)).toBe('Skirting SK-1 top is 40 mm above this Floor\'s upper limit.')
    const lowered = structuredClone(project)
    lowered.existingModel.skirting = [{ ...lowered.existingModel.skirting![0]!, bottom: -20, height: 100 }]
    const below = of(lowered, 'floor_limit_below').find((row) => row.subjects[0]!.id === SKIRTING)
    expect(warningSentence(below!.messageKey, below!.params)).toBe('Skirting SK-1 bottom is 20 mm below this Floor\'s lower limit.')
    // No limits, no rule: the same Skirting says nothing at all.
    expect(of(oneItem(), 'floor_limit_above').filter((row) => row.subjects[0]!.id === SKIRTING)).toEqual([])
  })
})

describe('the never-list (#78 §6, criterion 15)', () => {
  it('never warns about a Skirting and a Wall, an Opening, another Skirting or a Beam', () => {
    const project = withBackEdge(HOST_Y)
    // A second Skirting on the other face, a Beam crossing the host at the Skirting's height, and an
    // Opening cut through the same range: every one of these is the point of the element, not a fault.
    project.existingModel.skirting = [
      ...project.existingModel.skirting!,
      { ...project.existingModel.skirting![0]!, id: 'skirting-9', side: 'right', label: 'Skirting SK-9' },
    ]
    project.existingModel.beams = [
      {
        id: 'beam-9',
        floorId: FLOOR,
        label: 'Beam B-9',
        line: { start: { x: 500, y: 500 }, end: { x: 9000, y: 500 } },
        width: 200,
        justification: 'centre',
        underside: 0,
        height: 300,
      },
    ]
    project.existingModel.openings = [
      ...project.existingModel.openings,
      { id: 'opening-9', floorId: FLOOR, hostWallId: HOST, kind: 'door', label: 'Door D-90', start: 4000, width: 900, sill: 0, head: 2100 },
    ]
    const paired = deriveWarnings(project, FLOOR, null).warnings.filter((row) => row.subjects.some((subject) => subject.type === 'skirting'))
    expect(paired.map((row) => row.type).sort()).toEqual(['skirting_placed_item'])
  })

  it('produces no Skirting–Clearance Envelope warning', () => {
    // The envelope producers list Walls and Beams as intruders and never a Skirting (#78 §6): the
    // pair is not in the decided table, so no scene reaches it.
    const types = deriveWarnings(oneItem(), FLOOR, null).warnings
    const envelope = types.filter((row) => row.type === 'clearance_envelope_intrusion')
    expect(envelope.every((row) => row.subjects.every((subject) => subject.type !== 'skirting'))).toBe(true)
    expect(types.filter((row) => row.subjects.some((subject) => subject.type === 'skirting')).map((row) => row.type)).toEqual([])
  })
})
