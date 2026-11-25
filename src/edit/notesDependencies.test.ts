/**
 * The Notes dependency review at the edit layer (#82 §1–§5, §7).
 *
 * Each block asks one operation of a Project that has notes hanging off it and reads the answer the
 * same way the dialog will: `previewIntent(...).notes` for the question, and an Intent carrying
 * `notesResolutions` for the answer. The sentences are asserted as well as the codes because the
 * refusal is what a user who closes the dialog without answering is told, and the fingerprint is what
 * makes an answer that has gone stale refuse rather than misapply.
 */
import { describe, expect, it } from 'vitest'
import { COMMENT_SCOPE_ALL, type Annotation, type Comment, type EntityId, type Project } from '../domain'
import { pt } from '../geometry'
import { applyIntent, applyPatches, previewIntent } from './apply'
import type { Intent, NotesDependencyReport, NotesResolution, PayloadOf } from './intents'
import { notesDependencyReport } from './notesDependencies'
import { expectApplied, idSource, intent, newProject } from './testing'

const source = idSource('notes')
const NOW = '2026-11-18T09:00:00.000Z'
const LATER = '2026-11-19T14:30:00.000Z'

const floorOf = (project: Project): EntityId => project.floors[0]!.id
const viewOf = (project: Project): EntityId => project.views[0]!.id
const wallOf = (project: Project): EntityId => project.existingModel.walls[0]!.id
const commentAt = (project: Project, index = 0): Comment => project.comments[index]!
const annotationAt = (project: Project, index = 0): Annotation => project.annotations[index]!

/** The same Intent with the review answered. */
const answered = (next: Intent, notesResolutions: readonly NotesResolution[]): Intent => ({ ...next, notesResolutions }) as Intent

/** The report this Intent would show, or `null` when it shows none. A refusal is a fixture bug. */
const notesOf = (project: Project, next: Intent): NotesDependencyReport | null => {
  const { notes, rejection } = previewIntent(project, next)
  if (rejection !== null) throw new Error(`${next.type} was refused with ${rejection.code}: ${rejection.problems[0]!.message}`)
  return notes
}

