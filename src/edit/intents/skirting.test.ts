/**
 * The Skirting Intents (#78 §1, §3, §4): what one stores, what moves it, what the numbers do.
 *
 * The shape of the record is the acceptance criterion, so it is asserted as a key list rather than
 * field by field: a Skirting holds a host Wall, a side, a range along that Wall, a bottom, a height
 * and a thickness, and nothing else — no faces, no Top, no gaps, no outline. The refusals are
 * asserted by their sentence as well as their code, because the sentence is what the homeowner reads.
 *
 * The numbers are the issue's own: SK-1 at 0–100 given a `Bottom` of 20 stands at 20–120 and is still
 * 100 high (§ criterion 7), and a range that runs past the end of the Wall it is drawn against is
 * refused rather than clipped.
 */
import { describe, expect, it } from 'vitest'
import type { Project, Skirting } from '../../domain'
import { designOptionsOf, skirtingOf, skirtingTop } from '../../domain'
import { pt } from '../../geometry'
import { applyPatches } from '../apply'
import type { PayloadOf } from '../intents'
import { expectApplied, expectRejection, expectRoundTrip, idSource, intent, newProject } from '../testing'

const source = idSource('skirting')
const wallSource = idSource('wall')
const floorIdOf = (project: Project): string => project.floors[0]!.id

/** A 4 000 mm Wall along y = 0, the face every Skirting in this file is drawn against. */
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
      wallSource(1),
    ),
  ).project
}

const wallIdOf = (project: Project): string => project.existingModel.walls[0]!.id

/** The payload the Skirting tool sends for the whole kitchen face of the Wall, 0–100 at 15 mm. */
function skirtingPayload(project: Project, over: Partial<PayloadOf<'skirting.create'>> = {}): PayloadOf<'skirting.create'> {
  return {
    floorId: floorIdOf(project),
    hostWallId: wallIdOf(project),
    side: 'left',
    start: 0,
    end: 4000,
    bottom: 0,
    height: 100,
    thickness: 15,
    label: 'Skirting SK-1',
    ...over,
  }
}

/** One Project with one Wall and one Skirting drawn against it, and the Skirting itself. */
function oneSkirting(over: Partial<PayloadOf<'skirting.create'>> = {}): { project: Project; skirting: Skirting } {
  const drawn = oneWall(newProject())
  const applied = expectApplied(drawn, intent('skirting.create', skirtingPayload(drawn, over), source(1)))
  return { project: applied.project, skirting: skirtingOf(applied.project.existingModel)[0]! }
}

