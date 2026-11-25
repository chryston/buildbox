/**
 * `Delete Option B?` (#69 §2, criterion 9): what this Option owns, counted.
 *
 * The counts come from the Intent's own preview, never from a second count taken here — the same
 * rule #65 set for a Wall with Openings. What the person is being promised is the sentence under
 * the list: an Option is a drawing over the Existing Model, so deleting one cannot change the
 * record every Option is drawn against, and saying so is what makes the danger button an
 * informed press rather than a leap.
 *
 * A row is shown only where the Option actually owns something. A new Option holds nothing, and a
 * dialog of seven zeroes teaches a person to stop reading it.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DeleteDesignOptionReview, NotesDependencyReport, NotesResolution } from '../../../edit'
import type { Project } from '../../../domain'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { NotesReviewSection, initialNotesAnswers, notesResolutions, unansweredNotes } from '../notes/NotesReview'
import type { NotesAnswer, NotesAnswers } from '../notes/NotesReview'

/** What the Notes half of this review needs: the rows the delete would strand, and the Project to name them in. */
export interface DeleteOptionReviewNotes {
  readonly report: NotesDependencyReport
  readonly project: Project
}

export interface DeleteDesignOptionDialogProps {
  review: DeleteDesignOptionReview
  /**
   * The Comments and Annotations this Option owns or is anchored to (#82 criterion 14). They are answered
   * in this same modal, above one Apply — never a second dialog that asks a person to hold two questions
   * open at once.
   */
  notes?: DeleteOptionReviewNotes | null
  onConfirm: (resolutions: readonly NotesResolution[]) => void
  onCancel: () => void
}

/** The seven counts, each with the words that name it — the zero rows dropped. */
export function deleteOptionRows(review: DeleteDesignOptionReview): readonly { id: string; text: string }[] {
  const { counts } = review
  return [
    { id: 'walls', text: RENOVATION_STRINGS.deleteOptionWalls(counts.walls) },
    { id: 'wallJunctions', text: RENOVATION_STRINGS.deleteOptionJunctions(counts.wallJunctions) },
    { id: 'openings', text: RENOVATION_STRINGS.deleteOptionOpenings(counts.openings) },
    { id: 'rooms', text: RENOVATION_STRINGS.deleteOptionRooms(counts.rooms) },
    { id: 'placedItems', text: RENOVATION_STRINGS.deleteOptionPlacedItems(counts.placedItems) },
    { id: 'demolished', text: RENOVATION_STRINGS.deleteOptionDemolished(counts.demolished) },
    { id: 'acknowledgements', text: RENOVATION_STRINGS.deleteOptionAcknowledgements(counts.acknowledgements) },
  ].filter((row) => !row.text.startsWith('0 '))
}

export function DeleteDesignOptionDialog(props: DeleteDesignOptionDialogProps): ReactNode {
  const { review, notes, onConfirm, onCancel } = props
  const heading = RENOVATION_STRINGS.deleteOptionHeading(review.optionName)
  const [answers, setAnswers] = useState<NotesAnswers>(() =>
    notes === null || notes === undefined ? {} : initialNotesAnswers(notes.report),
  )
  const answer = (dependentId: string, next: NotesAnswer): void => {
    setAnswers((current) => ({ ...current, [dependentId]: next }))
  }
  const outstanding = notes === null || notes === undefined ? 0 : unansweredNotes(notes.report, answers)
  // Escape answers the question the same way Cancel does: nothing is deleted (#65 criterion 7).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="delete-option-dialog">
      <div role="dialog" aria-modal="true" aria-label={heading} className="bb-workspace-dialog">
        <h2>{heading}</h2>
        <ul className="bb-workspace-dependency-list" data-testid="delete-option-counts">
          {deleteOptionRows(review).map((row) => (
            <li key={row.id} data-testid={`delete-option-${row.id}`}>{row.text}</li>
          ))}
        </ul>
        <p className="bb-workspace-dialog-note" data-testid="delete-option-unchanged">
          {RENOVATION_STRINGS.deleteOptionUnchanged}
        </p>
        {notes !== null && notes !== undefined && (
          <NotesReviewSection project={notes.project} report={notes.report} answers={answers} onAnswer={answer} />
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="delete-option-confirm"
            className="bb-workspace-danger-button"
            disabled={outstanding > 0}
            onClick={() => {
              if (notes === null || notes === undefined) {
                onConfirm([])
                return
              }
              const resolutions = notesResolutions(notes.report, answers)
              if (resolutions !== null) onConfirm(resolutions)
            }}
          >
            {RENOVATION_STRINGS.deleteOptionConfirm}
          </button>
          <button
            type="button"
            data-testid="delete-option-cancel"
            className="bb-workspace-secondary-button"
            onClick={onCancel}
          >
            {RENOVATION_STRINGS.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
