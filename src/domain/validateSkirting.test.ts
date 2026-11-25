/**
 * The Skirting rejects of #78 §1, one test per rule the strict validator owns.
 *
 * The base is the #78 scene fixture — the renovation scene with one Skirting the Existing Model holds
 * against Wall W-1 and one `Option A` proposes against the same Wall on its other face — so the
 * accepts say the written bytes read, and the rejects are the ones the editor would have refused
 * before the Skirting was ever drawn: a range with no length, a range that runs off the end of the
 * Wall, a Wall that is not there, a face that is neither side, and a stored outline, which is the
 * thing this element never holds. Each is refused with its path, so the message lands on the Skirting
 * it is about.
 */
import { describe, expect, it } from 'vitest'
import skirtingFixture from '../../fixtures/domain/v13/skirting.json?raw'
import { migrateProject, validateProject } from './index'

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(skirtingFixture) as { domainSchemaVersion: number; project: Rec }
  // The base is the #78 scene fixture migrated up, as every strict-import test reads one: the file was
  // written at the thirteenth schema and the validator judges whatever the current schema requires.
  let issued = 0
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion, (count) =>
    Array.from({ length: count }, () => `fixture-skirt-${(issued += 1)}`),
  )
  if (!result.ok) throw new Error(`The skirting fixture no longer migrates: ${result.error.message}`)
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

/** The Skirting the Existing Model holds. */
function skirtingOf(project: Rec): Rec {
  const model = project.existingModel as Rec
  return (model.skirting as Rec[])[0]!
}

/** `Option A`, the one that proposes a Skirting of its own. */
function optionA(project: Rec): Rec {
  return (project.designOptions as Rec[])[0]!
}

/**
 * The scene with its replace story taken out: `Option A` proposes no Skirting and demolishes nothing.
 *
 * The fixture's `Option A` replaces Skirting SK-1, and a demolition and a predecessor are both
 * references the validator resolves — so a test about the Existing Model's own collection takes them
 * out first, or it reports the reference it removed rather than the thing it was checking.
 */
function plain(): Rec {
  const project = base()
  const option = optionA(project)
  ;(option.demolishedIds as string[]).length = 0
  ;(option.proposed as Rec).skirting = []
  return project
}

const SKIRTING = 'existingModel.skirting[0]'

/** The one problem every reject below is about, at one path. */
const only = (path: string, code: string): { path: string; code: string }[] => [{ path, code }]