function withWall(project: Project): Project {
  return expectApplied(
    project,
    intent(
      'wall.createChain',
      {
        floorId: floorOf(project),
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
      source(4),
    ),
  ).project
}

/** A Project with one Wall and one Comment about it. */
function anchoredComment(): { project: Project; wallId: EntityId; comment: Comment } {
  const base = withWall(newProject())
  const wallId = wallOf(base)
  const project = expectApplied(
    base,
    intent('comment.create', { anchor: { kind: 'entity', entityId: wallId }, title: 'Tile set out', body: 'From the left end.', priority: 'normal', at: NOW }, source(1)),
  ).project
  return { project, wallId, comment: commentAt(project) }
}

/** A Project with one Wall, a second Wall, and a Comment about the first. */
function twoWalls(): { project: Project; wallId: EntityId; otherId: EntityId; comment: Comment } {
  const base = expectApplied(
    newProject(),
    intent(
      'wall.createChain',
      {
        floorId: floorOf(newProject()),
        walls: [
          { line: { kind: 'line', start: pt(0, 0), end: pt(4000, 0) }, thickness: 100, justification: 'centre', baseElevation: 0, height: 2600 },
          { line: { kind: 'line', start: pt(0, 0), end: pt(0, 3000) }, thickness: 100, justification: 'centre', baseElevation: 0, height: 2600 },
        ],
        starts: [{ kind: 'free' }, { kind: 'free' }],
        ends: [{ kind: 'free' }, { kind: 'free' }],
      },
      source(8),
    ),
  ).project
  const [wallId, otherId] = base.existingModel.walls.map((wall) => wall.id)
  const project = expectApplied(
    base,
    intent('comment.create', { anchor: { kind: 'entity', entityId: wallId! }, title: 'Tile set out', body: 'From the left end.', priority: 'normal', at: NOW }, source(1)),
  ).project
  return { project, wallId: wallId!, otherId: otherId!, comment: commentAt(project) }
}

/** A Project with a named Plan View holding one Text Annotation. */
function annotatedView(): { project: Project; viewId: EntityId; annotation: Annotation } {
  const base = newProject()
  const [viewId] = source(1)
  const withView = expectApplied(base, intent('view.create', { floorId: floorOf(base), name: 'Tile setting out' }, [viewId!])).project
  const withMark = expectApplied(
    withView,
    intent('annotation.create', { viewId: viewId!, type: 'text', position: pt(1000, 2000), text: 'Fall to waste here', layerId: null, scope: COMMENT_SCOPE_ALL }, source(2)),
  ).project
  return { project: withMark, viewId: viewId!, annotation: annotationAt(withMark) }
}

describe('the Notes dependency report (#82 §2)', () => {
  it('lists the note a Wall deletion would strand, about the Wall it is about', () => {
    const { project, wallId, comment } = anchoredComment()
    const report = notesOf(project, intent('wall.delete', { wallId }))
    expect(report).not.toBeNull()
    expect(report!.subject).toEqual({ kind: 'entity', label: project.existingModel.walls[0]!.ref })
    expect(report!.rows).toHaveLength(1)
    const row = report!.rows[0]!
    expect(row).toMatchObject({
      dependentId: comment.id,
      kind: 'comment',
      reference: 'C-001',
      title: 'Tile set out',
      status: 'open',
      annotationType: null,
      owningViewName: null,
      targetViewName: null,
      anchorLabel: `“${project.existingModel.walls[0]!.ref}”`,
      choices: ['floor_point', 'reanchor', 'delete'],
      preset: null,
      floorPointDisabled: false,
      note: null,
    })
    expect(row.fingerprint).not.toHaveLength(0)
  })

  it('offers no target that this operation is deleting', () => {
    const { project, wallId, otherId } = twoWalls()
    const report = notesOf(project, intent('wall.delete', { wallId }))!
    const kinds = new Set(report.rows[0]!.targets.map((target) => target.kind))
    expect(kinds).toEqual(new Set(['project', 'floor', 'entity', 'feature', 'item_design']))
    const entityIds = report.rows[0]!.targets.flatMap((target) => ('entityId' in target ? [target.entityId] : []))
    expect(entityIds).not.toContain(wallId)
    expect(entityIds).toContain(otherId)
  })

  it('says nothing about an edit that keeps every Anchor resolvable (#82 §1, criterion 6)', () => {
    const { project, wallId } = anchoredComment()
    expect(notesOf(project, intent('wall.setThickness', { wallId, thickness: 150 }))).toBeNull()
    expect(notesOf(project, intent('wall.setLength', { wallId, length: 3000, keepFixed: 'start' }))).toBeNull()
  })

  it('says nothing when there is no note to ask about', () => {
    const { project, wallId } = anchoredComment()
    const bare = { ...project, comments: [] }
    expect(notesOf(bare, intent('wall.delete', { wallId }))).toBeNull()
  })

  it('asks a view deletion to delete what draws in it, and only that (#82 §3, criterion 7)', () => {
    const { project, viewId, annotation } = annotatedView()
    const report = notesOf(project, intent('view.delete', { viewId }))!
    expect(report.subject).toEqual({ kind: 'view', label: 'Tile setting out' })
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      dependentId: annotation.id,
      kind: 'annotation',
      reference: 'A-001',
      owningViewName: 'Tile setting out',
      choices: ['delete'],
      preset: 'delete',
      note: 'deleted-with-view',
      floorPointDisabled: true,
    })
    expect(report.rows[0]!.targets).toEqual([])
  })

  it('offers a Reference Marker a view to move to, never the one going (#82 §4, criterion 9)', () => {
    const base = newProject()
    const [fromId, toId, otherId] = source(3)
    const withViews = expectApplied(
      expectApplied(
        expectApplied(base, intent('view.create', { floorId: floorOf(base), name: 'Kitchen · North Elevation' }, [fromId!])).project,
        intent('view.create', { floorId: floorOf(base), name: 'Base 600 · Item Detail' }, [toId!]),
      ).project,
      intent('view.create', { floorId: floorOf(base), name: 'Pantry · West Elevation' }, [otherId!]),
    ).project
    const withMark = expectApplied(
      withViews,
      intent(
        'annotation.create',
        {
          viewId: fromId!,
          type: 'reference_marker',
          position: pt(900, 900),
          text: 'Detail here',
          layerId: null,
          scope: COMMENT_SCOPE_ALL,
          targetViewId: toId!,
        },
        source(2),
      ),
    ).project
    const report = notesOf(withMark, intent('view.delete', { viewId: toId! }))!
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ kind: 'reference_marker', reference: 'A-001', targetViewName: 'Base 600 · Item Detail', choices: ['reanchor', 'delete'] })
    const views = report.rows[0]!.targets.flatMap((target) => ('viewId' in target ? [target.viewId] : []))
    expect(views).toContain(otherId!)
    expect(views).not.toContain(toId!)
  })

  it('asks a Design Option deletion to choose, and says Keep means All Options (#82 §3, criterion 10)', () => {
    const base = newProject()
    const withOption = expectApplied(base, intent('designOption.create', { name: 'Option B' }, source(1))).project
    const optionId = withOption.designOptions![0]!.id
    const withNote = expectApplied(
      withOption,
      intent('comment.create', { anchor: { kind: 'design_option', designOptionId: optionId }, title: 'Island height', body: 'Confirm with joiner.', priority: 'normal', at: NOW }, source(1)),
    ).project
    const report = notesOf(withNote, intent('designOption.delete', { optionId }))!
    expect(report.subject).toEqual({ kind: 'design_option', label: 'Option B' })
    expect(report.rows[0]).toMatchObject({ choices: ['delete', 'keep'], preset: 'delete', note: 'keep-all-options', floorPointDisabled: true })
  })

  it('asks a Floor deletion about its Floor Comments (#82 §3, criterion 8)', () => {
    const base = newProject()
    const withFloor = expectApplied(base, intent('floor.create', { name: 'Level 2' }, source(2))).project
    const floorId = withFloor.floors[1]!.id
    const withNote = expectApplied(
      withFloor,
      intent('comment.create', { anchor: { kind: 'floor', floorId }, scope: COMMENT_SCOPE_ALL, title: 'Services riser', body: 'Confirm duct size.', priority: 'normal', at: NOW }, source(1)),
    ).project
    const report = notesOf(withNote, intent('floor.delete', { floorId }))!
    expect(report.subject).toEqual({ kind: 'floor', label: 'Level 2' })
    expect(report.rows[0]).toMatchObject({ choices: ['delete', 'keep'], preset: 'delete', note: 'keep-all-options' })
  })

  it('lists Comments first and each family by its own reference (#82 Notes)', () => {
    const base = withWall(newProject())
    const wallId = wallOf(base)
    const withNotes = expectApplied(
      expectApplied(
        base,
        intent('comment.create', { anchor: { kind: 'entity', entityId: wallId }, title: 'Second note', body: 'B.', priority: 'normal', at: NOW }, source(1)),
      ).project,
      intent('comment.create', { anchor: { kind: 'entity', entityId: wallId }, title: 'First note', body: 'A.', priority: 'normal', at: NOW }, source(1)),
    ).project
    const report = notesOf(withNotes, intent('wall.delete', { wallId }))!
    expect(report.rows.map((row) => row.reference)).toEqual(['C-001', 'C-002'])
  })

  it('is the same question the deletion guard asks, and no more', () => {
    const { project } = anchoredComment()
    const after = { ...project, existingModel: { ...project.existingModel, walls: [] } }
    expect(notesDependencyReport(project, after)!.rows).toHaveLength(1)
    expect(notesDependencyReport(project, project)).toBeNull()
  })
})

