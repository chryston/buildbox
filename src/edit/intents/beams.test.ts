/**
 * The Beam Intents (#77 §1, §2, §3): what one stores, what moves it, what the four boxes do.
 *
 * The shape of the record is the acceptance criterion, so it is asserted as a key list rather than
 * field by field: a Beam holds a reference line, a width, a justification, an Underside and a Depth,
 * and nothing else — no faces, no Top, no host, no Junction. The refusals are asserted by their
 * sentence as well as their code, because the sentence is what the homeowner reads.
 *
 * The numbers are the issue's own: a Beam at 2 160–2 460 whose `Top` is retyped as 2 500 ends up
 * 340 deep, and the same Beam given an Underside of 2 100 stands 2 100–2 440.
 */
import { describe, expect, it } from 'vitest'
import type { Beam, Project } from '../../domain'
import { beamTop, beamsOf, nextBeamLabel } from '../../domain'
import { pt } from '../../geometry'
import type { PayloadOf } from '../intents'
import { expectApplied, expectRejection, expectRoundTrip, idSource, intent, newProject } from '../testing'

const source = idSource('beam')
const floorIdOf = (project: Project): string => project.floors[0]!.id

/** The payload the Beam tool sends for a 200 × 300 Beam along y = −400, underside 2 300. */
function beamPayload(project: Project, over: Partial<PayloadOf<'beam.create'>> = {}): PayloadOf<'beam.create'> {
  return {
    floorId: floorIdOf(project),
    line: { start: pt(900, -400), end: pt(3900, -400) },
    justification: 'centre',
    width: 200,
    underside: 2300,
    height: 300,
    label: 'Beam B-1',
    ...over,
  }
}

/** One Project with one Beam drawn through it, and the Beam itself. */
function oneBeam(over: Partial<PayloadOf<'beam.create'>> = {}): { project: Project; beam: Beam } {
  const project = newProject()
  const applied = expectApplied(project, intent('beam.create', beamPayload(project, over), source(1)))
  return { project: applied.project, beam: beamsOf(applied.project.existingModel)[0]! }
}

/** A Wall drawn by the Wall tool, so the two element kinds can be moved against each other. */
function oneWall(project: Project): Project {
  return expectApplied(
    project,
    intent(
      'wall.createChain',
      {
        floorId: floorIdOf(project),
        walls: [
          {
            line: { kind: 'line', start: pt(0, 0), end: pt(4000, 0) },
            thickness: 100,
            justification: 'centre',
            baseElevation: 0,
            height: 2600,
          },
        ],
        starts: [{ kind: 'free' }],
        ends: [{ kind: 'free' }],
      },
      idSource('wall')(1),
    ),
  ).project
}

describe('beam.create (#77 §1, §2)', () => {
  it('stores the reference line, the section and the Vertical Extent, and nothing else', () => {
    const { beam } = oneBeam()
    // The whole of §1 criterion 1 as one assertion: the faces, the Top and the outline are derived,
    // so a record that carried one of them would be a second answer to the same question. The Layer
    // is the one extra the tool's saved view files it on (#71 §2).
    expect(Object.keys(beam).sort()).toEqual([
      'drawingLayerId',
      'floorId',
      'height',
      'id',
      'justification',
      'label',
      'line',
      'underside',
      'width',
    ])
    expect(beam.line).toEqual({ start: pt(900, -400), end: pt(3900, -400) })
    expect(beamTop(beam)).toBe(2600)
  })

  it('stores no `Top at` and leaves the Floor’s own limits untouched (#77 §2 criterion 4)', () => {
    const project = newProject()
    const applied = expectApplied(project, intent('beam.create', beamPayload(project, { underside: 2300 }), source(1)))
    const stored = JSON.stringify(beamsOf(applied.project.existingModel))
    expect(stored).not.toContain('top')
    expect(stored).not.toContain('2600')
    // The reference was 2 600 — the Floor’s nominal height — and using it changed nothing about it.
    expect(applied.project.floors[0]!.limits).toBeUndefined()
    expect(applied.patches.length).toBe(1)
  })

  it('keeps the label it was given and stores none when the tool sent none (#77 §3)', () => {
    const { beam } = oneBeam({ label: undefined })
    expect('label' in beam).toBe(false)
  })

  it('accepts an Underside below the Floor Datum, because a Sump band is real (#77 §2 criterion 6)', () => {
    const { beam } = oneBeam({ underside: -150 })
    expect(beam.underside).toBe(-150)
    expect(beamTop(beam)).toBe(150)
  })

  it('refuses a line with no length, a section of no width and a Depth of nothing', () => {
    const project = newProject()
    expectRejection(
      project,
      intent('beam.create', beamPayload(project, { line: { start: pt(900, -400), end: pt(900, -400) } }), source(1)),
      'invalid-beam',
    )
    expectRejection(project, intent('beam.create', beamPayload(project, { width: 0 }), source(1)), 'invalid-beam')
    expectRejection(project, intent('beam.create', beamPayload(project, { height: 0 }), source(1)), 'invalid-beam')
  })

  it('refuses a Floor the Project does not have', () => {
    const project = newProject()
    expectRejection(
      project,
      intent('beam.create', beamPayload(project, { floorId: 'floor-none' }), source(1)),
      'unknown-target',
    )
  })

  it('draws into a Design Option as proposed work on the Structure layer (#77 §2 criterion 3)', () => {
    const project = newProject()
    const withOption = expectApplied(project, intent('designOption.create', { name: 'Option A' }, ['opt-a'])).project
    const applied = expectApplied(
      withOption,
      intent('beam.create', { ...beamPayload(withOption), target: { designOptionId: 'opt-a' } }, source(1)),
    )
    const [beam] = beamsOf(applied.project.designOptions![0]!.proposed)
    expect(beam).toBeDefined()
    expect(beam.predecessorIds).toEqual([])
    expect(beam.drawingLayerId).toBeDefined()
    expect(beamsOf(applied.project.existingModel)).toHaveLength(0)
  })

  it('undoes back to the Project it started from', () => {
    const project = newProject()
    expectRoundTrip(project, intent('beam.create', beamPayload(project), source(1)))
  })
})

