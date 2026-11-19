/**
 * The Convert to Custom Path dialog (#58 §5).
 *
 * Conversion is deliberately lossy and the dialog says exactly what is lost, from
 * `convertWarningFor` — the domain's own statement of what the preset in hand stores. A
 * Rectangle is told it loses width, depth and orientation and nothing else; a Rounded
 * Rectangle with four radii is told about four radii. A warning that names a field the shape
 * never had is a warning about a shape the person is not holding.
 *
 * `Cancel` takes focus, not `Convert anyway`. The default answer to a destructive question is
 * the one that changes nothing, and Enter has to mean that.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { convertWarningFor } from '../../../domain'
import type { Preset } from '../../../derive'

export interface ConvertDialogProps {
  /** The Item Design's name, which is the dialog's heading: it says what is being converted. */
  readonly designName: string
  readonly preset: Preset
  readonly onConvert: () => void
  readonly onCancel: () => void
}

export function ConvertDialog(props: ConvertDialogProps): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="convert-modal">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="convert-modal-heading"
        className="bb-workspace-dialog bb-shape-convert-dialog"
      >
        <p className="bb-shape-dialog-eyebrow">Convert to Custom Path</p>
        <h2 id="convert-modal-heading" data-testid="convert-modal-heading">{props.designName}</h2>
        <p className="bb-shape-dialog-body" data-testid="convert-modal-warning">{convertWarningFor(props.preset)}</p>
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            ref={cancelRef}
            data-testid="convert-cancel"
            className="bb-workspace-secondary-button"
            onClick={props.onCancel}
          >
            Cancel — keep parameters
          </button>
          <button
            type="button"
            data-testid="convert-confirm"
            className="bb-workspace-primary-button bb-shape-destructive"
            onClick={props.onConvert}
          >
            Convert anyway
          </button>
        </div>
      </div>
    </div>
  )
}
