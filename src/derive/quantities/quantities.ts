/**
 * `quantities(scope)`: the Item List and the Cut List of a scope (#62 §6).
 *
 * The counting is per Floor and per Design Option — the same stage of the derive pipeline as
 * `effectiveFloor`, memoised by the same `(revision, floorId, optionId)` key — and the aggregation
 * across the scoped Floors happens here, once, in one direction:
 *
 *   - the **Item List** is never aggregated. It has a `floor_id` column, so a Floor's rows are
 *     simply concatenated; two Floors holding the same design write two rows.
 *   - the **Cut List** has no Floor column, so a panel spec seen on three Floors is one row whose
 *     `item_count` is the Placed Items of that design across all three, and whose `qty_in_scope`
 *     is `qty_per_item × item_count`.
 *
 * Nothing is ever summed across Renovation States or Design Options (export contract §7): the
 * merge key carries both, so a shelf that exists in two states is two rows.
 *
 * The sort is the contract's, and it is applied here rather than in the writer so that the panel
 * and the file show the same order: Floor order, then Design Option order, then Renovation State
 * in the contract's order, then Item Design name in code-point order, then Item Design ID as a
 * tie-break. Cut List rows then hold their part order, which `stableSort` preserves because it is
 * the last key and nothing follows it.
 */
import { compareCodePoints, stableSort } from '../../lib'
import type { EntityId, Project } from '../../domain'
import type { DeriveCache } from '../cache'
import { cutListParts, isCutListCapable, type CutListRow } from './cutList'
import { itemListRowsForFloor, type ItemListRow } from './itemList'
import { RENOVATION_STATES, layerMatches, optionColumns, type QuantityScope, type RenovationState } from './scope'

/** What one Floor under one Design Option contributes to a scope. */
export interface FloorQuantities {
  readonly items: readonly ItemListRow[]
  /** Its Cut List rows, with `item_count` counting this Floor's Placed Items only. */
  readonly cuts: readonly CutListRow[]
}

/** A scope's two tables, sorted as a file and as the panel want them. */
export interface Quantities {
  readonly items: readonly ItemListRow[]
  readonly cuts: readonly CutListRow[]
}

/**
 * The Item List and Cut List rows of one Floor under one Design Option, before any scope filter.
 *
 * `optionId` is `null` for the Existing Model alone. This is the memoised stage: it depends on
 * nothing but the Project, the Floor and the option, so the same call for a second scope reuses
 * it. Renovation States, Drawing Layers and the Item Detail narrowing are applied by
 * {@link quantities}, which is what lets one cached Floor serve every scope.
 */
export function quantitiesForFloor(
  project: Project,
  floorId: EntityId,
  optionId: EntityId | null,
): FloorQuantities {
  const option = optionColumns(optionId)
  const items = itemListRowsForFloor(project, floorId, option)
  const cuts: CutListRow[] = []
  for (const row of items) {
    const design = project.itemDesigns.find((candidate) => candidate.id === row.itemDesignId)
    if (design === undefined || !isCutListCapable(design)) continue
    for (const part of cutListParts(design, row.count)) {
      cuts.push({ ...option, renovationState: row.renovationState, ...part })
    }
  }
  return { items, cuts }
}

/**
 * The two tables of a whole scope.
 *
 * `revision` is the memoisation key and nothing more — the rows themselves are a pure function of
 * the Project, so a caller with no revision to hand (a migration test, a fixture) passes the
 * revision it has.
 *
 * `scope.itemDesignId` narrows the Cut List to one Item Design and makes `item_count` one: an
 * export from an Item Detail View is a list for the item in the reader's hand (export contract
 * §7). The Item List is grouped by Item Design anyway, so it is untouched.
 */