describe('moving a Beam (#77 §2 criterion 2)', () => {
  it('moves one end and leaves the other where it was', () => {
    const { project, beam } = oneBeam()
    const applied = expectApplied(project, intent('beam.dragEndpoint', { beamId: beam.id, end: 'end', to: pt(5000, -400) }))
    expect(beamsOf(applied.project.existingModel)[0]!.line).toEqual({ start: pt(900, -400), end: pt(5000, -400) })
    expectRoundTrip(project, intent('beam.dragEndpoint', { beamId: beam.id, end: 'end', to: pt(5000, -400) }))
  })

  it('refuses to collapse a Beam onto one point', () => {
    const { project, beam } = oneBeam()
    expectRejection(
      project,
      intent('beam.dragEndpoint', { beamId: beam.id, end: 'end', to: pt(900, -400) }),
      'invalid-beam',
    )
  })

  it('moves the whole Beam by the delta, section and elevations untouched', () => {
    const { project, beam } = oneBeam()
    const applied = expectApplied(project, intent('beam.dragBody', { beamId: beam.id, delta: pt(100, 50) }))
    const moved = beamsOf(applied.project.existingModel)[0]!
    expect(moved.line).toEqual({ start: pt(1000, -350), end: pt(4000, -350) })
    expect(moved.width).toBe(beam.width)
    expect(moved.underside).toBe(beam.underside)
    expectRoundTrip(project, intent('beam.dragBody', { beamId: beam.id, delta: pt(100, 50) }))
  })

  it('joins nothing: a second Beam crossing the first leaves the first untouched (#77 §1 criterion 2)', () => {
    const { project, beam } = oneBeam()
    const applied = expectApplied(
      project,
      intent('beam.create', beamPayload(project, { line: { start: pt(2000, -2000), end: pt(2000, 1000) }, label: 'Beam B-2' }), source(1)),
    )
    const after = beamsOf(applied.project.existingModel)
    expect(after).toHaveLength(2)
    // No Junction, no trim, no re-ordering: the two Beams simply both exist.
    expect(after.find((one) => one.id === beam.id)).toEqual(beam)
    expect(applied.project.existingModel.wallJunctions).toHaveLength(0)
  })

  it('is not moved by moving a Wall, and moves no Wall (#77 §1 criterion 2)', () => {
    const bare = newProject()
    const drawn = expectApplied(
      bare,
      intent('beam.create', beamPayload(bare, { line: { start: pt(0, -50), end: pt(4000, -50) } }), source(1)),
    ).project
    const withWall = oneWall(drawn)
    const beam = beamsOf(withWall.existingModel)[0]!
    const wall = withWall.existingModel.walls[0]!

    const wallMoved = expectApplied(withWall, intent('wall.dragBody', { wallId: wall.id, delta: pt(0, 500) }))
    expect(beamsOf(wallMoved.project.existingModel)[0]).toEqual(beam)
    expectRoundTrip(withWall, intent('wall.dragBody', { wallId: wall.id, delta: pt(0, 500) }))

    const beamMoved = expectApplied(withWall, intent('beam.dragBody', { beamId: beam.id, delta: pt(0, 500) }))
    expect(beamMoved.project.existingModel.walls).toEqual(withWall.existingModel.walls)
    expectRoundTrip(withWall, intent('beam.dragBody', { beamId: beam.id, delta: pt(0, 500) }))
  })
})

