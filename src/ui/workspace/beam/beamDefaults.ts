/**
 * The numbers the `Beam` tool starts with (#77 §3).
 *
 * These are what the bar shows before a person types anything, so they belong to the tool rather
 * than to the Intent: `beam.create` takes whatever it is given and has no default of its own. They
 * mirror `DEFAULT_BEAM_WIDTH_MM` and `DEFAULT_BEAM_DEPTH_MM` in `src/edit/defaults.ts`, which is
 * where the same two numbers are described — the layer rule keeps a UI module from importing an
 * `edit` value, so the pairing is stated here rather than shared.
 */
export const DEFAULT_BEAM_WIDTH_MM = 200
export const DEFAULT_BEAM_DEPTH_MM = 300
