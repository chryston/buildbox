/**
 * The vertical producers through the real engine (#76 criteria 13 and 14): the warnings the
 * elevation scene grows, and the two signature rules the whole feature is graded on — moving a
 * Placed Item along the wall keeps the sentence identical and still reopens the acknowledged
 * warning, changing the Design's height reopens it too, and no view change can touch either.
 */
import { describe, expect, it } from 'vitest'
import type { Acknowledgement, ClearanceEnvelope, Project } from '../../domain'
import { domainFixture } from '../testing'
import { deriveWarnings } from './engine'
import type { Warning } from './types'

const FLOOR = 'pr-002'

const VERTICAL_TYPES: Record<string, true> = {
  item_item_overlap: true,
  item_into_wall: true,
  opening_host_above: true,
  opening_host_below: true,
  floor_limit_above: true,
  floor_limit_below: true,
  clearance_envelope_intrusion: true,
}

const scene = (): Project => domainFixture('v10/elevation-scene.json')

const vertical = (project: Project): Warning[] =>
  deriveWarnings(project, FLOOR, null).warnings.filter((warning) => VERTICAL_TYPES[warning.type] === true)

const of = (project: Project, type: string): Warning[] => vertical(project).filter((warning) => warning.type === type)

/** Move one Placed Item, leaving every other field exactly as it was. */
const moved = (project: Project, placedId: string, x: number, y: number): Project => ({
  ...project,
  existingModel: {
    ...project.existingModel,
    placedItems: project.existingModel.placedItems.map((placed) =>
      placed.id === placedId ? { ...placed, translation: { x, y } } : placed,
    ),
  },
})

const acknowledge = (project: Project, warning: Warning, note = 'Site to confirm'): Project => {
  const acknowledgement: Acknowledgement = {
    id: 'ack-vertical',
    warningType: warning.type,
    subjectIds: warning.subjects.map((subject) => subject.id),
    designOptionId: warning.optionId,
    signature: warning.signature,
    note,
    acknowledgedAt: '2026-01-01T00:00:00.000Z',
  }
  return { ...project, warningAcknowledgements: [...project.warningAcknowledgements, acknowledgement] }
}

describe('the elevation scene, vertically', () => {
  it('starts with no vertical warning at all', () => {
    expect(vertical(scene())).toHaveLength(0)
  })

  it('reports one item_item_overlap when the two Base cabinets are made to overlap', () => {
    const found = of(moved(scene(), 'pr-016', 1000, 600), 'item_item_overlap')
    expect(found).toHaveLength(1)
    const warning = found[0]!
    expect(warning.subjects.map((subject) => subject.id)).toEqual(['pr-005', 'pr-016'])
    expect(warning.subjects.every((subject) => subject.type === 'placedItem')).toBe(true)
    // Identical extents: the lower ID is the subject and the overlap is the whole height.
    expect(warning.params.a).toBe('Base cabinet #1')
    expect(warning.params.b).toBe('Base cabinet #2')
    expect(warning.params.mm).toBe(860)
  })
})

