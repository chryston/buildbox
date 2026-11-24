/**
 * The Clearance Envelope rejects of #76 §4, one test per rule the strict validator owns.
 *
 * The base is the #76 scene fixture — the shared elevation scene with the Base Cabinet design
 * carrying its zone — so the accepts say the written bytes read, and the interesting rejects are
 * the ones the editor would have refused before the shape was ever drawn: a path that crosses
 * itself, a height of zero, a design that carries a list of envelopes. Each is refused with its
 * path, so the message lands on the envelope it is about.
 */
import { describe, expect, it } from 'vitest'
import clearanceFixture from '../../fixtures/domain/v11/clearance.json?raw'
import { validateProject } from './index'

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(clearanceFixture) as { domainSchemaVersion: number; project: Rec }
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

/** The Base Cabinet design's envelope, the one the fixture carries. */
function envelopeOf(project: Rec): Rec {
  const designs = project.itemDesigns as Rec[]
  return designs[0]!.clearanceEnvelope as Rec
}

const ENVELOPE = 'itemDesigns[0].clearanceEnvelope'

/** The one problem every reject below is about, at one path. */
const only = (path: string, code: string): { path: string; code: string }[] => [{ path, code }]

describe('the Clearance Envelope (#76 §4)', () => {
  it('accepts the scene as written', () => {
    expectProblems(base(), [])
  })

  it('accepts a design with no envelope field, and one with a null envelope', () => {
    const absent = base()
    delete (absent.itemDesigns as Rec[])[0]!.clearanceEnvelope
    expectProblems(absent, [])
    const nulled = base()
    ;(nulled.itemDesigns as Rec[])[0]!.clearanceEnvelope = null
    expectProblems(nulled, [])
  })

  it('refuses a design that carries a list of envelopes', () => {
    // Zero or one per design: a list is a file that cannot say which envelope a placement shares.
    const one = envelopeOf(base())
    const project = base()
    ;(project.itemDesigns as Rec[])[0]!.clearanceEnvelope = [one, structuredClone(one)]
    expectProblems(project, only(ENVELOPE, 'wrong-type'))
  })

  it('refuses a self-intersecting envelope path, at the path it sits at', () => {
    // Criterion 17: the kernel's own sentence, naming the edges that cross, not a bare "invalid".
    const project = base()
    envelopeOf(project).path = {
      start: { x: 0, y: 500 },
      segments: [
        { kind: 'line', to: { x: 600, y: 800 } },
        { kind: 'line', to: { x: 600, y: 500 } },
        { kind: 'line', to: { x: 0, y: 800 } },
        { kind: 'line', to: { x: 0, y: 500 } },
      ],
    }
    const problems = problemsOf(project)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every(({ path }) => path.startsWith(ENVELOPE))).toBe(true)
    expect(problems.some(({ code }) => code === 'edges-cross')).toBe(true)
  })

  it('refuses an envelope height of zero, with its path', () => {
    const project = base()
    envelopeOf(project).height = 0
    expectProblems(project, only(`${ENVELOPE}.height`, 'out-of-range'))
  })

  it('refuses a bottom offset that is not a finite number, with its path', () => {
    const project = base()
    envelopeOf(project).bottomOffset = Number.POSITIVE_INFINITY
    expectProblems(project, only(`${ENVELOPE}.bottomOffset`, 'out-of-range'))
  })

  it('refuses an envelope with no path, and one with a field it does not know', () => {
    const missing = base()
    delete envelopeOf(missing).path
    expectProblems(missing, only(`${ENVELOPE}.path`, 'missing-field'))
    const extra = base()
    envelopeOf(extra).color = '#ff0000'
    expectProblems(extra, only(`${ENVELOPE}.color`, 'unknown-field'))
  })
})
