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
import type { CommentStatus, RenovationDisplay } from '../domain'
import type { ListTableId } from './csv/tables'
import type { CompositionNotes, NotesSwitches, Orientation, PageSize } from './types'

/**
 * The three Notes switches in the order the dialog offers them (#83 §1), in the words the prototype
 * uses. The dialog's chips, the composition block and the file's metadata all read the same three
 * switches, so the words live beside the switches' own type rather than in a second table.
 */
export const NOTES_SWITCH_LABELS: Readonly<Record<keyof NotesSwitches, string>> = {
  viewAnnotations: 'View Annotations',
  commentPins: 'Comment Pins',
  includeResolvedPins: 'include Resolved pins',
}

/** The status a pin's label ends with (#83 §3), the same two words the Notes panel writes. */
export const PIN_STATUS_WORDS: Readonly<Record<CommentStatus, string>> = { open: 'Open', resolved: 'Resolved' }

/** What the composition block says a sheet has on it: the switches that were on, or `none`. */
export const notesStatement = (notes: CompositionNotes): string => {
  const on = [
    notes.view_annotations ? NOTES_SWITCH_LABELS.viewAnnotations : null,
    notes.comment_pins ? NOTES_SWITCH_LABELS.commentPins : null,
    notes.include_resolved_pins ? NOTES_SWITCH_LABELS.includeResolvedPins : null,
  ].filter((word): word is string => word !== null)
  return on.length === 0 ? 'none' : on.join(', ')
}

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

/**
 * A Room's label on the plan: its name and its area (#67 §4), `Kitchen · 13.08 m²`.
 *
 * The one place this sentence is written. The canvas passes it to `drawing` as `formatRoomLabel` and
 * the sheet passes the same function, so a Room cannot be called one size on the screen and another
 * on the paper drawn from it. The area is always square metres to two decimals, whatever the
 * Project's display unit — the same rule the Room inspector's own field follows.
 */
export const roomLabel = (name: string, squareMillimetres: number): string =>
  `${name} · ${(squareMillimetres / 1_000_000).toFixed(2)} m²`

/**
 * The four Renovation Displays by the name a sheet prints (#73 §1).
 *
 * This is the name a sheet prints. `ui/strings/renovation.ts` keeps the four words the screen uses
 * beside it: the two tables say the same words, and the screen's copy stays inside the table the
 * banned-word scan reads, so a Display cannot be called one thing on the canvas
 * and another on the paper that came out of it.
 */
export const DISPLAY_NAME: Readonly<Record<RenovationDisplay, string>> = {
  existing: 'Existing',
  demolition: 'Demolition',
  proposed: 'Proposed',
  combined: 'Combined',
}

/**
 * The renovation legend's two rows (#73 §1).
 *
 * Only the two States that carry an overlay have a swatch to show: `Existing` is content drawn in
 * its own layer colour, which is not a thing a legend can point at. The screen's legend says
 * `Demolition (hatch overlay)`; a printed one says the State, because the swatch beside it is the
 * hatch.
 */
export const RENOVATION_LEGEND: Readonly<Record<Extract<RenovationState, 'demolition' | 'proposed'>, string>> = {
  demolition: 'Demolition',
  proposed: 'Proposed',
}

