/**
 * The Comment Intents (#80 §1, §3, §14): what one stores, what the numbers do, and what refuses.
 *
 * The record's key list is the acceptance criterion, so it is asserted as a list rather than field by
 * field: a Comment holds a title, a body, one Anchor, a status, a priority and the timestamps that
 * bracket it, and **nothing else** — no author, no assignee, no due date, no replies (#80 criterion 1).
 *
 * The reference counter gets its own block because it is the one number in this feature that must never
 * go backwards. Undo rewinds the Comment and leaves the counter where it was, which is what makes
 * `C-009` a name nothing else will ever wear (§ criteria 2, 4).
 *
 * The §14 refusals are asserted by their sentence as well as their code, because the sentence names the
 * references the user has to move before the delete can go ahead.
 */
import { describe, expect, it } from 'vitest'
import type { Comment, Project } from '../../domain'
import { beamsOf, designOptionsOf, skirtingOf } from '../../domain'
import { pt } from '../../geometry'
import { applyPatches } from '../apply'
import type { Intent, PayloadOf } from '../intents'
import { expectApplied, expectRejection, expectRoundTrip, idSource, intent, newProject, splitProject } from '../testing'

const source = idSource('comment')
const NOW = '2026-11-18T09:00:00.000Z'
const LATER = '2026-11-19T14:30:00.000Z'

const floorIdOf = (project: Project): string => project.floors[0]!.id
const commentAt = (project: Project, index = 0): Comment => project.comments[index]!

/** Anchor kinds that inherit their scope from what they name, so they store none of their own. */
const INHERITING_KINDS = new Set(['design_option', 'entity', 'feature'])

/**
 * A Comment about the whole Project by default — the one Anchor that needs no target to exist.
 *
 * The scope follows the Anchor rather than the caller: an Anchor that names a Design Option, an entity
 * or a feature already answers "which Option?", and everything else has to say `All` or name one.
 */
function projectPayload(over: Partial<PayloadOf<'comment.create'>> = {}): PayloadOf<'comment.create'> {
  const anchor = over.anchor ?? { kind: 'project' }
  return {
    anchor,
    title: 'Check the ceiling height',
    body: '',
    priority: 'normal',
    scope: INHERITING_KINDS.has(anchor.kind) ? undefined : 'all',
    at: NOW,
    ...over,
  }
}

/** One Project with one Project-level Comment, and that Comment. */
function oneComment(over: Partial<PayloadOf<'comment.create'>> = {}): { project: Project; comment: Comment } {
  const project = expectRoundTrip(newProject(), intent('comment.create', projectPayload(over), source(1))).project
  return { project, comment: commentAt(project) }
}

/** A Wall, so an `entity` and a `feature` Anchor have something to point at. */
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

/** A Design Option, so a choosing Anchor has one to name. */
function oneOption(project: Project, name = 'Option A'): Project {
  return expectRoundTrip(project, intent('designOption.create', { name }, idSource('option')(1))).project
}

