/**
 * The shared Design Height and the Clearance Envelope as Edits (#76 §2, §4).
 *
 * Three Intent types, all Project-owned: every Placed Item of the Design moves with the one
 * number, the whole change is one Edit Transaction (one undo), and nothing invalid — a zero
 * height, a self-crossing zone, a no-op — ever enters the model or the history.
 */
import { describe, expect, it } from 'vitest'
import { cutListParts } from '../derive'
import type { ClearanceEnvelope, Project } from '../domain'
import { bannedWordsIn } from '../lib'
import { intentLabel } from './index'
import { basicProject, expectApplied, expectDeterministic, expectRejection, expectRoundTrip, intent } from './testing'

const CABINET = 'design-base-cabinet'
const BED = 'design-bed-king'

const scene = (): Project => basicProject()

const design = (project: Project, id: string) => project.itemDesigns.find((each) => each.id === id)!

const envelope = (x: number, y: number, w: number, h: number): ClearanceEnvelope => ({
  path: {
    start: { x, y },
    segments: [
      { kind: 'line', to: { x: x + w, y } },
      { kind: 'line', to: { x: x + w, y: y + h } },
      { kind: 'line', to: { x, y: y + h } },
      { kind: 'line', to: { x, y } },
    ],
  },
  bottomOffset: 0,
  height: 850,
})

describe('design.setHeight (#76 §2)', () => {
  it('moves a generic Design’s own height, and one undo puts it back', () => {
    const project = scene()
    const before = design(project, BED)
    expect(before.kind === 'generic' && before.height).toBe(500)
    const applied = expectRoundTrip(project, intent('design.setHeight', { itemDesignId: BED, heightMm: 750 }))
    const after = design(applied.project, BED)
    expect(after.kind === 'generic' && after.height).toBe(750)
  })

  it('writes a cabinet’s construction height, and its Cut List follows', () => {
    const project = scene()
    const before = design(project, CABINET)
    if (before.kind !== 'cabinet') throw new Error('the shared cabinet design must be a cabinet')
    expect(before.construction.settings.height).toBe(34.5)
    const partsBefore = cutListParts(before, 2)
    const applied = expectRoundTrip(project, intent('design.setHeight', { itemDesignId: CABINET, heightMm: 40 }))
    const after = design(applied.project, CABINET)
    if (after.kind !== 'cabinet') throw new Error('the Design kept its kind')
    expect(after.construction.settings.height).toBe(40)
    // The Cut List is derived from the construction, so the shared height moving moves it.
    expect(cutListParts(after, 2)).not.toEqual(partsBefore)
  })

  it('is one Transaction for every placement of the shared Design', () => {
    const project = scene()
    const placements = project.existingModel.placedItems.filter((placed) => placed.itemDesignId === CABINET)
    expect(placements).toHaveLength(2)
    const applied = expectRoundTrip(project, intent('design.setHeight', { itemDesignId: CABINET, heightMm: 40 }))
    // One patch set over the one Design: the two placements share it, so nothing per-placement
    // moved and one undo of this Transaction restores both.
    const touched = new Set(applied.patches.flatMap((patch) => patch.path.map(String)))
    expect(touched.has('itemDesigns')).toBe(true)
    expect(touched.has('placedItems')).toBe(false)
    const back = design(applied.project, CABINET)
    expect(back.kind === 'cabinet' && back.construction.settings.height).toBe(40)
  })

  it('refuses a height that is not a positive measurement', () => {
    const project = scene()
    for (const heightMm of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectRejection(project, intent('design.setHeight', { itemDesignId: BED, heightMm }), 'invalid-size')
    }
  })

  it('refuses the height the Design already has', () => {
    const project = scene()
    expectRejection(project, intent('design.setHeight', { itemDesignId: BED, heightMm: 500 }), 'no-change')
    expectRejection(project, intent('design.setHeight', { itemDesignId: CABINET, heightMm: 34.5 }), 'no-change')
  })

  it('is deterministic', () => {
    expectDeterministic(scene(), intent('design.setHeight', { itemDesignId: BED, heightMm: 750 }))
  })
})

