/**
 * The docked Notes panel (#80 §4, §5, §10).
 *
 * It lists the Comments the view a person is looking through is about, and edits the one they selected.
 * Everything it decides is delegated: the §6 context rules are `derive`'s `commentsForView`, the plain
 * words an Anchor is named with are `anchorLabel`, the copy is the string table. What lives here is the
 * reading order — which rows, in what order, with which words beside them — and the one rule the panel
 * exists to hold: it is separate from the model. No Floor property, no entity property, no measurement
 * appears in it (§5.8), and no Comment field goes into the model inspector.
 *
 * The `Annotations` tab is present and empty on purpose. #81 fills it; showing the tab now means the
 * panel's shape is settled and reviewed once rather than twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { notesSessionStore } from './notesSession'
import type { Comment, CommentPriority, CommentScope, EntityId, Project, SavedViewSettings } from '../../../domain'
import { COMMENT_SCOPE_ALL, compareCommentReferences, designOptionsOf, isCommentScopeAll } from '../../../domain'
import { commentAnchorLabel, commentIsInContext, commentScopeLabel, effectiveCommentScope, effectiveModel } from '../../../derive'
import { COMMENT_PRIORITY_LABELS, COMMENT_STATUS_FILTERS, COMMENT_STATUS_LABELS, COMMENT_STRINGS, COMMENT_TARGET_LABELS } from '../../strings/comments'
import { ANNOTATION_STRINGS } from '../../strings/annotations'
import { formatSince } from '../../library/formatSince'
import { useNotesSession } from './notesSession'
import { AnnotationsTab } from './AnnotationsTab'
import type { AnnotationEditPatch } from './AnnotationsTab'
import { annotationIsInContext } from '../../../derive'

import type { NotesPriorityFilter, NotesStatusFilter, NotesTargetFilter } from './notesSession'

export interface NotesPanelProps {
  project: Project
  /** The saved view the panel is beside, or `null` when none is open. */
  view: (SavedViewSettings & { floorId: EntityId; id: EntityId }) | null
  /** The wall-clock instant edits are stamped with; the panel never reads the clock itself. */
  now: string
  onResolve(commentId: EntityId): void
  onReopen(commentId: EntityId): void
  onDelete(commentId: EntityId): void
  onEdit(commentId: EntityId, patch: { title?: string; body?: string; priority?: CommentPriority; scope?: CommentScope }): void
  onEditAnnotation(annotationId: EntityId, patch: AnnotationEditPatch): void
  onDeleteAnnotation(annotationId: EntityId): void
  onGoToView(viewId: EntityId): void
}

/** The priority dot's colour, chosen by the priority alone (§37). */
const dotRole = (comment: Comment): string => (comment.status === 'resolved' ? 'resolved' : comment.priority)

/** Whether the search text names this note in its reference, title or body (§5.2). */
function matchesQuery(comment: Comment, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  return (
    comment.reference.toLowerCase().includes(needle) ||
    comment.title.toLowerCase().includes(needle) ||
    comment.body.toLowerCase().includes(needle)
  )
}

/** The four filters, composed with AND, after the §6 context rule has had its say (§5.3). */
function listedComments(
  project: Project,
  view: (SavedViewSettings & { floorId: EntityId; id: EntityId }) | null,
  session: {
    currentContext: boolean
    status: NotesStatusFilter
    priority: NotesPriorityFilter
    target: NotesTargetFilter
    query: string
  },
): Comment[] {
  const model = view === null ? null : effectiveModel(project, view.floorId, view.designOptionId ?? null)
  return project.comments
    .filter((comment) => {
      if (session.status !== 'any' && comment.status !== session.status) return false
      if (session.priority !== 'any' && comment.priority !== session.priority) return false
      if (session.target !== 'any' && comment.anchor.kind !== session.target) return false
      if (!matchesQuery(comment, session.query)) return false
      // With no view open there is no context to be in, so `Current context` lists everything rather
      // than nothing: an empty panel with a tick in it reads as a missing note.
      if (session.currentContext && view !== null && model !== null) {
        if (!commentIsInContext(project, view, comment, model)) return false
      }
      return true
    })
    .sort((left, right) => compareCommentReferences(left.reference, right.reference))
}