describe('carrying the answers into the transaction (#82 §3, §5)', () => {
  it('refuses an unanswered delete and changes nothing (#82 §1)', () => {
    const { project, wallId } = anchoredComment()
    const before = JSON.stringify(project)
    const result = applyIntent(project, intent('wall.delete', { wallId }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.code).toBe('has-dependants')
    expect(JSON.stringify(project)).toBe(before)
  })

  it('leaves a Floor Point where the note stood, with its scope written down (#82 §3, criterion 3)', () => {
    const { project, wallId, comment } = anchoredComment()
    const applied = expectApplied(
      project,
      answered(intent('wall.delete', { wallId }), [
        { dependentId: comment.id, choice: 'floor_point', expectedAnchor: notesOf(project, intent('wall.delete', { wallId }))!.rows[0]!.fingerprint },
      ]),
    )
    const moved = commentAt(applied.project)
    expect(moved.anchor.kind).toBe('floor_point')
    if (moved.anchor.kind !== 'floor_point') throw new Error('expected a Floor Point')
    expect(moved.anchor.floorId).toBe(floorOf(project))
    expect(moved.anchor.point).not.toEqual(pt(400, 250))
    expect(moved.scope).toBe(COMMENT_SCOPE_ALL)
    expect(moved.updatedAt).toBe(NOW)
    expect(applied.project.existingModel.walls).toHaveLength(0)
  })

  it('reanchors to the target the user chose and drops the inherited scope (#82 §3, criterion 4)', () => {
    const { project, wallId, otherId, comment } = twoWalls()
    const report = notesOf(project, intent('wall.delete', { wallId }))!
    const applied = expectApplied(
      project,
      answered(intent('wall.delete', { wallId }), [{ dependentId: comment.id, choice: 'reanchor', targetRef: { kind: 'entity', entityId: otherId }, expectedAnchor: report.rows[0]!.fingerprint }]),
    )
    expect(commentAt(applied.project).anchor).toEqual({ kind: 'entity', entityId: otherId })
    expect(commentAt(applied.project).scope).toBeUndefined()
  })

  it('deletes only the note the user said to delete (#82 §3, criterion 5)', () => {
    const base = withWall(newProject())
    const wallId = wallOf(base)
    const withNotes = expectApplied(
      expectApplied(
        base,
        intent('comment.create', { anchor: { kind: 'entity', entityId: wallId }, title: 'Goes', body: 'A.', priority: 'normal', at: NOW }, source(1)),
      ).project,
      intent('comment.create', { anchor: { kind: 'floor', floorId: floorOf(base) }, scope: COMMENT_SCOPE_ALL, title: 'Stays', body: 'B.', priority: 'normal', at: NOW }, source(1)),
    ).project
    const report = notesOf(withNotes, intent('wall.delete', { wallId }))!
    expect(report.rows.map((row) => row.reference)).toEqual(['C-001'])
    const applied = expectApplied(
      withNotes,
      answered(intent('wall.delete', { wallId }), [{ dependentId: commentAt(withNotes).id, choice: 'delete', expectedAnchor: report.rows[0]!.fingerprint }]),
    )
    expect(applied.project.comments.map((each) => each.title)).toEqual(['Stays'])
  })

  it('deletes what drew in a view, and nothing else (#82 criterion 7)', () => {
    const { project, viewId, annotation } = annotatedView()
    const report = notesOf(project, intent('view.delete', { viewId }))!
    const applied = expectApplied(project, answered(intent('view.delete', { viewId }), [{ dependentId: annotation.id, choice: 'delete', expectedAnchor: report.rows[0]!.fingerprint }]))
    expect(applied.project.annotations).toHaveLength(0)
    expect(applied.project.views.map((view) => view.id)).not.toContain(viewId)
  })

  it('moves a Reference Marker to the view the user chose (#82 criterion 9)', () => {
    const base = newProject()
    const [fromId, toId, otherId] = source(3)
    const withViews = expectApplied(
      expectApplied(
        expectApplied(base, intent('view.create', { floorId: floorOf(base), name: 'Kitchen · North Elevation' }, [fromId!])).project,
        intent('view.create', { floorId: floorOf(base), name: 'Base 600 · Item Detail' }, [toId!]),
      ).project,
      intent('view.create', { floorId: floorOf(base), name: 'Pantry · West Elevation' }, [otherId!]),
    ).project
    const withMark = expectApplied(
      withViews,
      intent('annotation.create', { viewId: fromId!, type: 'reference_marker', position: pt(900, 900), text: 'Detail here', layerId: null, scope: COMMENT_SCOPE_ALL, targetViewId: toId! }, source(2)),
    ).project
    const report = notesOf(withMark, intent('view.delete', { viewId: toId! }))!
    const applied = expectApplied(
      withMark,
      answered(intent('view.delete', { viewId: toId! }), [{ dependentId: annotationAt(withMark).id, choice: 'reanchor', targetRef: { kind: 'view', viewId: otherId! }, expectedAnchor: report.rows[0]!.fingerprint }]),
    )
    expect(annotationAt(applied.project).targetViewId).toBe(otherId!)
  })

  it('keeps a note about a deleted Option at All Options (#82 §3, criterion 10)', () => {
    const base = newProject()
    const withOption = expectApplied(base, intent('designOption.create', { name: 'Option B' }, source(1))).project
    const optionId = withOption.designOptions![0]!.id
    const withNote = expectApplied(
      withOption,
      intent('comment.create', { anchor: { kind: 'design_option', designOptionId: optionId }, title: 'Island height', body: 'Confirm.', priority: 'normal', at: NOW }, source(1)),
    ).project
    const report = notesOf(withNote, intent('designOption.delete', { optionId }))!
    const applied = expectApplied(withNote, answered(intent('designOption.delete', { optionId }), [{ dependentId: commentAt(withNote).id, choice: 'keep', expectedAnchor: report.rows[0]!.fingerprint }]))
    expect(commentAt(applied.project).scope).toBe(COMMENT_SCOPE_ALL)
    expect(applied.project.comments).toHaveLength(1)
  })

  it('keeps a Floor Comment when the Floor goes and the user says Keep (#82 criterion 8)', () => {
    const base = newProject()
    const withFloor = expectApplied(base, intent('floor.create', { name: 'Level 2' }, source(2))).project
    const floorId = withFloor.floors[1]!.id
    const withNote = expectApplied(
      withFloor,
      intent('comment.create', { anchor: { kind: 'floor', floorId }, scope: COMMENT_SCOPE_ALL, title: 'Services riser', body: 'Confirm.', priority: 'normal', at: NOW }, source(1)),
    ).project
    const report = notesOf(withNote, intent('floor.delete', { floorId }))!
    const applied = expectApplied(withNote, answered(intent('floor.delete', { floorId }), [{ dependentId: commentAt(withNote).id, choice: 'keep', expectedAnchor: report.rows[0]!.fingerprint }]))
    expect(commentAt(applied.project).anchor).toEqual({ kind: 'project' })
    expect(commentAt(applied.project).scope).toBe(COMMENT_SCOPE_ALL)
  })

  it('leaves a Leader endpoint free where its target went (#82 §3)', () => {
    const base = withWall(newProject())
    const wallId = wallOf(base)
    const withMark = expectApplied(
      base,
      intent(
        'annotation.create',
        { viewId: viewOf(base), type: 'leader', position: pt(500, 1500), text: 'Watch this reveal', layerId: null, scope: COMMENT_SCOPE_ALL, endpoint: { anchor: { kind: 'entity', entityId: wallId } } },
        source(2),
      ),
    ).project
    const report = notesOf(withMark, intent('wall.delete', { wallId }))!
    expect(report.rows[0]).toMatchObject({ kind: 'annotation', choices: ['floor_point', 'reanchor', 'delete'] })
    const applied = expectApplied(
      withMark,
      answered(intent('wall.delete', { wallId }), [{ dependentId: annotationAt(withMark).id, choice: 'floor_point', expectedAnchor: report.rows[0]!.fingerprint }]),
    )
    expect('free' in (annotationAt(applied.project).endpoint ?? {})).toBe(true)
  })

  it('is one Edit Transaction: one undo restores the target, the note and its Anchor (#82 §5.4)', () => {
    const { project, wallId, comment } = anchoredComment()
    const report = notesOf(project, intent('wall.delete', { wallId }))!
    const applied = expectApplied(
      project,
      answered(intent('wall.delete', { wallId }), [{ dependentId: comment.id, choice: 'reanchor', targetRef: { kind: 'project' }, expectedAnchor: report.rows[0]!.fingerprint }]),
    )
    expect(applied.project.comments).toHaveLength(1)
    expect(applied.project.existingModel.walls).toHaveLength(0)
    expect(JSON.stringify(applyPatches(applied.project, applied.inversePatches))).toBe(JSON.stringify(project))
  })
})

describe('a stale answer is refused whole (#82 §5.2)', () => {
  const staleFor = (project: Project, wallId: EntityId, over: Partial<NotesResolution>): NotesResolution => {
    const report = notesOf(project, intent('wall.delete', { wallId }))!
    return { dependentId: report.rows[0]!.dependentId, choice: 'delete', expectedAnchor: report.rows[0]!.fingerprint, ...over }
  }

  const refusedWith = (project: Project, next: Intent): string => {
    const result = applyIntent(project, next)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.code).toBe('stale-dependency-resolution')
    return result.problems[0]!.message
  }

  it('refuses when a row of the review has gone missing from the answer', () => {
    const { project, wallId } = anchoredComment()
    expect(refusedWith(project, answered(intent('wall.delete', { wallId }), []))).toContain('listed 1 note')
  })

  it('refuses when the note is about something else now', () => {
    const { project, wallId } = anchoredComment()
    expect(refusedWith(project, answered(intent('wall.delete', { wallId }), [staleFor(project, wallId, { expectedAnchor: '{"kind":"floor","floorId":"floor-0"}' })]))).toContain('something else now')
  })

  it('refuses a choice the row never offered', () => {
    const { project, wallId } = anchoredComment()
    expect(refusedWith(project, answered(intent('wall.delete', { wallId }), [staleFor(project, wallId, { choice: 'keep' })]))).toContain('cannot be answered with keep')
  })

  it('refuses a Reanchor whose target this operation is deleting', () => {
    const { project, wallId } = anchoredComment()
    expect(refusedWith(project, answered(intent('wall.delete', { wallId }), [staleFor(project, wallId, { choice: 'reanchor', targetRef: { kind: 'entity', entityId: wallId } })]))).toContain('this operation is deleting')
  })

  it('refuses a target that is no longer there at all', () => {
    const { project, wallId } = anchoredComment()
    expect(refusedWith(project, answered(intent('wall.delete', { wallId }), [staleFor(project, wallId, { choice: 'reanchor', targetRef: { kind: 'entity', entityId: 'gone' } })]))).toContain('no longer there')
  })

  it('refuses a target for a choice that takes none', () => {
    const { project, wallId } = anchoredComment()
    expect(refusedWith(project, answered(intent('wall.delete', { wallId }), [staleFor(project, wallId, { targetRef: { kind: 'project' } })]))).toContain('a choice that takes none')
  })

  it('refuses one note answered twice', () => {
    const { project, wallId } = anchoredComment()
    const one = staleFor(project, wallId, {})
    const result = applyIntent(project, answered(intent('wall.delete', { wallId }), [one, one]))
    if (result.ok) throw new Error('expected a refusal')
    expect(result.code).toBe('stale-dependency-resolution')
  })

  it('refuses when the Project no longer holds a row of the review', () => {
    const base = withWall(newProject())
    const wallId = wallOf(base)
    const onWall: PayloadOf<'comment.create'> = { anchor: { kind: 'entity', entityId: wallId }, title: 'Anything', body: 'Still here.', priority: 'normal', at: NOW }
    const withNotes = expectApplied(
      expectApplied(base, intent('comment.create', { ...onWall, title: 'One' }, source(1))).project,
      intent('comment.create', { ...onWall, title: 'Two' }, source(1)),
    ).project
    const report = notesOf(withNotes, intent('wall.delete', { wallId }))!
    expect(report.rows).toHaveLength(2)
    const answers = report.rows.map((row) => ({ dependentId: row.dependentId, choice: 'delete' as const, expectedAnchor: row.fingerprint }))
    const emptied = expectApplied(withNotes, intent('comment.delete', { commentId: report.rows[1]!.dependentId })).project
    const result = applyIntent(emptied, answered(intent('wall.delete', { wallId }), answers))
    if (result.ok) throw new Error('expected a refusal')
    expect(result.code).toBe('stale-dependency-resolution')
  })

  it('changes nothing when it refuses', () => {
    const { project, wallId } = anchoredComment()
    const before = JSON.stringify(project)
    applyIntent(project, answered(intent('wall.delete', { wallId }), [staleFor(project, wallId, { expectedAnchor: 'nope' })]))
    expect(JSON.stringify(project)).toBe(before)
  })
})

