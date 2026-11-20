/**
 * Every word that ends up inside an exported file (#61 §5, §12).
 *
 * The dialog's own copy lives in `ui/strings`; this table is what the *files* say, so the three
 * writers cannot drift from one another and #66's banned-word check has one file to read.
 * Criterion 13 asserts the footer and the title-block fields come from here.
 *
 * Two rules hold here. The footer is quoted from #61 exactly, because it is the one sentence
 * BuildBox puts on paper for someone else to read. And nothing here says what a drawing is not:
 * no disclaimer about codes, no claim about fitness for anything. The footer states who prepared
 * it and what the reader owes the site, and stops.
 */

import type { Orientation, PageSize } from './types'

/** The fixed footer, verbatim from #61 §5. Every format writes this one string. */
export const EXPORT_FOOTER =
  'Prepared with BuildBox for planning and discussion. Check all measurements on site before building or buying.'

/** What a sheet says when its scale carries no promise: fit-to-page, SVG, PNG. */
export const NOT_TO_SCALE = 'Not to scale'

/** `Scale 1:50` — the scale a fixed recipe named. */
export const scaleStatement = (denominator: number): string => `Scale 1:${trimScale(denominator)}`

/** `A4 portrait`, `A3 landscape`. */
export const sheetStatement = (size: PageSize, orientation: Orientation): string =>
  `${size} ${orientation}`

/** The Design Option line, which reads this until Design Options ship (#83). */
export const DESIGN_OPTION = 'Existing only'

/** `Page 1/1`. Multi-page Drawing Sets arrive in #85. */
export const pageStatement = (page: number, of: number): string => `Page ${page}/${of}`

/** The title-block labels, keyed by the row that shows them. */
export const TITLE_BLOCK = {
  project: 'Project',
  floor: 'Floor',
  itemDesign: 'Item',
  designOption: 'Design option',
  view: 'View',
  scale: 'Scale',
  date: 'Date',
  version: 'BuildBox',
  page: 'Page',
} as const

/** `Dimensions in mm`, `Dimensions in cm`, `Dimensions in m`. */
export const UNIT_STATEMENT: Readonly<Record<string, string>> = {
  mm: 'Dimensions in mm',
  cm: 'Dimensions in cm',
  m: 'Dimensions in m',
}

/** The unit statement for a display unit; an unknown unit says the unit rather than nothing. */
export const unitStatement = (unit: string): string =>
  UNIT_STATEMENT[unit] ?? `Dimensions in ${unit}`

/** The label of the scale bar's one-metre segment: `1 m`. */
export const SCALE_BAR_LABEL = '1 m'

/**
 * A scale denominator as paper wants it: `50`, not `50.0`, and `37.4` not `37.400000000000006`.
 *
 * A fitted scale is a real number; a fixed one is an integer. Both print to at most one decimal
 * place, which is finer than anyone measures a printed sheet.
 */
export function trimScale(denominator: number): string {
  const rounded = Math.round(denominator * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