describe('the Skirting (#78 §1)', () => {
  it('accepts the scene as written', () => {
    expectProblems(base(), [])
  })

  it('accepts a model with no Skirting collection at all, which is a model written before #78', () => {
    const project = plain()
    delete (project.existingModel as Rec).skirting
    for (const option of project.designOptions as Rec[]) delete (option.proposed as Rec).skirting
    expectProblems(project, [])
  })

  it('accepts an empty Skirting collection', () => {
    const project = plain()
    ;(project.existingModel as Rec).skirting = []
    expectProblems(project, [])
  })

  it('accepts a Bottom below the Floor Datum, which is a Skirting a person may genuinely record', () => {
    // -50 mm is not a nonsense measurement — a Skirting recorded from below a slab is one — so the
    // validator owns only that it is a finite number, and the warning list says it is low.
    const project = base()
    skirtingOf(project).bottom = -50
    expectProblems(project, [])
  })

  it('accepts a range that runs under a junction, because a gap there is derived, not stored', () => {
    // The Wall this Skirting is drawn against meets another Wall part way along. A range that carries
    // on past the junction is a legal Skirting with a derived gap, so the only length the validator
    // measures against is the host's own reference line (#78 §2 criterion 5).
    const project = base()
    skirtingOf(project).start = 4200
    skirtingOf(project).end = 9000
    expectProblems(project, [])
  })

  it('refuses a range whose end is not further along the Wall than its start', () => {
    const project = base()
    skirtingOf(project).end = 0
    expectProblems(project, only(`${SKIRTING}.end`, 'out-of-range'))
  })

  it('refuses a range that runs past the end of the Wall it is drawn against', () => {
    const project = base()
    skirtingOf(project).end = 9001
    expectProblems(project, only(`${SKIRTING}.end`, 'out-of-range'))
  })

  it('refuses a range that starts behind the start of the Wall it is drawn against', () => {
    const project = base()
    skirtingOf(project).start = -1
    expectProblems(project, only(`${SKIRTING}.start`, 'out-of-range'))
  })

  it('refuses a missing host Wall', () => {
    const project = plain()
    delete skirtingOf(project).hostWallId
    expectProblems(project, only(`${SKIRTING}.hostWallId`, 'missing-field'))
  })

  it('refuses a host Wall that is not in this Project', () => {
    const project = plain()
    skirtingOf(project).hostWallId = 'wall-nowhere'
    expectProblems(project, only(`${SKIRTING}.hostWallId`, 'dangling-reference'))
  })

  it('refuses a Skirting on a different Floor from the Wall it is drawn against', () => {
    const project = plain()
    // A second Floor, with the one default Plan View every Floor has (#56): the Skirting moves down
    // to it and its Wall stays where it was drawn.
    const floor = structuredClone((project.floors as Rec[])[0]!)
    floor.id = 'floor-2'
    floor.name = 'Floor 2'
    ;(project.floors as Rec[]).push(floor)
    const view = structuredClone((project.views as Rec[])[0]!)
    view.id = 'view-floor-2'
    view.floorId = floor.id
    view.name = 'Floor 2'
    ;(project.views as Rec[]).push(view)
    skirtingOf(project).floorId = floor.id
    expectProblems(project, only(`${SKIRTING}.hostWallId`, 'dangling-reference'))
  })

  it('refuses a Skirting of `Option A` drawn against a Wall only `Option B` builds', () => {
    const project = base()
    const built = (optionA(project).proposed as Rec).skirting as Rec[]
    const otherOption = (project.designOptions as Rec[])[1]!
    // A Wall `Option B` builds and `Option A` does not: the face exists in the other Option's
    // drawing, and a Skirting cannot stand on it from here (#69 §2).
    const foreign = structuredClone(((project.existingModel as Rec).walls as Rec[])[0]!)
    foreign.id = 'wall-b-1'
    foreign.ref = 'W-9'
    foreign.predecessorIds = []
    ;((otherOption.proposed as Rec).walls as Rec[]).push(foreign)
    built[0]!.hostWallId = foreign.id
    expectProblems(project, only('designOptions[0].proposed.skirting[0].hostWallId', 'dangling-reference'))
  })

  it('refuses a Skirting drawn against a Wall this Option has taken down', () => {
    const project = base()
    const option = optionA(project)
    const built = (option.proposed as Rec).skirting as Rec[]
    // The Option's own Skirting stands on the survey's W-1; demolish W-1 and the Skirting is left
    // standing on nothing, which is the state the dependency review exists to stop (#69 §3).
    const demolished = option.demolishedIds as string[]
    demolished.push(built[0]!.hostWallId as string)
    demolished.sort()
    expectProblems(project, only('designOptions[0].proposed.skirting[0].hostWallId', 'dangling-reference'))
  })

  it('refuses a Height of zero', () => {
    const project = base()
    skirtingOf(project).height = 0
    expectProblems(project, only(`${SKIRTING}.height`, 'out-of-range'))
  })

  it('refuses a Thickness of zero', () => {
    const project = base()
    skirtingOf(project).thickness = 0
    expectProblems(project, only(`${SKIRTING}.thickness`, 'out-of-range'))
  })

  it('refuses a face that is neither of the two faces a Wall has', () => {
    const project = base()
    skirtingOf(project).side = 'centre'
    expectProblems(project, only(`${SKIRTING}.side`, 'not-one-of'))
  })

  it('refuses a stored outline, which is the one thing a Skirting never holds', () => {
    // The body is derived from the host's tidied face offset by the thickness; a polygon, a line or a
    // list of gaps in the record would be a second answer to the same question (#78 §1).
    for (const field of ['line', 'polygon', 'gaps']) {
      const project = base()
      skirtingOf(project)[field] = field === 'gaps' ? [] : []
      expectProblems(project, only(`${SKIRTING}.${field}`, 'unknown-field'))
    }
  })

  it('refuses a predecessor on an Existing Model Skirting', () => {
    const project = plain()
    skirtingOf(project).predecessorIds = ['skirting-9']
    expectProblems(project, only(`${SKIRTING}.predecessorIds`, 'unknown-field'))
  })

  it('refuses a proposed Skirting whose predecessor is not in the Existing Model', () => {
    const project = base()
    const built = (optionA(project).proposed as Rec).skirting as Rec[]
    built[0]!.predecessorIds = ['skirting-9']
    expectProblems(project, only('designOptions[0].proposed.skirting[0].predecessorIds[0]', 'dangling-reference'))
  })

  it('refuses a proposed Skirting with no provenance field at all', () => {
    const project = base()
    const built = (optionA(project).proposed as Rec).skirting as Rec[]
    delete built[0]!.predecessorIds
    expectProblems(project, only('designOptions[0].proposed.skirting[0].predecessorIds', 'missing-field'))
  })
})
