/**
 * The two drawing decisions the Layers list makes that are neither Project data nor copy (#71 §3).
 *
 * A layer's colour is Project data and a view's override is saved-view data; both arrive as strings
 * from the domain and are painted as they are. What is neither is the colour of a row that has no
 * colour — `Unlayered` with no override — which the issue gives to the theme's neutral token. The
 * swatch takes that token from CSS and needs no value here; the colour *input* is the one control
 * that cannot be handed a `var(…)`, so it starts from the same colour written out, and that literal
 * lives in this file rather than in a component, where the raw-colour sweep (#50 criterion 1) can
 * keep an eye on it.
 */

/** `--bb-text-muted`, for the one control that has to hold a colour literal. */
export const LAYER_NEUTRAL_COLOR = '#8f8f98'

/** The swatch: painted from the effective colour, or left to the neutral token when there is none. */
export const layerSwatchClass = (color: string | null): string =>
  color === null ? 'bb-layer-swatch bb-layer-swatch-neutral' : 'bb-layer-swatch'
