/**
 * `<ref> belongs to the Existing Model` (#70 §7a): the forced choice.
 *
 * This dialog only ever appears where nothing has been written. The edit it is asking about was
 * refused by `applyIntent` — the Existing Model is the baseline every Design Option is drawn
 * against, so it cannot be changed as a side effect of working inside one — and the pending Intent
 * is held by the workspace until one of these three buttons is pressed.
 *
 * The order is the issue's, and it is not alphabetical or by cost: the primary button is what the
 * person was almost certainly doing (their option gets the moved work, the survey keeps what it
 * said), the danger button is the rarer and wider-reaching one (every option sees it), and Cancel
 * is a real third choice rather than a dismiss. Esc is Cancel.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { RENOVATION_STRINGS } from '../../strings/renovation'

export interface ForcedChoiceDialogProps {
  /** `W-1` — the entity the refused edit was aimed at. */
  entityRef: string
  /** `Combined` — the Display the edit was made from. */
  display: string
  /** `Option B · Widened opening` — the Design Option it was made in. */
  optionName: string
  onReplace: () => void
  onCorrect: () => void
  onCancel: () => void
}

export function ForcedChoiceDialog(props: ForcedChoiceDialogProps): ReactNode {
  const { entityRef, display, optionName, onReplace, onCorrect, onCancel } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="forced-choice-dialog">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={RENOVATION_STRINGS.forcedChoiceTitle(entityRef)}
        className="bb-workspace-dialog"
      >
        <h2 data-testid="forced-choice-title">{RENOVATION_STRINGS.forcedChoiceTitle(entityRef)}</h2>
        <p data-testid="forced-choice-body">
          {RENOVATION_STRINGS.forcedChoiceLead}
          {' '}
          <strong>{display}</strong>
          {' '}
          {RENOVATION_STRINGS.forcedChoiceBetween}
          {' '}
          <strong>{optionName}</strong>
          {RENOVATION_STRINGS.forcedChoiceTail}
        </p>
        <div className="bb-renovation-choice-actions">
          <button
            type="button"
            data-testid="forced-choice-replace"
            className="bb-workspace-primary-button"
            onClick={onReplace}
          >
            {RENOVATION_STRINGS.forcedChoiceReplace(optionName, entityRef)}
          </button>
          <button
            type="button"
            data-testid="forced-choice-correct"
            className="bb-workspace-danger-button"
            onClick={onCorrect}
          >
            {RENOVATION_STRINGS.forcedChoiceCorrect}
          </button>
          <button
            type="button"
            data-testid="forced-choice-cancel"
            className="bb-workspace-secondary-button"
            onClick={onCancel}
          >
            {RENOVATION_STRINGS.forcedChoiceCancel}
          </button>
        </div>
      </div>
    </div>
  )
}