describe('reopening (#76 criteria 13 and 14)', () => {
  const overlapping = moved(scene(), 'pr-016', 1000, 600)
  const seen = (): { project: Project; warning: Warning } => {
    const warning = of(overlapping, 'item_item_overlap')[0]!
    return { project: acknowledge(overlapping, warning), warning }
  }

  it('acknowledges a fresh vertical warning', () => {
    const { project } = seen()
    expect(of(project, 'item_item_overlap')[0]!.status).toBe('acknowledged')
    expect(of(project, 'item_item_overlap')[0]!.acknowledgement?.note).toBe('Site to confirm')
  })

  it('reopens when the item moves along the wall, with the very same sentence', () => {
    const { project, warning } = seen()
    const shifted = moved(project, 'pr-016', 1050, 600)
    const row = of(shifted, 'item_item_overlap')[0]!
    expect(row.status).toBe('reopened')
    expect(row.key).toBe(warning.key)
    expect(row.params).toEqual(warning.params)
    expect(row.acknowledgement?.note).toBe('Site to confirm')
  })

  it('reopens when the shared Design height changes', () => {
    const { project } = seen()
    const taller: Project = {
      ...project,
      itemDesigns: project.itemDesigns.map((design) =>
        design.id === 'pr-004' && design.kind === 'cabinet'
          ? { ...design, construction: { ...design.construction, settings: { ...design.construction.settings, height: 900 } } }
          : design,
      ),
    }
    const row = of(taller, 'item_item_overlap')[0]!
    expect(row.status).toBe('reopened')
    expect(row.params.mm).toBe(900)
  })

  it('never reopens on a view change', () => {
    const { project } = seen()
    const viewed: Project = {
      ...project,
      views: project.views.map((view) =>
        view.kind === 'plan' ? { ...view, planViewRange: { lowerMm: 0, upperMm: 1500 } } : view,
      ),
    }
    expect(of(viewed, 'item_item_overlap')[0]!.status).toBe('acknowledged')
  })

  it('reopens a Wall warning when the Wall is raised through the Floor limit', () => {
    const raised: Project = {
      ...scene(),
      existingModel: {
        ...scene().existingModel,
        walls: scene().existingModel.walls.map((wall) => (wall.id === 'pr-017' ? { ...wall, height: 2700 } : wall)),
      },
    }
    const found = of(raised, 'floor_limit_above')
    expect(found).toHaveLength(1)
    expect(found[0]!.subjects).toEqual([{ type: 'wall', id: 'pr-017' }])
    expect(found[0]!.params).toMatchObject({ a: 'Wall W-1', mm: 100 })
    const seenRaised = acknowledge(raised, found[0]!)
    const lowered: Project = {
      ...seenRaised,
      existingModel: {
        ...seenRaised.existingModel,
        walls: seenRaised.existingModel.walls.map((wall) => (wall.id === 'pr-017' ? { ...wall, height: 2750 } : wall)),
      },
    }
    expect(of(lowered, 'floor_limit_above')[0]!.status).toBe('reopened')
  })
})

describe('the other families through the engine', () => {
  it('reports a cabinet run into Wall W-1 and lets the window keep its host', () => {
    const intoWall = moved(scene(), 'pr-005', 600, 300)
    const found = of(intoWall, 'item_into_wall')
    expect(found).toHaveLength(1)
    expect(found[0]!.subjects.map((subject) => subject.type)).toEqual(['placedItem', 'wall'])
    expect(found[0]!.params).toMatchObject({ a: 'Base cabinet #1', b: 'Wall W-1', mm: 50 })
    expect(of(intoWall, 'opening_host_above')).toHaveLength(0)
  })

  it('reports a window reaching past its host top', () => {
    const project = scene()
    const taller: Project = {
      ...project,
      existingModel: {
        ...project.existingModel,
        openings: project.existingModel.openings.map((opening) => (opening.id === 'pr-021' ? { ...opening, head: 2700 } : opening)),
      },
    }
    const found = of(taller, 'opening_host_above')
    expect(found).toHaveLength(1)
    expect(found[0]!.subjects.map((subject) => subject.id)).toEqual(['pr-021', 'pr-017'])
    expect(found[0]!.params).toMatchObject({ a: 'Window 1', b: 'Wall W-1', mm: 100 })
  })

  it('reports a Clearance Envelope taken up by another Design’s placement', () => {
    const project = scene()
    const envelope: ClearanceEnvelope = {
      path: {
        start: { x: 0, y: 500 },
        segments: [
          { kind: 'line', to: { x: 600, y: 500 } },
          { kind: 'line', to: { x: 600, y: 800 } },
          { kind: 'line', to: { x: 0, y: 800 } },
          { kind: 'line', to: { x: 0, y: 500 } },
        ],
      },
      bottomOffset: 0,
      height: 850,
    }
    const withEnvelope: Project = {
      ...project,
      itemDesigns: project.itemDesigns.map((design) => (design.id === 'pr-004' ? { ...design, clearanceEnvelope: envelope } : design)),
    }
    // The Tall cupboard moves into the zone behind the first Base cabinet.
    const intruding = moved(withEnvelope, 'el-002', 600, 1000)
    const found = of(intruding, 'clearance_envelope_intrusion')
    expect(found).toHaveLength(1)
    const warning = found[0]!
    expect(warning.subjects.map((subject) => subject.id)).toEqual(['el-002', 'pr-005'])
    expect(warning.params.a).toBe('Tall cupboard')
    expect(warning.params.b).toBe('Base cabinet #1')
    expect(Number(warning.params.m2)).toBeCloseTo(0.18, 6)
    expect(Number(warning.params.pct)).toBeCloseTo(100, 6)
    expect(warning.measured.mm).toBeUndefined()
    // The Design’s own second placement never intrudes on its own envelope.
    expect(of(withEnvelope, 'clearance_envelope_intrusion')).toHaveLength(0)
  })
})
