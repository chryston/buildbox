/**
 * Comments in the model operations (#80 §13, §14, criterion 34).
 *
 * A Comment is a Project record like any other, so the operations that move records around — duplicate
 * a Floor, copy a selection, paste into another Project, remap a whole Project's IDs — each have an
 * answer about it. These are those answers, measured rather than asserted in prose: what crosses, what
 * stays, and what the reference counter does on the way.
 */
import { describe, expect, it } from 'vitest'
import {
  COMMENT_SCOPE_ALL,
  commentAnchorFloorId,
  duplicateCommentIds,
  remapAnchor,
  remapIds,
  summarizeFloorDependencies,
  type Comment,
  type EntityId,
  type Project,
} from '../domain'
import { captureCopySet } from './copySet'
import { basicProject, expectApplied, expectRejection, idSource, intent } from './testing'

/** A Comment about a Placed Item, written the way the Intent writes one. */
const aboutItem = (id: string, reference: string, entityId: EntityId): Comment => ({
  id,
  reference,
  anchor: { kind: 'entity', entityId },
  title: `Note ${reference}`,
  body: 'Move this before the tiler comes.',
  status: 'open',
  priority: 'normal',
  createdAt: '2026-11-18T09:00:00.000Z',
  updatedAt: '2026-11-18T09:00:00.000Z',
})

const aboutFloor = (id: string, reference: string, floorId: EntityId): Comment => ({
  ...aboutItem(id, reference, floorId),
  anchor: { kind: 'floor', floorId },
  scope: COMMENT_SCOPE_ALL,
})

const aboutDesign = (id: string, reference: string, itemDesignId: EntityId): Comment => ({
  ...aboutItem(id, reference, itemDesignId),
  anchor: { kind: 'item_design', itemDesignId },
  scope: COMMENT_SCOPE_ALL,
})

/** One Placed Item on the first Floor, so a duplicate has something to carry. */
function withItem(project: Project): Project {
  const next = structuredClone(project)
  const template = next.existingModel.placedItems[0]!
  next.existingModel.placedItems.push({
    ...template,
    id: 'placed-1',
    floorId: next.floors[0]!.id,
    itemDesignId: next.itemDesigns[0]!.id,
  })
  return next
}

/** A Project with one Item, three Comments (item, Floor, shared design) and the counter after them. */
function seeded(): Project {
  const base = withItem(basicProject())
  return {
    ...base,
    comments: [
      aboutItem('comment-item', 'C-001', 'placed-1'),
      aboutFloor('comment-floor', 'C-002', base.floors[0]!.id),
      aboutDesign('comment-design', 'C-003', base.itemDesigns[0]!.id),
    ],
    commentReferenceCounter: 3,
  }
}

const duplicate = (project: Project, commentIds: readonly EntityId[], ids: string[]) =>
  intent(
    'floor.duplicate',
    {
      floorId: project.floors[0]!.id,
      name: 'Kitchen level 2',
      toIndex: 1,
      placedItemIds: project.existingModel.placedItems
        .filter((item) => item.floorId === project.floors[0]!.id)
        .map((item) => item.id),
      includePlanImage: false,
      commentIds: [...commentIds],
    },
    ids,
  )

/** How many Placed Items the duplicate above copies. */
const itemCount = (project: Project): number =>
  project.existingModel.placedItems.filter((item) => item.floorId === project.floors[0]!.id).length

describe('floor.duplicate carries Comments only when it is asked to (#80 §13, criterion 34)', () => {
  it('copies no Comment when the list is empty', () => {
    const before = seeded()
    const after = expectApplied(
      before,
      duplicate(before, [], idSource('dup')(2 + itemCount(before))),
    ).project
    expect(after.comments.map((comment) => comment.id)).toEqual(['comment-item', 'comment-floor', 'comment-design'])
    expect(after.commentReferenceCounter).toBe(3)
  })

  it('gives a carried Comment a new ID, a new reference and an Anchor on the duplicate', () => {
    const before = seeded()
    const ids = idSource('dup')(4 + itemCount(before))
    const after = expectApplied(before, duplicate(before, ['comment-item', 'comment-floor'], ids)).project
    expect(after.comments).toHaveLength(5)
    const copies = after.comments.slice(3)
    expect(copies.map((comment) => comment.id)).toEqual(['dup-6', 'dup-7'])
    // The counter is spent in order, so the copies are the next two numbers this Project has handed out.
    expect(copies.map((comment) => comment.reference)).toEqual(['C-004', 'C-005'])
    expect(after.commentReferenceCounter).toBe(5)
    const newFloorId = after.floors[1]!.id
    // The carried entity Anchor names a Placed Item standing on the duplicate, not the one it
    // started on: the note came with the work it describes.
    const anchor = copies[0]?.anchor
    expect(anchor?.kind).toBe('entity')
    const subject = anchor?.kind === 'entity' ? after.existingModel.placedItems.find((item) => item.id === anchor.entityId) : undefined
    expect(subject?.floorId).toBe(newFloorId)
    expect(copies[1]?.anchor).toEqual({ kind: 'floor', floorId: newFloorId })
    // What was written is what comes across; only the names change.
    expect(copies[0]?.body).toBe('Move this before the tiler comes.')
    // The originals are untouched.
    expect(after.comments[0]?.anchor).toEqual({ kind: 'entity', entityId: 'placed-1' })
    expect(after.comments[1]?.anchor).toEqual({ kind: 'floor', floorId: before.floors[0]!.id })
  })

  it('leaves a Comment about a shared Item Design out of the list the dialog would offer', () => {
    const before = seeded()
    const offered = duplicateCommentIds(before, before.floors[0]!.id, ['placed-1'])
    expect(offered).toEqual(['comment-item', 'comment-floor'])
  })

  it('refuses a Comment ID that is not there, rather than duplicating a shorter list', () => {
    const before = seeded()
    expectRejection(
      before,
      duplicate(before, ['comment-gone'], idSource('dup')(4 + itemCount(before))),
      'unknown-target',
    )
  })
})

