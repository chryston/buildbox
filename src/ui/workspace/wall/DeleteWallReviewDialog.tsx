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
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { DependencyReview } from '../../../edit'
import { STRINGS } from '../../strings'

export interface DeleteWallReviewDialogProps {
  review: DependencyReview
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteWallReviewDialog(props: DeleteWallReviewDialogProps): ReactNode {
  const { review, onConfirm, onCancel } = props
  // Escape is the same answer as Cancel: the revision does not move either way (#65 criterion 7).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

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
        </ul>
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="delete-wall-review-confirm"
            className="bb-workspace-primary-button"
            onClick={onConfirm}
          >
            {STRINGS.wallDeleteWithOpenings(review.openings.length)}
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
