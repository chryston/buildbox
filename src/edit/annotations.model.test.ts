/**
 * Annotations in the model operations (#81 §9).
 *
 * An Annotation is a Project record that draws: the operations that move records — duplicate a Floor,
 * copy a selection, remap a whole Project's IDs — each have an answer about it. These are those
 * answers, measured: what crosses, what stays, what the `A-` counter does on the way, and which view
 * the copy ends up drawn in.
 */
import { describe, expect, it } from 'vitest'
import { ANNOTATION_SCOPE_ALL, duplicateAnnotationIds, remapIds, type Annotation, type EntityId, type Project } from '../domain'
import { captureCopySet } from './copySet'
import { basicProject, expectApplied, expectRejection, idSource, intent } from './testing'

/** A Leader on the first view, anchored to `entityId`, written the way the Intent writes one. */
const leaderOn = (id: string, reference: string, viewId: EntityId, entityId: EntityId): Annotation => ({
  id,
  reference,
  type: 'leader',
  viewId,
  position: { x: 1000, y: 2000 },
  endpoint: { anchor: { kind: 'entity', entityId } },
  text: `Check ${reference}`,
  layerId: null,
  scope: ANNOTATION_SCOPE_ALL,
})

const textOn = (id: string, reference: string, viewId: EntityId): Annotation => ({
  id,
  reference,
  type: 'text',
  viewId,
  position: { x: 300, y: 400 },
  text: 'Set out here',
  layerId: null,
  scope: ANNOTATION_SCOPE_ALL,
})

/** One extra Placed Item on the first Floor, so a duplicate has something to carry an endpoint onto. */
function withItem(project: Project): Project {
  const next = structuredClone(project)
  const template = next.existingModel.placedItems[0]!
  next.existingModel.placedItems.push({ ...template, id: 'placed-1', floorId: next.floors[0]!.id, itemDesignId: next.itemDesigns[0]!.id })
  return next
}

/** A Project with a second named view, one Leader anchored to `placed-1` and one Text, counter 2. */
function seeded(): Project {
  const base = withItem(basicProject())
  const first = base.views[0]!
  return {
    ...base,
    views: [...base.views, { ...first, id: 'view-named', name: 'Setting out', isDefault: false }],
    annotations: [leaderOn('mark-1', 'A-001', first.id, 'placed-1'), textOn('mark-2', 'A-002', 'view-named')],
    annotationReferenceCounter: 2,
  }
}

const duplicate = (project: Project, annotationIds: readonly EntityId[], ids: string[]) =>
  intent(
    'floor.duplicate',
    {
      floorId: project.floors[0]!.id,
      name: 'Kitchen level 2',
      toIndex: 1,
      placedItemIds: project.existingModel.placedItems.filter((item) => item.floorId === project.floors[0]!.id).map((item) => item.id),
      includePlanImage: false,
      commentIds: [],
      annotationIds: [...annotationIds],
    },
    ids,
  )

const itemCount = (project: Project): number => project.existingModel.placedItems.filter((item) => item.floorId === project.floors[0]!.id).length

