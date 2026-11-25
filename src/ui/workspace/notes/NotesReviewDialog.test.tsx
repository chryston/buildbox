/**
 * The Notes dependency review on screen (#82 criteria 1, 2, 3, 12, 13, 14, 16).
 *
 * What is asserted is what a person reads before pressing Apply: one row per note with only the
 * choices that note has, Apply unreachable while a row is undecided or a Reanchor has no target,
 * Cancel and Escape changing nothing, and the Wall review carrying the Notes as a section of the same
 * question rather than as a second dialog.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { NotesDependencyReport, NotesDependencyRow, NotesResolution, DeleteWallReview } from '../../../edit'
import type { Project } from '../../../domain'
import { DeleteWallReviewDialog } from '../wall/DeleteWallReviewDialog'
import { NotesReviewDialog } from './NotesReviewDialog'

// Only names are ever read off the Project, so it is spelled out here rather than loaded: a `dom`
// test runs under jsdom, where `import.meta.url` is an http URL and the fixture files cannot be read.
const project: Project = {
  id: 'project-1',
  meta: { name: 'Kitchen' },
  preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
  floors: [{ id: 'floor-1', name: 'Ground Floor', planImage: null }],
  views: [
    { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Ground Floor', isDefault: true, showPlanImage: true, planViewRange: { lowerMm: 0, upperMm: 2600 } },
  ],
  itemDesigns: [],
  existingModel: {
    walls: [],
    wallJunctions: [],
    openings: [],
    rooms: [],
    beams: [],
    placedItems: [
      { id: 'p1', itemDesignId: 'd1', floorId: 'floor-1', translation: { x: 0, y: 0 }, rotationDeg: 0, baseElevation: 0 },
      { id: 'p2', itemDesignId: 'd1', floorId: 'floor-1', translation: { x: 100, y: 0 }, rotationDeg: 0, baseElevation: 0 },
    ],
  },
  warningAcknowledgements: [],
  comments: [],
  commentReferenceCounter: 0,
  annotations: [],
  annotationReferenceCounter: 0,
}

const row = (over: Partial<NotesDependencyRow> = {}): NotesDependencyRow => ({
  dependentId: 'note-1',
  kind: 'comment',
  reference: 'C-004',
  title: 'Shift 50 mm for dishwasher',
  status: 'open',
  annotationType: null,
  owningViewName: null,
  targetViewName: null,
  anchorLabel: 'Placed Item · Base 600 #2',
  fingerprint: '{"anchor":"old"}',
  choices: ['floor_point', 'reanchor', 'delete'],
  preset: null,
  floorPointDisabled: false,
  targets: [{ kind: 'entity', entityId: "p1" }],
  note: null,
  ...over,
})

const report = (rows: readonly NotesDependencyRow[]): NotesDependencyReport => ({
  kind: 'notes',
  subject: { kind: 'entity', label: 'Base 600 #2' },
  rows,
})

describe('NotesReviewDialog', () => {
  it('lists one row per note, undecided, with Apply disabled (#82 criteria 1, 2)', () => {
    render(
      <NotesReviewDialog
        project={project}
        report={report([row()])}
        stale={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )
    expect(screen.getByTestId('notes-review-eyebrow').textContent).toBe('Dependency review')
    expect(screen.getByRole('dialog').textContent).toContain('1 note is about what this removes')
    const only = screen.getByTestId('notes-review-row')
    expect(only.textContent).toContain('C-004')
    expect(only.textContent).toContain('Shift 50 mm for dishwasher')
    expect(only.textContent).toContain('Placed Item · Base 600 #2')
    expect(screen.getByTestId('notes-review-confirm').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('notes-review-cancel').hasAttribute('disabled')).toBe(false)
  })

  it('keeps Apply disabled while a Reanchor has no target, and hands back the choice with it (#82 criterion 3)', () => {
    const onConfirm = vi.fn()
    render(
      <NotesReviewDialog
        project={project}
        report={report([row()])}
        stale={false}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )
    fireEvent.click(screen.getByTestId('notes-review-choice-reanchor'))
    expect(screen.getByTestId('notes-review-confirm').hasAttribute('disabled')).toBe(true)
    const picker = screen.getByTestId('notes-review-target') as HTMLSelectElement
    const picked = Array.from(picker.options).find((option) => option.value !== '')
    expect(picked).toBeDefined()
    fireEvent.change(picker, { target: { value: picked!.value } })
    expect(screen.getByTestId('notes-review-confirm').hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByTestId('notes-review-confirm'))
    const answers = onConfirm.mock.calls[0]![0] as NotesResolution[]
    expect(answers).toEqual([
      {
        dependentId: 'note-1',
        choice: 'reanchor',
        targetRef: { kind: 'entity', entityId: "p1" },
        expectedAnchor: '{"anchor":"old"}',
      },
    ])
  })

  it('disables Floor Point with the reason, and never offers a choice the row did not (#82 criteria 1, 16)', () => {
    render(
      <NotesReviewDialog
        project={project}
        report={report([row({ floorPointDisabled: true })])}
        stale={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )
    const floorPoint = screen.getByTestId('notes-review-choice-floor_point')
    expect(floorPoint.hasAttribute('disabled')).toBe(true)
    expect(floorPoint.getAttribute('title')).toBe('This note has no position on a Floor')
    expect(screen.queryByTestId('notes-review-choice-keep')).toBeNull()
  })

  it('says what Keep does before Apply, and starts a preset row answered (#82 criterion 1)', () => {
    render(
      <NotesReviewDialog
        project={project}
        report={report([row({ choices: ['delete', 'keep'], preset: 'delete', note: 'keep-floor-point', targets: [] })])}
        stale={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )
    expect(screen.getByText('Keep → Floor Point, All Options')).toBeDefined()
    expect(screen.getByTestId('notes-review-confirm').hasAttribute('disabled')).toBe(false)
  })

  it('shows the stale notice only when the answer came back refused (#82 criterion 12)', () => {
    const { rerender } = render(
      <NotesReviewDialog project={project} report={report([row()])} stale={false} onConfirm={() => undefined} onCancel={() => undefined} />,
    )
    expect(screen.queryByTestId('notes-review-stale')).toBeNull()
    rerender(
      <NotesReviewDialog project={project} report={report([row()])} stale onConfirm={() => undefined} onCancel={() => undefined} />,
    )
    expect(screen.getByTestId('notes-review-stale').textContent).toBe(
      'Something changed while this review was open. Check the highlighted rows.',
    )
  })

  it('cancels, and treats Escape as Cancel (#82 criterion 13)', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <NotesReviewDialog project={project} report={report([row()])} stale={false} onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByTestId('notes-review-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

const wallReview: DeleteWallReview = {
  kind: 'delete-wall',
  wallId: 'w3',
  wallRef: 'W-3',
  openings: [{ id: 'o1', label: 'Door 1', kind: 'door', text: 'Door 1 · door' }],
  skirting: [],
  message: 'Delete W-3 and its opening?',
}

describe('the Wall review carrying the Notes section (#82 criterion 14)', () => {
  it('asks one question with the Wall rows followed by Comments and Annotations', () => {
    const onConfirm = vi.fn()
    render(
      <DeleteWallReviewDialog
        review={wallReview}
        notes={{ report: report([row({ choices: ['delete'], preset: 'delete', targets: [] })]), project }}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )
    expect(screen.getByTestId('delete-wall-review-row').textContent).toBe('Door 1 · door')
    expect(screen.getByTestId('notes-review-heading').textContent).toBe('Comments and Annotations')
    fireEvent.click(screen.getByTestId('delete-wall-review-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0]![0]).toEqual([
      { dependentId: 'note-1', choice: 'delete', expectedAnchor: '{"anchor":"old"}' },
    ])
  })

  it('still confirms with no Notes at all', () => {
    const onConfirm = vi.fn()
    render(<DeleteWallReviewDialog review={wallReview} onConfirm={onConfirm} onCancel={() => undefined} />)
    expect(screen.queryByTestId('notes-review-heading')).toBeNull()
    fireEvent.click(screen.getByTestId('delete-wall-review-confirm'))
    expect(onConfirm).toHaveBeenCalledWith([])
  })
})
