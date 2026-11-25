import { describe, expect, it } from 'vitest'
import {
  anchorChoosesScope,
  CHOOSING_ANCHOR_KINDS,
  COMMENT_ANCHOR_KINDS,
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_PRIORITIES,
  COMMENT_REFERENCE_MIN_DIGITS,
  COMMENT_REFERENCE_PATTERN,
  COMMENT_STATUSES,
  COMMENT_TITLE_MAX_LENGTH,
  commentAnchorFloorId,
  commentIsOpen,
  commentReferenceNumber,
  compareCommentReferences,
  COMMENT_SCOPE_ALL,
  DEFAULT_COMMENT_PRIORITY,
  DEFAULT_COMMENT_TITLE,
  DEFAULT_FEATURE_T,
  formatCommentReference,
  isCommentScopeAll,
  openComments,
  type Comment,
} from './index'

/**
 * The reference is the Comment's name in the world (#80 §1): `C-` and at least three digits, and
 * nothing else. A four-digit reference is legal — the counter runs up — and a two-digit one is not,
 * because the column has to sort and read the same width for the first thousand notes.
 */
describe('the Comment reference (#80 §1)', () => {
  it('accepts C- and three digits or more', () => {
    for (const reference of ['C-001', 'C-099', 'C-100', 'C-999', 'C-1000', 'C-12345']) {
      expect(COMMENT_REFERENCE_PATTERN.test(reference)).toBe(true)
    }
  })

  it('refuses every other shape', () => {
    for (const reference of [
      '',
      'C-',
      'C-01', // two digits is below the minimum width
      'C-0012 ', // and a trailing space is not a reference
      'c-001', // the prefix is upper case
      'K-001',
      '001',
      'C-00a',
      'C-0.1',
      'COMMENT-001',
    ]) {
      expect(COMMENT_REFERENCE_PATTERN.test(reference)).toBe(false)
    }
  })

  it('names the minimum width once, so the pattern and the message cannot drift', () => {
    expect(COMMENT_REFERENCE_MIN_DIGITS).toBe(3)
    expect('C-'.length + COMMENT_REFERENCE_MIN_DIGITS).toBe(5)
    expect(COMMENT_REFERENCE_PATTERN.test('C-00')).toBe(false)
  })

  it('reads the number back out of a reference, and answers null for anything else', () => {
    expect(commentReferenceNumber('C-001')).toBe(1)
    expect(commentReferenceNumber('C-042')).toBe(42)
    expect(commentReferenceNumber('C-1000')).toBe(1000)
    expect(commentReferenceNumber('C-01')).toBeNull()
    expect(commentReferenceNumber('')).toBeNull()
    expect(commentReferenceNumber('c-001')).toBeNull()
  })

  it('writes a reference at least three digits wide, zero padded', () => {
    expect(formatCommentReference(1)).toBe('C-001')
    expect(formatCommentReference(42)).toBe('C-042')
    expect(formatCommentReference(999)).toBe('C-999')
    expect(formatCommentReference(1000)).toBe('C-1000')
  })

  it('round-trips every number the counter can hold', () => {
    for (const value of [0, 1, 9, 10, 99, 100, 999, 1000, 123456]) {
      const reference = formatCommentReference(value)
      expect(COMMENT_REFERENCE_PATTERN.test(reference)).toBe(true)
      expect(commentReferenceNumber(reference)).toBe(value)
    }
  })

  it('sorts by number, not by string, so C-1000 follows C-999', () => {
    const references = ['C-1000', 'C-002', 'C-010', 'C-001', 'C-999']
    expect([...references].sort(compareCommentReferences)).toEqual([
      'C-001',
      'C-002',
      'C-010',
      'C-999',
      'C-1000',
    ])
    // A reference the reader cannot number sorts last rather than throwing: the list is a view, and a
    // view that crashes on one bad row is worse than one that parks it at the end.
    expect(compareCommentReferences('C-001', 'nonsense')).toBeLessThan(0)
    expect(compareCommentReferences('nonsense', 'C-001')).toBeGreaterThan(0)
    expect(compareCommentReferences('nonsense', 'rubbish')).toBeLessThan(0)
    expect(compareCommentReferences('same', 'same')).toBe(0)
  })
})

/**
 * The Anchor is the whole of what a Comment points at (#80 §2), and the eight kinds split into two
 * groups with different rules: the ones that name a record inherit their scope from it, and the ones
 * that name a place have to say which Design Option they mean.
 */
