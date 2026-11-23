/**
 * The saved-view settings of #70 §1 and §9: this file runs in the
 * `renovation` project (`npm run test:renovation`) and nowhere else.
 *
 * The three things these tests hold: each setting is **one** Edit Transaction with **one** inverse
 * (criterion 2's data side), a Display that needs an Option the view does not have is **writable**
 * (it is §6's error state, not an import error), and deleting an Option nulls every view that named
 * it in the **same** transaction, so one undo brings the Option back with its references
 * (criterion 11).
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import roomsFixture from '../../../fixtures/domain/v7/rooms.json?raw'
import type { DesignOption, PlanView, Project } from '../../domain'
import { validateProject, viewDesignOptionId, viewRenovationDisplay } from '../../domain'
import { canonicalJson } from '../../lib'
import { applyIntent, applyPatches, intentLabel, previewIntent } from '../index'
import type { Applied, Intent, IntentType, PayloadOf } from '../intents'
import { intent } from '../testing'

const envelope = JSON.parse(roomsFixture) as { project: Project }

const option = (id: string, name: string): DesignOption => ({
  id,
  name,
  demolishedIds: [],
  proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] },
})

/**
 * The fixture's two Floors and their two default views, plus two Options. `view-1` (Mezzanine) is
 * pointed at `option-a` on the Combined Display, so a Project here always has a view that names an
 * Option and one that does not.
 */
function project(): Project {
  const views: PlanView[] = envelope.project.views.map((view) =>
    view.id === 'view-1'
      ? { ...view, designOptionId: 'option-a', renovationDisplay: 'combined' }
      : { ...view, designOptionId: null, renovationDisplay: 'existing' },
  )
  return { ...envelope.project, views, designOptions: [option('option-a', 'Option A'), option('option-b', 'Option B')] }
}

function apply<T extends IntentType>(start: Project, type: T, payload: PayloadOf<T>, ids: string[] = []) {
  const result = applyIntent(start, intent(type, payload, ids) as Intent)
  if (!result.ok) throw new Error(`${type} refused: ${result.code} ${JSON.stringify(result.problems)}`)
  return result
}

function reject(start: Project, type: IntentType, payload: PayloadOf, ids: string[] = []): string {
  const result = applyIntent(start, intent(type, payload, ids) as Intent)
  if (result.ok) throw new Error(`${type} was accepted`)
  return result.code
}

/** The undo of one applied Intent, applied to the Project it produced. */
function undo(start: Project, applied: Applied): Project {
  const back = applyPatches(applied.project, applied.inversePatches)
  expect(canonicalJson(back)).toBe(canonicalJson(start))
  return back
}

describe('view.setDesignOption (#70 §1)', () => {
  it('is one transaction that writes one field, and one undo that puts it back', () => {
    const start = project()
    const applied = apply(start, 'view.setDesignOption', { viewId: 'view-0', designOptionId: 'option-b' })
    expect(applied.patches).toHaveLength(1)
    expect(viewDesignOptionId(applied.project.views[0]!)).toBe('option-b')
    // The Display is a separate command and is untouched by this one.
    expect(viewRenovationDisplay(applied.project.views[0]!)).toBe('existing')
    // Undoing it has to land the user back on the view whose setting it puts right (#70 §9).
    expect(applied.affected).toMatchObject({ viewId: 'view-0', floorId: 'floor-0', view: 'plan' })
    undo(start, applied)
  })

  it('takes null as a choice — `— no Design Option —` — and reads back as none', () => {
    const start = project()
    const applied = apply(start, 'view.setDesignOption', { viewId: 'view-1', designOptionId: null })
    expect(applied.project.views[1]!.designOptionId).toBe(null)
    expect(validateProject(applied.project).ok).toBe(true)
    undo(start, applied)
  })

  it('refuses an Option this Project does not have, and changes nothing', () => {
    const start = project()
    expect(reject(start, 'view.setDesignOption', { viewId: 'view-0', designOptionId: 'option-gone' })).toBe('unknown-target')
    expect(canonicalJson(start)).toBe(canonicalJson(project()))
  })

  it('refuses a view that does not exist', () => {
    expect(reject(project(), 'view.setDesignOption', { viewId: 'view-gone', designOptionId: null })).toBe('unknown-target')
  })

  it('is no transaction at all when the view already looks through that Option', () => {
    // Criterion 2 counts one transaction per change: clicking the Option that is already chosen
    // must not put a step in the undo stack.
    expect(reject(project(), 'view.setDesignOption', { viewId: 'view-1', designOptionId: 'option-a' })).toBe('no-change')
  })

  it('spends no IDs and carries the label the card extends', () => {
    expect(intentLabel('view.setDesignOption')).toBe('Set Design Option')
    expect(intentLabel('view.setRenovationDisplay')).toBe('Set Renovation Display')
    const start = project()
    // An Intent handed more IDs than it needs is accepted and spends none of them.
    const applied = apply(start, 'view.setDesignOption', { viewId: 'view-0', designOptionId: 'option-a' }, ['spare-1'])
    expect(applied.project.views[0]!.designOptionId).toBe('option-a')
  })
})

