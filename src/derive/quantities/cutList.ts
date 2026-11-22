/**
 * The Cut List: the panels of every cut-list-capable Item Design (#62 §6, export contract §7).
 *
 * This is the **one** derivation. The Cut List CSV and the in-editor cut-list panel both read it,
 * which is what the export contract §10 asks for and what makes the two of them unable to
 * disagree about a panel's size. It is a thin shell over `cabinet`'s `computeCutListForUnits`,
 * whose logic is unchanged: build the one `CabinetUnit` the Item Design describes, ask `cabinet`
 * for its parts, and rename the fields to the contract's columns. No cut-list calculation lives
 * here, and none is added — the contract forbids new ones (§10), which is why `Drawer box (…)`
 * still carries the legacy box depth in `thickness_mm` and the parity test pins that too.
 *
 * The unit is built at `x: 0, y: 0` with the design's own ID and name, because a cut list is a
 * statement about the Item Design and not about where one of its Placed Items stands: two
 * placements of one design are one row with `item_count` 2, not two rows.
 *
 * `length_mm` is the longer of the legacy `width` and `height` and `width_mm` the shorter, so a
 * panel reads length-then-width the way a cutting list is read, and `thickness_mm` is the legacy
 * `depth`. The parity test compares that triple unordered, precisely because the swap is the
 * point of the mapping.
 */
import { computeCutListForUnits } from '../../cabinet'
import type { CabinetUnit } from '../../cabinet'
import type { CabinetItemDesign, EntityId, ItemDesign } from '../../domain'
import type { OptionColumns, RenovationState } from './scope'

/**
 * One row of the Cut List, keyed as `CUT_LIST_TABLE` declares its columns.
 *
 * A type rather than an interface, for the same reason as `ItemListRow`: it is the object
 * `writeCsv` writes, and the compiler checks the table's columns against it directly.
 */
export type CutListRow = {
  readonly designOptionId: EntityId
  readonly designOption: string
  readonly renovationState: RenovationState
  readonly itemDesignId: EntityId
  readonly itemDesign: string
  readonly part: string
  readonly lengthMm: number
  readonly widthMm: number
  readonly thicknessMm: number
  /** The material id code, spelled as the payload spells it: `oak`, `walnut`, `mdf`. */
  readonly material: string
  readonly qtyPerItem: number
  readonly itemCount: number
  readonly qtyInScope: number
  readonly notes: string
}

/** A `CutListRow` before the scope's three columns are put on it. */
export type CutListPart = Omit<CutListRow, keyof OptionColumns | 'renovationState'>

/**
 * One Cut List row's panels, still kept apart by the Drawing Layer the Placed Items stand on.
 *
 * The Cut List has no Layer column either: `quantities` merges the groups of one panel back
 * together once the scope's Drawing Layers have filtered them (#73 criterion 7), for the same
 * memoisation reason as the Item List's groups.
 */
export type CutListGroup = CutListRow & { readonly layerId: EntityId | null }

/** The Cut List row a group of panels writes: every field but the Layer it was split by. */
export function cutListRow(group: CutListGroup): CutListRow {
  const {
    designOptionId, designOption, renovationState, itemDesignId, itemDesign, part,
    lengthMm, widthMm, thicknessMm, material, qtyPerItem, itemCount, qtyInScope, notes,
  } = group
  return { designOptionId, designOption, renovationState, itemDesignId, itemDesign, part, lengthMm, widthMm, thicknessMm, material, qtyPerItem, itemCount, qtyInScope, notes }
}

/** Whether an Item Design has a cut list at all. Today: a cabinet, and nothing else. */
export function isCutListCapable(design: ItemDesign): design is CabinetItemDesign {
  return design.kind === 'cabinet'
}

/**
 * The parts of one Item Design, as `itemCount` Placed Items of it need them.
 *
 * `computeCutListForUnits` is called with a single unit, so its emission order is the order a
 * carpenter reads one cabinet in — Side panels, Top, Bottom, Back, toe-kick, shelves, dividers,
 * drawer boxes, doors, drawer fronts. That order is the last sort key of the table and survives
 * untouched: the function groups parts into rows itself, so a row's `qty` is already a count of
 * like parts.
 */
export function cutListParts(design: CabinetItemDesign, itemCount: number): CutListPart[] {
  const unit: CabinetUnit = {
    type: 'cabinet',
    id: design.id,
    label: design.name,
    x: 0,
    y: 0,
    settings: design.construction.settings,
    root: design.construction.root,
  }
  return computeCutListForUnits([unit]).map((entry) => ({
    itemDesignId: design.id,
    itemDesign: design.name,
    part: entry.label,
    lengthMm: Math.max(entry.width, entry.height),
    widthMm: Math.min(entry.width, entry.height),
    thicknessMm: entry.depth,
    material: entry.material,
    qtyPerItem: entry.qty,
    itemCount,
    qtyInScope: entry.qty * itemCount,
    notes: entry.notes ?? '',
  }))
}
