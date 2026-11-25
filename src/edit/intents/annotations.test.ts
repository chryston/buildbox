/**
 * The Annotation Intents (#81 §1, §2, §4): what one stores, what the numbers do, and what refuses.
 *
 * The record's key list is the acceptance criterion, so it is asserted as a list rather than field by
 * field: an Annotation holds a reference, a type, one owning view, a position, text, a layer answer,
 * a scope answer, and — only when its type asks — an endpoint and a target view, plus a style of
 * overrides, and **nothing else**: no Renovation State, no author, no rotation, no font (#81 §1).
 *
 * The reference counter gets its own block because, like the Comment counter, it is a number that
 * must never go backwards: undo rewinds the Annotation and leaves the counter where it was, which is
 * what makes `A-009` a name nothing else will ever wear (#81 §1, §2).
 */
import { describe, expect, it } from 'vitest'
import type { Annotation, Project } from '../../domain'
import { savedViewsOf } from '../../domain'
import { pt } from '../../geometry'
import { applyPatches } from '../apply'
import type { PayloadOf } from '../intents'
import { expectApplied, expectRejection, expectRoundTrip, idSource, intent, newProject } from '../testing'

const source = idSource('annotation')

const floorIdOf = (project: Project): string => project.floors[0]!.id
const annotationAt = (project: Project, index = 0): Annotation => project.annotations[index]!

/** The default Plan View of the one Floor — the view every Annotation here is placed in. */
const viewOf = (project: Project): string => savedViewsOf(project).find((view) => view.kind === 'plan')!.id

/** The smallest Text that reads: one point, one line of note, Unlayered, scoped to all. */
function textPayload(over: Partial<PayloadOf<'annotation.create'>> = {}): PayloadOf<'annotation.create'> {
  return {
    viewId: 'view-missing',
    type: 'text',
    position: pt(1000, 2000),
    text: 'Set out tile from here',
    layerId: null,
    scope: 'all',
    ...over,
  }
}

/** A Project with one Text Annotation, placed in its default Plan View. */
function oneAnnotation(over: Partial<PayloadOf<'annotation.create'>> = {}): { project: Project; annotation: Annotation } {
  const project = newProject()
  const withMark = expectRoundTrip(project, intent('annotation.create', textPayload({ viewId: viewOf(project), ...over }), source(2))).project
  return { project: withMark, annotation: annotationAt(withMark) }
}