describe('remapIds renames a Comment and the work its Anchor names (#80 §1)', () => {
  it('gives every Comment a fresh ID and remaps every Anchor field', () => {
    const before = seeded()
    const after = remapIds(before, 'project-copy', idSource('r'))
    // Slot 0 is the Project itself, so the Comments — the last collection the walk reaches — close
    // the list. What matters is that each is new and that the Anchors followed the same map.
    expect(after.comments.map((comment) => comment.id)).toEqual(['r-26', 'r-27', 'r-28'])
    expect(after.comments[0]?.id).not.toBe('comment-item')
    expect(after.comments[1]?.anchor).toEqual({ kind: 'floor', floorId: after.floors[0]!.id })
    expect(after.comments[2]?.anchor).toEqual({ kind: 'item_design', itemDesignId: after.itemDesigns[0]!.id })
    const copiedItem = after.existingModel.placedItems.find((item) => item.id !== 'placed-1' && item.id !== after.existingModel.placedItems[0]!.id)
    expect(after.comments[0]?.anchor).toEqual({ kind: 'entity', entityId: after.existingModel.placedItems[4]!.id })
    expect(copiedItem).toBeDefined()
    // The `C-` numbers are not IDs: a whole Project copied keeps its own references, and within it
    // each one still names exactly one Comment.
    expect(after.comments.map((comment) => comment.reference)).toEqual(['C-001', 'C-002', 'C-003'])
    expect(after.commentReferenceCounter).toBe(3)
  })

  it('leaves a Design Option Anchor and an Option-valued scope pointing at the same Option', () => {
    const base = basicProject()
    const optionId = 'option-a'
    const withOption: Project = {
      ...base,
      designOptions: [{ id: optionId, name: 'Open plan', proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] }, demolishedIds: [] }],
      comments: [
        {
          ...aboutFloor('comment-option', 'C-001', base.floors[0]!.id),
          anchor: { kind: 'design_option', designOptionId: optionId },
          scope: optionId,
        },
      ],
      commentReferenceCounter: 1,
    }
    const after = remapIds(withOption, 'project-copy', idSource('r'))
    expect(after.comments[0]?.anchor).toEqual({ kind: 'design_option', designOptionId: optionId })
    expect(after.comments[0]?.scope).toBe(optionId)
  })

  it('remaps a feature Anchor onto the copy of its owner', () => {
    const remapped = remapAnchor({ kind: 'feature', ownerId: 'wall-1', featureId: 'leftFace' }, (id) => `${id}/copy`)
    expect(remapped).toEqual({ kind: 'feature', ownerId: 'wall-1/copy', featureId: 'leftFace' })
  })
})

describe('a Floor with Comments on it is a Floor with something leaning on it (#80 §14)', () => {
  it('counts the Comments anchored to the Floor itself', () => {
    const before = seeded()
    const row = summarizeFloorDependencies(before, before.floors[0]!.id).find((entry) => entry.kind.id === 'comments')
    expect(row?.text).toBe('1 Comment')
  })

  it('counts nothing for a Comment about a Wall, which the Wall’s own row already covers', () => {
    const base = basicProject()
    const withWall: Project = { ...base, comments: [aboutItem('comment-wall', 'C-001', 'wall-1')] }
    const row = summarizeFloorDependencies(withWall, base.floors[0]!.id).find((entry) => entry.kind.id === 'comments')
    expect(row?.text).toBe('0 Comments')
    expect(commentAnchorFloorId({ kind: 'entity', entityId: 'wall-1' })).toBeNull()
  })
})

describe('captureCopySet carries the Comments anchored to what it copied (#80 §13)', () => {
  it('takes the entity-anchored Comment and leaves the Floor and Item Design ones behind', () => {
    const before = seeded()
    const view = before.views.find((candidate) => candidate.isDefault)!
    const copySet = captureCopySet(before, view, ['placed-1'])
    expect(copySet.notes.map((comment) => comment.id)).toEqual(['comment-item'])
  })

  it('carries nothing when the selection holds no Comment', () => {
    const before = seeded()
    const view = before.views.find((candidate) => candidate.isDefault)!
    expect(captureCopySet(before, view, []).notes).toEqual([])
  })
})