describe('design.setClearanceEnvelope and design.removeClearanceEnvelope (#76 §4)', () => {
  it('adds a zone to a Design, and one undo takes it away', () => {
    const project = scene()
    expect(design(project, BED).clearanceEnvelope ?? null).toBeNull()
    const applied = expectRoundTrip(project, intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: envelope(0, 500, 600, 300) }))
    expect(design(applied.project, BED).clearanceEnvelope?.height).toBe(850)
  })

  it('replaces the one envelope a Design already carries', () => {
    const withZone = expectApplied(scene(), intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: envelope(0, 500, 600, 300) })).project
    const next = envelope(0, 500, 600, 400)
    const applied = expectRoundTrip(withZone, intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: next }))
    expect(design(applied.project, BED).clearanceEnvelope?.path.segments[1]).toEqual({ kind: 'line', to: { x: 600, y: 900 } })
  })

  it('reaches every placement, because the zone belongs to the Design', () => {
    const applied = expectApplied(scene(), intent('design.setClearanceEnvelope', { itemDesignId: CABINET, envelope: envelope(0, 24, 24, 12) }))
    const after = design(applied.project, CABINET)
    expect(after.clearanceEnvelope?.height).toBe(850)
    // Both placements of the cabinet share the one zone: nothing per-placement was written.
    expect(applied.project.existingModel.placedItems.filter((placed) => placed.itemDesignId === CABINET && 'clearanceEnvelope' in placed)).toHaveLength(0)
  })

  it('refuses a zone whose shape describes nothing', () => {
    const project = scene()
    const crossed: ClearanceEnvelope = {
      path: {
        start: { x: 0, y: 0 },
        segments: [
          { kind: 'line', to: { x: 600, y: 600 } },
          { kind: 'line', to: { x: 600, y: 0 } },
          { kind: 'line', to: { x: 0, y: 600 } },
          { kind: 'line', to: { x: 0, y: 0 } },
        ],
      },
      bottomOffset: 0,
      height: 850,
    }
    expectRejection(project, intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: crossed }), 'invalid-shape')
  })

  it('refuses a height that is not positive and an offset that is not a number', () => {
    const project = scene()
    expectRejection(project, intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: { ...envelope(0, 500, 600, 300), height: 0 } }), 'invalid-size')
    expectRejection(project, intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: { ...envelope(0, 500, 600, 300), bottomOffset: Number.NaN } }), 'invalid-size')
  })

  it('refuses the zone the Design already has, and a removal there is nothing to remove', () => {
    const project = scene()
    const zone = envelope(0, 500, 600, 300)
    expectRejection(project, intent('design.removeClearanceEnvelope', { itemDesignId: BED }), 'no-change')
    const withZone = expectApplied(project, intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: zone })).project
    expectRejection(withZone, intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: zone }), 'no-change')
  })

  it('removes the zone, and one undo brings it back', () => {
    const withZone = expectApplied(scene(), intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: envelope(0, 500, 600, 300) })).project
    const applied = expectRoundTrip(withZone, intent('design.removeClearanceEnvelope', { itemDesignId: BED }))
    expect(design(applied.project, BED).clearanceEnvelope ?? null).toBeNull()
  })
})

describe('the words of the three Intents (#76)', () => {
  it('labels each one without a banned word', () => {
    const labels = (['design.setHeight', 'design.setClearanceEnvelope', 'design.removeClearanceEnvelope'] as const).map((type) => intentLabel(type))
    expect(labels).toEqual(['Change design height', 'Change clearance envelope', 'Remove clearance envelope'])
    for (const label of labels) expect(bannedWordsIn(label), label).toEqual([])
  })

  it('says why each refusal refused, in words that pass the same scan', () => {
    const project = scene()
    const rejections = [
      expectRejection(project, intent('design.setHeight', { itemDesignId: BED, heightMm: 0 }), 'invalid-size'),
      expectRejection(project, intent('design.setHeight', { itemDesignId: BED, heightMm: 500 }), 'no-change'),
      expectRejection(project, intent('design.setClearanceEnvelope', { itemDesignId: BED, envelope: { ...envelope(0, 500, 600, 300), height: -1 } }), 'invalid-size'),
      expectRejection(project, intent('design.removeClearanceEnvelope', { itemDesignId: BED }), 'no-change'),
    ]
    for (const rejection of rejections) {
      for (const problem of rejection.problems) {
        expect(bannedWordsIn(problem.message), problem.message).toEqual([])
      }
    }
  })
})
