/**
 * `Delete Elevation View?` (#75 §3, behaviour 19).
 *
 * The question has one honest answer and the dialog exists to say it before the click: the view's
 * saved settings go, and no model content changes. An Elevation View is a way of looking, so there is
 * nothing to count and nothing to move — which is why this is one line and not the table
 * `DeleteLayerDialog` needs.
 *
 * The one thing that can go wrong between asking and confirming is that the view is already gone —
 * deleted in another tab, or undone out from under the dialog. `problem` carries that sentence, and
 * the confirm stays there so the person can still choose Cancel.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { STRINGS } from '../strings'

export interface DeleteElevationViewDialogProps {
  /** The view's name, quoted in the sentence so it is clear which one is meant. */
  name: string
  /** Why the last confirm was refused — the view deleted while the question was open. */
  problem?: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteElevationViewDialog(props: DeleteElevationViewDialogProps): ReactNode {
  const { name, problem, onConfirm, onCancel } = props
  // Escape changes nothing, which is what the Cancel button says it does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="delete-elevation-view-dialog">
      <div className="bb-workspace-dialog" role="dialog" aria-modal="true" aria-label={STRINGS.elevationView}>
        <p className="bb-workspace-dialog-line" data-testid="delete-elevation-view-question">
          {STRINGS.deleteElevationViewConfirm(name)}
        </p>
        {problem !== undefined && (
          <p className="bb-workspace-error" data-testid="delete-elevation-view-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="delete-elevation-view-confirm"
            className="bb-workspace-danger-button"
            onClick={onConfirm}
          >
            {STRINGS.deleteElevationView}
          </button>
          <button
            type="button"
            data-testid="delete-elevation-view-cancel"
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
