/**
 * The Item List: Placed Items grouped by Item Design (#62 §6, export contract §7).
 *
 * One row per Floor × Design Option × Renovation State × Item Design with a count of at least
 * one. A design with no Placed Item in scope writes nothing — a row that says zero is a row
 * someone has to read and then ignore.
 *
 * The three extents are the Item Design's **local** width, depth and height, read through
 * `domain`'s accessors: a cabinet's come from its `construction.settings`, a generic design's
 * from its Item Footprint's local bounds plus its height. Never the placement's bounding box,
 * which is why a design turned 90° on plan still reports the width the carpenter cuts
 * (#62 criterion 9).
 *
 * What counts as a Placed Item is the export contract §8, and it is a rule about *not filtering*:
 * content hidden in a view counts, non-selectable content counts, every Drawing Layer counts,
 * every Renovation State counts (kept apart by its column), and an element with an acknowledged
 * warning counts. So this file reads `existingModel.placedItems` and consults nothing else — no
 * selection, no view, no warning list. There is nothing here to get wrong by adding a filter.
 */
import { designFootprintSize, designHeight } from '../../domain'
import type { EntityId, ItemDesign, Project } from '../../domain'
import type { OptionColumns, RenovationState } from './scope'

/** One row of the Item List, keyed as `ITEMS_TABLE` declares its columns. */
export interface ItemListRow {
  readonly floorId: EntityId
  readonly floor: string
  readonly designOptionId: EntityId
  readonly designOption: string
  readonly renovationState: RenovationState
  readonly itemDesignId: EntityId
  readonly itemDesign: string
  readonly count: number
  readonly widthMm: number
  readonly depthMm: number
  readonly heightMm: number
}

/**
 * The Item List rows of one Floor under one Design Option.
 *
 * `option` is the two Design Option columns; the Existing Model alone is two empty strings. The
 * Renovation State is `existing` throughout v1.0, because the only content the domain holds is
 * the Existing Model's (#32 introduces the rest).
 *
 * Rows come out in placement order — the order the Project stores them — because the sort that
 * makes a file is the caller's, and it is a rule about the table rather than about one Floor.
 */
export function itemListRowsForFloor(
  project: Project,
  floorId: EntityId,
  option: OptionColumns,
): ItemListRow[] {
  const floor = project.floors.find((candidate) => candidate.id === floorId)
  if (floor === undefined) return []
  const designs = new Map<EntityId, ItemDesign>(project.itemDesigns.map((design) => [design.id, design]))
  const counts = new Map<EntityId, number>()
  for (const placed of project.existingModel.placedItems) {
    if (placed.floorId !== floorId) continue
    if (!designs.has(placed.itemDesignId)) continue
    counts.set(placed.itemDesignId, (counts.get(placed.itemDesignId) ?? 0) + 1)
  }

  const rows: ItemListRow[] = []
  for (const [itemDesignId, count] of counts) {
    const design = designs.get(itemDesignId)!
    const { width, depth } = designFootprintSize(design)
    rows.push({
      ...option,
      renovationState: 'existing',
      floorId: floor.id,
      floor: floor.name,
      itemDesignId,
      itemDesign: design.name,
      count,
      widthMm: width,
      depthMm: depth,
      heightMm: designHeight(design),
    })
  }
  return rows
}