export function quantities(
  project: Project,
  revision: number,
  scope: QuantityScope,
  cache?: Pick<DeriveCache, 'quantities'>,
): Quantities {
  const optionIds: readonly (EntityId | null)[] =
    scope.designOptionIds === 'existing-only' ? [null] : scope.designOptionIds
  const states = new Set(scope.renovationStates)
  // A scope that named the same Floor twice would count it twice; a scope is data from a dialog
  // or a recipe file, so it is taken as a set of Floors rather than a list to iterate.
  const floorIds = [...new Set(scope.floorIds)]
  const floorOrder = new Map<EntityId, number>(project.floors.map((floor, index) => [floor.id, index]))
  const optionOrder = new Map<string, number>(optionIds.map((id, index) => [id ?? '', index]))

  const items: ItemListRow[] = []
  const cuts = new Map<string, CutListRow>()
  for (const optionId of optionIds) {
    for (const floorId of floorIds) {
      const floor = cache
        ? cache.quantities(project, revision, floorId, optionId)
        : quantitiesForFloor(project, floorId, optionId)
      for (const row of floor.items) {
        if (!states.has(row.renovationState)) continue
        if (!layerMatches(scope.drawingLayers, [])) continue
        items.push(row)
      }
      if (!layerMatches(scope.drawingLayers, [])) continue
      // One cabinet can emit two rows that are identical in every column — two drawers of one
      // size are two rows of `Drawer box (…)` — so a row is identified by its columns *and* by
      // which of those like rows it is. Merging the first Floor's with the second Floor's, and
      // the second with the second, is what keeps `item_count` from being added twice.
      const like = new Map<string, number>()
      for (const row of floor.cuts) {
        if (!states.has(row.renovationState)) continue
        if (scope.itemDesignId !== undefined && row.itemDesignId !== scope.itemDesignId) continue
        const identity = mergeKey(row)
        const seen = like.get(identity) ?? 0
        like.set(identity, seen + 1)
        const key = `${identity}\u0000${seen}`
        const held = cuts.get(key)
        if (held === undefined) {
          cuts.set(key, row)
          continue
        }
        const itemCount = held.itemCount + row.itemCount
        cuts.set(key, { ...held, itemCount, qtyInScope: held.qtyPerItem * itemCount })
      }
    }
  }

  // The contract's row order, spelled once because both tables are published in it: Design
  // Option in scope order, Renovation State in the contract's own order rather than the scope's,
  // then Item Design name in code-point order with the ID as the tie-break.
  const byScope = (a: { designOptionId: string }, b: { designOptionId: string }): number =>
    (optionOrder.get(a.designOptionId) ?? 0) - (optionOrder.get(b.designOptionId) ?? 0)
  const byState = (a: { renovationState: RenovationState }, b: { renovationState: RenovationState }): number =>
    RENOVATION_STATES.indexOf(a.renovationState) - RENOVATION_STATES.indexOf(b.renovationState)
  const byDesign = (a: { itemDesign: string; itemDesignId: string }, b: typeof a): number =>
    compareCodePoints(a.itemDesign, b.itemDesign) || compareCodePoints(a.itemDesignId, b.itemDesignId)

  const sortedItems = stableSort(items, (a, b) =>
    (floorOrder.get(a.floorId) ?? 0) - (floorOrder.get(b.floorId) ?? 0) ||
    byScope(a, b) ||
    byState(a, b) ||
    byDesign(a, b))

  const narrowed = scope.itemDesignId === undefined
    ? [...cuts.values()]
    : [...cuts.values()].map((row) => ({ ...row, itemCount: 1, qtyInScope: row.qtyPerItem }))
  const sortedCuts = stableSort(narrowed, (a, b) => byScope(a, b) || byState(a, b) || byDesign(a, b))

  return { items: sortedItems, cuts: sortedCuts }
}

/**
 * Everything but the two counted columns: the columns that say *which panel* a row is, and so the
 * rows that a scope's Floors collapse into one.
 */
function mergeKey(row: CutListRow): string {
  return JSON.stringify([
    row.designOptionId,
    row.renovationState,
    row.itemDesignId,
    row.part,
    row.lengthMm,
    row.widthMm,
    row.thicknessMm,
    row.material,
    row.qtyPerItem,
    row.notes,
  ])
}
