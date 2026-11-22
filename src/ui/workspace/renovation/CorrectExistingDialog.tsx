/**
 * `Correct the shared Existing Model?` (#70 §7b): the danger dialog.
 *
 * One row per Design Option, in Project order, each saying what that Option will do with the
 * correction — keep the entity, take it down, or let its own successor follow the corrected
 * geometry because the successor still stands where the survey put it. The rows are the
 * `CorrectionReview` the Intent's own preview produces (#69 §12), so the dialog cannot promise an
 * effect the write will not have, and an Option whose dependent update cannot be honoured blocks
 * the whole correction instead of being quietly skipped.
 *
 * Confirming sends the pending edit back wrapped in `renovation.correctExistingModel`: one atomic
 * Edit Transaction, one undo.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { CorrectionEffect, CorrectionReview } from '../../../edit'
import { RENOVATION_STRINGS } from '../../strings/renovation'

export interface CorrectExistingDialogProps {
  review: CorrectionReview
  /** The `<change>` word: `move`, `change`, `be removed`, `appear`. */
  change: string
  /** Why the last confirm was refused. */
  problem?: string
  onConfirm: () => void
  onCancel: () => void
}

/** §7b's row for each of the four effects the preview can report. */
const EFFECT_ROWS: { [E in CorrectionEffect]: string } = {
  retains: RENOVATION_STRINGS.correctRetains,
  demolishes: RENOVATION_STRINGS.correctDemolishes,
  'demolishes; successor stays aligned': RENOVATION_STRINGS.correctAligned,
  'demolishes; successor keeps its own geometry': RENOVATION_STRINGS.correctOwnGeometry,
}

/** An Option that cannot take the correction blocks it: the transaction is all-or-nothing. */
export const correctIsBlocked = (review: CorrectionReview): boolean =>
  review.options.some((option) => option.blockers.length > 0)

export function CorrectExistingDialog(props: CorrectExistingDialogProps): ReactNode {
  const { review, change, problem, onConfirm, onCancel } = props
  const blocked = correctIsBlocked(review)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="correct-existing-dialog">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={RENOVATION_STRINGS.correctTitle}
        className="bb-workspace-dialog"
      >
        <h2 data-testid="correct-existing-title">{RENOVATION_STRINGS.correctTitle}</h2>
        <p className="bb-workspace-dialog-danger" data-testid="correct-existing-danger">
          {RENOVATION_STRINGS.correctLead}
          {' '}
          <strong>{RENOVATION_STRINGS.correctEvery}</strong>
          {' '}
          {RENOVATION_STRINGS.correctWillSee(review.entityRef, change)}
        </p>
        <ul className="bb-workspace-dependency-list" data-testid="correct-existing-options">
          {review.options.map((option) => (
            <li key={option.optionId} data-testid={`correct-existing-option-${option.optionId}`}>
              {option.optionName} {EFFECT_ROWS[option.effect]}
              {option.dependants.length > 0 && (
                <ul className="bb-workspace-dependency-list" data-testid={`correct-existing-dependants-${option.optionId}`}>
                  {option.dependants.map((dependency) => (
                    <li key={dependency.id}>{dependency.label}</li>
                  ))}
                </ul>
              )}
              {option.blockers.map((blocker) => (
                <p className="bb-workspace-field-error" role="alert" key={blocker}>
                  {blocker}
                </p>
              ))}
            </li>
          ))}
        </ul>
        <p className="bb-workspace-dialog-note" data-testid="correct-existing-muted">
          {RENOVATION_STRINGS.correctMuted}
        </p>
        {problem !== undefined && (
          <p className="bb-workspace-field-error" data-testid="correct-existing-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="correct-existing-confirm"
            className="bb-workspace-danger-button"
            disabled={blocked}
            onClick={onConfirm}
          >
            {RENOVATION_STRINGS.correctConfirm}
          </button>
          <button
            type="button"
            data-testid="correct-existing-cancel"
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
