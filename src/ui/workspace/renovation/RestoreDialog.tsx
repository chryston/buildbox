/**
 * `Restore W-2?` (#70 §7d): the confirmation before a demolition record leaves a Design Option.
 *
 * Restoring is not the mirror image of demolishing. Demolishing adds a record and leaves the survey
 * alone; restoring takes a record away, and the Option's own proposed work may be standing on it —
 * a successor drawn over the baseline record it replaces falls when the record that anchors it goes.
 * The dialog says so before anything is written, and says it from the Intent's own preview
 * (`RestoreReview`, #69 §9), so the successors named are the ones the write will delete.
 *
 * The question itself is the review's sentence — `Restore W-2?` — rather than a second one written
 * beside it. Confirming dispatches one `renovation.restore`, which is one Edit Transaction: one undo
 * brings the record and its successors back together.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { RestoreReview } from '../../../edit'
import { RENOVATION_STRINGS } from '../../strings/renovation'

export interface RestoreDialogProps {
  review: RestoreReview
  /** The Design Option the record leaves. The review names the entity, not the Option. */
  optionName: string
  /** Why the last confirm was refused. */
  problem?: string
  onConfirm: () => void
  onCancel: () => void
}

export function RestoreDialog(props: RestoreDialogProps): ReactNode {
  const { review, optionName, problem, onConfirm, onCancel } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const falling = review.deletes.map((each) => each.label).join(', ')
  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="restore-dialog">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={review.message}
        className="bb-workspace-dialog"
      >
        <h2 data-testid="restore-title">{review.message}</h2>
        <p className="bb-workspace-dialog-note" data-testid="restore-body">
          {RENOVATION_STRINGS.restoreBody(optionName)}
        </p>
        {review.deletes.length > 0 && (
          <p className="bb-workspace-dialog-danger" data-testid="restore-danger">
            {RENOVATION_STRINGS.restoreDeletes(falling)}
          </p>
        )}
        {problem !== undefined && (
          <p className="bb-workspace-field-error" data-testid="restore-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="restore-confirm"
            className={review.deletes.length > 0 ? 'bb-workspace-danger-button' : 'bb-workspace-primary-button'}
            onClick={onConfirm}
          >
            {RENOVATION_STRINGS.actionRestore}
          </button>
          <button
            type="button"
            data-testid="restore-cancel"
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
