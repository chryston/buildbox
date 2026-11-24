/**
 * The current context of a Comment (#80 §6, criteria 5–8).
 *
 * These are the five rules read one at a time, each with the case that would break if the rule were
 * dropped: a Comment about another Floor, one about an Option the view is not drawn through, one about
 * work that only exists in a different alternative.
 */
import { describe, expect, it } from 'vitest'
import { commentScopeLabel, commentsForItemDetail, commentsForView, effectiveCommentScope } from './commentContext'
import { COMMENT_SCOPE_ALL, type Comment, type EntityId, type Project } from '../domain'
import { basicProject } from './testing'

const NOW = '2026-11-18T09:00:00.000Z'

const comment = (over: Partial<Comment> & { id: string; reference: string; anchor: Comment['anchor'] }): Comment => ({
  title: `Note ${over.reference}`,
  body: 'Check this with the joiner.',
  status: 'open',
  priority: 'normal',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

/** The Floor's default Plan View, which is the view the panel would be open beside. */
const planView = (project: Project) => project.views.find((view) => view.isDefault)!

/** A Project with one Design Option holding one proposed Placed Item, and one the Existing Model holds. */
function seeded(): Project {
  const base = basicProject()
  const template = base.existingModel.placedItems[0]!
  const proposed: typeof template = { ...template, id: 'placed-proposed' }
  return {
    ...base,
    designOptions: [{ id: 'option-open', name: 'Open plan', proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [proposed] }, demolishedIds: [] }],
  }
}

const existingSubjectId = (): EntityId => basicProject().existingModel.placedItems[0]!.id
const proposedWallId = (project: Project): EntityId => project.designOptions![0]!.proposed.placedItems[0]!.id
const optionId = (project: Project): EntityId => project.designOptions![0]!.id

describe('effectiveCommentScope (#80 §6)', () => {
  it('reads the stored scope of an Anchor that chooses one', () => {
    const project = seeded()
    const all = comment({ id: 'c1', reference: 'C-001', anchor: { kind: 'project' }, scope: COMMENT_SCOPE_ALL })
    const option = comment({ id: 'c2', reference: 'C-002', anchor: { kind: 'floor', floorId: project.floors[0]!.id }, scope: optionId(project) })
    expect(effectiveCommentScope(project, all)).toEqual({ kind: 'all' })
    expect(effectiveCommentScope(project, option)).toEqual({ kind: 'option', designOptionId: optionId(project), inherited: false })
  })

  it('inherits the Existing Model for a Comment about existing work, and says so', () => {
    const project = seeded()
    const about = comment({ id: 'c3', reference: 'C-003', anchor: { kind: 'entity', entityId: existingSubjectId() } })
    expect(effectiveCommentScope(project, about)).toEqual({ kind: 'existing', inherited: true })
    expect(commentScopeLabel(project, effectiveCommentScope(project, about))).toBe('Existing Model (inherited)')
  })

  it('inherits the Option that proposes the work', () => {
    const project = seeded()
    const about = comment({ id: 'c4', reference: 'C-004', anchor: { kind: 'entity', entityId: proposedWallId(project) } })
    expect(effectiveCommentScope(project, about)).toEqual({ kind: 'option', designOptionId: optionId(project), inherited: true })
    expect(commentScopeLabel(project, effectiveCommentScope(project, about))).toBe('Open plan (inherited)')
  })

  it('reads a subject that has gone missing as All Options rather than losing the note', () => {
    const project = seeded()
    const orphan = comment({ id: 'c5', reference: 'C-005', anchor: { kind: 'entity', entityId: 'wall-gone' } })
    expect(effectiveCommentScope(project, orphan)).toEqual({ kind: 'all' })
    expect(commentScopeLabel(project, effectiveCommentScope(project, orphan))).toBe('All Options')
  })

  it('names a chosen Option without the inherited marker', () => {
    const project = seeded()
    const chosen = comment({ id: 'c6', reference: 'C-006', anchor: { kind: 'item_design', itemDesignId: project.itemDesigns[0]!.id }, scope: optionId(project) })
    expect(commentScopeLabel(project, effectiveCommentScope(project, chosen))).toBe('Open plan')
  })
})

describe('commentsForView (#80 §6)', () => {
  it('lists a Project Comment and an All Options Floor Comment in every view of every Floor', () => {
    const project = seeded()
    const projectNote = comment({ id: 'c1', reference: 'C-001', anchor: { kind: 'project' }, scope: COMMENT_SCOPE_ALL })
    const listed = commentsForView(project, planView(project), [projectNote])
    expect(listed.map((row) => row.id)).toEqual(['c1'])
  })

  it('leaves a Comment about another Floor out (#6 rule 2)', () => {
    const project = seeded()
    const otherFloor = project.floors[1]!.id
    const here = comment({ id: 'here', reference: 'C-002', anchor: { kind: 'floor', floorId: project.floors[0]!.id }, scope: COMMENT_SCOPE_ALL })
    const there = comment({ id: 'there', reference: 'C-003', anchor: { kind: 'floor', floorId: otherFloor }, scope: COMMENT_SCOPE_ALL })
    expect(commentsForView(project, planView(project), [here, there]).map((row) => row.id)).toEqual(['here'])
  })

  it('hides an Option-scoped Comment while the view is drawn through no Option (#6 rule 1)', () => {
    const project = seeded()
    const scoped = comment({ id: 'opt', reference: 'C-004', anchor: { kind: 'floor', floorId: project.floors[0]!.id }, scope: optionId(project) })
    expect(commentsForView(project, planView(project), [scoped])).toEqual([])
    const throughOption = { ...planView(project), designOptionId: optionId(project) }
    expect(commentsForView(project, throughOption, [scoped]).map((row) => row.id)).toEqual(['opt'])
  })

  it('hides work that only another alternative proposes (#6 rule 4)', () => {
    const project = seeded()
    const proposed = comment({ id: 'proposed', reference: 'C-005', anchor: { kind: 'entity', entityId: proposedWallId(project) } })
    const existing = comment({ id: 'existing', reference: 'C-006', anchor: { kind: 'entity', entityId: existingSubjectId() } })
    // The Existing Model view draws the existing Wall and not the proposed one.
    expect(commentsForView(project, planView(project), [proposed, existing]).map((row) => row.id)).toEqual(['existing'])
    // Through the Option both stand, so both are in context.
    const throughOption = { ...planView(project), designOptionId: optionId(project) }
    expect(commentsForView(project, throughOption, [proposed, existing]).map((row) => row.id)).toEqual(['proposed', 'existing'])
  })

  it('lists a Design Option Comment only in the view of the Option it names (#6 rule 3)', () => {
    const project = seeded()
    const note = comment({ id: 'd', reference: 'C-007', anchor: { kind: 'design_option', designOptionId: optionId(project) }, scope: optionId(project) })
    expect(commentsForView(project, planView(project), [note])).toEqual([])
    expect(commentsForView(project, { ...planView(project), designOptionId: optionId(project) }, [note])).toHaveLength(1)
  })

  it('lists an Item Design Comment everywhere, subject to scope (#6 rule 5)', () => {
    const project = seeded()
    const note = comment({ id: 'i', reference: 'C-008', anchor: { kind: 'item_design', itemDesignId: project.itemDesigns[0]!.id }, scope: COMMENT_SCOPE_ALL })
    const otherFloor = { ...planView(project), floorId: project.floors[1]!.id }
    expect(commentsForView(project, otherFloor, [note])).toHaveLength(1)
  })

  it('sorts by reference numerically, so C-999 comes before C-1000', () => {
    const project = seeded()
    const rows = [
      comment({ id: 'big', reference: 'C-1000', anchor: { kind: 'project' }, scope: COMMENT_SCOPE_ALL }),
      comment({ id: 'small', reference: 'C-999', anchor: { kind: 'project' }, scope: COMMENT_SCOPE_ALL }),
      comment({ id: 'first', reference: 'C-002', anchor: { kind: 'project' }, scope: COMMENT_SCOPE_ALL }),
    ]
    expect(commentsForView(project, planView(project), rows).map((row) => row.reference)).toEqual(['C-002', 'C-999', 'C-1000'])
  })
})

describe('commentsForItemDetail (#80 §6)', () => {
  it('lists the Project notes, the notes on this Item Design and the notes on its features', () => {
    const project = seeded()
    const designId = project.itemDesigns[0]!.id
    const other = project.itemDesigns[1]!.id
    const rows = [
      comment({ id: 'p', reference: 'C-001', anchor: { kind: 'project' }, scope: COMMENT_SCOPE_ALL }),
      comment({ id: 'd', reference: 'C-002', anchor: { kind: 'item_design', itemDesignId: designId }, scope: COMMENT_SCOPE_ALL }),
      comment({ id: 'f', reference: 'C-003', anchor: { kind: 'feature', ownerId: designId, featureId: 'node-1' } }),
      comment({ id: 'other', reference: 'C-004', anchor: { kind: 'item_design', itemDesignId: other }, scope: COMMENT_SCOPE_ALL }),
      comment({ id: 'wall', reference: 'C-005', anchor: { kind: 'entity', entityId: existingSubjectId() } }),
    ]
    expect(commentsForItemDetail(project, designId, rows).map((row) => row.id)).toEqual(['p', 'd', 'f'])
  })
})
