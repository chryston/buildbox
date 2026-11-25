/**
 * The Notes panel's list (#80 §5, criteria 12–19).
 *
 * What is worth asserting here is the reading order rather than the markup: which rows the four filters
 * leave, in what order, and what words sit beside them. The filters compose with AND and nothing else —
 * a panel that OR-ed them would show a note a person had just filtered out, which is the one thing a
 * filter must never do.
 *
 * The last test is the one that keeps the whole feature honest: no Anchor kind, no scope code and no
 * feature id reaches the screen as a code. A person reads the panel; a code in it means a string table
 * was skipped.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityId, Project } from '../../../domain'
import { NotesPanel, NotesPanelToggle } from './NotesPanel'
import { notesSessionStore } from './notesSession'
import { COMMENT_STRINGS } from '../../strings/comments'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures')

/** The schema v15 Comments fixture: nine notes, one per Anchor kind plus a resolved Floor note. */
const project = JSON.parse(
  readFileSync(join(fixturesRoot, 'domain', 'v15', 'comments.json'), 'utf8'),
).project as Project

const NOW = '2026-11-25T00:00:00.000Z'

/** The fixture's only Plan View: Floor `seed-001`, no Design Option, so the Existing Model. */
const view = project.views.find((candidate) => candidate.kind === 'plan')! as typeof project.views[number] & {
  floorId: EntityId
}

type Spy = (commentId: EntityId, patch?: unknown) => void

function panel(): {
  onResolve: Spy
  onReopen: Spy
  onDelete: Spy
  onEdit: Spy
} {
  const onResolve = vi.fn()
  const onReopen = vi.fn()
  const onDelete = vi.fn()
  const onEdit = vi.fn()
  render(
    <NotesPanel
      project={project}
      view={view}
      now={NOW}
      onResolve={onResolve}
      onReopen={onReopen}
      onDelete={onDelete}
      onEdit={onEdit}
    />,
  )
  return { onResolve, onReopen, onDelete, onEdit }
}

/** The references of the rows on screen, in the order the panel listed them. */
const shown = (): string[] =>
  Array.from(document.querySelectorAll('[data-testid^="note-row-C-"]')).map((node) =>
    node.getAttribute('data-testid')!.replace('note-row-', ''),
  )

const untickContext = (): void => {
  fireEvent.click(screen.getByTestId('notes-current-context'))
}
const setStatus = (value: string): void => {
  fireEvent.change(screen.getByTestId('notes-status-filter'), { target: { value } })
}
const setPriority = (value: string): void => {
  fireEvent.change(screen.getByTestId('notes-priority-filter'), { target: { value } })
}
const setTarget = (value: string): void => {
  fireEvent.change(screen.getByTestId('notes-target-filter'), { target: { value } })
}
const selectRow = (reference: string): void => {
  fireEvent.click(screen.getByTestId(`note-row-${reference}`).querySelector('.bb-note-row-main')!)
}

beforeEach(() => {
  notesSessionStore.getState().reset()
  // The panel starts closed (§4.1 with the canvas width #55 gives it); these tests are about the list
  // inside it, so opening it is a precondition rather than the thing under test.
  notesSessionStore.getState().setPanelOpen(true)
})

