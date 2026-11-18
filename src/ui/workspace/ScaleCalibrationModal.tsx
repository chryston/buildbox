/**
 * The second half of calibration (#55): the drawn distance is in pixels, the answer is
 * in millimetres, and `plan.calibrate` stores the quotient. Moved from the legacy page
 * with the behaviour intact and the styling tokenised.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'

export interface ScaleCalibrationModalProps {
  distancePx: number
  onConfirm: (pixelsPerMm: number) => void
  onClose: () => void
}

export function ScaleCalibrationModal(props: ScaleCalibrationModalProps): ReactNode {
  const { distancePx, onConfirm, onClose } = props
  const [mm, setMm] = useState(1000)

  function handleConfirm() {
    if (distancePx <= 0) return
    if (!Number.isFinite(mm) || mm <= 0) return
    onConfirm(distancePx / mm)
  }

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="calibration-modal">
      <div role="dialog" aria-modal="true" aria-label="Calibrate Scale" className="bb-workspace-dialog">
        <h2>Calibrate Scale</h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--bb-text-muted)' }}>
          You drew a line of <strong style={{ color: 'var(--bb-text)' }}>{Math.round(distancePx)}px</strong>.<br />
          What is the real-world length of this line?
        </p>
        {distancePx <= 0 && (
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--bb-danger-text)' }}>
            Could not measure distance — try clicking two further-apart points.
          </p>
        )}
        <label className="bb-workspace-field-label" htmlFor="cal-mm">Distance (mm)</label>
        <input
          id="cal-mm"
          className="bb-workspace-input"
          type="number"
          min={1}
          value={mm}
          onChange={(e) => setMm(Number(e.target.value))}
          autoFocus
        />
        <div className="bb-workspace-dialog-actions">
          <button type="button" data-testid="calibration-confirm" className="bb-workspace-primary-button" onClick={handleConfirm}>
            Confirm
          </button>
          <button type="button" data-testid="calibration-cancel" className="bb-workspace-secondary-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
