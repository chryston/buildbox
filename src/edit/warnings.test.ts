/**
 * Acknowledging a warning is an edit like any other (#66 criteria 3 and 4).
 *
 * Two things make that more than a slogan. An acknowledgement is Project content, so it
 * travels with the patches of the step that made it — one undo, not two. And it cannot
 * outlive what it was about: the pruning of a stale record happens inside the same producer
 * as the handler, so deleting a Wall takes its acknowledgement with it and one undo brings
 * both back, note included.
 */
import { describe, expect, it } from 'vitest'
import type { Project, Wall } from '../domain'
import { warningKey } from '../domain'
import { deriveWarnings } from '../derive'
import { applyIntent, applyPatches, previewIntent } from './apply'
import { basicProject, idSource, intent, NOW } from './testing'

const FLOOR = 'floor-main'

const wall = (id: string, ref: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id,
  ref,
  floorId: FLOOR,
  line: { kind: 'line', start: { x: ax, y: ay }, end: { x: bx, y: by } },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

/** W-2 east–west with W-5 square through it at x = 2000, and nothing joining them. */
function crossing(): Project {
  const base = basicProject()
  return {
    ...base,
    existingModel: {
      ...base.existingModel,
      // Lift the Placed Items off y = 0, where these Walls run: the #76 item-into-wall producer
      // would otherwise answer beside the one wall_crossing this fixture is about.
      placedItems: base.existingModel.placedItems.map((placed) => ({ ...placed, translation: { x: placed.translation.x, y: placed.translation.y + 2000 } })),
      walls: [wall('wall-2', 'W-2', 0, 0, 4000, 0), wall('wall-5', 'W-5', 2000, -500, 2000, 500)],
    },
  }
}

/** The one warning `crossing()` produces, addressed the way the strip will address it. */
function subject(project: Project) {
  const warning = deriveWarnings(project, FLOOR, null).warnings[0]!
  return {
    warningType: warning.type,
    subjectIds: warning.subjects.map((entry) => entry.id),
    designOptionId: warning.optionId,
    signature: warning.signature,
  }
}

const acknowledge = (project: Project, note: string) =>
  applyIntent(project, intent('warning.acknowledge', { ...subject(project), note }, idSource('ack')(1)))

const editNote = (project: Project, note: string) => applyIntent(project, intent('warning.editNote', { ...subject(project), note }))

/** #48's undo: the inverse patches of the step, applied to the Project the step produced. */
const undo = (project: Project, inversePatches: readonly object[]): Project =>
  applyPatches(project, inversePatches as Parameters<typeof applyPatches>[1])

describe('acknowledging a warning (#66 criterion 3)', () => {
  it('records the decision, the signature it was made against, and the note', () => {
    const project = crossing()
    const result = acknowledge(project, 'Service run, deliberate')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const records = result.project.warningAcknowledgements
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({
      id: 'ack-1',
      warningType: 'wall_crossing',
      subjectIds: ['wall-2', 'wall-5'],
      designOptionId: null,
      signature: subject(project).signature,
      note: 'Service run, deliberate',
      acknowledgedAt: NOW,
    })
  })

  it('is one undo step, and that step puts the Project back exactly', () => {
    const project = crossing()
    const result = acknowledge(project, 'Service run, deliberate')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patches.length).toBeGreaterThan(0)
    expect(undo(result.project, result.inversePatches)).toEqual(project)
  })

  it('edits its note as one undo step of its own, leaving the decision standing', () => {
    const project = crossing()
    const first = acknowledge(project, 'Service run')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = editNote(first.project, 'Service run, revised after site visit')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.project.warningAcknowledgements[0]?.note).toBe('Service run, revised after site visit')
    expect(second.project.warningAcknowledgements[0]?.signature).toBe(first.project.warningAcknowledgements[0]?.signature)
    expect(second.project.warningAcknowledgements[0]?.acknowledgedAt).toBe(NOW)
    expect(undo(second.project, second.inversePatches)).toEqual(first.project)
  })

  it('overwrites the earlier decision when the same warning is acknowledged again', () => {
    const project = crossing()
    const first = acknowledge(project, 'First answer')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const reopened = { ...project, existingModel: { ...project.existingModel, walls: [wall('wall-2', 'W-2', 0, 0, 4000, 0), wall('wall-5', 'W-5', 2000, -500, 2000, 400)] } }
    const again = acknowledge(reopened, 'Second answer')
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.project.warningAcknowledgements).toHaveLength(1)
    expect(again.project.warningAcknowledgements[0]?.note).toBe('Second answer')
    expect(again.project.warningAcknowledgements[0]?.id).toBe('ack-1')
  })

  it('refuses to put a note on a warning nobody has acknowledged', () => {
    const result = editNote(crossing(), 'Nothing to edit')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unknown-target')
  })

  it('lands on the Floor its subjects stand on', () => {
    const project = crossing()
    const preview = previewIntent(project, intent('warning.acknowledge', { ...subject(project), note: 'x' }, idSource('ack')(1)))
    expect(preview.affected.floorId).toBe(FLOOR)
    expect(preview.affected.view).toBe('plan')
    expect(preview.rejection).toBeNull()
  })
})

