/**
 * The Annotation visibility and style answers (#81 §5.3, §5.4, §1).
 *
 * Two Project-shaped visibility rules, three Layer answers, and the style a record draws with once
 * the Layer's graphics fill the gaps — measured against a Project with one hidden Layer, one
 * read-only Layer, one Option-scoped Annotation and one view looking at a different Option.
 */
import { describe, expect, it } from 'vitest'
import { ANNOTATION_SCOPE_ALL, type Annotation, type Project } from '../domain'
import { annotationIsInContext, annotationLayerAccess, annotationsForView, effectiveAnnotationStyle } from './annotationsContext'
import { basicProject } from './testing'

const VIEW = basicProject().views[0]!.id

const mark = (over: Partial<Annotation>): Annotation => ({
  id: 'mark-1',
  reference: 'A-001',
  type: 'text',
  viewId: VIEW,
  position: { x: 0, y: 0 },
  text: 'Note',
  layerId: null,
  scope: ANNOTATION_SCOPE_ALL,
  ...over,
})

function seeded(): Project {
  const base = basicProject()
  return {
    ...base,
    drawingLayers: [
      { id: 'layer-a', name: 'Notes', color: '#ffb547' },
      { id: 'layer-b', name: 'Revisions', color: '#ff6b6b' },
      { id: 'layer-c', name: 'Field', color: '#5fb3ff' },
    ],
    views: base.views.map((view) =>
      view.id === VIEW
        ? {
            ...view,
            layerSettings: {
              ...(view.layerSettings ?? {}),
              'layer-b': { visible: false, selectable: true, editable: true },
              'layer-c': { visible: true, selectable: true, editable: false },
            },
          }
        : view,
    ),
  }
}

const viewOf = (project: Project) => project.views.find((view) => view.id === VIEW)!

describe('annotation visibility (#81 §5.3, §5.4)', () => {
  it('draws an All-Options Annotation on a visible Layer and one on Unlayered', () => {
    const project = seeded()
    expect(annotationIsInContext(project, viewOf(project), mark({}))).toBe(true)
    expect(annotationIsInContext(project, viewOf(project), mark({ layerId: 'layer-a' }))).toBe(true)
  })

  it('hides the Annotation of a Layer the view has hidden, and reports it not drawn', () => {
    const project = seeded()
    const hidden = mark({ layerId: 'layer-b' })
    expect(annotationIsInContext(project, viewOf(project), hidden)).toBe(false)
    expect(annotationLayerAccess(project, viewOf(project), hidden).drawn).toBe(false)
  })

  it('keeps a read-only Layer’s Annotation drawn and pickable but not modifiable', () => {
    const project = seeded()
    const access = annotationLayerAccess(project, viewOf(project), mark({ layerId: 'layer-c' }))
    expect(access).toEqual({ drawn: true, pickable: true, modifiable: false })
  })

  it('hides an Option-scoped Annotation from a view looking at another Option', () => {
    const project = seeded()
    const scoped = mark({ scope: 'option-other' })
    expect(annotationIsInContext(project, viewOf(project), scoped)).toBe(false)
    const sameOption = { ...viewOf(project), designOptionId: 'option-other' } as typeof project.views[number]
    expect(annotationIsInContext(project, sameOption, scoped)).toBe(true)
  })

  it('lists only the owning view’s own Annotations, in reference order', () => {
    const project = seeded()
    const annotations = [
      mark({ id: 'mark-9', reference: 'A-009', viewId: 'view-other' }),
      mark({ id: 'mark-2', reference: 'A-002' }),
      mark({ id: 'mark-1', reference: 'A-001' }),
    ]
    expect(annotationsForView(project, viewOf(project), annotations).map((each) => each.reference)).toEqual(['A-001', 'A-002'])
  })
})

describe('the style a Layer fills in (#81 §1)', () => {
  it('takes the view’s colour for the Layer and the bounded defaults for the rest', () => {
    const project = seeded()
    expect(effectiveAnnotationStyle(project, viewOf(project), mark({ layerId: 'layer-a' }))).toEqual({
      size: 'M',
      colour: '#ffb547',
      weight: 1,
      dashed: false,
      arrowhead: true,
      cloudTint: false,
      markerShape: 'circle',
    })
  })

  it('keeps every override the record set and falls back to the ink when Unlayered', () => {
    const project = seeded()
    const style = effectiveAnnotationStyle(project, viewOf(project), mark({ style: { size: 'L', weight: 3, dashed: true, colour: '#222222' } }))
    expect(style.size).toBe('L')
    expect(style.weight).toBe(3)
    expect(style.dashed).toBe(true)
    expect(style.colour).toBe('#222222')
    expect(effectiveAnnotationStyle(project, viewOf(project), mark({})).colour).toBe('#3f3f46')
  })
})