describe('comment.create (#80 §1)', () => {
  it('stores exactly the fields a Comment has, and no author, assignee, due date or reply (#1)', () => {
    const { comment } = oneComment({ title: 'Kitchen ceiling', body: 'Confirm with the client.', priority: 'high' })
    expect(Object.keys(comment).sort()).toEqual([
      'anchor',
      'body',
      'createdAt',
      'id',
      'priority',
      'reference',
      'scope',
      'status',
      'title',
      'updatedAt',
    ])
    expect(comment.status).toBe('open')
    expect(comment.createdAt).toBe(NOW)
    expect(comment.updatedAt).toBe(NOW)
  })

  it('allocates C-001, then C-002, and moves the counter with each (#2)', () => {
    const first = expectRoundTrip(newProject(), intent('comment.create', projectPayload(), source(1))).project
    expect(commentAt(first).reference).toBe('C-001')
    expect(first.commentReferenceCounter).toBe(1)
    const second = expectRoundTrip(first, intent('comment.create', projectPayload({ title: 'Second' }), source(1))).project
    expect(commentAt(second, 1).reference).toBe('C-002')
    expect(second.commentReferenceCounter).toBe(2)
  })

  it('never hands an undone reference to the next Comment (#2)', () => {
    const base = newProject()
    const applied = expectApplied(base, intent('comment.create', projectPayload(), source(1)))
    const undone = applyPatches(applied.project, applied.inversePatches)
    expect(undone.comments).toEqual([])
    // Undo rewinds the Comment and leaves the counter where it was: the number has been handed out,
    // and a name cannot be un-called (#80 §1 criterion 2).
    expect(undone.commentReferenceCounter).toBe(1)

    const again = expectRoundTrip(undone, intent('comment.create', projectPayload({ title: 'Again' }), source(1))).project
    expect(commentAt(again).reference).toBe('C-002')
  })

  it('gives the Comment after a deleted one the next number, not the freed one (#2)', () => {
    const withTwo = expectRoundTrip(
      expectRoundTrip(newProject(), intent('comment.create', projectPayload(), source(1))).project,
      intent('comment.create', projectPayload({ title: 'Second' }), source(1)),
    ).project
    const deleted = expectRoundTrip(withTwo, intent('comment.delete', { commentId: commentAt(withTwo, 1).id }))
    expect(deleted.project.comments).toHaveLength(1)
    const next = expectRoundTrip(deleted.project, intent('comment.create', projectPayload({ title: 'Third' }), source(1))).project
    expect(commentAt(next, 1).reference).toBe('C-003')
  })

  it('accepts one Comment of every Anchor kind and leaves the Project valid (#6)', () => {
    const base = oneOption(oneWall(newProject()))
    const wall = base.existingModel.walls[0]!
    const placement = base.existingModel.placedItems[0]!
    const cabinet = base.itemDesigns.find((design) => design.kind === 'cabinet')!
    const nodeId = cabinet.kind === 'cabinet' ? cabinet.construction.root.id : ''
    const optionId = designOptionsOf(base)[0]!.id
    const anchors: PayloadOf<'comment.create'>['anchor'][] = [
      { kind: 'project' },
      { kind: 'floor', floorId: floorIdOf(base) },
      { kind: 'design_option', designOptionId: optionId },
      { kind: 'item_design', itemDesignId: cabinet.id },
      { kind: 'entity', entityId: placement.id },
      { kind: 'entity', entityId: wall.id },
      { kind: 'feature', ownerId: wall.id, featureId: 'leftFace', t: 0.5 },
      { kind: 'feature', ownerId: cabinet.id, featureId: nodeId },
      { kind: 'floor_point', floorId: floorIdOf(base), point: pt(1200, 900) },
    ]
    let project = base
    for (const [index, anchor] of anchors.entries()) {
      const choosing = anchor.kind === 'project' || anchor.kind === 'floor' || anchor.kind === 'item_design' || anchor.kind === 'floor_point'
      project = expectRoundTrip(
        project,
        intent(
          'comment.create',
          projectPayload({ anchor, title: `About ${anchor.kind} ${index}`, scope: choosing ? 'all' : undefined }),
          source(1),
        ),
      ).project
    }
    expect(project.comments).toHaveLength(anchors.length)
    expect(project.commentReferenceCounter).toBe(anchors.length)
  })

  it('refuses a stored scope on an Anchor that already answers the question (#1)', () => {
    const base = oneOption(oneWall(newProject()))
    const wall = base.existingModel.walls[0]!
    expectRejection(
      base,
      intent('comment.create', projectPayload({ anchor: { kind: 'entity', entityId: wall.id }, scope: 'all' }), source(1)),
      'invalid-comment',
    )
  })

  it('refuses no scope on an Anchor that has to choose one (#1)', () => {
    expectRejection(newProject(), intent('comment.create', projectPayload({ anchor: { kind: 'floor', floorId: 'nope' } }), source(1)), 'unknown-target')
    const base = newProject()
    expectRejection(
      base,
      intent('comment.create', { anchor: { kind: 'floor', floorId: floorIdOf(base) }, title: 'Here', body: '', priority: 'normal', at: NOW }, source(1)),
      'invalid-comment',
    )
  })

  it('refuses a scope naming a Design Option the Project does not have', () => {
    const base = newProject()
    expectRejection(
      base,
      intent(
        'comment.create',
        { anchor: { kind: 'floor', floorId: floorIdOf(base) }, title: 'Here', body: '', priority: 'normal', scope: 'missing-option', at: NOW },
        source(1),
      ),
      'unknown-target',
    )
  })

  it('refuses an Anchor whose target is not in the Project', () => {
    expectRejection(
      newProject(),
      intent('comment.create', projectPayload({ anchor: { kind: 'entity', entityId: 'gone' } }), source(1)),
      'unknown-target',
    )
  })

  it('refuses a feature its owner never registered', () => {
    const base = oneWall(newProject())
    expectRejection(
      base,
      intent(
        'comment.create',
        projectPayload({ anchor: { kind: 'feature', ownerId: base.existingModel.walls[0]!.id, featureId: 'underside', t: 0.5 } }),
        source(1),
      ),
      'unknown-target',
    )
  })

  it('refuses a title that is only whitespace', () => {
    expectRejection(newProject(), intent('comment.create', projectPayload({ title: '   ' }), source(1)), 'invalid-comment')
  })

  it('accepts a Comment with no body at all (#1)', () => {
    const { comment } = oneComment({ body: '' })
    expect(comment.body).toBe('')
  })

  it('accepts a body with a paragraph break and a tab in it (#1)', () => {
    const { comment } = oneComment({ body: 'First line.\n\nSecond\tline.' })
    expect(comment.body).toBe('First line.\n\nSecond\tline.')
  })
})

