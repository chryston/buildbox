/**
 * The Annotation rejects of #81 §1 and §Strict import, one test per rule the strict validator owns.
 *
 * The base is the #81 scene fixture — the renovation scene with one Annotation of every type, an
 * anchored and a free Endpoint, one Unlayered Annotation owned by a Design Option, and a Reference
 * Marker on an Elevation View pointing at the Plan View — so the accepts say the written bytes read,
 * and the rejects are the ones the editor would have refused before the mark was ever drawn: an
 * owning view that does not exist, an Endpoint on a type that cannot carry one, an anchor that
 * points at nothing, a Marker aimed at its own view, two Annotations answering to one reference, and
 * a counter rewound behind a number it has already handed out.
 *
 * What is *not* refused is worth as much: an Unlayered Annotation, a scope of `all`, a style with no
 * fields at all, a counter of zero on a Project with no Annotations, and an owning view addressed by
 * the Item Design whose detail it is. Each has a test, because each is a mark somebody drew that an
 * over-eager reader would throw away.
 */
import { describe, expect, it } from 'vitest'
import annotationsFixture from '../../fixtures/domain/v16/annotations.json?raw'
import { validateProject } from './index'

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(annotationsFixture) as { domainSchemaVersion: number; project: Rec }
  return structuredClone(envelope.project)
}

function problemsOf(value: unknown): { path: string; code: string }[] {
  const result = validateProject(value)
  return result.ok ? [] : result.problems.map(({ path, code }) => ({ path, code }))
}

/** The exact `{path, code}` pairs, in the order the validator reported them. */
function expectProblems(value: unknown, expected: { path: string; code: string }[]): void {
  expect(problemsOf(value)).toEqual(expected)
}

function expectOk(value: unknown): void {
  expect(problemsOf(value)).toEqual([])
}

/** The Annotations, in the order the fixture writes them. */
function annotations(project: Rec): Rec[] {
  return project.annotations as Rec[]
}

/** The Annotation at one index, so a test can say what it broke about it. */
function annotationAt(project: Rec, index: number): Rec {
  return annotations(project)[index]!
}

/** The scene with every Annotation taken out, so a reject says only what it is about. */
function plain(): Rec {
  const project = base()
  project.annotations = []
  project.annotationReferenceCounter = 0
  return project
}

/** A Project that will hold exactly one `A-001`, so the counter already agrees with it. */
function solo(): Rec {
  const project = plain()
  project.annotationReferenceCounter = 1
  return project
}

/** The smallest Annotation that reads: a Text on the default Plan View, Unlayered, scoped to all. */
function mark(over: Rec = {}): Rec {
  return {
    id: 'annotation-x',
    reference: 'A-001',
    type: 'text',
    viewId: 'view-0',
    position: { x: 100, y: 200 },
    text: 'A note drawn on the plan',
    layerId: null,
    scope: 'all',
    ...over,
  }
}

/** The Existing Model's Walls, so a test can name a real endpoint target. */
function walls(project: Rec): Rec[] {
  return ((project.existingModel as Rec).walls ?? []) as Rec[]
}

const TEXT = 'annotations[0]'
const LEADER = 'annotations[1]'
const CLOUD = 'annotations[3]'
const MARKER = 'annotations[4]'

/** The one problem every reject below is about, at one path. */
const only = (path: string, code: string): { path: string; code: string }[] => [{ path, code }]

