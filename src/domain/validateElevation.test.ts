/// <reference types="vite/client" />
/**
 * The Elevation View rejects of #75 §1, one test per rule the strict validator owns.
 *
 * The base is the #75 scene fixture, migrated exactly as the app reads a file: the interesting rejects
 * are references between collections — a view naming a Floor that is not there, an ID a Plan View is
 * already using, a name this Floor's Elevation Views already use — and the fixture holds a real Floor,
 * a real Plan View and two real Elevation Views to point at.
 *
 * The rules are shape rules: nothing here depends on Renovation, Design Options or Drawing Layers, and
 * an absent `elevationViews` field — a Project written before the capability — is valid, which is the
 * first thing this file says.
 */
import { describe, expect, it } from 'vitest'
import elevationFixture from '../../fixtures/domain/v10/elevation-scene.json?raw'
import { migrateProject, validateProject } from './index'

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(elevationFixture) as { domainSchemaVersion: number; project: Rec }
  let issued = 0
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion, (count) =>
    Array.from({ length: count }, () => `fixture-elev-${(issued += 1)}`),
  )
  if (!result.ok) throw new Error(`The elevation fixture no longer migrates: ${result.error.message}`)
  return structuredClone(result.project) as unknown as Rec
}

function problemsOf(value: unknown): { path: string; code: string }[] {
  const result = validateProject(value)
  return result.ok ? [] : result.problems.map(({ path, code }) => ({ path, code }))
}

/** The exact `{path, code}` pairs, in the order the validator reported them. */
function expectProblems(value: unknown, expected: { path: string; code: string }[]): void {
  expect(problemsOf(value)).toEqual(expected)
}

function firstElevation(project: Rec): Rec {
  return (project.elevationViews as Rec[])[0] as Rec
}

/** The one problem every reject below is about, at one path. */
const only = (path: string, code: string): { path: string; code: string }[] => [{ path, code }]

describe('the Elevation View list (#75 §1)', () => {
  it('accepts the scene as written', () => {
    expectProblems(base(), [])
  })

  it('accepts a Project that has no Elevation Views field at all, and one with an empty list', () => {
    const absent = base()
    delete absent.elevationViews
    expectProblems(absent, [])
    const empty = base()
    empty.elevationViews = []
    expectProblems(empty, [])
  })

  it('refuses a list that is not a list', () => {
    const project = base()
    project.elevationViews = { id: 'elev-1' }
    expectProblems(project, only('elevationViews', 'wrong-type'))
  })

  it('refuses a record that is not a record', () => {
    const project = base()
    ;(project.elevationViews as unknown[])[0] = 'Kitchen elevation'
    expectProblems(project, only('elevationViews[0]', 'wrong-type'))
  })
})

describe('one Elevation View (#75 §1)', () => {
  it('refuses the Plan View kind', () => {
    const project = base()
    firstElevation(project).kind = 'plan'
    expectProblems(project, only('elevationViews[0].kind', 'not-one-of'))
  })

  it('refuses a missing ID and an ID that is not an ID', () => {
    const missing = base()
    delete firstElevation(missing).id
    expectProblems(missing, only('elevationViews[0].id', 'missing-field'))
    const blank = base()
    firstElevation(blank).id = ''
    expectProblems(blank, only('elevationViews[0].id', 'bad-id'))
  })

  it('refuses an ID a Plan View of the same Project is already using', () => {
    const project = base()
    firstElevation(project).id = (project.views as Rec[])[0]!.id as string
    expectProblems(project, only('elevationViews[0].id', 'duplicate-id'))
  })

  it('refuses an ID two Elevation Views share', () => {
    const project = base()
    const views = project.elevationViews as Rec[]
    views[1]!.id = views[0]!.id as string
    expectProblems(project, only('elevationViews[1].id', 'duplicate-id'))
  })

  it('refuses a Floor that is not in this Project', () => {
    const project = base()
    firstElevation(project).floorId = 'floor-nowhere'
    expectProblems(project, only('elevationViews[0].floorId', 'dangling-reference'))
  })

  it('refuses a missing Floor and an empty name', () => {
    const missing = base()
    delete firstElevation(missing).floorId
    expectProblems(missing, only('elevationViews[0].floorId', 'missing-field'))
    const blank = base()
    firstElevation(blank).name = '   '
    expectProblems(blank, only('elevationViews[0].name', 'empty-text'))
  })

  it('refuses a name this Floor’s Elevation Views already use, however it is spelled', () => {
    const project = base()
    const views = project.elevationViews as Rec[]
    views[1]!.name = String(views[0]!.name).toUpperCase()
    expectProblems(project, only('elevationViews[1].name', 'duplicate-name'))
  })

  it('lets an Elevation View and a Plan View of one Floor share a name', () => {
    const project = base()
    firstElevation(project).name = (project.views as Rec[])[0]!.name as string
    expectProblems(project, [])
  })

  it('lets two Floors each hold an Elevation View of the same name', () => {
    const project = base()
    const views = project.views as Rec[]
    // Every Floor comes with exactly one default Plan View, so the new Floor needs one too.
    views.push({ ...views[0]!, id: 'view-2', floorId: 'floor-2', name: 'Upper', isDefault: true })
    project.floors = [...(project.floors as Rec[]), { id: 'floor-2', name: 'Upper', planImage: null }]
    ;(project.elevationViews as Rec[])[1]!.floorId = 'floor-2'
    ;(project.elevationViews as Rec[])[1]!.name = (project.elevationViews as Rec[])[0]!.name as string
    expectProblems(project, [])
  })

  it('refuses a side that is neither side', () => {
    for (const side of ['north', 'LEFT', 'front', '']) {
      const project = base()
      firstElevation(project).side = side
      expectProblems(project, only('elevationViews[0].side', 'not-one-of'))
    }
  })

  it('refuses a depth of zero, a negative depth and a depth that is not a number', () => {
    for (const depth of [0, -2000, -0.5]) {
      const project = base()
      firstElevation(project).depth = depth
      expectProblems(project, only('elevationViews[0].depth', 'out-of-range'))
    }
    const notANumber = base()
    firstElevation(notANumber).depth = 'far'
    expectProblems(notANumber, only('elevationViews[0].depth', 'wrong-type'))
  })

  it('refuses a depth that is not a finite number', () => {
    for (const depth of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const project = base()
      firstElevation(project).depth = depth
      expectProblems(project, only('elevationViews[0].depth', 'out-of-range'))
    }
  })
})

