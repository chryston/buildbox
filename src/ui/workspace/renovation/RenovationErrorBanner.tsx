/**
 * The error state of a Display with nothing to describe (#70 §6, criterion 10).
 *
 * Demolition, Proposed and Combined are statements about a Design Option — what it removes, what it
 * adds, both together. With `designOptionId: null` there is no Option to make the statement about, so
 * the canvas draws the Existing Model and nothing else, and the tool strip keeps only Select. The
 * banner's job is to make that obvious before a person spends a minute thinking the work was lost: one
 * sentence naming the Display, the Option picker that fixes it in one choice, and `Show Existing` for
 * the case where the Display itself was the mistake.
 *
 * `Show Existing` is a saved-view setting like the Display cards, so it is one undoable transaction —
 * the escape hatch must not cost a step to take back.
 */
import type { ReactNode } from 'react'
import type { DesignOption, RenovationDisplay } from '../../../domain'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { displayLabel } from './displayTheme'

export interface RenovationErrorBannerProps {
  display: RenovationDisplay
  options: readonly DesignOption[]
  onSetDesignOption(designOptionId: string | null): void
  onShowExisting(): void
}

export function RenovationErrorBanner(props: RenovationErrorBannerProps): ReactNode {
  const { display, options, onSetDesignOption, onShowExisting } = props
  return (
    <div className="bb-renovation-error" data-testid="renovation-error-banner" role="status">
      <span className="bb-renovation-error-text" data-testid="renovation-error-text">
        {RENOVATION_STRINGS.needsOption(displayLabel(display))}
      </span>
      <label className="bb-renovation-error-picker">
        <span className="bb-renovation-error-field">{RENOVATION_STRINGS.designOptionField}</span>
        <select
          className="bb-workspace-select"
          data-testid="renovation-error-option"
          value=""
          onChange={(event) => onSetDesignOption(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{RENOVATION_STRINGS.noDesignOption}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="bb-renovation-error-action" data-testid="show-existing" onClick={onShowExisting}>
        {RENOVATION_STRINGS.showExisting}
      </button>
    </div>
  )
}