describe('comment.edit (#80 §3)', () => {
  it('moves updatedAt and leaves createdAt where it was', () => {
    const { project, comment } = oneComment()
    const edited = expectRoundTrip(project, intent('comment.edit', { commentId: comment.id, title: 'Renamed', at: LATER }))
    expect(commentAt(edited.project).title).toBe('Renamed')
    expect(commentAt(edited.project).createdAt).toBe(comment.createdAt)
    expect(commentAt(edited.project).updatedAt).toBe(LATER)
  })

  it('changes one field at a time, so a title edit leaves the body and the Anchor alone', () => {
    const { project, comment } = oneComment({ body: 'Keep me.', priority: 'high' })
    const edited = commentAt(expectRoundTrip(project, intent('comment.edit', { commentId: comment.id, title: 'Only the title', at: LATER })).project)
    expect(edited.body).toBe('Keep me.')
    expect(edited.priority).toBe('high')
    expect(edited.anchor).toEqual(comment.anchor)
  })

  it('moves the priority, and refuses one outside the three', () => {
    const { project, comment } = oneComment()
    expect(commentAt(expectRoundTrip(project, intent('comment.edit', { commentId: comment.id, priority: 'low', at: LATER })).project).priority).toBe('low')
    expectRejection(project, intent('comment.edit', { commentId: comment.id, priority: 'urgent' as 'low', at: LATER }), 'invalid-comment')
  })

  it('re-scopes a Floor Point, and refuses a scope on an Anchor that inherits one', () => {
    const base = oneOption(newProject())
    const created = expectRoundTrip(
      base,
      intent(
        'comment.create',
        projectPayload({ anchor: { kind: 'floor_point', floorId: floorIdOf(base), point: pt(10, 20) }, scope: 'all' }),
        source(1),
      ),
    ).project
    const optionId = designOptionsOf(created)[0]!.id
    const id = commentAt(created).id
    expect(commentAt(expectRoundTrip(created, intent('comment.edit', { commentId: id, scope: optionId, at: LATER })).project).scope).toBe(optionId)

    const withWall = oneWall(newProject())
    const anchored = expectRoundTrip(
      withWall,
      intent('comment.create', projectPayload({ anchor: { kind: 'entity', entityId: withWall.existingModel.walls[0]!.id } }), source(1)),
    ).project
    expectRejection(anchored, intent('comment.edit', { commentId: commentAt(anchored).id, scope: 'all', at: LATER }), 'invalid-comment')
  })

  it('refuses a Comment that does not exist', () => {
    expectRejection(newProject(), intent('comment.edit', { commentId: 'gone', title: 'x', at: LATER }), 'unknown-target')
  })
})