describe('the view line (#75 §1)', () => {
  it('refuses a missing line', () => {
    const project = base()
    delete firstElevation(project).line
    expectProblems(project, only('elevationViews[0].line', 'missing-field'))
  })

  it('refuses a line that is not an object, and ends that are not objects', () => {
    const notAnObject = base()
    firstElevation(notAnObject).line = '0,0 → 4000,0'
    expectProblems(notAnObject, only('elevationViews[0].line', 'wrong-type'))
    const badEnd = base()
    firstElevation(badEnd).line = { start: { x: 0, y: 1400 }, end: 4000 }
    expectProblems(badEnd, only('elevationViews[0].line.end', 'wrong-type'))
  })

  it('refuses two ends in the same place, which bounds no band', () => {
    const project = base()
    firstElevation(project).line = { start: { x: 100, y: 200 }, end: { x: 100, y: 200 } }
    expectProblems(project, only('elevationViews[0].line.end', 'out-of-range'))
  })

  it('accepts a line at any angle, and one that reaches past the room', () => {
    const project = base()
    firstElevation(project).line = { start: { x: -900, y: 200.5 }, end: { x: 2598.25, y: 1460.75 } }
    expectProblems(project, [])
  })

  it('refuses an end that is not a finite number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const project = base()
      firstElevation(project).line = { start: { x: 0, y: 1400 }, end: { x: value, y: 1400 } }
      expectProblems(project, only('elevationViews[0].line.end.x', 'out-of-range'))
    }
    const missing = base()
    firstElevation(missing).line = { start: { x: 0, y: 1400 }, end: { y: 1400 } }
    expectProblems(missing, only('elevationViews[0].line.end.x', 'missing-field'))
  })

  it('refuses a field an end does not have, and one the line does not have', () => {
    const point = base()
    firstElevation(point).line = { start: { x: 0, y: 1400, z: 0 }, end: { x: 4000, y: 1400 } }
    expectProblems(point, only('elevationViews[0].line.start.z', 'unknown-field'))
    const line = base()
    firstElevation(line).line = { start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 }, azimuthDeg: 90 }
    expectProblems(line, only('elevationViews[0].line.azimuthDeg', 'unknown-field'))
  })
})

describe('what an Elevation View is not (#75 §1)', () => {
  it('refuses the Plan View fields, which belong to the other kind', () => {
    const project = base()
    const view = firstElevation(project)
    view.planViewRange = { lowerMm: 0, upperMm: 1200 }
    view.showPlanImage = false
    view.isDefault = false
    expectProblems(project, [
      { path: 'elevationViews[0].isDefault', code: 'unknown-field' },
      { path: 'elevationViews[0].planViewRange', code: 'unknown-field' },
      { path: 'elevationViews[0].showPlanImage', code: 'unknown-field' },
    ])
  })

  it('still checks the settings every saved view shares', () => {
    const project = base()
    firstElevation(project).designOptionId = 'option-nowhere'
    expectProblems(project, only('elevationViews[0].designOptionId', 'dangling-reference'))
    const display = base()
    firstElevation(display).renovationDisplay = 'as-built'
    expectProblems(display, only('elevationViews[0].renovationDisplay', 'not-one-of'))
  })
})