describe('floor.duplicate carries Annotations only when it is asked to (#81 §9)', () => {
  it('copies no Annotation when the list is empty', () => {
    const before = seeded()
    const after = expectApplied(before, duplicate(before, [], idSource('dup')(2 + itemCount(before)))).project
    expect(after.annotations.map((annotation) => annotation.id)).toEqual(['mark-1', 'mark-2'])
    expect(after.annotationReferenceCounter).toBe(2)
  })

  it('gives a carried Annotation a new ID, a new reference and the duplicate’s own default view', () => {
    const before = seeded()
    const ids = idSource('dup')(4 + itemCount(before))
    const applied = expectApplied(before, duplicate(before, ['mark-1'], ids))
    const carried = applied.project.annotations.find((annotation) => annotation.id !== 'mark-1' && annotation.id !== 'mark-2')
    expect(carried).toBeDefined()
    expect(carried!.reference).toBe('A-003')
    expect(applied.project.annotationReferenceCounter).toBe(3)
    // The duplicate’s default view is the one view the source did not have.
    const newView = applied.project.views.find((candidate) => !before.views.some((each) => each.id === candidate.id))!
    expect(carried!.viewId).toBe(newView.id)
    expect(newView.isDefault).toBe(true)
    // The endpoint followed the copy of the Placed Item it named, not the original.
    const anchor = (carried!.endpoint as { anchor: { entityId: EntityId } }).anchor
    expect(anchor.entityId).not.toBe('placed-1')
    const copiedItem = applied.project.existingModel.placedItems.find((item) => item.id === anchor.entityId)
    expect(copiedItem!.floorId).toBe(newView.floorId)
  })

  it('refuses an Annotation drawn in a named view, which the duplicate has no counterpart for', () => {
    const before = seeded()
    const rejection = expectRejection(
      before,
      duplicate(before, ['mark-2'], idSource('dup')(2 + itemCount(before))),
      'unknown-target',
    )
    expect(rejection.problems[0]!.message).toContain('default Plan View')
  })

  it('refuses an ID that names no Annotation', () => {
    const before = seeded()
    expectRejection(before, duplicate(before, ['mark-9'], idSource('dup')(2 + itemCount(before))), 'unknown-target')
  })

  it('duplicateAnnotationIds answers which marks a duplicate could bring', () => {
    const before = seeded()
    const floorViews = before.views.filter((view) => view.kind === 'plan' && view.floorId === before.floors[0]!.id).map((view) => view.id)
    expect(duplicateAnnotationIds(before, floorViews)).toEqual(['mark-1', 'mark-2'])
  })
})

describe('remapIds renames an Annotation’s own record and the views it names (#81 §9)', () => {
  it('rewrites id, viewId, target and endpoint anchor, and leaves reference, layer and scope alone', () => {
    const base = seeded()
    const first = base.views[0]!
    const before: Project = {
      ...base,
      annotations: [
        { ...leaderOn('mark-1', 'A-001', first.id, 'placed-1'), layerId: null, scope: ANNOTATION_SCOPE_ALL },
        {
          id: 'mark-3',
          reference: 'A-003',
          type: 'reference_marker',
          viewId: 'view-named',
          position: { x: 10, y: 20 },
          text: 'Plan',
          targetViewId: first.id,
          layerId: null,
          scope: ANNOTATION_SCOPE_ALL,
        },
      ],
      annotationReferenceCounter: 3,
    }
    const copy = remapIds(before, 'project-copy', idSource('copy'))
    const [leader, marker] = copy.annotations
    expect(leader!.id).not.toBe('mark-1')
    expect(leader!.viewId).not.toBe(first.id)
    expect(leader!.viewId).toBe(copy.views[0]!.id)
    expect((leader!.endpoint as { anchor: { entityId: string } }).anchor.entityId).not.toBe('placed-1')
    expect(leader!.reference).toBe('A-001')
    expect(marker!.targetViewId).toBe(copy.views[0]!.id)
    expect(marker!.reference).toBe('A-003')
    expect(copy.annotationReferenceCounter).toBe(3)
  })
})

describe('a Copy Set carries the Annotations anchored to what it copied (#81 §9)', () => {
  it('takes the Leader on the copied item and leaves the Text and the free-ended marks behind', () => {
    const before = seeded()
    const view = before.views[0]!
    const copySet = captureCopySet(before, view, ['placed-1'])
    expect(copySet.annotations.map((annotation) => annotation.id)).toEqual(['mark-1'])
  })

  it('brings the Layer an Annotation rides even when no copied entity rides it', () => {
    const base = seeded()
    const before: Project = {
      ...base,
      drawingLayers: [{ id: 'layer-notes', name: 'Notes', color: '#ffb547' }],
      annotations: [{ ...base.annotations[0]!, layerId: 'layer-notes' }, ...base.annotations.slice(1)],
    }
    const copySet = captureCopySet(before, before.views[0]!, ['placed-1'])
    expect(copySet.layers.map((layer) => layer.id)).toEqual(['layer-notes'])
  })
})