describe('annotation.create (#81 §1, §2)', () => {
  it('stores exactly the keys an Annotation owns, with the first reference and the counter', () => {
    const { project, annotation } = oneAnnotation()
    expect(Object.keys(annotation).sort()).toEqual([
      'id', 'layerId', 'position', 'reference', 'scope', 'text', 'type', 'viewId',
    ])
    expect(annotation.reference).toBe('A-001')
    expect(annotation.id).toBe('annotation-1')
    expect(project.annotationReferenceCounter).toBe(1)
  })

  it('hands out A-002 next, and never re-reads a number undo took back', () => {
    const { project } = oneAnnotation()
    const second = expectRoundTrip(project, intent('annotation.create', textPayload({ viewId: viewOf(project) }), source(2))).project
    expect(annotationAt(second, 1).reference).toBe('A-002')
    // Undo the second Annotation: the record goes, the counter stays — `A-002` is not worn again.
    const applied = expectApplied(project, intent('annotation.create', textPayload({ viewId: viewOf(project) }), source(2)))
    const undone = applyPatches(applied.project, applied.inversePatches)
    expect(undone.annotations).toHaveLength(1)
    expect(undone.annotationReferenceCounter).toBe(applied.project.annotationReferenceCounter)
    const third = expectRoundTrip(undone, intent('annotation.create', textPayload({ viewId: viewOf(project) }), source(2))).project
    expect(annotationAt(third, 1).reference).toBe('A-003')
  })

  it('keeps the layer answer as given — a real layer, or null for Unlayered', () => {
    const { annotation } = oneAnnotation()
    expect(annotation.layerId).toBeNull()
  })

  it('creates the prompt’s layer and the Annotation in one transaction, at the front (#81 §4)', () => {
    const project = newProject()
    const [id, newLayerId] = source(2)
    const applied = expectApplied(
      project,
      intent(
        'annotation.create',
        textPayload({ viewId: viewOf(project), layerId: null, createLayer: { name: 'Notes', color: '#ffb547' } }),
        [id, newLayerId],
      ),
    )
    const annotation = annotationAt(applied.project)
    expect(annotation.layerId).toBe(newLayerId)
    const layers = applied.project.drawingLayers ?? []
    // The end of the array is the front (#71 §1): the new layer is the one the list shows first.
    expect(layers[layers.length - 1]).toEqual({ id: newLayerId, name: 'Notes', color: '#ffb547' })
    // One undo removes both: the Annotation, and the layer that came with it.
    const undone = applyPatches(applied.project, applied.inversePatches)
    expect(undone.annotations).toHaveLength(0)
    expect(undone.drawingLayers).toHaveLength(project.drawingLayers?.length ?? 0)
  })

  it('joins the new layer to every view that keeps an order of its own (#81 §4)', () => {
    const project = newProject()
    const viewId = viewOf(project)
    const withLayer = expectApplied(project, intent('layer.add', { name: 'Constructions', color: '#5fb3ff' }, idSource('layer')(1))).project
    const ordered = expectApplied(
      withLayer,
      intent(
        'view.setLayerOrder',
        { viewId, layerOrder: [...(withLayer.drawingLayers ?? []).map((layer) => layer.id), 'unlayered'] },
        [],
      ),
    ).project
    const [id, newLayerId] = source(2)
    const applied = expectApplied(
      ordered,
      intent('annotation.create', textPayload({ viewId, createLayer: { name: 'Notes', color: '#ffb547' } }), [id, newLayerId]),
    ).project
    const ownOrder = savedViewsOf(applied).find((each) => each.id === viewId)!.layerOrder!
    expect(ownOrder[ownOrder.length - 1]).toBe(newLayerId)
  })

  it('refuses a type the schema does not know', () => {
    const project = newProject()
    expectRejection(
      project,
      intent('annotation.create', { ...textPayload({ viewId: viewOf(project) }), type: 'balloon' as never }, source(2)),
      'invalid-annotation',
    )
  })

  it('refuses a view that does not exist', () => {
    expectRejection(newProject(), intent('annotation.create', textPayload(), source(2)), 'unknown-target')
  })

  it('refuses text that is empty, too long, or holding a control character', () => {
    const project = newProject()
    const viewId = viewOf(project)
    expectRejection(project, intent('annotation.create', textPayload({ viewId, text: '  ' }), source(2)), 'invalid-annotation')
    expectRejection(project, intent('annotation.create', textPayload({ viewId, text: 'x'.repeat(501) }), source(2)), 'invalid-annotation')
    expectRejection(project, intent('annotation.create', textPayload({ viewId, text: 'a form feed: \u000c' }), source(2)), 'invalid-annotation')
  })

  it('refuses a dangling layer and a scope naming no Option', () => {
    const project = newProject()
    const viewId = viewOf(project)
    expectRejection(project, intent('annotation.create', textPayload({ viewId, layerId: 'layer-nowhere' }), source(2)), 'unknown-target')
    expectRejection(project, intent('annotation.create', textPayload({ viewId, scope: 'option-nowhere' }), source(2)), 'unknown-target')
  })

  it('refuses an endpoint on a type that draws none, and none on a Leader or Arrow', () => {
    const project = newProject()
    const viewId = viewOf(project)
    expectRejection(
      project,
      intent('annotation.create', textPayload({ viewId, endpoint: { free: pt(0, 0) } }), source(2)),
      'invalid-annotation',
    )
    expectRejection(project, intent('annotation.create', textPayload({ viewId, type: 'leader' }), source(2)), 'invalid-annotation')
  })

  it('refuses an endpoint anchored to nothing, and reads a free one', () => {
    const project = newProject()
    const viewId = viewOf(project)
    expectRejection(
      project,
      intent('annotation.create', textPayload({ viewId, type: 'leader', endpoint: { anchor: { kind: 'entity', entityId: 'wall-nowhere' } } }), source(2)),
      'unknown-target',
    )
    const { annotation } = oneAnnotation({ type: 'leader', endpoint: { free: pt(3000, 1000) } })
    expect(annotation.endpoint).toEqual({ free: pt(3000, 1000) })
  })

  it('refuses a target on a type that is not a Marker, and a Marker aimed at itself or nowhere', () => {
    const project = newProject()
    const viewId = viewOf(project)
    expectRejection(project, intent('annotation.create', textPayload({ viewId, targetViewId: viewId }), source(2)), 'invalid-annotation')
    expectRejection(
      project,
      intent('annotation.create', textPayload({ viewId, type: 'reference_marker' }), source(2)),
      'invalid-annotation',
    )
    expectRejection(
      project,
      intent('annotation.create', textPayload({ viewId, type: 'reference_marker', targetViewId: viewId }), source(2)),
      'invalid-annotation',
    )
    expectRejection(
      project,
      intent('annotation.create', textPayload({ viewId, type: 'reference_marker', targetViewId: 'view-nowhere' }), source(2)),
      'unknown-target',
    )
  })

  it('refuses a rectangle where a point belongs, and a point where a cloud belongs', () => {
    const project = newProject()
    const viewId = viewOf(project)
    expectRejection(
      project,
      intent('annotation.create', textPayload({ viewId, position: { a: pt(0, 0), b: pt(100, 100) } }), source(2)),
      'invalid-annotation',
    )
    expectRejection(project, intent('annotation.create', textPayload({ viewId, type: 'revision_cloud' }), source(2)), 'invalid-annotation')
  })

  it('refuses a style outside the bounded sets and reads one inside them', () => {
    const project = newProject()
    const viewId = viewOf(project)
    expectRejection(project, intent('annotation.create', textPayload({ viewId, style: { colour: '#123456' } }), source(2)), 'invalid-annotation')
    expectRejection(project, intent('annotation.create', textPayload({ viewId, style: { weight: 4 } }), source(2)), 'invalid-annotation')
    expectRejection(project, intent('annotation.create', textPayload({ viewId, style: { size: 'XL' as never } }), source(2)), 'invalid-annotation')
    const { annotation } = oneAnnotation({ style: { size: 'L', colour: '#ff6b6b', weight: 2, dashed: true } })
    expect(annotation.style).toEqual({ size: 'L', colour: '#ff6b6b', weight: 2, dashed: true })
  })

  it('refuses a prompt layer whose name is taken or whose colour is not six hex digits (#81 §4)', () => {
    const project = newProject()
    const viewId = viewOf(project)
    const taken = (project.drawingLayers ?? [])[0]!
    expectRejection(
      project,
      intent('annotation.create', textPayload({ viewId, createLayer: { name: taken.name, color: '#ffb547' } }), source(2)),
      'layer-blocked',
    )
    expectRejection(
      project,
      intent('annotation.create', textPayload({ viewId, createLayer: { name: 'Notes', color: 'amber' } }), source(2)),
      'invalid-annotation',
    )
  })
})

