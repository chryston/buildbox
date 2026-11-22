/**
 * `Move to a Design Option?` (#69 §13, criterion 8): baseline data that was surveyed by mistake
 * becomes one Option's own work.
 *
 * The danger paragraph is the whole reason this dialog exists. A move takes entities out of the
 * Existing Model, which every Option is drawn against, so the effect is not local to the Option
 * being chosen — it is read per Option from the preview, which is the same answer the write will
 * follow or refuse. Where an Option holds a successor of something being moved, that Option says
 * so and the confirm action is disabled: the person restores there first, rather than finding out
 * from a rejection after pressing.
 *
 * Choosing another target re-previews. The dialog never recomputes an effect of its own, so what
 * is listed is what `applyIntent` will do, entry for entry.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { MoveToOptionReview } from '../../../edit'
import type { DesignOption } from '../../../domain'
import { RENOVATION_STRINGS } from '../../strings/renovation'

export interface MoveToOptionDialogProps {
  review: MoveToOptionReview
  /** Every Option the person could move to, in the order the settings list shows them. */
  options: readonly DesignOption[]
  /** Why the last confirm was refused, when one was (#69 criterion 8). */
  problem?: string
  onTargetChange: (optionId: string) => void
  onConfirm: () => void
  onCancel: () => void
}

/** One Option's blocker stops the move: the baseline would leave that Option holding a successor of nothing. */
export const moveToOptionIsBlocked = (review: MoveToOptionReview): boolean =>
  review.options.some((option) => option.blockers.length > 0)

export function MoveToOptionDialog(props: MoveToOptionDialogProps): ReactNode {
  const { review, options, problem, onTargetChange, onConfirm, onCancel } = props
  const blocked = moveToOptionIsBlocked(review)
  // Escape is Cancel: the entities stay in the Existing Model (#65 criterion 7).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="move-to-option-dialog">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={RENOVATION_STRINGS.moveHeading}
        className="bb-workspace-dialog"
      >
        <h2>{RENOVATION_STRINGS.moveHeading}</h2>
        <label className="bb-workspace-field-label" htmlFor="move-target-option">
          {RENOVATION_STRINGS.moveTargetOption}
        </label>
        <select
          id="move-target-option"
          data-testid="move-target-option"
          className="bb-workspace-select"
          value={review.targetOptionId}
          onChange={(event) => onTargetChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        <p className="bb-workspace-dialog-note" data-testid="move-danger">
          {RENOVATION_STRINGS.moveDanger}
        </p>
        <ul className="bb-workspace-dependency-list" data-testid="move-items">
          {review.moves.map((move) => (
            <li key={move.id} data-testid={`move-item-${move.id}`}>{move.label}</li>
          ))}
        </ul>
        <p className="bb-workspace-field-hint" data-testid="move-count">
          {RENOVATION_STRINGS.moveItems(review.moves.length)}
        </p>
        <ul className="bb-workspace-dependency-list" data-testid="move-option-effects">
          {review.options.map((option) => (
            <li key={option.optionId} data-testid={`move-option-${option.optionId}`}>
              <span className="bb-workspace-dependency-text">{option.optionName}</span>
              {option.removesDemolitions.length > 0 && (
                <span data-testid={`move-option-drops-${option.optionId}`}>
                  {RENOVATION_STRINGS.moveRemovesDemolitions(option.removesDemolitions.length)}
                </span>
              )}
              {option.detaches.length > 0 && (
                <span data-testid={`move-option-detaches-${option.optionId}`}>
                  {RENOVATION_STRINGS.moveDetaches(option.detaches)}
                </span>
              )}
              {option.blockers.length > 0 && (
                <span data-testid={`move-option-blocked-${option.optionId}`}>
                  {RENOVATION_STRINGS.moveBlocked}
                  {option.blockers.join(' ')}
                </span>
              )}
            </li>
          ))}
        </ul>
        {problem !== undefined && (
          <p className="bb-workspace-field-error" data-testid="move-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="move-to-option-confirm"
            className="bb-workspace-danger-button"
            disabled={blocked}
            onClick={onConfirm}
          >
            {RENOVATION_STRINGS.moveConfirm(review.targetOptionName)}
          </button>
          <button
            type="button"
            data-testid="move-to-option-cancel"
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
