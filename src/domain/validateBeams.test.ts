/**
 * The Beam rejects of #77 §1, one test per rule the strict validator owns.
 *
 * The base is the #77 scene fixture — the renovation scene with one Beam the Existing Model holds and
 * one `Option A` proposes in its place — so the accepts say the written bytes read, and the
 * interesting rejects are the ones the editor would have refused before the Beam was ever drawn: a
 * line with no length, a section of zero width, a Depth of nothing, an arc, and the one reject the
 * issue is most particular about — a Beam that names a Wall it hangs from. Each is refused with its
 * path, so the message lands on the Beam it is about.
 */
import { describe, expect, it } from 'vitest'
import beamsFixture from '../../fixtures/domain/v12/beams.json?raw'
import { migrateProject, validateProject } from './index'

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(beamsFixture) as { domainSchemaVersion: number; project: Rec }
  // The base is the #77 scene fixture migrated up, as every strict-import test reads one: the file was
  // written at the twelfth schema and the validator judges whatever the current schema requires.
  let issued = 0
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion, (count) =>
    Array.from({ length: count }, () => `fixture-beam-${(issued += 1)}`),
  )
  if (!result.ok) throw new Error(`The beams fixture no longer migrates: ${result.error.message}`)
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

/** The Beam the Existing Model holds. */
function beamOf(project: Rec): Rec {
  const model = project.existingModel as Rec
  return (model.beams as Rec[])[0]!
}

/**
 * The scene with its replace story taken out: `Option A` proposes no Beam and demolishes nothing.
 *
 * The fixture's `Option A` replaces Beam B-1, and a demolition and a predecessor are both references
 * the validator resolves — so a test about the Existing Model's own collection takes them out first,
 * or it reports the reference it removed rather than the thing it was checking.
 */
function plain(): Rec {
  const project = base()
  const option = (project.designOptions as Rec[])[0]!
  ;(option.demolishedIds as string[]).length = 0
  ;(option.proposed as Rec).beams = []
  return project
}

const BEAM = 'existingModel.beams[0]'

/** The one problem every reject below is about, at one path. */
const only = (path: string, code: string): { path: string; code: string }[] => [{ path, code }]

