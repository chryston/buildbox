/**
 * The legend under the canvas (#70 §4, criterion 9): the three renovation marks, each next to the
 * words the issue gives it, then the muted sentence that says what the marks do *not* do — the
 * layer's own colour is still underneath them.
 *
 * The swatches are the ones the Display cards already wear (`swatchClass`), so the card, the canvas
 * and this row cannot disagree about what a hatch or a halo looks like: one rule for the picture,
 * three places that use it.
 *
 * Like the mode bar, it is a row of the workspace shell rather than a band inside the canvas host —
 * the host sizes its `<svg>` to its own full height, and an in-flow band there would take pixels off
 * the drawing every time a Display changed.
 */
import type { ReactNode } from 'react'
import type { RenovationState } from '../../../derive'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { DISPLAY_LABELS, swatchClass } from './displayTheme'

/** The three marks, in the order the issue lists them. */
const LEGEND_ROWS: readonly { state: RenovationState; label: string }[] = [
  { state: 'existing', label: DISPLAY_LABELS.existing },
  { state: 'demolition', label: RENOVATION_STRINGS.legendDemolition },
  { state: 'proposed', label: RENOVATION_STRINGS.legendProposed },
]

export function RenovationLegend(): ReactNode {
  return (
    <div className="bb-renovation-legend" data-testid="renovation-legend">
      {LEGEND_ROWS.map((row) => (
        <span className="bb-renovation-legend-item" key={row.state} data-state={row.state}>
          <span className={`bb-renovation-swatch ${swatchClass(row.state)}`} aria-hidden="true" />
          {row.label}
        </span>
      ))}
      <span className="bb-renovation-legend-note" data-testid="renovation-legend-note">
        {RENOVATION_STRINGS.legendLayerNote}
      </span>
    </div>
  )
}