describe('the Comment Anchor (#80 §2)', () => {
  it('names all seven kinds', () => {
    expect(COMMENT_ANCHOR_KINDS).toEqual([
      'project',
      'floor',
      'design_option',
      'item_design',
      'entity',
      'feature',
      'floor_point',
    ])
  })

  it('marks exactly the four kinds that choose their own scope', () => {
    // A Project note, a Floor note and a design's note belong to something that is not itself filed
    // under one Option, so they say which Option they mean; a note pinned to a point of a Floor has
    // to say so too. The three that name a record already inside an answer inherit it.
    expect(CHOOSING_ANCHOR_KINDS).toEqual(['project', 'floor', 'item_design', 'floor_point'])
    for (const kind of COMMENT_ANCHOR_KINDS) {
      expect(anchorChoosesScope(kind)).toBe(CHOOSING_ANCHOR_KINDS.includes(kind))
    }
    expect(anchorChoosesScope('entity')).toBe(false)
    expect(anchorChoosesScope('feature')).toBe(false)
    expect(anchorChoosesScope('design_option')).toBe(false)
  })

  it('covers every kind with the choosing test, so a ninth kind cannot be forgotten silently', () => {
    // The stored vocabulary is snake_case like `air_con` and `removed_section`; the UI never shows it
    // (#80 criterion 19), so the only guard against a new kind is this one.
    expect(new Set(COMMENT_ANCHOR_KINDS).size).toBe(COMMENT_ANCHOR_KINDS.length)
    for (const kind of COMMENT_ANCHOR_KINDS) expect(typeof anchorChoosesScope(kind)).toBe('boolean')
  })

  it('names the Floor a Floor-shaped Anchor is on, and no Floor for the rest', () => {
    expect(commentAnchorFloorId({ kind: 'floor', floorId: 'floor-0' as never })).toBe('floor-0')
    expect(
      commentAnchorFloorId({ kind: 'floor_point', floorId: 'floor-0' as never, point: { x: 0, y: 0 } }),
    ).toBe('floor-0')
    expect(commentAnchorFloorId({ kind: 'project' })).toBeNull()
    expect(commentAnchorFloorId({ kind: 'entity', entityId: 'wall-1' as never })).toBeNull()
    expect(
      commentAnchorFloorId({ kind: 'feature', ownerId: 'wall-1' as never, featureId: 'leftFace' }),
    ).toBeNull()
    expect(commentAnchorFloorId({ kind: 'design_option', designOptionId: 'option-1' as never })).toBeNull()
    expect(commentAnchorFloorId({ kind: 'item_design', itemDesignId: 'design-1' as never })).toBeNull()
  })
})

describe('the Comment scope (#80 §1)', () => {
  it('spells the whole Project once', () => {
    expect(COMMENT_SCOPE_ALL).toBe('all')
    expect(isCommentScopeAll('all')).toBe(true)
    // An Option's ID is a real ID, and no ID is spelled `all`.
    expect(isCommentScopeAll('option-1')).toBe(false)
    expect(isCommentScopeAll('')).toBe(false)
  })
})

describe('the Comment status and priority (#80 §1, §5)', () => {
  it('has two statuses, open first', () => {
    expect(COMMENT_STATUSES).toEqual(['open', 'resolved'])
  })

  it('has three priorities with normal as the default', () => {
    expect(COMMENT_PRIORITIES).toEqual(['low', 'normal', 'high'])
    expect(DEFAULT_COMMENT_PRIORITY).toBe('normal')
  })

  it('titles a new Comment with words, not a placeholder', () => {
    expect(DEFAULT_COMMENT_TITLE).toBe('New comment')
    expect(DEFAULT_COMMENT_TITLE.trim()).toBe(DEFAULT_COMMENT_TITLE)
  })

  it('bounds the title and the body wide enough to be useful', () => {
    expect(COMMENT_TITLE_MAX_LENGTH).toBe(120)
    expect(COMMENT_BODY_MAX_LENGTH).toBe(4000)
    expect(COMMENT_BODY_MAX_LENGTH).toBeGreaterThan(COMMENT_TITLE_MAX_LENGTH)
  })
})

describe('open Comments (#80 §5)', () => {
  const comment = (id: string, status: Comment['status']): Comment => ({
    id: id as never,
    reference: `C-00${id.slice(-1)}`,
    title: 'A note',
    body: '',
    anchor: { kind: 'project' },
    status,
    priority: DEFAULT_COMMENT_PRIORITY,
    createdAt: '2026-11-23T09:00:00.000Z',
    updatedAt: '2026-11-23T09:00:00.000Z',
    scope: COMMENT_SCOPE_ALL,
  })

  it('reads the status without a caller spelling the string', () => {
    expect(commentIsOpen(comment('1', 'open'))).toBe(true)
    expect(commentIsOpen(comment('2', 'resolved'))).toBe(false)
  })

  it('keeps the open ones in the order they were stored', () => {
    const list = [comment('1', 'resolved'), comment('2', 'open'), comment('3', 'open')]
    expect(openComments(list).map((row) => row.id)).toEqual(['2', '3'])
    expect(openComments([])).toEqual([])
    // The badge on the panel counts these, so the count is the length and nothing else.
    expect(openComments(list)).toHaveLength(2)
  })
})

describe('the feature position default (#80 §8)', () => {
  it('starts a linear-feature Comment at the middle', () => {
    expect(DEFAULT_FEATURE_T).toBe(0.5)
  })
})
