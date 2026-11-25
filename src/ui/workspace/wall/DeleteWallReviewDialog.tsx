/**
 * The delete-host review (#65 §8): the list a Wall with Openings has to be answered before it
 * goes through.
 *
 * The list is not decoration. An Opening is an absence in one Wall, and when that Wall is gone
 * there is nothing left for it to be an absence in — so a delete that would take two doors with
 * it says which two, and the answer goes back into the Intent as the ids it was given. An
 * Opening added after this preview makes that answer stale, and the handler refuses the Intent
 * with `DependencyChanged` rather than deleting something nobody agreed to (#65 criterion 7).
 *
 * It is a modal over the workspace, not a thing drawn in the Plan View: the scene is the plan,
 * and a question is not part of a plan.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DeleteWallReview, NotesDependencyReport, NotesResolution } from '../../../edit'
import type { Project } from '../../../domain'
import { STRINGS } from '../../strings'
import { NotesReviewSection, initialNotesAnswers, notesResolutions, unansweredNotes } from '../notes/NotesReview'
import type { NotesAnswer, NotesAnswers } from '../notes/NotesReview'

export interface DeleteWallReviewNotes {
  report: NotesDependencyReport
  project: Project
}

export interface DeleteWallReviewDialogProps {
  review: DeleteWallReview
  /**
   * The Notes this same delete would strand (#82 criterion 14). They are a section of this question,
   * never a second dialog: one Apply commits one transaction that answers both.
   */
  notes?: DeleteWallReviewNotes | null
  onConfirm: (resolutions: readonly NotesResolution[]) => void
  onCancel: () => void
}

export function DeleteWallReviewDialog(props: DeleteWallReviewDialogProps): ReactNode {
  const { review, notes, onConfirm, onCancel } = props
  const [answers, setAnswers] = useState<NotesAnswers>(() => (notes === null || notes === undefined ? {} : initialNotesAnswers(notes.report)))
  // Escape is the same answer as Cancel: the revision does not move either way (#65 criterion 7).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const outstanding = notes === null || notes === undefined ? 0 : unansweredNotes(notes.report, answers)
  const answer = (dependentId: string, next: NotesAnswer): void =>
    setAnswers((current) => ({ ...current, [dependentId]: next }))

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="delete-wall-review">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={review.message}
        className="bb-workspace-dialog"
        data-testid="delete-wall-review-dialog"
      >
        <h2>{review.message}</h2>
        <ul
          data-testid="delete-wall-review-openings"
          style={{ margin: '0 0 12px', padding: '0 0 0 18px', fontSize: 13 }}
        >
          {review.openings.map((opening) => (
            <li key={opening.id} data-testid="delete-wall-review-row">{opening.text}</li>
          ))}
          {/* The runs drawn against this Wall's faces, listed beside the openings it carries (#78 §5). */}
          {review.skirting.map((entry) => (
            <li key={entry.id} data-testid="delete-wall-review-row">{entry.text}</li>
          ))}
        </ul>
        {notes !== null && notes !== undefined && (
          <NotesReviewSection project={notes.project} report={notes.report} answers={answers} onAnswer={answer} />
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="delete-wall-review-confirm"
            className="bb-workspace-primary-button"
            disabled={outstanding > 0}
            title={outstanding > 0 ? STRINGS.notesReviewNeedsAnswer(outstanding) : undefined}
            onClick={() => {
              if (notes === null || notes === undefined) {
                onConfirm([])
                return
              }
              const resolutions = notesResolutions(notes.report, answers)
              if (resolutions !== null) onConfirm(resolutions)
            }}
          >
            {STRINGS.wallDeleteWithDependencies(review.openings.length, review.skirting.length)}
          </button>
          <button
            type="button"
            data-testid="delete-wall-review-cancel"
            className="bb-workspace-secondary-button"
            onClick={onCancel}
          >
            {STRINGS.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
