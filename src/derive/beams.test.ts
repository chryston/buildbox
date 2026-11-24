/**
 * `deriveBeams` (#77 §1, §4): the faces a stored reference line becomes.
 *
 * The three justifications are the whole of the placement contract, so they are measured against
 * the reference line rather than against a golden: a centred Beam hangs 100 mm either side of it,
 * a left-justified Beam stands wholly to the left of its own direction, and the reference line
 * never moves for either. The length is measured along the reference line, which is the number the
 * Beams table publishes.
 */
import { describe, expect, it } from 'vitest'
import beamsFixture from '../../fixtures/domain/v12/beams.json?raw'
import type { Beam, Project } from '../domain'
import { linearElement } from '../geometry'
import { deriveBeams } from './beams'

const FLOOR = 'seed-001'

// The `?raw` import is the file's text and the JSON has no static type; the fixture is BuildBox's
// own, read by `src/package/testing.ts` under the same shape.
const beamsRecord = JSON.parse(beamsFixture) as { project: Project }
const fixture = (): Project => structuredClone(beamsRecord.project)

/** One Project holding exactly one Beam built from the fixture's, edited as needed. */
function oneBeam(over: Partial<Beam> = {}): Project {
  const project = fixture()
  const beam = project.existingModel.beams![0]!
  project.existingModel.beams = [{ ...beam, ...over }]
  return project
}

const facesOf = (project: Project) => {
  const derived = deriveBeams(project, FLOOR)
  const beam = derived.beams[0]!
  return { derived, beam }
}

describe('deriveBeams (#77 §4)', () => {
  it('hangs a centred Beam equally either side of its reference line', () => {
    const { beam } = facesOf(oneBeam({ justification: 'centre', width: 200 }))
    // The fixture runs along y = −400, so the faces sit at −500 and −300.
    expect(beam.faces[0]!.from).toEqual({ x: 900, y: -500 })
    expect(beam.faces[0]!.to).toEqual({ x: 3900, y: -500 })
    expect(beam.faces[1]!.from).toEqual({ x: 900, y: -300 })
    expect(beam.faces[1]!.to).toEqual({ x: 3900, y: -300 })
    expect(beam.faces.map((one) => one.key)).toEqual(['beam-1/left', 'beam-1/right'])
  })

  it('stands a left-justified Beam wholly to the left of the direction it was drawn in', () => {
    const { beam } = facesOf(oneBeam({ justification: 'left', width: 200 }))
    expect(beam.faces[0]!.from.y).toBe(-400)
    expect(beam.faces[1]!.from.y).toBe(-200)
  })

  it('stands a right-justified Beam wholly to the right, and never moves the line', () => {
    const { derived, beam } = facesOf(oneBeam({ justification: 'right', width: 200 }))
    expect(beam.faces[0]!.from.y).toBe(-600)
    expect(beam.faces[1]!.from.y).toBe(-400)
    // The stored reference is untouched by the justification: only the faces answer to it.
    expect(derived.byId.get('beam-1')!.length).toBe(3000)
  })

  it('outlines the body and measures the length along the reference line', () => {
    const { beam } = facesOf(oneBeam({ width: 200 }))
    expect(beam.outline.start).toEqual({ x: 900, y: -500 })
    expect(beam.outline.segments.map((segment) => segment.to)).toEqual([
      { x: 3900, y: -500 },
      { x: 3900, y: -300 },
      { x: 900, y: -300 },
      { x: 900, y: -500 },
    ])
    expect(beam.length).toBe(3000)
    expect(beam.underside).toBe(2300)
    expect(beam.top).toBe(2600)
    expect(beam.label).toBe('Beam B-1')
  })

  it('offers the four face ends and both faces to the snap engine', () => {
    const { derived } = facesOf(oneBeam())
    const [source] = derived.snapSources
    expect(source!.label).toBe('Beam B-1 · face')
    expect(source!.corners).toHaveLength(4)
    expect(source!.faces.map((face) => [face.from, face.to])).toEqual([
      [{ x: 900, y: -500 }, { x: 3900, y: -500 }],
      [{ x: 900, y: -300 }, { x: 3900, y: -300 }],
    ])
  })

  it('joins nothing: two crossing Beams keep their own outlines (#77 §1 criterion 2)', () => {
    const project = fixture()
    const beam = project.existingModel.beams![0]!
    project.existingModel.beams = [
      beam,
      { ...beam, id: 'beam-2', line: { start: { x: 2000, y: -2000 }, end: { x: 2000, y: 1000 } } },
    ]
    const derived = deriveBeams(project, FLOOR)
    expect(derived.beams).toHaveLength(2)
    // Neither is trimmed by the other: the first still runs its whole 3 000 mm.
    expect(derived.byId.get('beam-1')!.length).toBe(3000)
    expect(derived.byId.get('beam-2')!.length).toBe(3000)
  })

  it('reads a Floor with no Beams as empty rather than undefined', () => {
    const project = fixture()
    project.existingModel.beams = []
    const derived = deriveBeams(project, FLOOR)
    expect(derived.beams).toEqual([])
    expect(derived.faces).toEqual([])
    expect(derived.snapSources).toEqual([])
  })
})

describe('geometry.linearElement, the shared body primitive (#77 §1)', () => {
  it('offsets by millimetres of thickness, never by the length of the reference', () => {
    // A 4 000 mm reference and a 1 mm one of the same thickness must give faces the same
    // distance apart — the thickness is a section, not a proportion of the run.
    const long = linearElement({ kind: 'line', to: { x: 4000, y: 0 } }, { x: 0, y: 0 }, 200, 'centre')
    const short = linearElement({ kind: 'line', to: { x: 1, y: 0 } }, { x: 0, y: 0 }, 200, 'centre')
    expect(long.outline.start).toEqual({ x: 0, y: -100 })
    expect(short.outline.start).toEqual({ x: 0, y: -100 })
    expect(long.outline.segments[1]!.to).toEqual({ x: 4000, y: 100 })
  })

  it('follows the direction of a Beam drawn the other way', () => {
    const back = linearElement({ kind: 'line', to: { x: 0, y: 0 } }, { x: 4000, y: 0 }, 200, 'left')
    // Reversed, "left" is the other side of the page: the body lies above the line, not below.
    expect(back.outline.start).toEqual({ x: 4000, y: 0 })
    expect(back.outline.segments[1]!.to).toEqual({ x: 0, y: -200 })
  })
})
