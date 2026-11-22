/**
 * `Demolish W-3?` (#69 §9, criterion 3): the Wall that comes down, and everything on it.
 *
 * The question and its list are the preview's own — `edit` answers a `renovation.demolish` with
 * the Openings that go with the Wall and the reasons the answer cannot be acted on — so this
 * component holds no opinion of its own about what is blocked. It says the same thing the refused
 * Intent would, which is the point of asking before writing rather than after.
 *
 * Confirming carries the reviewed ids back to the Intent. An Opening added after the question was
 * asked therefore makes the answer stale, and the write is refused instead of demolishing
 * something nobody agreed to (#65 §8, the same shape as a Wall delete).
 *
 * #70 opens this from `Mark demolition`; nothing on the mode bar does yet.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { DemolitionReview } from '../../../edit'
import { RENOVATION_STRINGS } from '../../strings/renovation'

export interface DemolishWallDialogProps {
  review: DemolitionReview
  /** Why the last confirm was refused — a stale answer, usually (#69 criterion 3). */
  problem?: string
  onConfirm: () => void
  onCancel: () => void
}

/** A Wall with something the person has to deal with first cannot be demolished. */
export const demolishIsBlocked = (review: DemolitionReview): boolean => review.blockers.length > 0

export function DemolishWallDialog(props: DemolishWallDialogProps): ReactNode {
  const { review, problem, onConfirm, onCancel } = props
  const blocked = demolishIsBlocked(review)
  // Escape is Cancel: the Wall stands either way (#65 criterion 7).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="demolish-dialog">
      <div role="dialog" aria-modal="true" aria-label={review.message} className="bb-workspace-dialog">
        <h2>{review.message}</h2>
        {review.willDemolish.length === 0 ? (
          <p className="bb-workspace-dialog-note" data-testid="demolish-none">
            {RENOVATION_STRINGS.demolishNothing}
          </p>
        ) : (
          <>
            <p className="bb-workspace-field-label" data-testid="demolish-takes">
              {RENOVATION_STRINGS.demolishTakes}
            </p>
            <ul className="bb-workspace-dependency-list" data-testid="demolish-dependencies">
              {review.willDemolish.map((dependency) => (
                <li key={dependency.id} data-testid={`demolish-dependency-${dependency.id}`}>
                  {dependency.label}
                </li>
              ))}
            </ul>
          </>
        )}
        {blocked && (
          <>
            <p className="bb-workspace-field-label" data-testid="demolish-blocked-label">
              {RENOVATION_STRINGS.demolishBlocked}
            </p>
            <ul className="bb-workspace-dependency-list" data-testid="demolish-blockers">
              {review.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </>
        )}
        {problem !== undefined && (
          <p className="bb-workspace-field-error" data-testid="demolish-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="demolish-confirm"
            className="bb-workspace-danger-button"
            disabled={blocked}
            onClick={onConfirm}
          >
            {RENOVATION_STRINGS.demolishConfirm(review.willDemolish.length)}
          </button>
          <button
            type="button"
            data-testid="demolish-cancel"
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