describe('annotation.edit and annotation.move (#81 §2, §7)', () => {
  it('changes one field per box and is one undo step', () => {
    const { project, annotation } = oneAnnotation()
    const edited = expectRoundTrip(project, intent('annotation.edit', { annotationId: annotation.id, text: 'Set out tile from this corner' }, [])).project
    expect(annotationAt(edited).text).toBe('Set out tile from this corner')
    expect(edited.annotations).toHaveLength(1)
  })

  it('moves the position, and the endpoint when the drag took it too', () => {
    const { project, annotation } = oneAnnotation({ type: 'leader', endpoint: { free: pt(3000, 1000) } })
    const moved = expectRoundTrip(
      project,
      intent('annotation.move', { annotationId: annotation.id, position: pt(1500, 2500), endpoint: { free: pt(3200, 1100) } }, []),
    ).project
    expect(annotationAt(moved).position).toEqual(pt(1500, 2500))
    expect(annotationAt(moved).endpoint).toEqual({ free: pt(3200, 1100) })
  })

  it('clears every override on Reset to layer style (#81 §7 criterion 21)', () => {
    const { project, annotation } = oneAnnotation({ style: { size: 'L', weight: 3 } })
    const reset = expectRoundTrip(project, intent('annotation.edit', { annotationId: annotation.id, style: null }, [])).project
    expect('style' in annotationAt(reset)).toBe(false)
  })

  it('refuses an edit of an Annotation that is not there', () => {
    expectRejection(newProject(), intent('annotation.edit', { annotationId: 'annotation-gone', text: 'x' }, []), 'unknown-target')
  })

  it('refuses a style edit outside the bounded sets', () => {
    const { project, annotation } = oneAnnotation()
    expectRejection(project, intent('annotation.edit', { annotationId: annotation.id, style: { markerShape: 'octagon' as never } }, []), 'invalid-annotation')
  })
})

describe('annotation.delete (#81 §2)', () => {
  it('takes the record away and puts it back with its reference', () => {
    const { project, annotation } = oneAnnotation()
    const deleted = expectRoundTrip(project, intent('annotation.delete', { annotationId: annotation.id }, [])).project
    expect(deleted.annotations).toHaveLength(0)
    // The counter is not rewound by the delete, nor by its undo: the reference stays spent.
    expect(deleted.annotationReferenceCounter).toBe(project.annotationReferenceCounter)
    expect(annotation.reference).toBe('A-001')
  })

  it('refuses a second delete of the same Annotation', () => {
    const { project, annotation } = oneAnnotation()
    const deleted = expectApplied(project, intent('annotation.delete', { annotationId: annotation.id }, [])).project
    expectRejection(deleted, intent('annotation.delete', { annotationId: annotation.id }, []), 'unknown-target')
  })
})

describe('the Floor the Annotation lives on (#81 §5.1)', () => {
  it('locates to the owning view and its Floor', () => {
    const project = newProject()
    const viewId = viewOf(project)
    const applied = expectApplied(project, intent('annotation.create', textPayload({ viewId }), source(2)))
    expect(applied.affected.viewId).toBe(viewId)
    expect(applied.affected.floorId).toBe(floorIdOf(project))
  })
})
