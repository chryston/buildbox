/**
 * The Annotation reference and the per-type defaults (#81 §1, §4.1, §4.3, §9): the small pure rules
 * the editor and the panel lean on.
 *
 * The reference is the one number a Project promises never to hand out twice, so its shape, its
 * padding past `A-999`, and its numeric order are worth their own tests — a panel that sorted
 * `A-1000` before `A-999` would read as a broken counter even when the counter is sound.
 */
import { describe, expect, it } from 'vitest'
import annotationsFixture from '../../fixtures/domain/v16/annotations.json?raw'
import {
  ANNOTATION_MARKER_SHAPES,
  ANNOTATION_PALETTE,
  ANNOTATION_REFERENCE_PATTERN,
  ANNOTATION_SIZES,
  ANNOTATION_TEXT_MAX_LENGTH,
  ANNOTATION_TYPES,
  ANNOTATION_WEIGHTS,
  annotationDefaultLayerColor,
  annotationDefaultLayerName,
  annotationPositionIsRect,
  annotationReferenceNumber,
  annotationTypeHasEndpoint,
  annotationTypeHasTarget,
  compareAnnotationReferences,
  DEFAULT_REVISION_CLOUD_HEIGHT_MM,
  DEFAULT_REVISION_CLOUD_WIDTH_MM,
  duplicateAnnotationIds,
  endpointIsAnchored,
  formatAnnotationReference,
} from './index'

describe('the Annotation reference (#81 §1)', () => {
  it('formats a number the way the record stores it', () => {
    expect(formatAnnotationReference(1)).toBe('A-001')
    expect(formatAnnotationReference(42)).toBe('A-042')
    expect(formatAnnotationReference(999)).toBe('A-999')
    // Past three digits the reference simply grows; it never truncates or wraps.
    expect(formatAnnotationReference(1000)).toBe('A-1000')
  })

  it('reads back exactly what it wrote', () => {
    for (const value of [1, 7, 999, 1000, 123456]) {
      expect(annotationReferenceNumber(formatAnnotationReference(value))).toBe(value)
    }
  })

  it('refuses to read a text that is not a reference', () => {
    expect(annotationReferenceNumber('A-01')).toBeNull()
    expect(annotationReferenceNumber('C-001')).toBeNull()
    expect(annotationReferenceNumber('A-1x')).toBeNull()
    expect(annotationReferenceNumber('')).toBeNull()
  })

  it('matches only `A-` and at least three digits', () => {
    expect(ANNOTATION_REFERENCE_PATTERN.test('A-001')).toBe(true)
    expect(ANNOTATION_REFERENCE_PATTERN.test('A-0001')).toBe(true)
    expect(ANNOTATION_REFERENCE_PATTERN.test('A-99')).toBe(false)
    expect(ANNOTATION_REFERENCE_PATTERN.test('a-001')).toBe(false)
  })

  it('orders references numerically, not lexically', () => {
    const sorted = ['A-1000', 'A-002', 'A-999', 'A-010'].sort(compareAnnotationReferences)
    expect(sorted).toEqual(['A-002', 'A-010', 'A-999', 'A-1000'])
  })

  it('sorts a text that is not a reference last, after each other such text', () => {
    // A broken record cannot shuffle the well-formed ones.
    const sorted = ['zz', 'A-002', 'aa', 'A-001'].sort(compareAnnotationReferences)
    expect(sorted).toEqual(['A-001', 'A-002', 'aa', 'zz'])
  })
})

describe('the bounded sets (#81 §1)', () => {
  it('names five types, three sizes, three weights and two marker shapes', () => {
    expect(ANNOTATION_TYPES).toEqual(['text', 'leader', 'arrow', 'revision_cloud', 'reference_marker'])
    expect(ANNOTATION_SIZES).toEqual(['S', 'M', 'L'])
    expect(ANNOTATION_WEIGHTS).toEqual([1, 2, 3])
    expect(ANNOTATION_MARKER_SHAPES).toEqual(['circle', 'hexagon'])
  })

  it('holds five distinct palette colours, each a lowercase hex triple', () => {
    expect(ANNOTATION_PALETTE).toHaveLength(5)
    expect(new Set(ANNOTATION_PALETTE).size).toBe(5)
    for (const colour of ANNOTATION_PALETTE) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('caps the text at a few lines of note, not a document', () => {
    expect(ANNOTATION_TEXT_MAX_LENGTH).toBe(500)
  })
})

describe('the per-type defaults (#81 §3.8, §4.1, §4.3)', () => {
  it('asks for `Notes`, except the Revision Cloud, which asks for `Revisions`', () => {
    expect(annotationDefaultLayerName('text')).toBe('Notes')
    expect(annotationDefaultLayerName('leader')).toBe('Notes')
    expect(annotationDefaultLayerName('arrow')).toBe('Notes')
    expect(annotationDefaultLayerName('reference_marker')).toBe('Notes')
    expect(annotationDefaultLayerName('revision_cloud')).toBe('Revisions')
  })

  it('creates that layer in the prototype amber, and the cloud layer in red', () => {
    expect(annotationDefaultLayerColor('text')).toBe('#ffb547')
    expect(annotationDefaultLayerColor('revision_cloud')).toBe('#ff6b6b')
  })

  it('leaves a plain click a 1200 by 600 cloud', () => {
    expect(DEFAULT_REVISION_CLOUD_WIDTH_MM).toBe(1200)
    expect(DEFAULT_REVISION_CLOUD_HEIGHT_MM).toBe(600)
  })

  it('carries an endpoint exactly on the Leader and the Arrow, and a target exactly on the Marker', () => {
    expect(ANNOTATION_TYPES.map(annotationTypeHasEndpoint)).toEqual([false, true, true, false, false])
    expect(ANNOTATION_TYPES.map(annotationTypeHasTarget)).toEqual([false, false, false, false, true])
  })
})

describe('the position and endpoint shapes (#81 §1)', () => {
  it('tells a cloud rectangle from a single point', () => {
    expect(annotationPositionIsRect({ x: 1, y: 2 })).toBe(false)
    expect(annotationPositionIsRect({ a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })).toBe(true)
  })

  it('tells an anchored endpoint from a free one', () => {
    expect(endpointIsAnchored({ anchor: { kind: 'entity', entityId: 'wall-1' as never } })).toBe(true)
    expect(endpointIsAnchored({ free: { x: 0, y: 0 } })).toBe(false)
  })
})

describe('duplicateAnnotationIds — what a duplicated Floor takes with it (#81 §9)', () => {
  it('takes the Annotations of the Floor’s own saved views and no others', () => {
    const envelope = JSON.parse(annotationsFixture) as { project: Parameters<typeof duplicateAnnotationIds>[0] }
    const project = envelope.project
    // The fixture draws four Annotations on `view-0` and one on the Elevation View of the same
    // Floor; a second Floor’s view owns none.
    expect(duplicateAnnotationIds(project, ['view-0' as never])).toEqual([
      'annotation-1',
      'annotation-2',
      'annotation-3',
      'annotation-4',
    ])
    expect(duplicateAnnotationIds(project, ['view-elevation-sink' as never])).toEqual(['annotation-5'])
    expect(duplicateAnnotationIds(project, ['view-1' as never])).toEqual([])
    expect(duplicateAnnotationIds(project, [])).toEqual([])
  })
})