describe('the numeric edits of a Beam (#77 §3)', () => {
  it('sets the length from the end that stays put', () => {
    const { project, beam } = oneBeam()
    const fromStart = expectApplied(project, intent('beam.setLength', { beamId: beam.id, length: 1000, keepFixed: 'start' }))
    expect(fromStart.project.existingModel.beams![0]!.line).toEqual({ start: pt(900, -400), end: pt(1900, -400) })
    expectRoundTrip(project, intent('beam.setLength', { beamId: beam.id, length: 1000, keepFixed: 'start' }))

    const fromEnd = expectApplied(project, intent('beam.setLength', { beamId: beam.id, length: 1000, keepFixed: 'end' }))
    expect(fromEnd.project.existingModel.beams![0]!.line).toEqual({ start: pt(2900, -400), end: pt(3900, -400) })
    expectRejection(project, intent('beam.setLength', { beamId: beam.id, length: 0, keepFixed: 'start' }), 'invalid-beam')
  })

  it('sets the width and the justification, which move the faces and never the line', () => {
    const { project, beam } = oneBeam()
    const widened = expectApplied(project, intent('beam.setWidth', { beamId: beam.id, width: 250 }))
    expect(beamsOf(widened.project.existingModel)[0]).toEqual({ ...beam, width: 250 })
    expectRoundTrip(project, intent('beam.setWidth', { beamId: beam.id, width: 250 }))
    expectRejection(project, intent('beam.setWidth', { beamId: beam.id, width: 0 }), 'invalid-beam')

    const justified = expectApplied(project, intent('beam.setJustification', { beamId: beam.id, justification: 'left' }))
    expect(beamsOf(justified.project.existingModel)[0]!.justification).toBe('left')
    expectRoundTrip(project, intent('beam.setJustification', { beamId: beam.id, justification: 'left' }))
  })

  it('renames, and an empty label says only Beam', () => {
    const { project, beam } = oneBeam()
    const renamed = expectApplied(project, intent('beam.rename', { beamId: beam.id, label: 'Beam B-7' }))
    expect(beamsOf(renamed.project.existingModel)[0]!.label).toBe('Beam B-7')
    expectRoundTrip(project, intent('beam.rename', { beamId: beam.id, label: 'Beam B-7' }))

    const cleared = expectApplied(project, intent('beam.rename', { beamId: beam.id, label: '' }))
    expect('label' in beamsOf(cleared.project.existingModel)[0]!).toBe(false)
    expectRoundTrip(project, intent('beam.rename', { beamId: beam.id, label: '' }))
  })
})

describe('the four Vertical Extent boxes of a Beam (#77 §3 criterion 8)', () => {
  // The issue's own Beam: 2 160 to 2 460, 300 deep.
  const standing = (): { project: Project; beam: Beam } => oneBeam({ underside: 2160, height: 300 })

  it('keeps the Underside and restates the Depth when `Top` is retyped', () => {
    const { project, beam } = standing()
    const applied = expectApplied(project, intent('beam.setVerticalExtent', { beamId: beam.id, field: 'top', value: 2500 }))
    const after = beamsOf(applied.project.existingModel)[0]!
    expect(after.underside).toBe(2160)
    expect(after.height).toBe(340)
    expect(beamTop(after)).toBe(2500)
    expectRoundTrip(project, intent('beam.setVerticalExtent', { beamId: beam.id, field: 'top', value: 2500 }))
  })

  it('carries the Depth when `Underside` is retyped, so the band moves', () => {
    const { project, beam } = standing()
    const applied = expectApplied(project, intent('beam.setVerticalExtent', { beamId: beam.id, field: 'base', value: 2100 }))
    const after = beamsOf(applied.project.existingModel)[0]!
    expect(after.underside).toBe(2100)
    expect(after.height).toBe(300)
    expect(beamTop(after)).toBe(2400)
  })

  it('keeps the Underside when `Depth` is retyped', () => {
    const { project, beam } = standing()
    const raised = expectApplied(project, intent('beam.setVerticalExtent', { beamId: beam.id, field: 'top', value: 2500 }))
    const applied = expectApplied(raised.project, intent('beam.setVerticalExtent', { beamId: beam.id, field: 'height', value: 300 }))
    const after = beamsOf(applied.project.existingModel)[0]!
    expect(after.underside).toBe(2160)
    expect(beamTop(after)).toBe(2460)
  })

  it('keeps the Top when the Elevation View’s bottom handle is dragged', () => {
    const { project, beam } = standing()
    const applied = expectApplied(project, intent('beam.setVerticalExtent', { beamId: beam.id, field: 'bottom', value: 2000 }))
    const after = beamsOf(applied.project.existingModel)[0]!
    expect(after.underside).toBe(2000)
    expect(beamTop(after)).toBe(2460)
    expectRoundTrip(project, intent('beam.setVerticalExtent', { beamId: beam.id, field: 'bottom', value: 2000 }))
  })

  it('refuses a Top at or under the Underside and a Depth of nothing', () => {
    const { project, beam } = standing()
    expectRejection(
      project,
      intent('beam.setVerticalExtent', { beamId: beam.id, field: 'top', value: 2160 }),
      'invalid-extent',
    )
    expectRejection(
      project,
      intent('beam.setVerticalExtent', { beamId: beam.id, field: 'height', value: 0 }),
      'invalid-extent',
    )
  })

  it('never moves the reference line', () => {
    const { project, beam } = standing()
    const applied = expectApplied(project, intent('beam.setVerticalExtent', { beamId: beam.id, field: 'base', value: 100 }))
    expect(beamsOf(applied.project.existingModel)[0]!.line).toEqual(beam.line)
  })
})

