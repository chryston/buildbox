/**
 * The Service rejects of #79 §1 and §Strict import, one test per rule the strict validator owns.
 *
 * The base is the #79 scene fixture — the renovation scene with four Services the Existing Model
 * holds and one Design Option `Option A` invents — so the accepts say the written bytes read, and the
 * rejects are the ones the editor would have refused before the Service was ever drawn: a Run with no
 * length, a Riser with no height, a section measurement of zero, a field that belongs to the other
 * shape or the other section, and a Kind, shape or section outside the closed vocabulary. Each is
 * refused with its path, so the message lands on the Service it is about.
 *
 * What is *not* refused is a negative elevation, and one test says so: the fixture's own below-Datum
 * Run is the evidence, and criterion 26 asks that a Project holding one imports.
 */
import { describe, expect, it } from 'vitest'
import servicesFixture from '../../fixtures/domain/v14/services.json?raw'
import { validateProject } from './index'

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(servicesFixture) as { domainSchemaVersion: number; project: Rec }
  return structuredClone(envelope.project)
}

function problemsOf(value: unknown): { path: string; code: string }[] {
  const result = validateProject(value)
  return result.ok ? [] : result.problems.map(({ path, code }) => ({ path, code }))
}

/** The exact `{path, code}` pairs, in the order the validator reported them. */
function expectProblems(value: unknown, expected: { path: string; code: string }[]): void {
  expect(problemsOf(value)).toEqual(expected)
}

/** The Services the Existing Model holds, in the order the fixture writes them. */
function services(project: Rec): Rec[] {
  return ((project.existingModel as Rec).services as Rec[])
}

/** The Service at one index of the Existing Model's collection. */
function serviceAt(project: Rec, index: number): Rec {
  return services(project)[index]!
}

/** The scene with the Design Option's own Service taken out, so a reject says only what it is about. */
function plain(): Rec {
  const project = base()
  for (const option of project.designOptions as Rec[]) (option.proposed as Rec).services = []
  return project
}

const RUN = 'existingModel.services[0]'
const RECT = 'existingModel.services[1]'
const RISER = 'existingModel.services[2]'
const BELOW = 'existingModel.services[3]'

/** The one problem every reject below is about, at one path. */
const only = (path: string, code: string): { path: string; code: string }[] => [{ path, code }]

