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

import type { RenovationState } from '../derive'
import type { Orientation, PageSize } from './types'

/** The fixed footer, verbatim from #61 §5. Every format writes this one string. */
export const EXPORT_FOOTER =
  'Prepared with BuildBox for planning and discussion. Check all measurements on site before building or buying.'

/**
 * What the file says prepared it: the PDF's Producer and Creator, the ZIP's `generator`, the
 * provenance document's `generator`, and the title block's version row.
 *
 * One constant because a file that names two different products is a bug, and because the
 * literal *type* in `Provenance.generator` and `Manifest.generator` is written as
 * `typeof PRODUCT_NAME` — the schema and the value cannot then disagree about the name.
 */
export const PRODUCT_NAME = 'BuildBox'

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
  /** The view name a scaled-up Item sheet carries, where a Floor sheet carries the Floor's name. */
  itemDetail: 'Item Detail',
  scale: 'Scale',
  date: 'Date',
  version: 'BuildBox',
  page: 'Page',
} as const

/**
 * The warning for a character the embedded font has no glyph for.
 *
 * A warning, not an error: the sheet still writes, with the missing characters left out of the
 * text. It names the character and the string it appeared in, because the person choosing a font
 * needs to know which of their labels the font cannot draw.
 */
export const noGlyphFor = (chars: string, text: string): string =>
  `No glyph for ${chars} in "${text}"`

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
 * The words the Lists dialog's scope summary is built from (#62 §7, #73 §3).
 *
 * The summary is a sentence, so it needs the connective tissue a table of labels has no use for.
 * `Existing only` is `DESIGN_OPTION`, the same words the title block uses for the same fact.
 */
export const SCOPE = {
  separator: ' · ',
  join: ', ',
  allFloors: 'All Floors',
  existingOnly: DESIGN_OPTION,
  /** `Existing Model only` — the option control's third arm, spelled out in the sentence (#73 §2). */
  existingModelOnly: 'Existing Model only',
  /** ` (compared)` — several Design Options, so every Existing row is repeated once per Option. */
  compared: ' (compared)',
  states: {
    existing: 'Existing',
    demolition: 'Demolition',
    proposed: 'Proposed',
  } as Readonly<Record<RenovationState, string>>,
  allLayers: 'all layers incl. Unlayered',
  /** The name the Layers control gives content on no Drawing Layer, named in the sentence too. */
  unlayered: 'Unlayered',
} as const

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
