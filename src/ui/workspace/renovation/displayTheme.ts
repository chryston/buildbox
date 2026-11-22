/**
 * What each Renovation Display looks like (#70 §2, §3) — the colour roles and the swatch states, as
 * data, so the mode bar, the Display cards and the canvas legend cannot disagree about a Display's
 * colour or about which States it shows.
 *
 * The swatches are the prototype's, re-expressed with tokens: Existing is a solid fill, Demolition
 * is 45° hatching with a dashed border, Proposed is a dashed border with no fill. A card shows one
 * swatch per Renovation State it draws, which is the shortest answer to "what will I see if I click
 * this" — and it is the same fact `derive`'s display funnel uses to decide what to draw, so the
 * swatch row cannot drift from the canvas.
 */
import type { RenovationDisplay } from '../../../domain'
import type { RenovationState } from '../../../derive'
import type { TokenRole } from '../../theme/tokens'

/** The Display order: the card grid's reading order and the mode bar's list. */
export const DISPLAY_ORDER: readonly RenovationDisplay[] = ['existing', 'demolition', 'proposed', 'combined']

/** One Display's two colour roles. */
export interface DisplayRoles {
  readonly border: TokenRole
  readonly tint: TokenRole
}

/** The border + tint pair of each Display, from the shared #50 token set. */
export const DISPLAY_ROLES: { [D in RenovationDisplay]: DisplayRoles } = {
  existing: { border: 'renovationExistingBorder', tint: 'renovationExistingTint' },
  demolition: { border: 'renovationDemolitionBorder', tint: 'renovationDemolitionTint' },
  proposed: { border: 'renovationProposedBorder', tint: 'renovationProposedTint' },
  combined: { border: 'renovationCombinedBorder', tint: 'renovationCombinedTint' },
}

/**
 * The States one Display shows, in the order their swatches sit on its card — the same table
 * `derive/renovationDisplay` draws with, written here as the short list the swatches need.
 */
export const DISPLAY_STATES: { [D in RenovationDisplay]: readonly RenovationState[] } = {
  existing: ['existing'],
  demolition: ['existing', 'demolition'],
  proposed: ['existing', 'proposed'],
  combined: ['existing', 'demolition', 'proposed'],
}

/** The swatch class suffix for one State: `bb-renovation-swatch-existing`, `-demolition`, `-proposed`. */
export const swatchClass = (state: RenovationState): string => `bb-renovation-swatch-${state}`
