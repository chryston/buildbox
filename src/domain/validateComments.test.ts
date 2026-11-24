/**
 * The Comment rejects of #80 §1, §2 and §Strict import, one test per rule the strict validator owns.
 *
 * The base is the #80 scene fixture — the renovation scene with one Comment of every Anchor kind, a
 * Resolved one carrying the Warning message it was written from, and a note anchored inside a
 * cabinet's own tree — so the accepts say the written bytes read, and the rejects are the ones the
 * editor would have refused before the note was ever typed: an Anchor that points at nothing, a
 * feature ID no kind registers, two Comments answering to one reference, a counter rewound behind a
 * number it has already handed out, a resolution time that disagrees with the status, and a scope
 * stored where the Anchor already answers the question.
 *
 * What is *not* refused is worth as much: a Comment with no body, a body holding a paragraph break,
 * a `t` exactly at either end of the feature, a counter of zero on a Project with no Comments, and a
 * Project that has never had one at all. Each has a test, because each is a note somebody wrote that
 * an over-eager reader would throw away.
 */
import { describe, expect, it } from 'vitest'
import commentsFixture from '../../fixtures/domain/v15/comments.json?raw'
import { validateProject } from './index'

type Rec = Record<string, unknown>

function base(): Rec {
  const envelope = JSON.parse(commentsFixture) as { domainSchemaVersion: number; project: Rec }
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

/** The Existing Model's records of one collection, so a test can name a real target. */
function modelOf(project: Rec, key: string): Rec[] {
  return ((project.existingModel as Rec)[key] ?? []) as Rec[]
}

/** The root of one cabinet Design's construction, which is its first registered space. */
function rootNodeOf(design: Rec): Rec {
  return (design.construction as Rec).root as Rec
}

/** The Comments, in the order the fixture writes them. */
function comments(project: Rec): Rec[] {
  return project.comments as Rec[]
}

/** The Comment at one index, so a test can say what it broke about it. */
function commentAt(project: Rec, index: number): Rec {
  return comments(project)[index]!
}

/** The scene with every Comment taken out, so a reject says only what it is about. */
function plain(): Rec {
  const project = base()
  project.comments = []
  project.commentReferenceCounter = 0
  return project
}

/** A Project with no Comment at all, filed at one index. */
function oneComment(project: Rec, comment: Rec): Rec {
  project.comments = [comment]
  project.commentReferenceCounter = 1
  return project
}

/** The smallest Comment that reads: a Project note, scoped to the whole Project. */
function note(anchor: Rec, over: Rec = {}): Rec {
  return {
    id: 'comment-x',
    reference: 'C-001',
    title: 'A note',
    body: '',
    anchor,
    status: 'open',
    priority: 'normal',
    createdAt: '2026-11-23T09:00:00.000Z',
    updatedAt: '2026-11-23T09:00:00.000Z',
    scope: 'all',
    ...over,
  }
}

const PROJECT_NOTE = 'comments[0]'
const FLOOR_NOTE = 'comments[1]'
const OPTION_NOTE = 'comments[2]'
const DESIGN_NOTE = 'comments[3]'
const ENTITY_NOTE = 'comments[4]'
const FACE_NOTE = 'comments[5]'
const SPACE_NOTE = 'comments[6]'
const POINT_NOTE = 'comments[7]'
const RESOLVED_NOTE = 'comments[8]'

/** The one problem every reject below is about, at one path. */
const only = (path: string, code: string): { path: string; code: string }[] => [{ path, code }]

describe('the Comments of the scene (#80 §1)', () => {
  it('reads every Anchor kind the fixture writes', () => {
    expectOk(base())
    expect(comments(base())).toHaveLength(9)
    expect(base().commentReferenceCounter).toBe(9)
  })

  it('reads a Project with no Comment at all', () => {
    // The empty case is the common one: every Project migrated from v14 arrives with both fields and
    // nothing in them, and an import that refused that would refuse the whole back catalogue.
    expectOk(plain())
  })

  it('refuses a Comment list that is not a list', () => {
    const project = base()
    project.comments = 'a note about the whole Project'
    expectProblems(project, only('comments', 'wrong-type'))
  })

  it('refuses a Comment list that is missing', () => {
    const project = base()
    delete project.comments
    expectProblems(project, only('comments', 'missing-field'))
  })

  it('refuses a counter that is missing', () => {
    const project = base()
    delete project.commentReferenceCounter
    expectProblems(project, only('commentReferenceCounter', 'missing-field'))
  })

  it('refuses an entry that is not a Comment', () => {
    const project = base()
    project.comments = ['C-001']
    expectProblems(project, only('comments[0]', 'wrong-type'))
  })
})

describe('the Comment reference (#80 §1)', () => {
  it('refuses a reference outside C- and three digits', () => {
    const project = base()
    commentAt(project, 0).reference = 'C-01'
    expectProblems(project, only(`${PROJECT_NOTE}.reference`, 'bad-format'))
  })

  it('refuses a reference in lower case, which is a different word', () => {
    const project = base()
    commentAt(project, 0).reference = 'c-001'
    expectProblems(project, only(`${PROJECT_NOTE}.reference`, 'bad-format'))
  })

  it('accepts a reference wider than three digits, because the counter runs up', () => {
    const project = plain()
    oneComment(project, note({ kind: 'project' }, { reference: 'C-1000' }))
    project.commentReferenceCounter = 1000
    expectOk(project)
  })

  it('refuses two Comments answering to one reference', () => {
    // The Warning strip names a Comment by its reference; two of them would make that sentence lie.
    const project = base()
    commentAt(project, 1).reference = 'C-001'
    expectProblems(project, only(`${FLOOR_NOTE}.reference`, 'duplicate-id'))
  })

  it('refuses an empty reference', () => {
    const project = base()
    commentAt(project, 0).reference = ''
    expectProblems(project, only(`${PROJECT_NOTE}.reference`, 'empty-text'))
  })
})

describe('the reference counter (#80 §1)', () => {
  it('accepts a counter equal to the highest reference in use', () => {
    // The counter IS the highest number handed out, so nine Comments ending at C-009 sit on nine.
    expectOk(base())
  })

  it('accepts a counter ahead of every reference, which is what deleting leaves', () => {
    const project = base()
    project.comments = [commentAt(project, 0)]
    project.commentReferenceCounter = 9
    expectOk(project)
  })

  it('refuses a counter rewound behind a reference it already handed out', () => {
    // Undo may never rewind this: a Project that came back from a deleted Comment and lost the number
    // would hand C-009 to the next note as well.
    const project = base()
    project.commentReferenceCounter = 8
    expectProblems(project, only('commentReferenceCounter', 'out-of-range'))
  })

  it('accepts a counter of zero on a Project with no Comments', () => {
    expectOk(plain())
  })

  it('refuses a negative or fractional counter', () => {
    const negative = plain()
    negative.commentReferenceCounter = -1
    expectProblems(negative, only('commentReferenceCounter', 'out-of-range'))
    const fraction = plain()
    fraction.commentReferenceCounter = 1.5
    expectProblems(fraction, only('commentReferenceCounter', 'out-of-range'))
  })

  it('refuses a counter that is not a number', () => {
    const project = plain()
    project.commentReferenceCounter = '9'
    expectProblems(project, only('commentReferenceCounter', 'wrong-type'))
  })
})

describe('the Comment identity (#80 §1)', () => {
  it('refuses two Comments with one id', () => {
    const project = base()
    commentAt(project, 1).id = commentAt(project, 0).id
    expectProblems(project, only(`${FLOOR_NOTE}.id`, 'duplicate-id'))
  })

  it('refuses a Comment sharing an id with a Wall', () => {
    // A Comment lives in the Project-wide ID namespace, so a copy that forgot to remap is caught here
    // rather than by whichever tool happens to look an ID up first.
    const project = base()
    const wallId = modelOf(project, 'walls')[0]!.id
    commentAt(project, 0).id = wallId
    expectProblems(project, only(`${PROJECT_NOTE}.id`, 'duplicate-id'))
  })

  it('refuses a field that reads like an author', () => {
    // #80 §15 names this refusal: a Comment records the work, not the person who typed it, and a file
    // carrying `author` would promise an audit trail the app never writes.
    const project = base()
    commentAt(project, 0).author = 'C. Hreston'
    expectProblems(project, only(`${PROJECT_NOTE}.author`, 'unknown-field'))
  })

  it('refuses a field the Comment does not store, whatever it is called', () => {
    const project = base()
    commentAt(project, 0).pinned = true
    expectProblems(project, only(`${PROJECT_NOTE}.pinned`, 'unknown-field'))
  })
})

describe('the Comment title and body (#80 §1)', () => {
  it('refuses an empty title', () => {
    const project = base()
    commentAt(project, 0).title = ''
    expectProblems(project, only(`${PROJECT_NOTE}.title`, 'empty-text'))
  })

  it('refuses a title over the bound, and accepts one at it', () => {
    const project = base()
    commentAt(project, 0).title = 'x'.repeat(121)
    expectProblems(project, only(`${PROJECT_NOTE}.title`, 'out-of-range'))
    const edge = base()
    commentAt(edge, 0).title = 'x'.repeat(120)
    expectOk(edge)
  })

  it('refuses a title holding a line break, because a row is one line', () => {
    const project = base()
    commentAt(project, 0).title = 'Two\nlines'
    expectProblems(project, only(`${PROJECT_NOTE}.title`, 'bad-format'))
  })

  it('accepts a body that is empty', () => {
    // A title alone is a note somebody finished writing; the body is the optional half.
    const project = base()
    commentAt(project, 0).body = ''
    expectOk(project)
  })

  it('refuses a body over the bound, and accepts one at it', () => {
    const project = base()
    commentAt(project, 0).body = 'x'.repeat(4001)
    expectProblems(project, only(`${PROJECT_NOTE}.body`, 'out-of-range'))
    const edge = base()
    commentAt(edge, 0).body = 'x'.repeat(4000)
    expectOk(edge)
  })

  it('accepts a body holding a paragraph break or a tab', () => {
    const project = base()
    commentAt(project, 0).body = 'First paragraph.\n\nSecond one, with a\ttab.'
    expectOk(project)
  })

  it('refuses a body holding any other control character', () => {
    const project = base()
    commentAt(project, 0).body = `A ${String.fromCharCode(7)}bell in the middle`
    expectProblems(project, only(`${PROJECT_NOTE}.body`, 'bad-format'))
  })
})

describe('the Comment status and priority (#80 §1, §5)', () => {
  it('refuses a status outside the two it knows', () => {
    const project = base()
    commentAt(project, 0).status = 'closed'
    expectProblems(project, only(`${PROJECT_NOTE}.status`, 'not-one-of'))
  })

  it('refuses a priority outside the three it knows', () => {
    const project = base()
    commentAt(project, 0).priority = 'urgent'
    expectProblems(project, only(`${PROJECT_NOTE}.priority`, 'not-one-of'))
  })

  it('refuses a Resolved Comment that cannot say when it stopped mattering', () => {
    const project = base()
    delete commentAt(project, 8).resolvedAt
    expectProblems(project, only(`${RESOLVED_NOTE}.resolvedAt`, 'missing-field'))
  })

  it('refuses an Open Comment carrying a resolution time, which Reopen clears', () => {
    const project = base()
    commentAt(project, 0).resolvedAt = '2026-11-24T02:15:00.000Z'
    expectProblems(project, only(`${PROJECT_NOTE}.resolvedAt`, 'unknown-field'))
  })

  it('refuses a missing timestamp', () => {
    const project = base()
    delete commentAt(project, 0).createdAt
    expectProblems(project, only(`${PROJECT_NOTE}.createdAt`, 'missing-field'))
  })
})

describe('the linked Warning (#80 §11)', () => {
  it('reads the key and the message a Resolved Comment was written from', () => {
    expectOk(base())
    expect(commentAt(base(), 8).linkedWarning).toMatchObject({ key: expect.any(String), message: expect.any(String) })
  })

  it('refuses a link with no message', () => {
    const project = base()
    delete (commentAt(project, 8).linkedWarning as Rec).message
    expectProblems(project, only(`${RESOLVED_NOTE}.linkedWarning.message`, 'missing-field'))
  })

  it('refuses a link carrying anything beside the key and the message', () => {
    // The link is a snapshot of what the strip said, not a live pointer to a Warning that may be gone.
    const project = base()
    ;(commentAt(project, 8).linkedWarning as Rec).warningId = 'warning-1'
    expectProblems(project, only(`${RESOLVED_NOTE}.linkedWarning.warningId`, 'unknown-field'))
  })

  it('refuses a link that is not a key and a message', () => {
    const project = base()
    commentAt(project, 8).linkedWarning = 'wall_crossing|wall-1|'
    expectProblems(project, only(`${RESOLVED_NOTE}.linkedWarning`, 'wrong-type'))
  })

  it('accepts an Open Comment with no link, and a Resolved one with none', () => {
    // A link is only there when the Comment came from the strip; a note typed by hand has nothing to
    // remember.
    const project = base()
    delete commentAt(project, 8).linkedWarning
    expectOk(project)
  })
})

describe('the Comment Anchor (#80 §2)', () => {
  it('refuses a Comment with no Anchor at all', () => {
    // An Anchor is the whole record's meaning; a note that points nowhere cannot be found again.
    const project = base()
    delete commentAt(project, 0).anchor
    expectProblems(project, only(`${PROJECT_NOTE}.anchor`, 'missing-field'))
  })

  it('refuses an Anchor that is not a typed pointer', () => {
    const project = base()
    commentAt(project, 0).anchor = 'the whole Project'
    expectProblems(project, only(`${PROJECT_NOTE}.anchor`, 'wrong-type'))
  })

  it('refuses an Anchor kind outside the seven', () => {
    const project = base()
    commentAt(project, 0).anchor = { kind: 'layer' }
    expectProblems(project, only(`${PROJECT_NOTE}.anchor.kind`, 'not-one-of'))
  })

  it('refuses a stored vocabulary spelled the way the prose spells it', () => {
    // The stored names are snake_case like `air_con`; `left_face` and `floorPoint` are both somebody
    // else's spelling and resolve to nothing.
    const project = base()
    commentAt(project, 0).anchor = { kind: 'floorPoint', floorId: 'seed-001', point: { x: 0, y: 0 } }
    // The kind is refused, and the two fields it would have used are refused beside it: an unknown
    // kind registers no fields, so nothing about the pointer is believed.
    expectProblems(project, [
      { path: `${PROJECT_NOTE}.anchor.kind`, code: 'not-one-of' },
      { path: `${PROJECT_NOTE}.anchor.floorId`, code: 'unknown-field' },
      { path: `${PROJECT_NOTE}.anchor.point`, code: 'unknown-field' },
    ])
  })

  it('refuses an Anchor carrying a field its kind does not use', () => {
    const project = base()
    commentAt(project, 0).anchor = { kind: 'project', floorId: 'seed-001' }
    expectProblems(project, only(`${PROJECT_NOTE}.anchor.floorId`, 'unknown-field'))
  })

  it('refuses an unresolved Floor', () => {
    const project = base()
    commentAt(project, 1).anchor = { kind: 'floor', floorId: 'floor-gone' }
    expectProblems(project, only(`${FLOOR_NOTE}.anchor.floorId`, 'dangling-reference'))
  })

  it('refuses an unresolved Design Option', () => {
    const project = base()
    commentAt(project, 2).anchor = { kind: 'design_option', designOptionId: 'option-gone' }
    expectProblems(project, only(`${OPTION_NOTE}.anchor.designOptionId`, 'dangling-reference'))
  })

  it('refuses an unresolved Item Design', () => {
    const project = base()
    commentAt(project, 3).anchor = { kind: 'item_design', itemDesignId: 'unit-gone' }
    expectProblems(project, only(`${DESIGN_NOTE}.anchor.itemDesignId`, 'dangling-reference'))
  })

  it('refuses an entity Anchor that names nothing in either model', () => {
    const project = base()
    commentAt(project, 4).anchor = { kind: 'entity', entityId: 'wall-gone' }
    expectProblems(project, only(`${ENTITY_NOTE}.anchor.entityId`, 'dangling-reference'))
  })

  it('accepts an entity Anchor naming work a Design Option is proposing', () => {
    // Both models are in scope: a note about a Wall an Option would build is a note about this Project.
    const project = plain()
    const copy = structuredClone(modelOf(project, 'placedItems')[0]) as Rec
    copy.id = 'place-proposed'
    copy.predecessorIds = []
    ;((project.designOptions as Rec[])[0]!.proposed as Rec).placedItems = [copy]
    oneComment(project, note({ kind: 'entity', entityId: 'place-proposed' }))
    commentAt(project, 0).scope = undefined
    expectOk(project)
  })

  it('refuses a Floor Point on a Floor that is not there', () => {
    const project = base()
    commentAt(project, 7).anchor = { kind: 'floor_point', floorId: 'floor-gone', point: { x: 10, y: 20 } }
    expectProblems(project, only(`${POINT_NOTE}.anchor.floorId`, 'dangling-reference'))
  })

  it('refuses a Floor Point with no point', () => {
    const project = base()
    commentAt(project, 7).anchor = { kind: 'floor_point', floorId: 'seed-001' }
    expectProblems(project, only(`${POINT_NOTE}.anchor.point`, 'missing-field'))
  })

  it('refuses a Floor Point holding a number it cannot draw', () => {
    // Each of the three is refused, and each at the half of the point that is wrong.
    const cases: [unknown, string, string][] = [
      [{ x: Number.NaN, y: 0 }, 'comments[7].anchor.point.x', 'out-of-range'],
      [{ x: Number.POSITIVE_INFINITY, y: 0 }, 'comments[7].anchor.point.x', 'out-of-range'],
      [{ x: 0 }, 'comments[7].anchor.point.y', 'missing-field'],
    ]
    for (const [point, path, code] of cases) {
      const project = base()
      commentAt(project, 7).anchor = { kind: 'floor_point', floorId: 'seed-001', point }
      expect(problemsOf(project)).toEqual(only(path, code))
    }
  })
})

describe('the feature Anchor (#80 §2)', () => {
  it('reads a Wall face and a cabinet space', () => {
    expectOk(base())
    expect(commentAt(base(), 5).anchor).toMatchObject({ kind: 'feature', featureId: 'leftFace', t: 0.5 })
    expect(commentAt(base(), 6).anchor).toMatchObject({ kind: 'feature' })
    // The two feature Comments are the two owner kinds: a Wall's face and one space of one cabinet.
    expect((commentAt(base(), 5).anchor as Rec).ownerId).toBe(modelOf(base(), 'walls')[0]!.id)
    expect((commentAt(base(), 6).anchor as Rec).ownerId).toBe(
      (base().itemDesigns as Rec[]).find((design) => design.kind === 'cabinet')!.id,
    )
    expect(comments(base()).filter((comment) => (comment.anchor as Rec).kind === 'feature')).toHaveLength(2)
  })

  it('refuses a cabinet space that is not a space of the cabinet named', () => {
    // The fixture's own space Comment, broken by naming a Wall face instead: the dynamic set belongs to
    // one design's tree, and a Wall's vocabulary cannot widen it.
    const project = base()
    ;(commentAt(project, 6).anchor as Rec).featureId = 'leftFace'
    expectProblems(project, only(`${SPACE_NOTE}.anchor.featureId`, 'not-one-of'))
  })

  it('refuses a feature Anchor naming an owner the Project does not have', () => {
    const project = base()
    commentAt(project, 5).anchor = { kind: 'feature', ownerId: 'wall-gone', featureId: 'leftFace' }
    expectProblems(project, only(`${FACE_NOTE}.anchor.ownerId`, 'dangling-reference'))
  })

  it('refuses a feature ID no kind registers', () => {
    const project = base()
    commentAt(project, 5).anchor = {
      kind: 'feature',
      ownerId: modelOf(project, 'walls')[0]!.id,
      featureId: 'underside',
    }
    // A Wall has two faces and two ends; an underside is a Beam's word, so the registry refuses it.
    expectProblems(project, only(`${FACE_NOTE}.anchor.featureId`, 'not-one-of'))
  })

  it('refuses a feature ID on a kind that registers nothing', () => {
    const project = plain()
    const room = modelOf(project, 'rooms')[0]
    if (room === undefined) return
    oneComment(project, note({ kind: 'feature', ownerId: room.id, featureId: 'start' }))
    commentAt(project, 0).scope = undefined
    // A Room has no named parts, so a Comment on it is a Comment on the Room.
    expectProblems(project, only('comments[0].anchor.featureId', 'not-one-of'))
  })

  it('refuses a cabinet space of a different cabinet', () => {
    // The dynamic set belongs to one design's tree, not to every cabinet in the Project.
    const project = plain()
    const [first, second] = (project.itemDesigns as Rec[]).filter((design) => design.kind === 'cabinet')
    if (first === undefined || second === undefined) return
    const otherSpace = rootNodeOf(second).id
    oneComment(project, note({ kind: 'feature', ownerId: first.id, featureId: otherSpace }))
    commentAt(project, 0).scope = undefined
    expectProblems(project, only('comments[0].anchor.featureId', 'not-one-of'))
  })

  it('accepts a space of the cabinet the Anchor names', () => {
    const project = plain()
    const cabinet = (project.itemDesigns as Rec[]).find((design) => design.kind === 'cabinet')
    if (cabinet === undefined) return
    oneComment(project, note({ kind: 'feature', ownerId: cabinet.id, featureId: rootNodeOf(cabinet).id }))
    commentAt(project, 0).scope = undefined
    expectOk(project)
  })

  it('refuses a position along the feature outside the feature', () => {
    for (const t of [1.5, -0.1, 100]) {
      const project = base()
      ;(commentAt(project, 5).anchor as Rec).t = t
      expect(problemsOf(project)).toEqual(only(`${FACE_NOTE}.anchor.t`, 'out-of-range'))
    }
  })

  it('accepts a position at either end, and none at all', () => {
    for (const t of [0, 0.25, 1, undefined]) {
      const project = base()
      const anchor = commentAt(project, 5).anchor as Rec
      if (t === undefined) delete anchor.t
      else anchor.t = t
      expectOk(project)
    }
  })

  it('refuses a position that is not a number', () => {
    const project = base()
    ;(commentAt(project, 5).anchor as Rec).t = 'middle'
    expectProblems(project, only(`${FACE_NOTE}.anchor.t`, 'wrong-type'))
  })
})

describe('the Comment scope (#80 §1)', () => {
  it('refuses a stored scope on an Anchor that inherits one', () => {
    // The entity already answers "which Option?"; a second answer there is a row that reads one thing
    // in the panel and draws another on the canvas.
    const project = base()
    commentAt(project, 4).scope = 'all'
    expectProblems(project, only(`${ENTITY_NOTE}.scope`, 'unknown-field'))
  })

  it('refuses a stored scope on a feature Anchor and on a Design Option Anchor', () => {
    const project = base()
    commentAt(project, 5).scope = 'option-a'
    commentAt(project, 2).scope = 'all'
    expectProblems(project, [
      { path: `${OPTION_NOTE}.scope`, code: 'unknown-field' },
      { path: `${FACE_NOTE}.scope`, code: 'unknown-field' },
    ])
  })

  it('refuses a choosing Anchor with no scope', () => {
    const project = base()
    delete commentAt(project, 0).scope
    expectProblems(project, only(`${PROJECT_NOTE}.scope`, 'missing-field'))
  })

  it('refuses a scope naming a Design Option the Project does not have', () => {
    const project = base()
    commentAt(project, 7).scope = 'option-gone'
    expectProblems(project, only(`${POINT_NOTE}.scope`, 'dangling-reference'))
  })

  it('accepts "all" and either Option on a choosing Anchor', () => {
    for (const scope of ['all', 'option-a', 'option-b']) {
      const project = base()
      commentAt(project, 7).scope = scope
      expectOk(project)
    }
  })

  it('says nothing about scope when the Anchor itself could not be read', () => {
    // One problem per broken thing: inventing a scope complaint about an Anchor this pass could not
    // place would point the reader at the wrong line.
    const project = base()
    commentAt(project, 0).anchor = { kind: 'nonsense' }
    expectProblems(project, only(`${PROJECT_NOTE}.anchor.kind`, 'not-one-of'))
  })
})