describe('view.setRenovationDisplay (#70 §1, §6)', () => {
  it('writes each of the four as one transaction, and one undo per step', () => {
    // `view-0` starts on Existing and `view-1` on Combined, so each of the four is a real change
    // for one of them — a Display that is already the one drawn is `no-change`, tested below.
    for (const [viewId, display] of [
      ['view-0', 'demolition'],
      ['view-0', 'proposed'],
      ['view-0', 'combined'],
      ['view-1', 'existing'],
    ] as const) {
      const start = project()
      const applied = apply(start, 'view.setRenovationDisplay', { viewId, renovationDisplay: display })
      expect(applied.patches).toHaveLength(1)
      expect(viewRenovationDisplay(applied.project.views[viewId === 'view-0' ? 0 : 1]!)).toBe(display)
      undo(start, applied)
    }
  })

  it('accepts a Display that needs an Option this view does not have, and the result validates', () => {
    // §6: this pairing is the error state the canvas draws, so it has to be reachable by choosing
    // the card — refusing it here would make the banner impossible to show.
    for (const display of ['demolition', 'proposed', 'combined'] as const) {
      const applied = apply(project(), 'view.setRenovationDisplay', { viewId: 'view-0', renovationDisplay: display })
      expect(viewRenovationDisplay(applied.project.views[0]!)).toBe(display)
      expect(validateProject(applied.project).ok).toBe(true)
    }
  })

  it('is no transaction when the Display is already the one drawn', () => {
    expect(reject(project(), 'view.setRenovationDisplay', { viewId: 'view-1', renovationDisplay: 'combined' })).toBe('no-change')
  })
})

describe('a new Plan View copies the view it was made from (#70 §1)', () => {
  it('carries the Option and Display of `fromViewId`', () => {
    const applied = apply(project(), 'view.create', { floorId: 'floor-0', name: 'Evening', fromViewId: 'view-1' }, ['view-new'])
    const created = applied.project.views.find((view) => view.id === 'view-new')!
    expect([created.designOptionId, created.renovationDisplay]).toEqual(['option-a', 'combined'])
    expect(created.isDefault).toBe(false)
  })

  it('falls back to the Floor’s default view, and to the Existing Model with no source at all', () => {
    const byFloor = apply(project(), 'view.create', { floorId: 'floor-1', name: 'Night' }, ['view-2'])
    expect([byFloor.project.views[2]!.designOptionId, byFloor.project.views[2]!.renovationDisplay]).toEqual([
      'option-a',
      'combined',
    ])
    const byGoneView = apply(project(), 'view.create', { floorId: 'floor-0', name: 'Morning', fromViewId: 'view-gone' }, ['view-3'])
    expect([byGoneView.project.views[2]!.designOptionId, byGoneView.project.views[2]!.renovationDisplay]).toEqual([
      null,
      'existing',
    ])
  })

  it('is unchanged when the payload carries no `fromViewId` and the Floor’s default is the Existing Model', () => {
    const applied = apply(project(), 'view.create', { floorId: 'floor-0', name: 'Evening' }, ['view-new'])
    const created = applied.project.views.find((view) => view.id === 'view-new')!
    expect([created.designOptionId, created.renovationDisplay]).toEqual([null, 'existing'])
  })
})

