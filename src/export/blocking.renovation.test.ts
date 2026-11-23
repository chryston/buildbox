/**
 * The one refusal the Export dialog makes over a Renovation Display (#73 §3, criterion 11).
 *
 * The predicate is the whole product decision — a Display that describes an Option with no Option
 * to describe cannot be drawn honestly — so it is tested against the saved views that ship in the
 * fixture rather than against invented ones, including the one view that looks like a refusal and
 * is not: a Display of `Existing` needs no Option, because the Existing Model is what it draws.
 */
import { describe, expect, it } from 'vitest'
import renovationFixture from '../../fixtures/domain/v8/renovation-views.json?raw'
import type { PlanView, Project } from '../domain'
import { needsActiveOption } from './index'

const project = (JSON.parse(renovationFixture) as { project: Project }).project

const planView = (id: string): PlanView => {
  const view = project.views.find((each) => each.id === id)
  if (view === undefined || view.kind !== 'plan') throw new Error(`no Plan View ${id}`)
  return view
}

/** The same view with its Design Option taken away, which is the state the criterion is about. */
const withoutOption = (view: PlanView): PlanView => ({ ...view, designOptionId: undefined })

describe('the export blocking predicate (#73 §3)', () => {
  it('refuses a Display that describes an Option the view does not have', () => {
    for (const id of ['views-view-014', 'views-view-015', 'views-view-016']) {
      expect(needsActiveOption(withoutOption(planView(id))), id).toBe(true)
    }
  })

  it('says nothing about a view that has its Option', () => {
    for (const id of ['views-view-014', 'views-view-015', 'views-view-016']) {
      expect(needsActiveOption(planView(id)), id).toBe(false)
    }
  })

  it('never refuses the Existing Model, which needs no Option to be drawn', () => {
    expect(needsActiveOption(planView('seed-view-001'))).toBe(false)
    expect(needsActiveOption(withoutOption(planView('seed-view-001')))).toBe(false)
  })
})
