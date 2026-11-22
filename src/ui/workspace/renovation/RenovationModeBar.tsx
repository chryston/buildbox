/**
 * The mode bar (#70 §3, criterion 3): the full-width band above the canvas that says what the
 * workspace is doing right now, in three parts read left to right — the Renovation Display in bold,
 * the Design Option it is looking through (or `No Design Option`), and one muted sentence about what
 * editing means in that combination.
 *
 * The band is coloured by Display through the four `renovation.*` roles: a 3px bottom border and a
 * tinted background from the same pair the Display cards swatch and the legend dots wear, so the
 * colour under the cursor is the colour the rail promised. The sentence is the part that carries the
 * risk: `Marking what the option removes or replaces` and `Editing new work owned by the option`
 * describe two different consequences for the same keystroke, and a person who has not read the
 * manual should not have to.
 *
 * It is a row of the workspace shell rather than a child of the canvas host, because the host sizes
 * its `<svg>` to the full height of the host and an in-flow band there would move the canvas by a
 * pixel for every Project — including the ones with the flag off.
 */
import type { ReactNode } from 'react'
import type { RenovationDisplay } from '../../../domain'
import { tokenVar } from '../../theme/tokens'
import { RENOVATION_STRINGS } from '../../strings/renovation'
import { DISPLAY_ROLES, displayLabel } from './displayTheme'

/** What editing means in each Display, in the issue's exact words. */
const MODE_SENTENCES: { [D in RenovationDisplay]: string } = {
  existing: RENOVATION_STRINGS.modeExisting,
  demolition: RENOVATION_STRINGS.modeDemolition,
  proposed: RENOVATION_STRINGS.modeProposed,
  combined: RENOVATION_STRINGS.modeCombined,
}

export interface RenovationModeBarProps {
  display: RenovationDisplay
  /** The active Design Option's name, or `null` for the Existing Model on its own. */
  optionName: string | null
}

export function RenovationModeBar(props: RenovationModeBarProps): ReactNode {
  const { display, optionName } = props
  const roles = DISPLAY_ROLES[display]
  return (
    <div
      className="bb-renovation-mode-bar"
      data-testid="renovation-mode-bar"
      data-display={display}
      style={{ borderBottom: `3px solid ${tokenVar(roles.border)}`, background: tokenVar(roles.tint) }}
    >
      <span className="bb-renovation-mode-display" data-testid="mode-bar-display">
        {displayLabel(display)}
      </span>
      <span className="bb-renovation-mode-option" data-testid="mode-bar-option">
        {optionName ?? RENOVATION_STRINGS.noDesignOptionShort}
      </span>
      <span className="bb-renovation-mode-note" data-testid="mode-bar-note">
        {MODE_SENTENCES[display]}
      </span>
    </div>
  )
}
