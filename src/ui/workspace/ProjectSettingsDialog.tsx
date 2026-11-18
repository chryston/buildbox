/**
 * The Project settings dialog (#55 criterion 5): display unit and precision, the two
 * preferences the Project carries. Changing the unit presets the precision to that
 * unit's default — mm 0, cm 1, m 3 — and the person may override it; Save dispatches
 * one `project.setPreferences`, so the pair is one undo step.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit } from '../../domain'
import { DEFAULT_PRECISION } from './displayUnits'

const UNITS: readonly DisplayUnit[] = ['mm', 'cm', 'm']

export interface ProjectSettingsDialogProps {
  unit: DisplayUnit
  precision: number
  onSave: (unit: DisplayUnit, precision: number) => void
  onClose: () => void
}

export function ProjectSettingsDialog(props: ProjectSettingsDialogProps): ReactNode {
  const { unit, precision, onSave, onClose } = props
  const [nextUnit, setNextUnit] = useState<DisplayUnit>(unit)
  const [nextPrecision, setNextPrecision] = useState(precision)

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="project-settings-dialog">
      <div role="dialog" aria-modal="true" aria-label="Project settings" className="bb-workspace-dialog">
        <h2>Project settings</h2>
        <label className="bb-workspace-field-label" htmlFor="settings-unit">Display unit</label>
        <select
          id="settings-unit"
          data-testid="settings-unit"
          className="bb-workspace-select"
          value={nextUnit}
          onChange={(event) => {
            const unit = event.target.value as DisplayUnit
            setNextUnit(unit)
            setNextPrecision(DEFAULT_PRECISION[unit])
          }}
        >
          {UNITS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <label className="bb-workspace-field-label" htmlFor="settings-precision">Decimal places</label>
        <input
          id="settings-precision"
          data-testid="settings-precision"
          className="bb-workspace-input"
          type="number"
          min={0}
          max={4}
          step={1}
          value={nextPrecision}
          onChange={(event) => setNextPrecision(Math.round(Number(event.target.value)))}
        />
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="settings-save"
            className="bb-workspace-primary-button"
            onClick={() => onSave(nextUnit, Math.min(4, Math.max(0, nextPrecision)))}
          >
            Save
          </button>
          <button
            type="button"
            data-testid="settings-cancel"
            className="bb-workspace-secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