describe('skirting.create (#78 §1)', () => {
  it('stores the host, the side, the range and the three numbers, and nothing else', () => {
    const { skirting } = oneSkirting()
    // The whole of §1 as one assertion: the face, the Top, the outline and the gaps are derived, so a
    // record that carried one of them would be a second answer to the same question. The Layer is the
    // one extra the tool's saved view files it on (#71 §2, #78 §7).
    expect(Object.keys(skirting).sort()).toEqual([
      'bottom',
      'drawingLayerId',
      'end',
      'floorId',
      'height',
      'hostWallId',
      'id',
      'label',
      'side',
      'start',
      'thickness',
    ])
    expect(skirting.start).toBe(0)
    expect(skirting.end).toBe(4000)
    expect(skirting.side).toBe('left')
    expect(skirting.thickness).toBe(15)
    expect(skirtingTop(skirting)).toBe(100)
  })

  it('accepts a Skirting recorded from below the Floor Datum', () => {
    const { skirting } = oneSkirting({ bottom: -50 })
    expect(skirting.bottom).toBe(-50)
    expect(skirtingTop(skirting)).toBe(50)
  })

  it('refuses an empty range, saying what a range has to do', () => {
    const drawn = oneWall(newProject())
    const rejection = expectRejection(
      drawn,
      intent('skirting.create', skirtingPayload(drawn, { start: 2000, end: 2000 }), source(1)),
      'invalid-skirting',
    )
    expect(rejection.problems[0]!.message).toContain('further along the Wall')
  })

  it('refuses a range that runs past the end of the Wall it is drawn against', () => {
    const drawn = oneWall(newProject())
    const rejection = expectRejection(
      drawn,
      intent('skirting.create', skirtingPayload(drawn, { end: 4200 }), source(1)),
      'invalid-skirting',
    )
    expect(rejection.problems[0]!.path).toMatch(/\.end$/)
    expect(rejection.problems[0]!.message).toContain('4000 mm long')
  })

  it('refuses a Skirting with no height, and one with no thickness', () => {
    const drawn = oneWall(newProject())
    expectRejection(drawn, intent('skirting.create', skirtingPayload(drawn, { height: 0 }), source(1)), 'invalid-skirting')
    const thin = expectRejection(
      drawn,
      intent('skirting.create', skirtingPayload(drawn, { thickness: 0 }), source(1)),
      'invalid-skirting',
    )
    expect(thin.problems[0]!.message).toContain('off the face')
  })

  it('refuses a Wall that is not in this Project, and a Floor that is not either', () => {
    const drawn = oneWall(newProject())
    expectRejection(
      drawn,
      intent('skirting.create', skirtingPayload(drawn, { hostWallId: 'wall-none' }), source(1)),
      'unknown-target',
    )
    expectRejection(
      drawn,
      intent('skirting.create', skirtingPayload(drawn, { floorId: 'floor-none' }), source(1)),
      'unknown-target',
    )
  })

  it('refuses a Skirting on a Floor its Wall is not on', () => {
    const drawn = expectApplied(oneWall(newProject()), intent('floor.create', { name: 'Floor 2' }, ['floor-2', 'view-2'])).project
    expectRejection(
      drawn,
      intent('skirting.create', skirtingPayload(drawn, { floorId: 'floor-2' }), source(1)),
      'unknown-target',
    )
  })

  it('proposes the Skirting in the Design Option it was drawn in', () => {
    const drawn = oneWall(newProject())
    const withOption = expectApplied(drawn, intent('designOption.create', { name: 'Option A' }, ['opt-a'])).project
    const applied = expectApplied(
      withOption,
      intent('skirting.create', { ...skirtingPayload(withOption), target: { designOptionId: 'opt-a' } }, source(1)),
    )
    const [skirting] = skirtingOf(applied.project.designOptions![0]!.proposed)
    expect(skirting!.predecessorIds).toEqual([])
    expect(skirtingOf(applied.project.existingModel)).toHaveLength(0)
    expectRoundTrip(withOption, intent('skirting.create', { ...skirtingPayload(withOption), target: { designOptionId: 'opt-a' } }, source(2)))
  })
})

describe('the range (#78 §3, §4)', () => {
  it('moves one end and leaves the other, the face and the section alone', () => {
    const { project, skirting } = oneSkirting()
    const applied = expectRoundTrip(project, intent('skirting.dragEndpoint', { skirtingId: skirting.id, end: 'end', to: 3200 }))
    const moved = skirtingOf(applied.project.existingModel)[0]!
    expect(moved.start).toBe(0)
    expect(moved.end).toBe(3200)
    expect(moved.side).toBe('left')
    expect(moved.thickness).toBe(15)
  })

  it('refuses an end dragged past the end of the Wall', () => {
    const { project, skirting } = oneSkirting()
    expectRejection(
      project,
      intent('skirting.dragEndpoint', { skirtingId: skirting.id, end: 'end', to: 4100 }),
      'invalid-skirting',
    )
  })

  it('refuses an end dragged past the other end', () => {
    const { project, skirting } = oneSkirting()
    expectRejection(
      project,
      intent('skirting.dragEndpoint', { skirtingId: skirting.id, end: 'start', to: 4000 }),
      'invalid-skirting',
    )
  })

  it('sets `Start` and `End` together as one commit', () => {
    const { project, skirting } = oneSkirting()
    const applied = expectRoundTrip(project, intent('skirting.setRange', { skirtingId: skirting.id, start: 600, end: 2400 }))
    const moved = skirtingOf(applied.project.existingModel)[0]!
    expect(moved.start).toBe(600)
    expect(moved.end).toBe(2400)
  })

  it('refuses a range whose ends are the other way round', () => {
    const { project, skirting } = oneSkirting()
    expectRejection(project, intent('skirting.setRange', { skirtingId: skirting.id, start: 3000, end: 1000 }), 'invalid-skirting')
  })
})

