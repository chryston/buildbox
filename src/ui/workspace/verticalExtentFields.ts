/**
 * The Vertical Extent rows of the inspector, as data (#74 §5).
 *
 * Three kinds, three shapes, and the difference between them is the whole reason this is a module
 * rather than three blocks of JSX:
 *
 *   Wall          `Base`, `Height`, `Top` — three boxes, all of them the Wall's own numbers
 *   Opening       `Base (sill)`, `Height`, `Top` — the Opening's own as well; its host is never touched
 *   Placed Item   `Base`, `Top` — the `Top` captioned `moves item` — and no `Height` box at all: the
 *                 height belongs to the Item Design, so it is read out
 *                 (`700 mm · from Item Design Wall cabinet · shared by 1 placement`) rather than
 *                 offered as something to type into
 *
 * So every Wall and Opening shows a `Height` field and none of them says "derived", and a Placed Item
 * never shows one, because there is no height on its record to write (#74 §7).
 *
 * `Top` is never stored: it is Base + Height, computed here so the three boxes cannot disagree with
 * each other, and the commit names the box that was actually edited (`field`).
 *
 * A row carries both the millimetres (`valueMm`, what the Intent sends) and the text the input shows
 * (`text`), because an input has to hold what it parses — no group separators — while a read-out wants
 * the opposite. `format` is the Project's display-unit number formatter, the same one the Wall and
 * Opening draft chips take. The Height line is in millimetres whatever that unit is: it names the
 * number the Item Design stores, not a measurement of this placement.
 */
import { openingExtent, placementExtent, rangeClass, wallExtent } from '../../derive'
import type { RangeClass } from '../../derive'
import { designHeight } from '../../domain'
import type { ItemDesign, Opening, PlanViewRange, PlacedItem, Wall } from '../../domain'
import { STRINGS } from '../strings'
import { RANGE_CLASS_LABELS } from '../strings/renovation'

/** Which of the §5 boxes a row is, and so which box the commit names. */
export type ExtentField = 'base' | 'height' | 'top'

/** One editable box of the §5 table. */
export interface ExtentRow {
  readonly field: ExtentField
  readonly label: string
  /** The exact millimetres stored (or, for `Top`, derived) — what the Intent carries. */
  readonly valueMm: number
  /** What the input holds: the same number in the Project's display unit, unpunctuated. */
  readonly text: string
  /** The line under the box, `moves item` on a Placed Item's `Top`; `''` when there is nothing to say. */
  readonly caption: string
}

/** What the inspector says about one entity's Vertical Extent, in this Plan View. */
export interface VerticalExtentView {
  readonly rows: readonly ExtentRow[]
  /** The read-only Height line of a Placed Item; `null` for a Wall or an Opening, which get a field. */
  readonly heightLine: string | null
  /** `Shown as: Above range`, from this view's Plan View Range. */
  readonly shownAs: string
  readonly rangeClass: RangeClass
}

/** The Project's display-unit number formatter, without the unit after it. */
export type ExtentNumberFormat = (mm: number) => string

const row = (field: ExtentField, label: string, valueMm: number, format: ExtentNumberFormat, caption = ''): ExtentRow => ({
  field,
  label,
  valueMm,
  text: format(valueMm),
  caption,
})

const shownAs = (classOf: RangeClass): string => STRINGS.extentShownAs(RANGE_CLASS_LABELS[classOf])

/** `Base`, `Height`, `Top` of a Wall, and what this view's Range makes of it. */
export function wallExtentView(wall: Wall, range: PlanViewRange, format: ExtentNumberFormat): VerticalExtentView {
  const extent = wallExtent(wall)
  const classOf = rangeClass(extent, range)
  return {
    rows: [
      row('base', STRINGS.extentBase, wall.baseElevation, format),
      row('height', STRINGS.extentHeight, wall.height, format),
      row('top', STRINGS.extentTop, extent.hi, format),
    ],
    heightLine: null,
    shownAs: shownAs(classOf),
    rangeClass: classOf,
  }
}

/** `Base (sill)`, `Height`, `Top` of an Opening. The host Wall is not part of this view. */
export function openingExtentView(opening: Opening, range: PlanViewRange, format: ExtentNumberFormat): VerticalExtentView {
  const extent = openingExtent(opening)
  const classOf = rangeClass(extent, range)
  return {
    rows: [
      row('base', STRINGS.extentBaseSill, opening.sill, format),
      row('height', STRINGS.extentHeight, opening.head - opening.sill, format),
      row('top', STRINGS.extentTop, opening.head, format),
    ],
    heightLine: null,
    shownAs: shownAs(classOf),
    rangeClass: classOf,
  }
}

/**
 * `Base` and `Top` of a Placed Item, the Height line of its Item Design, and what this view's Range
 * makes of it.
 *
 * `placements` is how many placements share that design — the inspector counts them, because the
 * number is a fact about the Project and not about this one placement.
 */
export function placementExtentView(
  design: ItemDesign,
  placed: PlacedItem,
  placements: number,
  range: PlanViewRange,
  format: ExtentNumberFormat,
): VerticalExtentView {
  const extent = placementExtent(design, placed)
  const classOf = rangeClass(extent, range)
  return {
    rows: [
      row('base', STRINGS.extentBase, placed.baseElevation, format),
      // Typing a new Top moves the item and leaves the design's height alone — the caption is the only
      // place the difference between this box and a Wall's `Top` is said.
      row('top', STRINGS.extentTop, extent.hi, format, STRINGS.extentMovesItem),
    ],
    heightLine: STRINGS.extentHeightLine(format(designHeight(design)), design.name, placements),
    shownAs: shownAs(classOf),
    rangeClass: classOf,
  }
}
