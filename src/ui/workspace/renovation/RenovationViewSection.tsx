/**
 * The renovation block of the saved-view card (#70 §2): which Design Option this saved view looks
 * through, and which Renovation Display it draws.
 *
 * It sits under the saved-view picker because the three together are the answer to "what am I
 * looking at", and they are read in that order: which saved view, through which Option, on which
 * Display. Choosing the saved view is navigation and belongs to the picker above; the two settings
 * below it are Edit Transactions, one per click, each with its own undo step and its own undo label
 * naming what was chosen.
 *
 * The Display cards are a 2×2 grid in reading order — Existing, Demolition across the top, Proposed,
 * Combined below — because the four are a pair of questions: is the Option's opinion shown, and is
 * the removal or the replacement the interesting part. Each card carries one swatch per Renovation
 * State it shows, so the grid says what will appear before anything is clicked.
 *
 * The **Layers** slot is reserved here and renders nothing: #71 builds the Drawing Layers list and
 * its two toggles into this position. The footer reserves `Paste from other Project…`'s position to
 * the left of `Export…` and renders no disabled placeholder — an empty slot is a promise about a
 * future version, and a greyed-out button is a question the user cannot answer.
 */
import type { ReactNode } from 'react'
import type { DesignOption, PlanView, RenovationDisplay } from '../../../domain'
import { viewDesignOptionId, viewRenovationDisplay } from '../../../domain'
import { tokenVar } from '../../theme/tokens'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { DISPLAY_ORDER, DISPLAY_ROLES, DISPLAY_STATES, swatchClass } from './displayTheme'

export interface RenovationViewSectionProps {
  /** The saved view whose two settings these are. No view, no block: there is nothing to aim. */
  view: PlanView | null
  /** The Project's Design Options, in Project order. */
  options: readonly DesignOption[]
  /** One Edit Transaction, labelled with what was chosen (#70 §2). */
  onSetDesignOption(designOptionId: string | null): void
  onSetRenovationDisplay(display: RenovationDisplay): void
  onExport(): void
}

/** The Display's name, in the words the whole feature uses for it. */
const DISPLAY_LABELS: { [D in RenovationDisplay]: string } = {
  existing: RENOVATION_STRINGS.displayExisting,
  demolition: RENOVATION_STRINGS.displayDemolition,
  proposed: RENOVATION_STRINGS.displayProposed,
  combined: RENOVATION_STRINGS.displayCombined,
}

export const displayLabel = (display: RenovationDisplay): string => DISPLAY_LABELS[display]

export function RenovationViewSection(props: RenovationViewSectionProps): ReactNode {
  const { view, options, onSetDesignOption, onSetRenovationDisplay, onExport } = props
  if (view === null) return null
  const activeOption = viewDesignOptionId(view)
  const activeDisplay = viewRenovationDisplay(view)

  return (
    <div className="bb-renovation-view-section" data-testid="renovation-view-section">
      <label className="bb-workspace-field-label" htmlFor="design-option-picker">
        {RENOVATION_STRINGS.designOptionField}
      </label>
      <select
        id="design-option-picker"
        data-testid="design-option-picker"
        className="bb-workspace-select"
        value={activeOption ?? ''}
        onChange={(event) => onSetDesignOption(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{RENOVATION_STRINGS.noDesignOption}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>

      <span className="bb-workspace-field-label" id="renovation-display-label">
        {RENOVATION_STRINGS.renovationDisplayField}
      </span>
      <div className="bb-renovation-display-grid" data-testid="renovation-display-grid" role="group" aria-labelledby="renovation-display-label">
        {DISPLAY_ORDER.map((display) => {
          const roles = DISPLAY_ROLES[display]
          const active = display === activeDisplay
          return (
            <button
              key={display}
              type="button"
              data-testid={`display-${display}`}
              data-active={active ? 'true' : 'false'}
              className={`bb-renovation-display-card${active ? ' bb-renovation-display-card-active' : ''}`}
              style={active ? { background: tokenVar(roles.tint), borderColor: tokenVar(roles.border) } : undefined}
              aria-pressed={active}
              onClick={() => onSetRenovationDisplay(display)}
            >
              <span className="bb-renovation-display-name" style={{ color: tokenVar(roles.border) }}>
                {displayLabel(display)}
              </span>
              <span className="bb-renovation-swatches" data-testid={`swatches-${display}`}>
                {DISPLAY_STATES[display].map((state) => (
                  <span key={state} className={`bb-renovation-swatch ${swatchClass(state)}`} data-state={state} />
                ))}
              </span>
            </button>
          )
        })}
      </div>

      {/* #71 fills this slot with the Drawing Layers list and its two toggles. Nothing is rendered
          here until then, and nothing is rendered *instead* — an empty slot is not a stub. */}
      <div className="bb-renovation-layers-slot" data-testid="renovation-layers-slot" />

      <div className="bb-renovation-card-footer">
        {/* `Paste from other Project…` (#72) takes the slot to the left of Export when it arrives. */}
        <span className="bb-renovation-paste-slot" data-testid="renovation-paste-slot" />
        <button type="button" data-testid="card-export" className="bb-workspace-tool-button" onClick={onExport}>
          {RENOVATION_STRINGS.exportEllipsis}
        </button>
      </div>
    </div>
  )
}
