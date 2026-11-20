/**
 * The print palette (#61 §3).
 *
 * `drawing`'s style table colours its lines with the app's CSS custom properties, which is
 * right on screen and wrong on paper: `--bb-text` is a near-white for the dark theme, and a
 * drawing whose labels are near-white ink on white paper cannot be read. So the export writers
 * resolve every `var(--…)` through this table instead, and a `var()` never reaches a file.
 *
 * The values are print values, deliberately not the screen theme's. `src/ui/theme/tokens.css`
 * owns the screen; this table owns the sheet, and `src/integration/exportPalette.test.ts` fails
 * if a style row starts using a custom property this table has no answer for.
 *
 * Two colours carry the drawing: one ink for everything that is a thing, and one blue for
 * everything that is a measurement. The blues are darker than the theme's because a photocopied
 * sheet is the way these drawings actually get to a site.
 */

/** One entry: what a CSS custom property means on paper. */
const PRINT_VARS: Readonly<Record<string, string>> = {
  '--bb-text': '#111114',
  '--bb-text-muted': '#55555e',
  '--bb-accent': '#1a4f8a',
  '--bb-bg-card': '#ffffff',
  '--bb-border-card': '#8e8e96',
  '--color-accent': '#1a4f8a',
  '--color-dim-label': '#111114',
}

/** The custom properties this table answers for, for the drift check. */
export const PRINT_PALETTE_KEYS: readonly string[] = Object.keys(PRINT_VARS)

/** The ink every uncoloured mark on a sheet is drawn with. */
export const INK = PRINT_VARS['--bb-text']

/** The blue of a measurement: a dimension line, its text, a scale bar. */
export const MEASURE = PRINT_VARS['--bb-accent']

/** The paper every sheet is drawn on, and the only colour a fill may be when it means "empty". */
export const PAPER = '#ffffff'

/**
 * One paint colour from `drawing`, read as paper wants it.
 *
 * A hex literal, an `rgba()`, `none` and `transparent` pass through: they are already concrete.
 * A `var(--…)` is looked up. Anything else is a bug in the caller, and `none` is the answer that
 * draws nothing rather than the one that draws black and pretends it was meant.
 */
export function resolveColour(colour: string | undefined): string {
  if (colour === undefined) return 'none'
  if (colour.startsWith('var(')) {
    const name = colour.slice(4, colour.lastIndexOf(')')).trim()
    return PRINT_VARS[name] ?? 'none'
  }
  return colour
}

/** The custom property inside a `var(…)`, or `null` when the colour is not one. */
export const cssVarOf = (colour: string): string | null =>
  colour.startsWith('var(') && colour.endsWith(')') ? colour.slice(4, -1).trim() : null

/** One channel-normalised colour: `{r,g,b,a}` with each channel in `0..1`. */
export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * Any colour this module can name, as numbers.
 *
 * `null` means "draw nothing": `none`, `transparent`, and anything unparseable. PDF has no CSS,
 * so it needs this; the SVG writer keeps the string and lets the reader parse it.
 */
export function colourToRgba(colour: string): Rgba | null {
  if (colour === 'none' || colour === 'transparent') return null
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(colour)
  if (hex !== null) {
    const digits = hex[1]!.length === 3 ? hex[1]!.replace(/./g, (d) => d + d) : hex[1]!
    return {
      r: parseInt(digits.slice(0, 2), 16) / 255,
      g: parseInt(digits.slice(2, 4), 16) / 255,
      b: parseInt(digits.slice(4, 6), 16) / 255,
      a: 1,
    }
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(colour)
  if (rgb !== null) {
    const parts = rgb[1]!.split(',').map((part) => Number.parseFloat(part.trim()))
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return {
        r: (parts[0] ?? 0) / 255,
        g: (parts[1] ?? 0) / 255,
        b: (parts[2] ?? 0) / 255,
        a: parts.length >= 4 ? Math.max(0, Math.min(1, parts[3] ?? 1)) : 1,
      }
    }
  }
  return null
}