describe('the face (#78 §3)', () => {
  it('flips to the other face of the same Wall in one undo step', () => {
    const { project, skirting } = oneSkirting()
    const applied = expectRoundTrip(project, intent('skirting.flipSide', { skirtingId: skirting.id }))
    const flipped = skirtingOf(applied.project.existingModel)[0]!
    expect(flipped.side).toBe('right')
    expect(flipped.hostWallId).toBe(skirting.hostWallId)
    expect(flipped.start).toBe(0)
    expect(flipped.end).toBe(4000)
  })

  it('duplicates to the other side as a second element with its own label', () => {
    const { project, skirting } = oneSkirting()
    const applied = expectRoundTrip(project, intent('skirting.duplicateOtherSide', { skirtingId: skirting.id }, source(1)))
    const all = skirtingOf(applied.project.existingModel)
    expect(all).toHaveLength(2)
    const copy = all.find((entry) => entry.id !== skirting.id)!
    expect(copy.side).toBe('right')
    expect(copy.hostWallId).toBe(skirting.hostWallId)
    expect(copy.start).toBe(0)
    expect(copy.end).toBe(4000)
    expect(copy.bottom).toBe(0)
    expect(copy.height).toBe(100)
    expect(copy.thickness).toBe(15)
    expect(copy.label).toBe('Skirting SK-2')
    // Undoing the duplicate leaves the one Skirting it started with, exactly.
    const undone = applyPatches(applied.project, applied.inversePatches)
    expect(skirtingOf(undone.existingModel)).toEqual([skirting])
  })
})

describe('the numbers (#78 §4)', () => {
  it('moves the Skirting when `Bottom` changes and keeps its Height', () => {
    const { project, skirting } = oneSkirting()
    // § criterion 7: 0 → 20 puts SK-1 at 20–120, still 100 high.
    const applied = expectRoundTrip(project, intent('skirting.setBottom', { skirtingId: skirting.id, bottom: 20 }))
    const moved = skirtingOf(applied.project.existingModel)[0]!
    expect(moved.bottom).toBe(20)
    expect(moved.height).toBe(100)
    expect(skirtingTop(moved)).toBe(120)
  })

  it('keeps the Bottom when `Height` changes', () => {
    const { project, skirting } = oneSkirting()
    const applied = expectRoundTrip(project, intent('skirting.setHeight', { skirtingId: skirting.id, height: 901 }))
    const grown = skirtingOf(applied.project.existingModel)[0]!
    expect(grown.bottom).toBe(0)
    expect(grown.height).toBe(901)
    expect(skirtingTop(grown)).toBe(901)
  })

  it('refuses a Height of 0 and a Thickness of 0', () => {
    const { project, skirting } = oneSkirting()
    expectRejection(project, intent('skirting.setHeight', { skirtingId: skirting.id, height: 0 }), 'invalid-skirting')
    expectRejection(project, intent('skirting.setThickness', { skirtingId: skirting.id, thickness: 0 }), 'invalid-skirting')
  })

  it('moves the body off the face when `Thickness` changes', () => {
    const { project, skirting } = oneSkirting()
    const applied = expectRoundTrip(project, intent('skirting.setThickness', { skirtingId: skirting.id, thickness: 25 }))
    expect(skirtingOf(applied.project.existingModel)[0]!.thickness).toBe(25)
  })
})

describe('the Vertical Extent boxes (#78 §4)', () => {
  it('moves the Skirting and keeps the Height from `base` and `bottom`', () => {
    const { project, skirting } = oneSkirting()
    for (const field of ['base', 'bottom'] as const) {
      const applied = expectApplied(project, intent('skirting.setVerticalExtent', { skirtingId: skirting.id, field, value: 20 }))
      const moved = skirtingOf(applied.project.existingModel)[0]!
      expect(`${field} → ${moved.bottom}-${skirtingTop(moved)}`).toBe(`${field} → 20-120`)
      expect(moved.height).toBe(100)
    }
  })

  it('restates the Height from `top` and keeps the Bottom', () => {
    const { project, skirting } = oneSkirting({ bottom: 20 })
    const applied = expectRoundTrip(project, intent('skirting.setVerticalExtent', { skirtingId: skirting.id, field: 'top', value: 170 }))
    const grown = skirtingOf(applied.project.existingModel)[0]!
    expect(grown.bottom).toBe(20)
    expect(grown.height).toBe(150)
  })

  it('changes the Height from `height` and keeps the Bottom', () => {
    const { project, skirting } = oneSkirting({ bottom: 20 })
    const applied = expectRoundTrip(project, intent('skirting.setVerticalExtent', { skirtingId: skirting.id, field: 'height', value: 150 }))
    expect(skirtingTop(skirtingOf(applied.project.existingModel)[0]!)).toBe(170)
  })

  it('refuses a Top below the Bottom', () => {
    const { project, skirting } = oneSkirting({ bottom: 20 })
    expectRejection(project, intent('skirting.setVerticalExtent', { skirtingId: skirting.id, field: 'top', value: 20 }), 'invalid-extent')
  })
})