/** The title-block labels, keyed by the row that shows them. */
export const TITLE_BLOCK = {
  project: 'Project',
  floor: 'Floor',
  itemDesign: 'Item',
  designOption: 'Design option',
  /** The Renovation Display row, which sits under the Design Option it belongs to (#73 §1). */
  renovationDisplay: 'Display',
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
  /** The Register's status arm (#83 §4.2): Resolved Comments are opt-in, so the line says which it lists. */
  openComments: 'Open Comments',
  openAndResolvedComments: 'Open and Resolved Comments',
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

// ------------------------------------------------------------------- the printed tables (#84)

/**
 * The three tables that print, in the words a reader uses.
 *
 * The CSV file is named after the contract's own id (`cut-list`); the printed page is named after
 * the thing (#84 §3.5). The two are never the same string for the same reason the dialog's labels
 * are not: one is an identifier a script compares and the other is a heading a person reads.
 */
export const TABLE_NAMES: Readonly<Record<ListTableId, string>> = {
  items: 'Item List',
  'cut-list': 'Cut List',
  comments: 'Comment Register',
}

/**
 * What each CSV column is called on paper, keyed by the table and the published header (#84 §2).
 *
 * Keyed by the header rather than by position so that a column appended in a minor version of the
 * CSV contract fails by name — `tableModel` throws on a column with no label here — instead of
 * printing the file's own identifier as its heading. The printed column order is the CSV's, always
 * read off the `TableSpec`; this table supplies words and nothing else.
 *
 * A length column's label carries no unit: `tableModel` appends the Project's, so the header reads
 * `Width (mm)` and agrees with the title block's `Dimensions in mm` whatever the Project is set to.
 */
export const COLUMN_LABELS: Readonly<Record<ListTableId, Readonly<Record<string, string>>>> = {
  items: {
    floor_id: 'Floor ID',
    floor: 'Floor',
    design_option_id: 'Design Option ID',
    design_option: 'Design Option',
    renovation_state: 'Renovation State',
    item_design_id: 'Item Design ID',
    item_design: 'Item Design',
    count: 'Count',
    width_mm: 'Width',
    depth_mm: 'Depth',
    height_mm: 'Height',
  },
  'cut-list': {
    design_option_id: 'Design Option ID',
    design_option: 'Design Option',
    renovation_state: 'Renovation State',
    item_design_id: 'Item Design ID',
    item_design: 'Item Design',
    part: 'Part',
    length_mm: 'Length',
    width_mm: 'Width',
    thickness_mm: 'Thickness',
    material: 'Material',
    qty_per_item: 'Qty per item',
    item_count: 'Item count',
    qty_in_scope: 'Qty in scope',
    notes: 'Notes',
  },
  comments: {
    reference: 'Reference',
    title: 'Title',
    body: 'Body',
    status: 'Status',
    priority: 'Priority',
    created_at: 'Created',
    updated_at: 'Updated',
    resolved_at: 'Resolved',
    scope: 'Scope',
    floor: 'Floor',
    design_option: 'Design Option',
    target_type: 'Target type',
    target_label: 'Target',
  },
}

/**
 * The storage codes a printed table shows as plain words, keyed by `table:header` (#84 §1.2).
 *
 * The CSV publishes the codes and a printed page never does: #80 §5.5 is a rule about what a person
 * reads, and paper is read by a person. The keys are qualified by the table because `status` means
 * `Open` or `Resolved` in the Register and something else again in the Warnings List, and one word
 * list for both would print a Comment as an acknowledged Warning.
 *
 * `entity` reads `Element or Placed Item`, the words the Notes panel's filter offers: on paper there
 * is no pin to look at, so the row has to say what kind of thing it names.
 */
export const CODE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'items:renovation_state': SCOPE.states,
  'cut-list:renovation_state': SCOPE.states,
  'comments:status': PIN_STATUS_WORDS,
  'comments:priority': { low: 'Low', normal: 'Normal', high: 'High' },
  'comments:scope': {
    all_options: 'All Options',
    existing_model: 'Existing Model',
    design_option: 'Design Option',
  },
  'comments:target_type': {
    project: 'Project',
    floor: 'Floor',
    design_option: 'Design Option',
    item_design: 'Item Design',
    entity: 'Element or Placed Item',
    feature: 'Feature',
    floor_point: 'Floor Point',
  },
}

/**
 * The suffix the Register's timestamps print with (#84 Why).
 *
 * `YYYY-MM-DD HH:mm UTC`, and never the reader's local hour: the contract records no time zone, so
 * a page that printed a local one would state a fact it cannot support and would disagree with the
 * CSV it is meant to match row for row.
 */
export const UTC_SUFFIX = 'UTC'

/** `0 rows` — the line an empty scope prints under its header row (#84 §3.10). */
export const ZERO_ROWS = '0 rows'

/** `(continued)` — what a row too tall for one page says in its first cell on the next page. */
export const CONTINUED = '(continued)'

/**
 * The dialog's notice for characters the embedded face cannot draw (#84 §3.7).
 *
 * A notice beside a file that was written, not a failure instead of one: the page carries a box
 * where each unreadable character sits, so the person can find it, and this sentence tells them
 * which labels to expect boxes in.
 */
export const unrenderableNotice = (labels: readonly string[]): string =>
  `Some characters can't be shown in the PDF: ${labels.join(', ')}.`

/** The title block's table row: `Table` over `Cut List`. */
export const TABLE_TITLE_LABEL = 'Table'

/** The title block's scope row, which stands where a drawing's Floor or Item row stands. */
export const SCOPE_TITLE_LABEL = 'Scope'