/**
 * The inline editor at the bottom of the panel (#80 §10).
 *
 * Title and body commit on Enter or blur as one transaction per committed field, never per keystroke:
 * a Comment typed one letter at a time would fill the undo stack with letters. The draft is held here
 * and dropped whenever a different row is selected, so clicking away from a half-typed title loses the
 * draft rather than committing half a sentence.
 */
function CommentEditor({
  project,
  comment,
  now,
  onResolve,
  onReopen,
  onDelete,
  onEdit,
  focusTitle = false,
}: {
  project: Project
  comment: Comment
  now: string
  onResolve(commentId: EntityId): void
  onReopen(commentId: EntityId): void
  onDelete(commentId: EntityId): void
  onEdit(commentId: EntityId, patch: { title?: string; body?: string; priority?: CommentPriority; scope?: CommentScope }): void
  /** Focus the title and select its text — set for a note that has just been created. */
  focusTitle?: boolean
}): ReactNode {
  const [title, setTitle] = useState(comment.title)
  const [body, setBody] = useState(comment.body)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setTitle(comment.title)
    setBody(comment.body)
  }, [comment.id, comment.title, comment.body])
  // A note that has just been created is titled by the tool, not by the person. The keyboard goes to
  // the title with the text selected, so the first keystroke replaces it (#80 §9, §10).
  useEffect(() => {
    if (!focusTitle) return
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [focusTitle])

  const commitTitle = (): void => {
    const next = title.trim()
    if (next === '' || next === comment.title) {
      setTitle(comment.title)
      return
    }
    onEdit(comment.id, { title: next })
  }
  const commitBody = (): void => {
    if (body === comment.body) return
    onEdit(comment.id, { body })
  }
  const scope = effectiveCommentScope(project, comment)
  const scopeText = commentScopeLabel(project, scope)
  const options = designOptionsOf(project)

  return (
    <div className="bb-note-editor" data-testid="note-editor">
      <div className="bb-note-editor-eyebrow" data-testid="note-editor-eyebrow">
        {COMMENT_STRINGS.editorEyebrow(comment.reference)}
      </div>
      <input
        ref={titleRef}
        className="bb-note-editor-title"
        data-testid="note-editor-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commitTitle()
        }}
      />
      <textarea
        className="bb-note-editor-body"
        data-testid="note-editor-body"
        placeholder={COMMENT_STRINGS.bodyPlaceholder}
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onBlur={commitBody}
      />
      <dl className="bb-note-editor-fields">
        <div className="bb-note-editor-field">
          <dt>{COMMENT_STRINGS.anchor}</dt>
          <dd data-testid="note-editor-anchor">{commentAnchorLabel(project, comment.anchor)}</dd>
        </div>
        <div className="bb-note-editor-field">
          <dt>{COMMENT_STRINGS.scope}</dt>
          <dd data-testid="note-editor-scope">
            {scope.kind !== 'all' && scope.inherited ? (
              scopeText
            ) : (
              <select
                className="bb-notes-filter"
                data-testid="note-editor-scope-select"
                value={isCommentScopeAll(comment.scope ?? COMMENT_SCOPE_ALL) ? COMMENT_SCOPE_ALL : (comment.scope as string)}
                onChange={(event) => onEdit(comment.id, { scope: event.target.value })}
              >
                <option value={COMMENT_SCOPE_ALL}>{COMMENT_STRINGS.scopeAllOptions}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </dd>
        </div>
        <div className="bb-note-editor-field">
          <dt>{COMMENT_STRINGS.priority}</dt>
          <dd>
            <select
              className="bb-notes-filter"
              data-testid="note-editor-priority"
              value={comment.priority}
              onChange={(event) => onEdit(comment.id, { priority: event.target.value as CommentPriority })}
            >
              {(['low', 'normal', 'high'] as const).map((priority) => (
                <option key={priority} value={priority}>
                  {COMMENT_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </dd>
        </div>
        <div className="bb-note-editor-field">
          <dt>{COMMENT_STRINGS.status}</dt>
          <dd data-testid="note-editor-status">
            {COMMENT_STRINGS.statusLine(COMMENT_STATUS_LABELS[comment.status], formatSince(comment.updatedAt, now))}
          </dd>
        </div>
      </dl>
      {comment.linkedWarning !== undefined && (
        <p className="bb-note-editor-warning" data-testid="note-editor-warning-link">
          {COMMENT_STRINGS.warningLinkNote(comment.linkedWarning.message)}
        </p>
      )}
      <div className="bb-note-editor-actions">
        <button
          type="button"
          data-testid="note-editor-toggle"
          className="bb-button"
          onClick={() => (comment.status === 'open' ? onResolve(comment.id) : onReopen(comment.id))}
        >
          {comment.status === 'open' ? COMMENT_STRINGS.resolve : COMMENT_STRINGS.reopen}
        </button>
        <button
          type="button"
          data-testid="note-editor-delete"
          className="bb-button bb-workspace-danger-button"
          onClick={() => onDelete(comment.id)}
        >
          {COMMENT_STRINGS.delete}
        </button>
      </div>
    </div>
  )
}

/** One row of the list (§5.5): dot, reference and title, then the Anchor and the effective scope. */
function CommentRow({
  project,
  comment,
  selected,
  onSelect,
  onToggle,
}: {
  project: Project
  comment: Comment
  selected: boolean
  onSelect(): void
  onToggle(): void
}): ReactNode {
  const scope = effectiveCommentScope(project, comment)
  const scopeText = commentScopeLabel(project, scope)
  return (
    <li
      className="bb-note-row"
      data-testid={`note-row-${comment.reference}`}
      data-selected={selected ? 'true' : 'false'}
      data-resolved={comment.status === 'resolved' ? 'true' : 'false'}
    >
      <button
        type="button"
        className="bb-note-row-main"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
      >
        <span className="bb-note-dot" data-role={dotRole(comment)} data-testid={`note-dot-${comment.reference}`} />
        <span className="bb-note-row-text">
          <span className="bb-note-row-title" data-struck={comment.status === 'resolved' ? 'true' : 'false'}>
            {comment.reference} · {comment.title}
            {comment.linkedWarning !== undefined && (
              <span className="bb-note-row-warning">{COMMENT_STRINGS.linkedWarningSuffix}</span>
            )}
          </span>
          <span className="bb-note-row-anchor">
            {commentAnchorLabel(project, comment.anchor)} · {scopeText}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="bb-note-row-toggle"
        data-testid={`note-toggle-${comment.reference}`}
        onClick={(event) => {
          // The button changes status without selecting the row (§5.5), so the click must not reach
          // the row's own handler.
          event.stopPropagation()
          onToggle()
        }}
      >
        {comment.status === 'open' ? COMMENT_STRINGS.resolve : COMMENT_STRINGS.reopen}
      </button>
    </li>
  )
}

export function NotesPanel(props: NotesPanelProps): ReactNode {
  const { project, view, now, onResolve, onReopen, onDelete, onEdit, onEditAnnotation, onDeleteAnnotation, onGoToView } = props
  const panelOpen = useNotesSession((state) => state.panelOpen)
  const selectedCommentId = useNotesSession((state) => state.selectedCommentId)
  const titleToFocus = useNotesSession((state) => state.titleToFocus)
  const query = useNotesSession((state) => state.query)
  const currentContext = useNotesSession((state) => state.currentContext)
  const status = useNotesSession((state) => state.status)
  const priority = useNotesSession((state) => state.priority)
  const target = useNotesSession((state) => state.target)
  const session = notesSessionStore.getState

  const listed = useMemo(
    () => listedComments(project, view, { currentContext, status, priority, target, query }),
    [project, view, currentContext, status, priority, target, query],
  )
  const selected = listed.find((comment) => comment.id === selectedCommentId) ?? project.comments.find((comment) => comment.id === selectedCommentId) ?? null

  const tab = useNotesSession((state) => state.tab)
  const annotationCount = useMemo(
    () => (currentContext && view !== null
      ? (project.annotations ?? []).filter((annotation) => annotation.viewId === view.id && annotationIsInContext(project, view, annotation)).length
      : (project.annotations ?? []).length),
    [project, view, currentContext],
  )

  const toggle = useCallback(
    (comment: Comment): void => {
      if (comment.status === 'open') onResolve(comment.id)
      else onReopen(comment.id)
    },
    [onResolve, onReopen],
  )

  if (!panelOpen) return <div className="bb-notes-collapsed" data-testid="notes-panel-collapsed" />

  return (
    <section className="bb-notes" data-testid="notes-panel" aria-label={COMMENT_STRINGS.notesPanel}>
      <div className="bb-notes-tabs" role="tablist" data-testid="notes-tabs">
        <button type="button" className="bb-notes-tab" data-active={tab === 'comments' ? 'true' : 'false'} role="tab" aria-selected={tab === 'comments'} data-testid="notes-tab-comments" onClick={() => session().setTab('comments')}>
          {COMMENT_STRINGS.commentsTab} {String(listed.length)}
        </button>
        <button type="button" className="bb-notes-tab" data-active={tab === 'annotations' ? 'true' : 'false'} role="tab" aria-selected={tab === 'annotations'} data-testid="notes-tab-annotations" onClick={() => session().setTab('annotations')}>
          {ANNOTATION_STRINGS.annotationsTab} {String(annotationCount)}
        </button>
      </div>
      <div className="bb-notes-filters" data-testid="notes-filters">
        <input
          className="bb-notes-search"
          data-testid="notes-search"
          type="search"
          placeholder={COMMENT_STRINGS.searchNotes}
          value={query}
          onChange={(event) => session().setQuery(event.target.value)}
        />
        <label className="bb-notes-chip" data-testid="notes-current-context-row">
          <input
            type="checkbox"
            data-testid="notes-current-context"
            checked={currentContext}
            onChange={(event) => session().setCurrentContext(event.target.checked)}
          />
          {COMMENT_STRINGS.currentContext}
        </label>
        {tab === 'comments' && (
          <>
            <select
              className="bb-notes-filter"
              data-testid="notes-status-filter"
              value={status}
              onChange={(event) => session().setStatus(event.target.value as NotesStatusFilter)}
            >
              {(['open', 'resolved', 'any'] as const).map((value) => (
                <option key={value} value={value}>
                  {COMMENT_STATUS_FILTERS[value]}
                </option>
              ))}
            </select>
            <select
              className="bb-notes-filter"
              data-testid="notes-priority-filter"
              value={priority}
              onChange={(event) => session().setPriority(event.target.value as NotesPriorityFilter)}
            >
              <option value="any">{COMMENT_STRINGS.anyPriority}</option>
              {(['high', 'normal', 'low'] as const).map((value) => (
                <option key={value} value={value}>
                  {COMMENT_PRIORITY_LABELS[value]}
                </option>
              ))}
            </select>
            <select
              className="bb-notes-filter"
              data-testid="notes-target-filter"
              value={target}
              onChange={(event) => session().setTarget(event.target.value as NotesTargetFilter)}
            >
              <option value="any">{COMMENT_STRINGS.anyTarget}</option>
              {(['project', 'floor', 'design_option', 'item_design', 'entity', 'feature', 'floor_point'] as const).map((value) => (
                <option key={value} value={value}>
                  {COMMENT_TARGET_LABELS[value]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {tab === 'annotations' ? (
        <AnnotationsTab
          project={project}
          view={view}
          now={now}
          onEdit={onEditAnnotation}
          onDelete={onDeleteAnnotation}
          onGoToView={onGoToView}
        />
      ) : (
        <>
          <ul className="bb-note-rows" data-testid="note-rows">
            {listed.map((comment) => (
              <CommentRow
                key={comment.id}
                project={project}
                comment={comment}
                selected={comment.id === selectedCommentId}
                onSelect={() => session().select(comment.id)}
                onToggle={() => toggle(comment)}
              />
            ))}
          </ul>
          {selected === null ? (
            <p className="bb-notes-empty" data-testid="notes-editor-empty">
              {COMMENT_STRINGS.selectNoteToEdit}
            </p>
          ) : (
            <CommentEditor
              project={project}
              comment={selected}
              now={now}
              onResolve={onResolve}
              onReopen={onReopen}
              onDelete={onDelete}
              onEdit={onEdit}
              focusTitle={titleToFocus === selected.id}
            />
          )}
        </>
      )}
    </section>
  )
}

/** The panel's own toolbar control, which never touches the overlay (§4.2). */
export function NotesPanelToggle(): ReactNode {
  const panelOpen = useNotesSession((state) => state.panelOpen)
  const setPanelOpen = useNotesSession((state) => state.setPanelOpen)
  return (
    <button
      type="button"
      className="bb-workspace-tool-button"
      data-testid="notes-panel-toggle"
      aria-pressed={panelOpen}
      onClick={() => setPanelOpen(!panelOpen)}
    >
      {panelOpen ? COMMENT_STRINGS.hideNotes : COMMENT_STRINGS.showNotes}
    </button>
  )
}