describe('the Annotations of the scene (#81 §1)', () => {
  it('reads every type the fixture draws', () => {
    expectOk(base())
    expect(annotations(base())).toHaveLength(5)
    expect(base().annotationReferenceCounter).toBe(5)
  })

  it('reads a Project with no Annotation at all', () => {
    // The empty case is the common one: every Project migrated from v15 arrives with both fields and
    // nothing in them, and an import that refused that would refuse the whole back catalogue.
    expectOk(plain())
  })

  it('reads an Unlayered Annotation owned by a Design Option', () => {
    // `layerId: null` is the written-down absence, not a missing field; the scope names a real
    // Option of the scene.
    expect(annotations(base())[2]).toMatchObject({ layerId: null, scope: 'option-1' })
  })

  it('refuses an Annotation list that is not a list', () => {
    const project = base()
    project.annotations = 'a cloud over the appliance wall'
    expectProblems(project, only('annotations', 'wrong-type'))
  })

  it('refuses an Annotation list that is missing', () => {
    const project = base()
    delete project.annotations
    expectProblems(project, only('annotations', 'missing-field'))
  })
})

describe('the owning view (#81 §1)', () => {
  it('refuses a view that is not a saved view of the Project', () => {
    const project = base()
    annotationAt(project, 0).viewId = 'view-nowhere'
    expectProblems(project, only(`${TEXT}.viewId`, 'dangling-reference'))
  })

  it('refuses a missing owning view', () => {
    const project = solo()
    project.annotations = [mark({ viewId: undefined })]
    expectProblems(project, only(`${TEXT}.viewId`, 'missing-field'))
  })

  it('reads an owning view addressed by the Item Design whose detail it is', () => {
    // The Item Detail View is not a saved view; its design ID is the only stable name it has, so
    // the view namespace includes the Item Designs (#81 §1).
    const project = solo()
    const design = (project.itemDesigns as Rec[])[0]!
    project.annotations = [mark({ viewId: design.id })]
    expectOk(project)
  })

  it('reads an Annotation on an Elevation View', () => {
    expect(annotations(base())[4].viewId).toBe('view-elevation-sink')
  })
})

describe('the type and the shape it asks for (#81 §1)', () => {
  it('refuses a type outside the five', () => {
    const project = base()
    annotationAt(project, 0).type = 'dimension'
    expectProblems(project, only(`${TEXT}.type`, 'not-one-of'))
  })

  it('refuses a position that is not a shape at all', () => {
    const project = base()
    annotationAt(project, 3).position = 'a cloud over the appliance wall'
    expectProblems(project, only(`${CLOUD}.position`, 'wrong-type'))
  })

  it('refuses a single point where the Revision Cloud wants two corners', () => {
    const project = base()
    annotationAt(project, 3).position = { x: 800, y: 600 }
    expectProblems(project, [
      { path: `${CLOUD}.position.a`, code: 'missing-field' },
      { path: `${CLOUD}.position.b`, code: 'missing-field' },
      { path: `${CLOUD}.position.x`, code: 'unknown-field' },
      { path: `${CLOUD}.position.y`, code: 'unknown-field' },
    ])
  })

  it('refuses a rectangle where any other type wants one point', () => {
    const project = base()
    annotationAt(project, 0).position = { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }
    expectProblems(project, [
      { path: `${TEXT}.position.x`, code: 'missing-field' },
      { path: `${TEXT}.position.y`, code: 'missing-field' },
      { path: `${TEXT}.position.a`, code: 'unknown-field' },
      { path: `${TEXT}.position.b`, code: 'unknown-field' },
    ])
  })

  it('refuses a corner that is not a point', () => {
    const project = base()
    ;(annotationAt(project, 3).position as Rec).b = { x: 1 }
    expectProblems(project, only(`${CLOUD}.position.b.y`, 'missing-field'))
  })
})

describe('the text (#81 §1)', () => {
  it('refuses an empty text', () => {
    const project = solo()
    project.annotations = [mark({ text: ' ' })]
    expectProblems(project, only(`${TEXT}.text`, 'empty-text'))
  })

  it('refuses a text longer than a few lines of note', () => {
    const project = solo()
    project.annotations = [mark({ text: 'x'.repeat(501) })]
    expectProblems(project, only(`${TEXT}.text`, 'out-of-range'))
  })

  it('reads a text at the ceiling exactly, and one holding a paragraph break', () => {
    const project = solo()
    project.annotations = [mark({ text: `${'x'.repeat(497)}\n\n.` })]
    expectOk(project)
  })

  it('refuses control characters that are not line breaks or tabs', () => {
    const project = solo()
    project.annotations = [mark({ text: 'a form feed: \u000c' })]
    expectProblems(project, only(`${TEXT}.text`, 'bad-format'))
  })
})

