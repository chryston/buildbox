/**
 * The Design Option half of the catalogue (#69 §2, criterion 9): the types
 * whose handler lives in `./renovationHandlers`. Every other type is the existing suite's, and one
 * that no handler holds is answered by `applyIntent` with the rejection any unknown type gets.
 */
import { describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../../domain/testing'
import roomsFixture from '../../../fixtures/domain/v7/rooms.json?raw'
import type { Acknowledgement, DesignOption, Project } from '../../domain'
import { validateProject } from '../../domain'
import { canonicalJson } from '../../lib'
import { applyIntent, applyPatches, intentIdCount, intentLabel, previewIntent } from '../index'
import { intent } from '../testing'

const envelope = { project: currentSchemaOf((JSON.parse(roomsFixture) as { project: unknown }).project, 7) }

const option = (id: string, name: string): DesignOption => ({
  id,
  name,
  demolishedIds: [],
  proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] },
})

/** A decision about the crossing of `wall-1` and `wall-2`, made inside one Option. */
const ack = (id: string, designOptionId: string | null): Acknowledgement => ({
  id,
  warningType: 'wall_crossing',
  subjectIds: ['wall-1', 'wall-2'],
  designOptionId,
  signature: '8db57272e5b2adb2',
  note: '',
  acknowledgedAt: '2026-11-22T00:00:00.000Z',
})

/** `Renovation edits` with two Options, each holding one decision of its own. */
function project(): Project {
  return {
    ...envelope.project,
    designOptions: [option('option-a', 'Option A'), option('option-b', 'Option B')],
    warningAcknowledgements: [ack('ack-1', null), ack('ack-2', 'option-a'), ack('ack-3', 'option-b')],
  }
}

describe('designOption.create', () => {
  it('gives a Project with no Options an Option A, then an Option B', () => {
    const bare: Project = { ...envelope.project, designOptions: undefined }
    const first = applyIntent(bare, intent('designOption.create', { name: 'Option A' }, ['opt-a']))
    if (!first.ok) throw new Error(JSON.stringify(first.problems))
    const second = applyIntent(first.project, intent('designOption.create', { name: 'Option B' }, ['opt-b']))
    if (!second.ok) throw new Error(JSON.stringify(second.problems))
    expect(second.project.designOptions?.map((entry) => [entry.id, entry.name])).toEqual([
      ['opt-a', 'Option A'],
      ['opt-b', 'Option B'],
    ])
    // An Option starts as a copy of nothing: the Existing Model is what every Option starts from.
    expect(second.project.designOptions?.[1]?.proposed).toEqual({
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
      placedItems: [],
    })
    expect(second.project.designOptions?.[1]?.demolishedIds).toEqual([])
    expect(validateProject(second.project).ok).toBe(true)
    expect(intentIdCount('designOption.create')).toBe(1)
    expect(intentLabel('designOption.create')).toBe('New Design Option')
  })

  it('refuses a second Option under a name one already answers to', () => {
    const result = applyIntent(project(), intent('designOption.create', { name: 'Option A' }, ['opt-c']))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('option-blocked')
    expect(result.problems[0]?.message).toBe('An option called "Option A" already exists.')
    // The fold is the validator's (#69 §4): `option a` is the same name to a person reading a card.
    const folded = applyIntent(project(), intent('designOption.create', { name: '  option a  ' }, ['opt-c']))
    expect(folded.ok).toBe(false)
    if (folded.ok) return
    expect(folded.problems[0]?.message).toBe('An option called "Option A" already exists.')
    const blank = applyIntent(project(), intent('designOption.create', { name: '   ' }, ['opt-c']))
    expect(blank.ok).toBe(false)
    if (blank.ok) return
    expect(blank.problems[0]?.message).toBe('A Design Option needs a name.')
  })
})