describe('the Notes panel list (#80 §5)', () => {
  it('lists the notes of the current context by default, and counts them in the tab', () => {
    panel()
    // C-003 and C-008 belong to Option A and C-007 hangs off a Proposed placement, so none of the three
    // is about the Existing Model this view is looking through. C-009 is Resolved and the default status
    // filter is `Open`.
    expect(shown()).toEqual(['C-001', 'C-002', 'C-004', 'C-005', 'C-006'])
    expect(screen.getByTestId('notes-tab-comments').textContent).toContain('5')
    expect(screen.getByTestId('notes-current-context')).toHaveAttribute('checked')
    expect(screen.getByTestId('notes-status-filter')).toHaveValue('open')
  })

  it('shows every open note once `Current context` is unticked', () => {
    panel()
    untickContext()
    expect(shown()).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-005', 'C-006', 'C-007', 'C-008'])
  })

  it('lists a Resolved note only under `Resolved` or `Any`, and strikes it through', () => {
    panel()
    expect(shown()).not.toContain('C-009')
    setStatus('resolved')
    expect(shown()).toEqual(['C-009'])
    expect(screen.getByTestId('note-row-C-009').querySelector('.bb-note-row-title')).toHaveAttribute(
      'data-struck',
      'true',
    )
    setStatus('any')
    expect(shown()).toEqual(['C-001', 'C-002', 'C-004', 'C-005', 'C-006', 'C-009'])
  })

  it('searches the reference, the title and the body', () => {
    panel()
    fireEvent.change(screen.getByTestId('notes-search'), { target: { value: 'C-005' } })
    expect(shown()).toEqual(['C-005'])
    fireEvent.change(screen.getByTestId('notes-search'), { target: { value: 'carcass' } })
    expect(shown()).toEqual(['C-004'])
    // The body is searched too, and a body that belongs to a filtered-out note finds nothing.
    fireEvent.change(screen.getByTestId('notes-search'), { target: { value: 'unlined' } })
    expect(shown()).toEqual([])
    untickContext()
    expect(shown()).toEqual(['C-007'])
  })

  it('filters by priority and by the kind of thing a note is about', () => {
    panel()
    setPriority('high')
    expect(shown()).toEqual(['C-001'])
    setPriority('any')
    setTarget('entity')
    expect(shown()).toEqual(['C-005'])
    setTarget('floor_point')
    expect(shown()).toEqual([])
    untickContext()
    expect(shown()).toEqual(['C-008'])
  })

  it('composes the four filters with AND', () => {
    panel()
    untickContext()
    setStatus('any')
    setPriority('normal')
    setTarget('feature')
    expect(shown()).toEqual(['C-006', 'C-007'])
  })

  it('lists in reference order, so C-009 follows C-008 rather than sorting by status', () => {
    panel()
    untickContext()
    setStatus('any')
    expect(shown()).toEqual(['C-001', 'C-002', 'C-003', 'C-004', 'C-005', 'C-006', 'C-007', 'C-008', 'C-009'])
  })

  it('resolves from the row without selecting it', () => {
    const { onResolve } = panel()
    fireEvent.click(screen.getByTestId('note-toggle-C-005'))
    expect(onResolve).toHaveBeenCalledWith('comment-C-005')
    expect(notesSessionStore.getState().selectedCommentId).toBeNull()
  })

  it('opens the inline editor for the selected row and edits one field per transaction', () => {
    const { onEdit, onDelete, onResolve } = panel()
    selectRow('C-005')
    expect(screen.getByTestId('note-editor-eyebrow').textContent).toContain('C-005')
    fireEvent.change(screen.getByTestId('note-editor-title'), { target: { value: 'Notch the base' } })
    fireEvent.keyDown(screen.getByTestId('note-editor-title'), { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith('comment-C-005', { title: 'Notch the base' })
    fireEvent.change(screen.getByTestId('note-editor-body'), { target: { value: 'Duct at 100 mm.' } })
    fireEvent.blur(screen.getByTestId('note-editor-body'))
    expect(onEdit).toHaveBeenLastCalledWith('comment-C-005', { body: 'Duct at 100 mm.' })
    setPriority('high')
    fireEvent.change(screen.getByTestId('note-editor-priority'), { target: { value: 'high' } })
    expect(onEdit).toHaveBeenLastCalledWith('comment-C-005', { priority: 'high' })
    // A note anchored to one entity has no Scope control at all: its Anchor already answers.
    expect(screen.queryByTestId('note-editor-scope-select')).toBeNull()
    fireEvent.click(screen.getByTestId('note-editor-toggle'))
    expect(onResolve).toHaveBeenCalledWith('comment-C-005')
    fireEvent.click(screen.getByTestId('note-editor-delete'))
    expect(onDelete).toHaveBeenCalledWith('comment-C-005')
  })

  it('reopens a Resolved note from the editor and offers its Scope choice', () => {
    const { onEdit, onReopen } = panel()
    setStatus('resolved')
    selectRow('C-009')
    fireEvent.click(screen.getByTestId('note-editor-toggle'))
    expect(onReopen).toHaveBeenCalledWith('comment-C-009')
    expect(screen.getByTestId('note-editor-scope-select')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('note-editor-scope-select'), { target: { value: 'option-b' } })
    expect(onEdit).toHaveBeenCalledWith('comment-C-009', { scope: 'option-b' })
  })

  it('offers a Scope choice only for a note whose Anchor does not already answer', () => {
    panel()
    selectRow('C-001')
    expect(screen.getByTestId('note-editor-scope-select')).toBeInTheDocument()
    selectRow('C-002')
    expect(screen.getByTestId('note-editor-scope-select')).toBeInTheDocument()
    selectRow('C-005')
    expect(screen.queryByTestId('note-editor-scope-select')).toBeNull()
  })

  it('names every Anchor and Scope in words, never a code', () => {
    panel()
    untickContext()
    setStatus('any')
    const text = document.querySelector('[data-testid="notes-panel"]')!.textContent ?? ''
    for (const code of ['floor_point', 'item_design', 'design_option', 'leftFace', 'option-a', 'option-b', 'seed-wall-002', 'unit-kitchen-base']) {
      expect(text).not.toContain(code)
    }
    expect(text).toContain('Floor Point')
    expect(text).toContain('All Options')
    expect(text).toContain('Option A')
  })

  it('shows the empty editor prompt when nothing is selected', () => {
    panel()
    expect(screen.getByTestId('notes-editor-empty').textContent).toContain('Select a note')
  })
})

describe('the `Hide Notes` / `Show Notes` control (#80 §4.2)', () => {
  it('says which way it will go, in the two words the issue gives it', () => {
    notesSessionStore.getState().setPanelOpen(false)
    render(<NotesPanelToggle />)
    expect(screen.getByTestId('notes-panel-toggle').textContent).toBe(COMMENT_STRINGS.showNotes)
    fireEvent.click(screen.getByTestId('notes-panel-toggle'))
    expect(notesSessionStore.getState().panelOpen).toBe(true)
    expect(screen.getByTestId('notes-panel-toggle').textContent).toBe(COMMENT_STRINGS.hideNotes)
  })
})