describe('comment.resolve and comment.reopen (#80 §3)', () => {
  it('Resolve writes resolvedAt and Reopen clears it, each one undo step (#3)', () => {
    const { project, comment } = oneComment()
    const resolved = expectRoundTrip(project, intent('comment.resolve', { commentId: comment.id, at: LATER }))
    expect(commentAt(resolved.project).status).toBe('resolved')
    expect(commentAt(resolved.project).resolvedAt).toBe(LATER)
    expect(applyPatches(resolved.project, resolved.inversePatches)).toEqual(project)

    const reopened = expectRoundTrip(resolved.project, intent('comment.reopen', { commentId: comment.id, at: LATER }))
    expect(commentAt(reopened.project).status).toBe('open')
    expect('resolvedAt' in commentAt(reopened.project)).toBe(false)
    expect(applyPatches(reopened.project, reopened.inversePatches)).toEqual(resolved.project)
  })

  it('keeps a Resolved Comment in the Project (#3)', () => {
    const { project, comment } = oneComment()
    const resolved = expectApplied(project, intent('comment.resolve', { commentId: comment.id, at: LATER })).project
    expect(resolved.comments).toHaveLength(1)
    expect(resolved.comments[0]!.reference).toBe(comment.reference)
  })

  it('refuses to resolve twice and to reopen what is already open', () => {
    const { project, comment } = oneComment()
    const resolved = expectApplied(project, intent('comment.resolve', { commentId: comment.id, at: LATER })).project
    expectRejection(resolved, intent('comment.resolve', { commentId: comment.id, at: LATER }), 'no-change')
    expectRejection(project, intent('comment.reopen', { commentId: comment.id, at: LATER }), 'no-change')
  })
})

describe('comment.delete (#80 §3)', () => {
  it('is one undo step that restores the original ID and reference (#4)', () => {
    const { project, comment } = oneComment()
    const deleted = expectRoundTrip(project, intent('comment.delete', { commentId: comment.id }))
    expect(deleted.project.comments).toEqual([])
    expect(deleted.project.commentReferenceCounter).toBe(project.commentReferenceCounter)
    const restored = applyPatches(deleted.project, deleted.inversePatches)
    expect(commentAt(restored)).toEqual(comment)
  })

  it('leaves the other Comments and every other record alone', () => {
    const first = expectRoundTrip(newProject(), intent('comment.create', projectPayload(), source(1))).project
    const both = expectRoundTrip(first, intent('comment.create', projectPayload({ title: 'Second' }), source(1))).project
    const before = JSON.stringify({ ...both, comments: [] })
    const deleted = expectApplied(both, intent('comment.delete', { commentId: commentAt(both, 1).id })).project
    expect(JSON.stringify({ ...deleted, comments: [] })).toBe(before)
    expect(commentAt(deleted).reference).toBe('C-001')
  })
})