describe('the endpoint (#81 §1)', () => {
  it('refuses an endpoint on a type that cannot carry one', () => {
    const project = base()
    annotationAt(project, 0).endpoint = { free: { x: 0, y: 0 } }
    expectProblems(project, only(`${TEXT}.endpoint`, 'unknown-field'))
  })

  it('refuses a Leader or Arrow with no endpoint', () => {
    const project = base()
    delete annotationAt(project, 1).endpoint
    expectProblems(project, only(`${LEADER}.endpoint`, 'missing-field'))
  })

  it('refuses an endpoint that is neither anchored nor free', () => {
    const project = solo()
    project.annotations = [mark({ type: 'leader', endpoint: { somewhere: 'else' } })]
    expectProblems(project, only(`${TEXT}.endpoint`, 'wrong-type'))
  })

  it('refuses an endpoint that is anchored and free at once', () => {
    const project = solo()
    project.annotations = [mark({ type: 'arrow', endpoint: { anchor: { kind: 'entity', entityId: 'wall-1' }, free: { x: 0, y: 0 } } })]
    expectProblems(project, only(`${TEXT}.endpoint.free`, 'unknown-field'))
  })

  it('refuses an anchored endpoint whose entity does not exist', () => {
    const project = solo()
    project.annotations = [mark({ type: 'leader', endpoint: { anchor: { kind: 'entity', entityId: 'wall-nowhere' } } })]
    expectProblems(project, only(`${TEXT}.endpoint.anchor.entityId`, 'dangling-reference'))
  })

  it('reads an endpoint anchored to a Wall face with its parametric position', () => {
    const wall = walls(base())[0]!
    expect(annotationAt(base(), 1).endpoint).toEqual({
      anchor: { kind: 'feature', ownerId: wall.id, featureId: 'leftFace', t: 0.5 },
    })
  })

  it('refuses a feature endpoint whose owner registers no such feature', () => {
    const wall = walls(base())[0]!
    const project = base()
    const anchor = (annotationAt(project, 1).endpoint as Rec).anchor as Rec
    anchor.featureId = 'northFace'
    expectProblems(project, only(`${LEADER}.endpoint.anchor.featureId`, 'not-one-of'))
    // The Wall is a real owner — the complaint is about the feature, not the owner.
    expect(anchor.ownerId).toBe(wall.id)
  })

  it('refuses an endpoint anchor of a kind that is neither entity nor feature', () => {
    // A Marker that followed a Floor would navigate to a place that is not a view; a Leader pinned
    // to a Design Option would follow the Option, not the thing.
    const project = solo()
    project.annotations = [mark({ type: 'leader', endpoint: { anchor: { kind: 'floor_point', floorId: 'floor-0', point: { x: 0, y: 0 } } } })]
    expectProblems(project, [
      { path: `${TEXT}.endpoint.anchor.kind`, code: 'not-one-of' },
      { path: `${TEXT}.endpoint.anchor.floorId`, code: 'unknown-field' },
      { path: `${TEXT}.endpoint.anchor.point`, code: 'unknown-field' },
    ])
  })

  it('refuses a `t` outside the feature', () => {
    const project = base()
    const anchor = (annotationAt(project, 1).endpoint as Rec).anchor as Rec
    anchor.t = 1.5
    expectProblems(project, only(`${LEADER}.endpoint.anchor.t`, 'out-of-range'))
  })

  it('reads a free endpoint at any finite point', () => {
    expect(annotations(base())[2].endpoint).toEqual({ free: { x: 3400, y: 2200 } })
  })
})