describe('the Service (#79 §1)', () => {
  it('accepts the scene as written, negative elevation included', () => {
    expectProblems(base(), [])
  })

  it('accepts a model with no Service collection at all, which is a model written before #79', () => {
    const project = base()
    delete (project.existingModel as Rec).services
    for (const option of project.designOptions as Rec[]) delete (option.proposed as Rec).services
    expectProblems(project, [])
  })

  it('accepts an empty Service collection', () => {
    const project = plain()
    ;(project.existingModel as Rec).services = []
    expectProblems(project, [])
  })

  it('accepts a Riser whose bottom sits below the Floor Datum', () => {
    const project = plain()
    serviceAt(project, 2).bottomElevation = -1200
    expectProblems(project, [])
  })

  it('accepts a Run renamed to a free-text label, which is what `other` is drawn with', () => {
    const project = plain()
    const run = serviceAt(project, 0)
    run.kind = 'other'
    run.label = 'Condensate to the kitchen sink'
    expectProblems(project, [])
  })

  it('refuses a Run with zero length, because it has no direction to read its faces from', () => {
    const project = plain()
    serviceAt(project, 0).line = { start: { x: 600, y: 1200 }, end: { x: 600, y: 1200 } }
    expectProblems(project, only(`${RUN}.line`, 'out-of-range'))
  })

  it('refuses a Riser with no height, and one with a negative height', () => {
    for (const height of [0, -100]) {
      const project = plain()
      serviceAt(project, 2).height = height
      expectProblems(project, only(`${RISER}.height`, 'out-of-range'))
    }
  })

  it('refuses an outside diameter, a Width or a Depth of zero or less', () => {
    const cases: [number, string, string][] = [
      [0, RUN, 'outsideDiameter'],
      [-50, RUN, 'outsideDiameter'],
      [0, RECT, 'width'],
      [-1, RECT, 'depth'],
      [0, RISER, 'outsideDiameter'],
    ]
    for (const [value, path, field] of cases) {
      const project = plain()
      const index = path === RUN ? 0 : path === RECT ? 1 : 2
      serviceAt(project, index)[field] = value
      expectProblems(project, only(`${path}.${field}`, 'out-of-range'))
    }
  })

  it('refuses a Width and a Depth on a round Run, which are the rectangular section\u2019s fields', () => {
    const project = plain()
    const run = serviceAt(project, 0)
    run.width = 80
    run.depth = 60
    expectProblems(project, [
      { path: `${RUN}.width`, code: 'unknown-field' },
      { path: `${RUN}.depth`, code: 'unknown-field' },
    ])
  })

  it('refuses an outside diameter on a rectangular Run', () => {
    const project = plain()
    serviceAt(project, 1).outsideDiameter = 50
    expectProblems(project, only(`${RECT}.outsideDiameter`, 'unknown-field'))
  })

  it('refuses a rectangular Riser, because a Riser is always round and carries no section', () => {
    const project = plain()
    const riser = serviceAt(project, 2)
    riser.section = 'rectangular'
    riser.width = 80
    riser.depth = 60
    expectProblems(project, [
      { path: `${RISER}.depth`, code: 'unknown-field' },
      { path: `${RISER}.section`, code: 'unknown-field' },
      { path: `${RISER}.width`, code: 'unknown-field' },
    ])
  })

  it('refuses a Run that carries a Riser\u2019s point, bottom or height', () => {
    const project = plain()
    const run = serviceAt(project, 0)
    run.point = { x: 100, y: 100 }
    run.bottomElevation = 0
    run.height = 2600
    expectProblems(project, [
      { path: `${RUN}.bottomElevation`, code: 'unknown-field' },
      { path: `${RUN}.height`, code: 'unknown-field' },
      { path: `${RUN}.point`, code: 'unknown-field' },
    ])
  })

  it('refuses a Riser that carries a Run\u2019s line or centreline', () => {
    const project = plain()
    const riser = serviceAt(project, 2)
    riser.line = { start: { x: 100, y: 100 }, end: { x: 200, y: 100 } }
    riser.centrelineElevation = 300
    expectProblems(project, [
      { path: `${RISER}.centrelineElevation`, code: 'unknown-field' },
      { path: `${RISER}.line`, code: 'unknown-field' },
    ])
  })

  it('refuses a Run with no section, and one with a section outside the two it knows', () => {
    const project = plain()
    delete serviceAt(project, 0).section
    expectProblems(project, only(`${RUN}.section`, 'missing-field'))

    const other = plain()
    serviceAt(other, 0).section = 'square'
    expectProblems(other, only(`${RUN}.section`, 'not-one-of'))
  })

  it('refuses an unknown Kind, which is a Kind the plan can write no code for', () => {
    const project = plain()
    serviceAt(project, 0).kind = 'sewer'
    expectProblems(project, only(`${RUN}.kind`, 'not-one-of'))
  })

  it('refuses an unknown shape, which is a record of an element the tool cannot draw', () => {
    const project = plain()
    serviceAt(project, 0).shape = 'bend'
    expectProblems(project, only(`${RUN}.shape`, 'not-one-of'))
  })

  it('refuses a Run with no centreline and a Riser with no point', () => {
    const project = plain()
    delete serviceAt(project, 0).line
    delete serviceAt(project, 2).point
    expectProblems(project, [
      { path: `${RUN}.line`, code: 'missing-field' },
      { path: `${RISER}.point`, code: 'missing-field' },
    ])
  })

  it('refuses an arc centreline, because a Run has no arc', () => {
    const project = plain()
    serviceAt(project, 0).line = { kind: 'arc', start: { x: 600, y: 1200 }, end: { x: 3600, y: 1200 }, through: { x: 2100, y: 1400 } }
    expectProblems(project, [
      { path: `${RUN}.line.kind`, code: 'not-one-of' },
      { path: `${RUN}.line.through`, code: 'unknown-field' },
    ])
  })

  it('refuses a host, a connection or a fitting, because a Service attaches to nothing', () => {
    const project = plain()
    const run = serviceAt(project, 0)
    run.hostWallId = 'wall-1'
    run.connections = []
    expectProblems(project, [
      { path: `${RUN}.connections`, code: 'unknown-field' },
      { path: `${RUN}.hostWallId`, code: 'unknown-field' },
    ])
  })

  it('refuses a Service on a Floor that is not there', () => {
    const project = plain()
    serviceAt(project, 0).floorId = 'floor-nowhere'
    expectProblems(project, only(`${RUN}.floorId`, 'dangling-reference'))
  })

  it('refuses a Service that stores a Bottom or a Top of its own', () => {
    // Criterion 1: the three vertical positions of a Run are derived. A record that remembered one
    // would disagree with its own Diameter the first time the Diameter changed.
    const project = plain()
    const run = serviceAt(project, 0)
    run.bottom = 2175
    run.top = 2225
    expectProblems(project, [
      { path: `${RUN}.bottom`, code: 'unknown-field' },
      { path: `${RUN}.top`, code: 'unknown-field' },
    ])
  })

  it('refuses a label far too long to be a label', () => {
    const other = plain()
    serviceAt(other, 0).label = 'x'.repeat(81)
    expectProblems(other, only(`${RUN}.label`, 'out-of-range'))
  })

  it('refuses a duplicate Service ID, wherever the twin sits', () => {
    const project = plain()
    services(project).push(structuredClone(serviceAt(project, 0)))
    expectProblems(project, only('existingModel.services[4].id', 'duplicate-id'))
  })

  it('refuses a Service the Existing Model says came out of something', () => {
    // Provenance starts at the Existing Model (#69 §3), so the field itself is the mistake here.
    const project = plain()
    serviceAt(project, 0).predecessorIds = ['service-1']
    expectProblems(project, only(`${RUN}.predecessorIds`, 'unknown-field'))
  })

  it('refuses a Design Option\u2019s Service that names a predecessor this Option leaves standing', () => {
    const project = base()
    const option = (project.designOptions as Rec[])[0]!
    ;(option.proposed as Rec).services = [{ ...services(project)[0]!, id: 'service-9', predecessorIds: ['service-1'] }]
    expectProblems(project, only('designOptions[0].proposed.services[0].predecessorIds[0]', 'dangling-reference'))
  })

  it('accepts the Design Option\u2019s own Service, which came out of nothing', () => {
    const project = base()
    const option = (project.designOptions as Rec[])[0]!
    expect(((option.proposed as Rec).services as Rec[])[0]!.predecessorIds).toEqual([])
    expectProblems(project, [])
  })

  it('refuses a Service on a Drawing Layer that is not there', () => {
    const project = plain()
    serviceAt(project, 0).drawingLayerId = 'layer-nowhere'
    expectProblems(project, only(`${RUN}.drawingLayerId`, 'dangling-reference'))
  })

  it('accepts a Service filed Unlayered', () => {
    const project = plain()
    serviceAt(project, 0).drawingLayerId = null
    expectProblems(project, [])
  })

  it('keeps the below-Datum Run below the Datum, which is the case the Plan View Range fades', () => {
    const project = base()
    expect(serviceAt(project, 3)).toMatchObject({ centrelineElevation: -100, outsideDiameter: 100 })
    expect(BELOW).toBe('existingModel.services[3]')
  })
})