describe('the anchored-deletion guard (#80 §14)', () => {
  /** A Project with one Wall and one Comment anchored to it. */
  function anchoredWall(): { project: Project; wallId: string; comment: Comment } {
    const base = oneWall(newProject())
    const wallId = base.existingModel.walls[0]!.id
    const project = expectRoundTrip(
      base,
      intent('comment.create', projectPayload({ anchor: { kind: 'entity', entityId: wallId } }), source(1)),
    ).project
    return { project, wallId, comment: commentAt(project) }
  }

  it('refuses an unanswered delete and asks what happens to the note (#10, #82 §1)', () => {
    const { project, wallId, comment } = anchoredWall()
    const rejection = expectRejection(project, intent('wall.delete', { wallId }), 'has-dependants')
    expect(rejection.problems[0]!.message).toBe(`1 note is about what this removes: ${comment.reference}. Choose what happens to each.`)
  })

  it('changes nothing at all when it refuses (#10)', () => {
    const { project, wallId } = anchoredWall()
    const before = JSON.stringify(project)
    expectRejection(project, intent('wall.delete', { wallId }), 'has-dependants')
    expect(JSON.stringify(project)).toBe(before)
  })

  it('lists every reference on the one target in a single sentence', () => {
    const { project, wallId } = anchoredWall()
    const second = expectRoundTrip(
      project,
      intent('comment.create', projectPayload({ title: 'Also here', anchor: { kind: 'feature', ownerId: wallId, featureId: 'leftFace', t: 0.25 } }), source(1)),
    ).project
    const rejection = expectRejection(second, intent('wall.delete', { wallId }), 'has-dependants')
    expect(rejection.problems[0]!.message).toBe('2 notes are about what this removes: C-001, C-002. Choose what happens to each.')
  })

  it('refuses to delete a Floor a Comment is anchored to', () => {
    const base = newProject()
    const project = expectRoundTrip(
      base,
      intent('comment.create', projectPayload({ anchor: { kind: 'floor', floorId: floorIdOf(base) }, scope: 'all' }), source(1)),
    ).project
    expectRejection(project, intent('floor.delete', { floorId: floorIdOf(project) }), 'has-dependants')
  })

  it('refuses to delete a Design Option a Comment is anchored to', () => {
    const base = oneOption(newProject())
    const optionId = designOptionsOf(base)[0]!.id
    const project = expectRoundTrip(
      base,
      intent('comment.create', projectPayload({ anchor: { kind: 'design_option', designOptionId: optionId } }), source(1)),
    ).project
    expectRejection(project, intent('designOption.delete', { optionId }), 'has-dependants')
  })

  it('refuses a cabinet edit that drops a node a Comment is anchored to (#9)', () => {
    const { project, childIds } = splitProject()
    const nodeId = childIds[0]!
    const designId = project.itemDesigns.find((design) => design.kind === 'cabinet')!.id
    const anchored = expectRoundTrip(
      project,
      intent('comment.create', projectPayload({ anchor: { kind: 'feature', ownerId: designId, featureId: nodeId } }), source(1)),
    ).project
    expectRejection(anchored, intent('cabinet.deleteBoard', { itemDesignId: designId, nodeId }), 'has-dependants')
  })

  it('lets an edit through that keeps the target, and one that moves the Comment away first', () => {
    const { project, wallId } = anchoredWall()
    expectApplied(project, intent('wall.dragBody', { wallId, delta: pt(0, 30) }))
    const moved = expectRoundTrip(project, intent('comment.delete', { commentId: commentAt(project).id })).project
    expectApplied(moved, intent('wall.delete', { wallId }))
  })

  it('is not disturbed by a Project with no Comments at all', () => {
    const base = oneWall(newProject())
    expect(base.comments).toEqual([])
    expectApplied(base, intent('wall.delete', { wallId: base.existingModel.walls[0]!.id }))
  })

  it('leaves Beams and Skirting alone — the guard is about Comments only', () => {
    const base = oneWall(newProject())
    expect(beamsOf(base.existingModel)).toHaveLength(0)
    expect(skirtingOf(base.existingModel)).toHaveLength(0)
    expectApplied(base, intent('wall.dragBody', { wallId: base.existingModel.walls[0]!.id, delta: pt(0, 30) }))
  })
})

describe('a linked Comment and its Warning stay independent (#80 §11.3)', () => {
  const LINK = { key: 'wall_crossing|w-a,w-b|existing', message: 'W-2 and W-5 cross without a junction' }

  /** Everything a Comment could be accused of changing, with the Comments cut out. */
  const withoutComments = (project: Project): Project => ({ ...project, comments: [], commentReferenceCounter: 0 })

  const linkedCreate = (base: Project): Intent =>
    intent(
      'comment.create',
      projectPayload({ anchor: { kind: 'entity', entityId: base.existingModel.walls[0]!.id }, priority: 'high', linkedWarning: LINK }),
      source(1),
    )

  it('carries the link through create and edit unchanged', () => {
    const base = oneWall(newProject())
    const created = expectApplied(base, linkedCreate(base))
    const linked = commentAt(created.project)
    expect(linked.linkedWarning).toEqual(LINK)
    expect(linked.priority).toBe('high')
    // Editing the note for any reason at all leaves the link where it was: it is not a field the
    // editor offers, and a reword must not quietly unhook the note from the thing it follows up.
    const edited = expectApplied(created.project, intent('comment.edit', { commentId: linked.id, title: 'Reworded', at: NOW }, source(2)))
    expect(commentAt(edited.project).linkedWarning).toEqual(LINK)
  })

  it('round-trips the link through undo', () => {
    const base = oneWall(newProject())
    expectRoundTrip(base, linkedCreate(base))
  })

  it('resolves and deletes the note without touching anything else about the Project', () => {
    const base = oneWall(newProject())
    const created = expectApplied(base, linkedCreate(base))
    const linked = commentAt(created.project)
    const resolved = expectApplied(created.project, intent('comment.resolve', { commentId: linked.id, at: NOW }, source(2)))
    expect(withoutComments(resolved.project)).toEqual(withoutComments(base))
    const deleted = expectApplied(resolved.project, intent('comment.delete', { commentId: linked.id }, source(3)))
    expect(withoutComments(deleted.project)).toEqual(withoutComments(base))
    expect(deleted.project.comments).toHaveLength(0)
  })
})