describe('floor.duplicate carries the source Floor’s view settings (#70 §1)', () => {
  const payload = { name: 'Kitchen level 2', toIndex: 1, placedItemIds: [], includePlanImage: false }

  it('gives the duplicate the Option and Display the original was being looked at through', () => {
    const applied = apply(project(), 'floor.duplicate', { floorId: 'floor-1', ...payload }, ['floor-new', 'view-new'])
    const copy = applied.project.views.find((view) => view.id === 'view-new')!
    expect([copy.designOptionId, copy.renovationDisplay]).toEqual(['option-a', 'combined'])
  })

  it('gives a duplicate of an Existing-Model Floor the Existing Model', () => {
    const applied = apply(project(), 'floor.duplicate', { floorId: 'floor-0', ...payload }, ['floor-new', 'view-new'])
    const copy = applied.project.views.find((view) => view.id === 'view-new')!
    expect([copy.designOptionId, copy.renovationDisplay]).toEqual([null, 'existing'])
  })
})

describe('deleting an Option releases every view that named it (#70 criterion 11)', () => {
  /** Both saved views look through `option-a`, which is the criterion's "used by two saved views". */
  function twoViews(): Project {
    const start = project()
    return {
      ...start,
      views: start.views.map((view) => ({ ...view, designOptionId: 'option-a' })),
    }
  }

  it('nulls both in the same transaction, and one undo restores the Option and both references', () => {
    const start = twoViews()
    const applied = apply(start, 'designOption.delete', { optionId: 'option-a' })
    expect(applied.project.designOptions?.map((each) => each.id)).toEqual(['option-b'])
    expect(applied.project.views.map((view) => view.designOptionId)).toEqual([null, null])
    // One transaction: the Option, its acknowledgements and the two views are one patch set, and
    // its inverse is the whole of the way back.
    undo(start, applied)
  })

  it('reports the affected views in the review, by name, in Project order', () => {
    const preview = previewReview(twoViews())
    expect(preview.counts.views).toBe(2)
    expect(preview.viewNames).toEqual(['Floor 1', 'Mezzanine'])
  })

  it('leaves a view that never named it byte-identical', () => {
    const start = project()
    const applied = apply(start, 'designOption.delete', { optionId: 'option-b' })
    // `view-0` carried `designOptionId: null` and `view-1` carried `option-a`; neither is rewritten.
    expect(applied.project.views.map((view) => [view.designOptionId, view.renovationDisplay])).toEqual([
      [null, 'existing'],
      ['option-a', 'combined'],
    ])
    // Option A is named by `view-1` alone; Option B by nobody.
    expect(previewReview(start).counts.views).toBe(1)
  })
})

function previewReview(start: Project) {
  const preview = previewIntent(start, intent('designOption.delete', { optionId: 'option-a' }))
  if (preview.review === null || preview.review.kind !== 'delete-design-option') throw new Error('no delete review')
  return preview.review
}

describe('every saved-view Intent comes back exactly as it went (#70 criterion 2)', () => {
  it('applies and inverts to the byte-identical Project over random settings', () => {
    const displays = ['existing', 'demolition', 'proposed', 'combined'] as const
    const steps = fc.oneof(
      fc.record({
        type: fc.constant('view.setDesignOption' as const),
        viewId: fc.constantFrom('view-0', 'view-1'),
        designOptionId: fc.oneof(fc.constant(null), fc.constantFrom('option-a', 'option-b')),
      }),
      fc.record({
        type: fc.constant('view.setRenovationDisplay' as const),
        viewId: fc.constantFrom('view-0', 'view-1'),
        renovationDisplay: fc.constantFrom(...displays),
      }),
    )
    fc.assert(
      fc.property(fc.array(steps, { minLength: 1, maxLength: 8 }), (chosen) => {
        let current = project()
        const history: Applied[] = []
        for (const step of chosen) {
          const { type, viewId, ...rest } = step
          const applied = applyIntent(current, intent(type, { viewId, ...rest } as PayloadOf<typeof type>))
          // A setting that was already the value answers `no-change`, which is the answer that
          // keeps the undo stack honest — it is not a step, so there is nothing to invert.
          if (!applied.ok) {
            expect(applied.code).toBe('no-change')
            continue
          }
          history.push(applied)
          current = applied.project
          expect(validateProject(current).ok).toBe(true)
        }
        // Undoing the whole stack in order returns the Project the user started from, byte for byte.
        for (const applied of [...history].reverse()) {
          current = applyPatches(current, applied.inversePatches)
        }
        expect(canonicalJson(current)).toBe(canonicalJson(project()))
      }),
      { numRuns: 60 },
    )
  }, 60_000)
})