describe('the target view of a Reference Marker (#81 §1)', () => {
  it('refuses a target on a type that is not a Marker', () => {
    const project = base()
    annotationAt(project, 0).targetViewId = 'view-1'
    expectProblems(project, only(`${TEXT}.targetViewId`, 'unknown-field'))
  })

  it('refuses a Marker with no target', () => {
    const project = base()
    delete annotationAt(project, 4).targetViewId
    expectProblems(project, only(`${MARKER}.targetViewId`, 'missing-field'))
  })

  it('refuses a Marker aimed at its own view', () => {
    const project = base()
    annotationAt(project, 4).targetViewId = 'view-elevation-sink'
    expectProblems(project, only(`${MARKER}.targetViewId`, 'dangling-reference'))
  })

  it('refuses a Marker aimed at a view that does not exist', () => {
    const project = base()
    annotationAt(project, 4).targetViewId = 'view-nowhere'
    expectProblems(project, only(`${MARKER}.targetViewId`, 'dangling-reference'))
  })

  it('reads a Marker aimed at another view, across view kinds', () => {
    // The fixture's Marker stands on an Elevation View and points at the Plan View.
    expect(annotationAt(base(), 4).targetViewId).toBe('view-0')
  })
})

describe('the layer and the scope (#81 §1)', () => {
  it('refuses a layer that is not a Drawing Layer of the Project', () => {
    const project = base()
    annotationAt(project, 0).layerId = 'layer-99'
    expectProblems(project, only(`${TEXT}.layerId`, 'dangling-reference'))
  })

  it('reads Unlayered — a null layer is the answer, not a missing field', () => {
    const project = solo()
    project.annotations = [mark({ layerId: null })]
    expectOk(project)
  })

  it('refuses a missing layer', () => {
    const project = solo()
    project.annotations = [mark({ layerId: undefined })]
    expectProblems(project, only(`${TEXT}.layerId`, 'missing-field'))
  })

  it('refuses a scope that names no Design Option and is not `all`', () => {
    const project = base()
    annotationAt(project, 0).scope = 'option-99'
    expectProblems(project, only(`${TEXT}.scope`, 'dangling-reference'))
  })

  it('reads a scope of `all` and a scope of one real Option', () => {
    expect(annotations(base())[0].scope).toBe('all')
    expect(annotations(base())[2].scope).toBe('option-1')
  })
})

describe('the bounded style (#81 §1)', () => {
  it('reads the overrides the fixture writes', () => {
    expect(annotationAt(base(), 1).style).toEqual({ colour: '#ff6b6b', weight: 2 })
    expect(annotationAt(base(), 2).style).toEqual({ size: 'L', arrowhead: false })
    expect(annotationAt(base(), 4).style).toEqual({ markerShape: 'hexagon' })
  })

  it('reads an empty style — every field is an override and none is owed', () => {
    const project = solo()
    project.annotations = [mark({ style: {} })]
    expectOk(project)
  })

  it('refuses a size outside S, M and L', () => {
    const project = solo()
    project.annotations = [mark({ style: { size: 'XL' } })]
    expectProblems(project, only(`${TEXT}.style.size`, 'not-one-of'))
  })

  it('refuses a colour outside the five-colour palette, and never snaps one', () => {
    const project = solo()
    project.annotations = [mark({ style: { colour: '#123456' } })]
    expectProblems(project, only(`${TEXT}.style.colour`, 'not-one-of'))
  })

  it('refuses a line weight outside 1, 2 and 3', () => {
    const project = solo()
    project.annotations = [mark({ style: { weight: 4 } })]
    expectProblems(project, only(`${TEXT}.style.weight`, 'not-one-of'))
  })

  it('refuses a dashed flag that is not a flag', () => {
    const project = solo()
    project.annotations = [mark({ style: { dashed: 'yes' } })]
    expectProblems(project, only(`${TEXT}.style.dashed`, 'wrong-type'))
  })

  it('refuses an arrowhead on a type that draws no line to an endpoint', () => {
    const project = base()
    annotationAt(project, 0).style = { arrowhead: true }
    expectProblems(project, only(`${TEXT}.style.arrowhead`, 'unknown-field'))
  })

  it('refuses a cloud tint on a type that clouds over nothing', () => {
    const project = base()
    annotationAt(project, 1).style = { cloudTint: true }
    expectProblems(project, only(`${LEADER}.style.cloudTint`, 'unknown-field'))
  })

  it('refuses a marker shape on a type that is not a Marker', () => {
    const project = base()
    annotationAt(project, 3).style = { markerShape: 'circle' }
    expectProblems(project, only(`${CLOUD}.style.markerShape`, 'unknown-field'))
  })

  it('refuses a marker shape outside the two', () => {
    const project = base()
    ;(annotationAt(project, 4).style as Rec).markerShape = 'square'
    expectProblems(project, only(`${MARKER}.style.markerShape`, 'not-one-of'))
  })

  it('refuses a style field the schema does not know — no font, no arbitrary point size', () => {
    const project = solo()
    project.annotations = [mark({ style: { fontSize: 24 } })]
    expectProblems(project, only(`${TEXT}.style.fontSize`, 'unknown-field'))
  })
})