describe('an acknowledgement cannot outlive its subject (#66 criterion 4)', () => {
  it('goes with the Wall it was about, in the same Edit Transaction', () => {
    const project = crossing()
    const acknowledged = acknowledge(project, 'Service run, deliberate')
    expect(acknowledged.ok).toBe(true)
    if (!acknowledged.ok) return
    const deleted = applyIntent(acknowledged.project, intent('wall.delete', { wallId: 'wall-5' }))
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.project.warningAcknowledgements).toEqual([])
    expect(deriveWarnings(deleted.project, FLOOR, null).warnings).toEqual([])
  })

  it('comes back with the Wall on one undo, note and signature included', () => {
    const project = crossing()
    const acknowledged = acknowledge(project, 'Service run, deliberate')
    expect(acknowledged.ok).toBe(true)
    if (!acknowledged.ok) return
    const deleted = applyIntent(acknowledged.project, intent('wall.delete', { wallId: 'wall-5' }))
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    const restored = undo(deleted.project, deleted.inversePatches)
    expect(restored).toEqual(acknowledged.project)
    expect(restored.warningAcknowledgements[0]?.note).toBe('Service run, deliberate')
    expect(deriveWarnings(restored, FLOOR, null).warnings).toHaveLength(1)
  })

  it('goes when the last of several subjects goes, and stays while they all live', () => {
    const project = crossing()
    const acknowledged = acknowledge(project, 'Service run, deliberate')
    expect(acknowledged.ok).toBe(true)
    if (!acknowledged.ok) return
    // Thicker W-5 reopens the warning — the signature moves — but both subjects live, so the
    // record and its note stay for the strip to mark as reopened.
    const thickened = applyIntent(acknowledged.project, intent('wall.setThickness', { wallId: 'wall-5', thickness: 120 }))
    expect(thickened.ok).toBe(true)
    if (!thickened.ok) return
    expect(thickened.project.warningAcknowledgements).toHaveLength(1)
    expect(thickened.project.warningAcknowledgements[0]?.note).toBe('Service run, deliberate')
  })

  it('survives an edit nowhere near it, and costs a Project with none nothing', () => {
    const project = crossing()
    const acknowledged = acknowledge(project, 'Service run, deliberate')
    expect(acknowledged.ok).toBe(true)
    if (!acknowledged.ok) return
    const renamed = applyIntent(acknowledged.project, intent('floor.rename', { floorId: FLOOR, name: 'Ground' }))
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.project.warningAcknowledgements).toEqual(acknowledged.project.warningAcknowledgements)
  })

  it('is addressed by the key the engine computes, not by a copy of it', () => {
    const project = crossing()
    const acknowledged = acknowledge(project, 'Service run, deliberate')
    expect(acknowledged.ok).toBe(true)
    if (!acknowledged.ok) return
    const record = acknowledged.project.warningAcknowledgements[0]!
    expect(warningKey(record.warningType, record.subjectIds, record.designOptionId)).toBe(
      warningKey('wall_crossing', ['wall-2', 'wall-5'], null),
    )
  })
})