describe('designOption.rename', () => {
  it('moves the name and nothing else', () => {
    const before = project()
    const result = applyIntent(before, intent('designOption.rename', { optionId: 'option-b', name: 'Open plan' }))
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    expect(result.project.designOptions?.map((entry) => entry.name)).toEqual(['Option A', 'Open plan'])
    expect(canonicalJson(result.project.designOptions?.[1]?.proposed)).toBe(
      canonicalJson(before.designOptions?.[1]?.proposed),
    )
    // The id is what every record is owned by, so none of them is rewritten.
    expect(result.project.warningAcknowledgements.map((record) => record.designOptionId)).toEqual([
      null,
      'option-a',
      'option-b',
    ])
  })

  it('blocks a name another Option answers to, and an unknown Option', () => {
    const taken = applyIntent(project(), intent('designOption.rename', { optionId: 'option-b', name: 'option a' }))
    expect(taken.ok).toBe(false)
    if (taken.ok) return
    expect(taken.code).toBe('option-blocked')
    expect(taken.problems[0]?.message).toBe('An option called "Option A" already exists.')
    const long = applyIntent(project(), intent('designOption.rename', { optionId: 'option-b', name: 'x'.repeat(61) }))
    expect(long.ok).toBe(false)
    if (long.ok) return
    expect(long.problems[0]?.message).toBe('A Design Option name is at most 60 characters.')
    const gone = applyIntent(project(), intent('designOption.rename', { optionId: 'option-z', name: 'Third' }))
    expect(gone.ok).toBe(false)
    if (gone.ok) return
    expect(gone.code).toBe('unknown-target')
  })

  it('trims the name it is given, the way a Floor rename does', () => {
    const result = applyIntent(project(), intent('designOption.rename', { optionId: 'option-b', name: '  Open plan  ' }))
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    expect(result.project.designOptions?.[1]?.name).toBe('Open plan')
    expect(validateProject(result.project).ok).toBe(true)
  })
})

describe('designOption.delete', () => {
  it('lists what the Option holds before it goes', () => {
    const { review, rejection } = previewIntent(project(), intent('designOption.delete', { optionId: 'option-b' }))
    expect(rejection).toBeNull()
    expect(review).toEqual({
      kind: 'delete-design-option',
      optionId: 'option-b',
      optionName: 'Option B',
      counts: {
        walls: 0,
        wallJunctions: 0,
        openings: 0,
        rooms: 0,
        placedItems: 0,
        demolished: 0,
        acknowledgements: 1,
        // No saved view is looking through Option B in this fixture (#70 §1).
        views: 0,
      },
      viewNames: [],
      message: 'Delete Option B and everything it proposes?',
    })
  })

  it('removes only its records, and leaves the Existing Model and Option A byte-identical', () => {
    const before = project()
    const [optionA, optionB] = before.designOptions as [DesignOption, DesignOption]
    const withWork: Project = {
      ...before,
      designOptions: [
        optionA,
        {
          ...optionB,
          demolishedIds: ['wall-2'],
          proposed: { ...optionB.proposed, walls: [{ id: 'wall-9', floorId: 'floor-0' } as never] },
        },
      ],
    }
    const result = applyIntent(withWork, intent('designOption.delete', { optionId: 'option-b' }))
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    const after = result.project
    expect(after.designOptions?.map((entry) => entry.id)).toEqual(['option-a'])
    // The Existing Model, byte for byte, and the Option nobody touched, byte for byte.
    expect(canonicalJson(after.existingModel)).toBe(canonicalJson(withWork.existingModel))
    expect(canonicalJson(after.designOptions?.[0])).toBe(canonicalJson(withWork.designOptions?.[0]))
    expect(canonicalJson(after.floors)).toBe(canonicalJson(withWork.floors))
    // Its own decision goes with it; the Project-wide one and Option A's stay.
    expect(after.warningAcknowledgements.map((record) => record.id)).toEqual(['ack-1', 'ack-2'])
    expect(validateProject(after).ok).toBe(true)
  })

  it('brings the whole Option back on one undo', () => {
    const before = project()
    const result = applyIntent(before, intent('designOption.delete', { optionId: 'option-b' }))
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    expect(canonicalJson(applyPatches(result.project, result.inversePatches))).toBe(canonicalJson(before))
  })

  it('refuses an Option that is not there', () => {
    const result = applyIntent(project(), intent('designOption.delete', { optionId: 'option-z' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unknown-target')
  })
})