describe('the label and delete (#78 §4)', () => {
  it('renames, and an empty label says only `Skirting`', () => {
    const { project, skirting } = oneSkirting()
    const renamed = expectApplied(project, intent('skirting.rename', { skirtingId: skirting.id, label: 'Kitchen skirting' })).project
    expect(skirtingOf(renamed.existingModel)[0]!.label).toBe('Kitchen skirting')
    const cleared = expectRoundTrip(renamed, intent('skirting.rename', { skirtingId: skirting.id, label: '' }))
    expect('label' in skirtingOf(cleared.project.existingModel)[0]!).toBe(false)
  })

  it('refuses a label over 80 characters', () => {
    const { project, skirting } = oneSkirting()
    expectRejection(project, intent('skirting.rename', { skirtingId: skirting.id, label: 'x'.repeat(81) }), 'invalid-skirting')
  })

  it('deletes the Skirting and nothing else', () => {
    const { project, skirting } = oneSkirting()
    const applied = expectRoundTrip(project, intent('skirting.delete', { skirtingId: skirting.id }))
    expect(skirtingOf(applied.project.existingModel)).toEqual([])
    expect(applied.project.existingModel.walls).toHaveLength(1)
  })

  it('drops a Design Option’s demolition record with it, so the Project stays valid', () => {
    const { project, skirting } = oneSkirting()
    const withOption = expectApplied(project, intent('designOption.create', { name: 'Option A' }, ['opt-a'])).project
    const demolished = expectApplied(
      withOption,
      intent('renovation.demolish', { entityId: skirting.id, target: { designOptionId: 'opt-a' } }),
    ).project
    expect(demolished.designOptions![0]!.demolishedIds).toEqual([skirting.id])

    // Deleting surveyed work while an Option stands is a correction (#69 §12), and the correction
    // carries the tidying with it: a demolition record can only name Existing work.
    const applied = expectApplied(
      demolished,
      intent('renovation.correctExistingModel', { inner: intent('skirting.delete', { skirtingId: skirting.id }) }),
    )
    expect(skirtingOf(applied.project.existingModel)).toEqual([])
    expect(applied.project.designOptions![0]!.demolishedIds).toEqual([])
  })

  it('refuses to delete surveyed work straight out from under a Design Option', () => {
    const { project, skirting } = oneSkirting()
    const withOption = expectApplied(project, intent('designOption.create', { name: 'Option A' }, ['opt-a'])).project
    expectRejection(
      withOption,
      intent('skirting.delete', { skirtingId: skirting.id }),
      'baseline-correction-required',
    )
  })

  it('refuses to delete a Skirting that is not there', () => {
    expectRejection(oneWall(newProject()), intent('skirting.delete', { skirtingId: 'skirting-none' }), 'unknown-target')
  })
})

describe('the Design Option a Skirting stands in (#78 §5)', () => {
  it('leaves the survey alone when an Option proposes one', () => {
    const drawn = oneWall(newProject())
    const withOption = expectApplied(drawn, intent('designOption.create', { name: 'Option A' }, ['opt-a'])).project
    const applied = expectApplied(
      withOption,
      intent('skirting.create', { ...skirtingPayload(withOption), target: { designOptionId: 'opt-a' } }, source(1)),
    )
    const option = designOptionsOf(applied.project)[0]!
    expect(skirtingOf(option.proposed)).toHaveLength(1)
    expect(skirtingOf(applied.project.existingModel)).toHaveLength(0)
  })
})
