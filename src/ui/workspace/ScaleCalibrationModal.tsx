/**
 * The second half of calibration (#55, #56 criterion 5): the drawn distance is in pixels,
 * the answer is in the Project's display unit, and `plan.calibrate` stores the quotient
 * `pixelsPerMm = distancePx / distanceMm`.
 *
 * What calibration changes is the image's display scale and nothing else. Stored geometry
 * is never multiplied — that was the coordinate flip #11 finding 6 named — so recalibrating
 * an image that already has items on it moves the picture, not the furniture.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit } from '../../domain'
import { formatMm, parseToMm } from './displayUnits'

export interface ScaleCalibrationModalProps {
  distancePx: number
  unit: DisplayUnit
  precision: number
  onConfirm: (pixelsPerMm: number) => void
  onClose: () => void
}

/** The default answer: one metre, in whatever the Project is being read in. */
const DEFAULT_MM = 1000

export function ScaleCalibrationModal(props: ScaleCalibrationModalProps): ReactNode {
  const { distancePx, unit, precision, onConfirm, onClose } = props
  const [text, setText] = useState(formatMm(DEFAULT_MM, unit, precision))

  function handleConfirm() {
    if (distancePx <= 0) return
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return
    const mm = parseToMm(parsed, unit)
    if (mm <= 0) return
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
        <label className="bb-workspace-field-label" htmlFor="cal-mm">
          Distance <span className="bb-workspace-unit-suffix">({unit})</span>
        </label>
        <input
          id="cal-mm"
          className="bb-workspace-input"
          data-testid="calibration-distance"
          type="number"
          step="any"
          value={text}
          onChange={(e) => setText(e.target.value)}
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
