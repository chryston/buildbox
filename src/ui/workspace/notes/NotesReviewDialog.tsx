/**
 * The Notes dependency review on its own (#82 §2): the modal a delete opens when the only thing it
 * would strand is a Comment or an Annotation.
 *
 * Nothing is decided until Apply. Cancel and Escape are the same answer — the revision does not move
 * either way — and Apply is refused while a row is still undecided, so a note is never carried along
 * by a default nobody chose. When the Project has moved on since the review was opened the edit layer
 * refuses the whole Intent, and the notice says so rather than silently re-asking.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { NotesDependencyReport, NotesResolution } from '../../../edit'
import type { Project } from '../../../domain'
import { STRINGS } from '../../strings'
import { NotesReviewSection, initialNotesAnswers, notesResolutions, unansweredNotes } from './NotesReview'
import type { NotesAnswer, NotesAnswers } from './NotesReview'
import { useState } from 'react'

export interface NotesReviewDialogProps {
  project: Project
  report: NotesDependencyReport
  /** Set when the same Intent has already come back refused: the review is stale, not unanswered. */
  stale: boolean
  onConfirm: (resolutions: NotesResolution[]) => void
  onCancel: () => void
}

export function NotesReviewDialog(props: NotesReviewDialogProps): ReactNode {
  const { project, report, stale, onConfirm, onCancel } = props
  const [answers, setAnswers] = useState<NotesAnswers>(() => initialNotesAnswers(report))
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const outstanding = unansweredNotes(report, answers)
  const answer = (dependentId: string, next: NotesAnswer): void =>
    setAnswers((current) => ({ ...current, [dependentId]: next }))

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="notes-review">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={STRINGS.notesReviewHeading(report.rows.length)}
        className="bb-workspace-dialog bb-notes-review-dialog"
        data-testid="notes-review-dialog"
      >
        <p className="bb-workspace-dialog-eyebrow bb-notes-review-eyebrow" data-testid="notes-review-eyebrow">
          {STRINGS.notesReviewEyebrow}
        </p>
        <h2>{STRINGS.notesReviewHeading(report.rows.length)}</h2>
        {stale && (
          <p className="bb-workspace-dialog-note bb-notes-review-stale" data-testid="notes-review-stale">
            {STRINGS.notesReviewStale}
          </p>
        )}
        <NotesReviewSection project={project} report={report} answers={answers} onAnswer={answer} />
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="notes-review-cancel"
            className="bb-workspace-secondary-button"
            onClick={onCancel}
          >
            {STRINGS.notesReviewCancel}
          </button>
          <button
            type="button"
            data-testid="notes-review-confirm"
            className="bb-workspace-primary-button bb-notes-review-danger"
            disabled={outstanding > 0}
            title={outstanding > 0 ? STRINGS.notesReviewNeedsAnswer(outstanding) : undefined}
            onClick={() => {
              const resolutions = notesResolutions(report, answers)
              if (resolutions !== null) onConfirm(resolutions)
            }}
          >
            {STRINGS.notesReviewApply}
          </button>
        </div>
      </div>
    </div>
  )
}
