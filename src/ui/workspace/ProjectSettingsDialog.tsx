/**
 * The Project settings dialog (#55 criterion 5): display unit and precision, the two
 * preferences the Project carries. Changing the unit presets the precision to that
 * unit's default — mm 0, cm 1, m 3 — and the person may override it; Save dispatches
 * one `project.setPreferences`, so the pair is one undo step.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DisplayUnit } from '../../domain'
import { STRINGS } from '../strings'
import { DEFAULT_PRECISION } from './displayUnits'

const UNITS: readonly DisplayUnit[] = ['mm', 'cm', 'm']

export interface ProjectSettingsDialogProps {
  unit: DisplayUnit
  precision: number
  /** The Project's `Default wall height` (#64 §16), in millimetres. */
  wallHeight: number
  onSave: (unit: DisplayUnit, precision: number, wallHeight: number) => void
  /**
   * Whatever else the Project keeps as settings (#69 §15). The dialog holds no opinion about it and
   * no word of it: a section brings its own copy and dispatches its own Intents, so a dark surface
   * is passed in from a flagged branch rather than written into this file.
   */
  children?: ReactNode
  onClose: () => void
}

export function ProjectSettingsDialog(props: ProjectSettingsDialogProps): ReactNode {
  const { unit, precision, wallHeight, onSave, children, onClose } = props
  const [nextUnit, setNextUnit] = useState<DisplayUnit>(unit)
  const [nextPrecision, setNextPrecision] = useState(precision)
  const [nextWallHeight, setNextWallHeight] = useState(wallHeight)

  return (
    <div className="bb-workspace-dialog-backdrop" data-testid="project-settings-dialog">
      <div role="dialog" aria-modal="true" aria-label={STRINGS.projectSettings} className="bb-workspace-dialog">
        <h2>{STRINGS.projectSettings}</h2>
        <label className="bb-workspace-field-label" htmlFor="settings-unit">{STRINGS.displayUnit}</label>
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
        <label className="bb-workspace-field-label" htmlFor="settings-precision">{STRINGS.decimalPlaces}</label>
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
        {/* The height a new Wall takes where the Floor has not chosen its own (#64 §16). */}
        <label className="bb-workspace-field-label" htmlFor="settings-wall-height">{STRINGS.defaultWallHeight}</label>
        <input
          id="settings-wall-height"
          data-testid="settings-wall-height"
          className="bb-workspace-input"
          type="number"
          min={1}
          step={100}
          value={nextWallHeight}
          onChange={(event) => setNextWallHeight(Math.round(Number(event.target.value)))}
        />
        {children}
        <div className="bb-workspace-dialog-actions">
          <button
            type="button"
            data-testid="settings-save"
            className="bb-workspace-primary-button"
            onClick={() => onSave(nextUnit, Math.min(4, Math.max(0, nextPrecision)), Math.max(1, nextWallHeight))}
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