describe('beam.delete (#77 §1)', () => {
  it('takes the Beam out and leaves every Wall standing', () => {
    const bare = newProject()
    const drawn = expectApplied(bare, intent('beam.create', beamPayload(bare), source(1))).project
    const withWall = oneWall(drawn)
    const beam = beamsOf(withWall.existingModel)[0]!
    const applied = expectRoundTrip(withWall, intent('beam.delete', { beamId: beam.id }))
    expect(beamsOf(applied.project.existingModel)).toHaveLength(0)
    expect(applied.project.existingModel.walls).toHaveLength(1)
  })

  it('drops a Design Option’s demolition record with it, so the Project stays valid', () => {
    const bare = newProject()
    const drawn = expectApplied(bare, intent('beam.create', beamPayload(bare), source(1))).project
    const withOption = expectApplied(drawn, intent('designOption.create', { name: 'Option A' }, ['opt-a'])).project
    const beam = beamsOf(withOption.existingModel)[0]!
    const demolished = expectApplied(
      withOption,
      intent('renovation.demolish', { entityId: beam.id, target: { designOptionId: 'opt-a' } }),
    ).project
    expect(demolished.designOptions![0]!.demolishedIds).toEqual([beam.id])

    // Deleting surveyed work while an Option stands is a correction (#69 §12), and the correction
    // carries the tidying with it: a demolition record can only name Existing work.
    const applied = expectApplied(
      demolished,
      intent('renovation.correctExistingModel', { inner: intent('beam.delete', { beamId: beam.id }) }),
    )
    expect(beamsOf(applied.project.existingModel)).toHaveLength(0)
    expect(applied.project.designOptions![0]!.demolishedIds).toEqual([])
  })

  it('refuses to delete surveyed work straight out from under a Design Option', () => {
    const bare = newProject()
    const drawn = expectApplied(bare, intent('beam.create', beamPayload(bare), source(1))).project
    const withOption = expectApplied(drawn, intent('designOption.create', { name: 'Option A' }, ['opt-a'])).project
    expectRejection(
      withOption,
      intent('beam.delete', { beamId: beamsOf(withOption.existingModel)[0]!.id }),
      'baseline-correction-required',
    )
  })

  it('refuses a Beam the Project does not have', () => {
    expectRejection(newProject(), intent('beam.delete', { beamId: 'beam-none' }), 'unknown-target')
  })
})

describe('the label the tool pre-fills (#77 §3)', () => {
  it('counts the next free `Beam B-n` across every container', () => {
    const bare = newProject()
    expect(nextBeamLabel(bare)).toBe('Beam B-1')
    const first = expectApplied(bare, intent('beam.create', beamPayload(bare), source(1))).project
    expect(nextBeamLabel(first)).toBe('Beam B-2')
    // A gap left by a delete is filled again: the number is spent only while a Beam answers to it.
    const deleted = expectApplied(first, intent('beam.delete', { beamId: beamsOf(first.existingModel)[0]!.id })).project
    expect(nextBeamLabel(deleted)).toBe('Beam B-1')
  })
})