describe('the Beam (#77 §1)', () => {
  it('accepts the scene as written', () => {
    expectProblems(base(), [])
  })

  it('accepts a model with no Beam collection at all, which is a model written before #77', () => {
    const project = plain()
    delete (project.existingModel as Rec).beams
    for (const option of project.designOptions as Rec[]) delete (option.proposed as Rec).beams
    expectProblems(project, [])
  })

  it('accepts an empty Beam collection', () => {
    const project = plain()
    ;(project.existingModel as Rec).beams = []
    expectProblems(project, [])
  })

  it('accepts an Underside below the Floor Datum, which is a Beam a person may genuinely draw', () => {
    // A negative elevation is not a nonsense measurement — a Beam under a basement slab is one — so
    // the validator owns only that it is a finite number, and the warning list says it is low.
    const project = base()
    beamOf(project).underside = -200
    expectProblems(project, [])
  })

  it('refuses a missing reference line', () => {
    const project = base()
    delete beamOf(project).line
    expectProblems(project, only(`${BEAM}.line`, 'missing-field'))
  })

  it('refuses a reference line whose two ends are the same point', () => {
    const project = base()
    const line = beamOf(project).line as Rec
    line.end = structuredClone(line.start)
    expectProblems(project, only(`${BEAM}.line`, 'out-of-range'))
  })

  it('refuses a reference line no longer than the drawing tolerance', () => {
    // 0.01 mm is what the kernel calls coincident; a Beam of that length is a dot, not a Beam.
    const project = base()
    const line = beamOf(project).line as Rec
    line.end = { x: (line.start as Rec).x as number + 0.005, y: (line.start as Rec).y as number }
    expectProblems(project, only(`${BEAM}.line`, 'out-of-range'))
  })

  it('refuses an arc, by name, at the line it sits at', () => {
    // A Beam has no arc, and the reason has to be said: a file that carries `kind: 'arc'` was
    // written by something that thinks a Beam can curve, and "unknown field" would not tell it so.
    const project = base()
    ;(beamOf(project).line as Rec).kind = 'arc'
    expectProblems(project, only(`${BEAM}.line.kind`, 'not-one-of'))
  })

  it('refuses a third point on the reference line, which only an arc has', () => {
    const project = base()
    ;(beamOf(project).line as Rec).through = { x: 2400, y: 0 }
    expectProblems(project, only(`${BEAM}.line.through`, 'unknown-field'))
  })

  it('refuses a width of zero, and a negative one', () => {
    for (const width of [0, -100]) {
      const project = base()
      beamOf(project).width = width
      expectProblems(project, only(`${BEAM}.width`, 'out-of-range'))
    }
  })

  it('refuses a Depth of zero, and a negative one', () => {
    for (const height of [0, -10]) {
      const project = base()
      beamOf(project).height = height
      expectProblems(project, only(`${BEAM}.height`, 'out-of-range'))
    }
  })

  it('refuses a justification outside left, centre and right', () => {
    const project = base()
    beamOf(project).justification = 'middle'
    expectProblems(project, only(`${BEAM}.justification`, 'not-one-of'))
  })

  it('refuses an Underside that is not a number', () => {
    const project = base()
    beamOf(project).underside = 'low'
    expectProblems(project, only(`${BEAM}.underside`, 'wrong-type'))
  })

  it('refuses a Beam on a Floor that is not there', () => {
    const project = base()
    beamOf(project).floorId = 'floor-404'
    expectProblems(project, only(`${BEAM}.floorId`, 'dangling-reference'))
  })

  it('refuses a Beam that names the Wall it hangs from', () => {
    // The reject the issue is most particular about: a Beam is a Building Element of its own, never
    // a thing attached to a Wall. There is no field for a host, so the unknown field is the refusal.
    const project = base()
    beamOf(project).hostWallId = 'wall-1'
    expectProblems(project, only(`${BEAM}.hostWallId`, 'unknown-field'))
  })

  it('refuses a Beam that names the Wall it joins', () => {
    const project = base()
    beamOf(project).startJunctionId = 'junction-1'
    expectProblems(project, only(`${BEAM}.startJunctionId`, 'unknown-field'))
  })

  it('refuses a Beam that stores its own Top, which is always Underside plus Depth', () => {
    const project = base()
    beamOf(project).top = 2600
    expectProblems(project, only(`${BEAM}.top`, 'unknown-field'))
  })

  it('refuses a Beam that stores its faces, which are derived from the line and the width', () => {
    const project = base()
    beamOf(project).faces = []
    expectProblems(project, only(`${BEAM}.faces`, 'unknown-field'))
  })

  it('refuses a predecessor on a Beam of the Existing Model', () => {
    // An Existing Model Beam came out of nothing; provenance belongs to the Option that made work,
    // so the field is not one this container has.
    const project = plain()
    beamOf(project).predecessorIds = ['beam-9']
    expectProblems(project, only(`${BEAM}.predecessorIds`, 'unknown-field'))
  })

  it('refuses a proposed Beam whose predecessor this Option leaves standing', () => {
    // `Option A` proposes Beam B-2 in place of Beam B-1 and demolishes it; take the demolition away
    // and the provenance claims a replacement of work that still stands as it is.
    const project = base()
    const option = (project.designOptions as Rec[])[0]!
    ;(option.demolishedIds as string[]).length = 0
    expectProblems(project, only('designOptions[0].proposed.beams[0].predecessorIds[0]', 'dangling-reference'))
  })

  it('refuses a label longer than the field the inspector shows', () => {
    const project = base()
    beamOf(project).label = 'B'.repeat(81)
    expectProblems(project, only(`${BEAM}.label`, 'out-of-range'))
  })

  it('accepts a Beam with no label, which says only Beam', () => {
    const project = base()
    delete beamOf(project).label
    expectProblems(project, [])
  })

  it('refuses a Beam filed on a Drawing Layer that is not there', () => {
    const project = base()
    beamOf(project).drawingLayerId = 'layer-404'
    expectProblems(project, only(`${BEAM}.drawingLayerId`, 'dangling-reference'))
  })

  it('refuses two Beams with one ID', () => {
    const project = base()
    const model = project.existingModel as Rec
    ;(model.beams as Rec[]).push(structuredClone(beamOf(project)))
    expectProblems(project, only('existingModel.beams[1].id', 'duplicate-id'))
  })

  it('refuses the Beams of one model as a single object rather than a list', () => {
    const project = plain()
    ;(project.existingModel as Rec).beams = beamOf(project)
    expectProblems(project, only('existingModel.beams', 'wrong-type'))
  })
})