describe('the reference and the counter (#81 §1)', () => {
  it('refuses a reference outside `A-` and at least three digits', () => {
    const project = solo()
    project.annotations = [mark({ reference: 'A-1' })]
    expectProblems(project, only(`${TEXT}.reference`, 'bad-format'))
  })

  it('refuses two Annotations answering to one reference', () => {
    const project = base()
    annotationAt(project, 1).reference = 'A-001'
    expectProblems(project, only(`${LEADER}.reference`, 'duplicate-id'))
  })

  it('refuses two Annotations answering to one ID', () => {
    const project = base()
    annotationAt(project, 1).id = annotationAt(project, 0).id
    expectProblems(project, only(`${LEADER}.id`, 'duplicate-id'))
  })

  it('refuses a counter rewound behind a number it has already handed out', () => {
    const project = base()
    project.annotationReferenceCounter = 4
    expectProblems(project, only('annotationReferenceCounter', 'out-of-range'))
  })

  it('reads a counter ahead of every reference in use', () => {
    // Undoing the last Annotation does not rewind the promise; the counter may sit ahead.
    const project = base()
    project.annotationReferenceCounter = 9
    expectOk(project)
  })

  it('reads a counter of zero on a Project with no Annotations', () => {
    expectOk(plain())
  })

  it('refuses a negative or fractional counter', () => {
    const project = plain()
    project.annotationReferenceCounter = -1
    expectProblems(project, only('annotationReferenceCounter', 'out-of-range'))
    const other = plain()
    other.annotationReferenceCounter = 1.5
    expectProblems(other, only('annotationReferenceCounter', 'out-of-range'))
  })

  it('reads a reference past three digits and a counter that matches', () => {
    const project = solo()
    project.annotations = [mark({ reference: 'A-1000' })]
    project.annotationReferenceCounter = 1000
    expectOk(project)
  })
})

describe('what an Annotation never carries (#81 §1)', () => {
  it('refuses a Renovation State on an Annotation', () => {
    // An Annotation is neither Existing nor Proposed work; it is a mark about the drawing. A record
    // that grew a phase-like field is refused, not ignored.
    const project = solo()
    project.annotations = [mark({ renovationState: 'proposed' })]
    expectProblems(project, only(`${TEXT}.renovationState`, 'unknown-field'))
  })

  it('refuses a style that is not a set of overrides', () => {
    const project = solo()
    project.annotations = [mark({ style: 'amber' })]
    expectProblems(project, only(`${TEXT}.style`, 'wrong-type'))
  })
})