describe('the review reaches every triggering operation (#82 §2)', () => {
  it('lists an Annotation whose scope names the Option being deleted (#82 §2)', () => {
    const base = newProject()
    const withOption = expectApplied(base, intent('designOption.create', { name: 'Option B' }, source(1))).project
    const optionId = withOption.designOptions![0]!.id
    const withMark = expectApplied(
      withOption,
      intent('annotation.create', { viewId: viewOf(base), type: 'text', position: pt(600, 600), text: 'Only in B', layerId: null, scope: optionId }, source(2)),
    ).project
    const report = notesOf(withMark, intent('designOption.delete', { optionId }))!
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ kind: 'annotation', reference: 'A-001', choices: ['delete', 'keep'], note: 'keep-all-options' })
    const applied = expectApplied(
      withMark,
      answered(intent('designOption.delete', { optionId }), [{ dependentId: annotationAt(withMark).id, choice: 'keep', expectedAnchor: report.rows[0]!.fingerprint }]),
    )
    expect(annotationAt(applied.project).scope).toBe(COMMENT_SCOPE_ALL)
  })

  it('names the note in the refusal a user who closes the dialog is left with', () => {
    const { project, wallId, comment } = anchoredComment()
    const result = applyIntent(project, intent('wall.delete', { wallId }))
    if (result.ok) throw new Error('expected a refusal')
    expect(result.problems[0]!.message).toBe(`1 note is about what this removes: ${comment.reference}. Choose what happens to each.`)
    expect(result.problems[0]!.path).toContain(comment.id)
  })

  it('counts every note in one sentence', () => {
    const base = withWall(newProject())
    const wallId = wallOf(base)
    const onWall: PayloadOf<'comment.create'> = { anchor: { kind: 'entity', entityId: wallId }, title: 'Anything', body: 'Still here.', priority: 'normal', at: NOW }
    const withNotes = expectApplied(
      expectApplied(base, intent('comment.create', { ...onWall, title: 'One' }, source(1))).project,
      intent('comment.create', { ...onWall, title: 'Two' }, source(1)),
    ).project
    const result = applyIntent(withNotes, intent('wall.delete', { wallId }))
    if (result.ok) throw new Error('expected a refusal')
    expect(result.problems[0]!.message).toBe('2 notes are about what this removes: C-001, C-002. Choose what happens to each.')
  })

  it('stamps the note it moves with the Intent’s own clock', () => {
    const { project, wallId, comment } = anchoredComment()
    const report = notesOf(project, intent('wall.delete', { wallId }))!
    const applied = expectApplied(
      project,
      { ...intent('wall.delete', { wallId }), now: LATER, notesResolutions: [{ dependentId: comment.id, choice: 'delete', expectedAnchor: report.rows[0]!.fingerprint }] } as Intent,
    )
    expect(applied.project.comments).toHaveLength(0)
    expect(LATER > NOW).toBe(true)
  })
})
