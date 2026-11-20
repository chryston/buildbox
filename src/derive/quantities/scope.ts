/**
 * What a set of quantity rows is counted over (#62 §6, §7; export contract §3).
 *
 * A machine-readable export never inherits what a view happens to hide (#18): the scope says so
 * in four words — which Floors, which Design Option, which Renovation States, which Drawing
 * Layers — and everything outside it is simply not asked about. The defaults are the contract's:
 * every Floor, the Existing Model alone while a Project has no Design Options, every Renovation
 * State, every layer including Unlayered.
 *
 * The scope is data, so it is also what the dialog shows and what a remembered recipe stores.
 * `export` describes it in plain words; `derive` counts it. Neither can drift from the other
 * because there is only one of it.
 *
 * Renovation State and Design Option are not in the domain schema yet — #32 and #18 add them — so
 * the codes here are the ones the CSV contract publishes (§6) and the only content v1.0 can hold
 * is the Existing Model's, which is `existing` under no option. The columns exist from v1.0 all
 * the same (§10): a table that grew a column later would be a major version.
 */
import type { EntityId } from '../../domain'

/** The Renovation State codes of export contract §6, in the order a table sorts them. */
export const RENOVATION_STATES = ['existing', 'demolition', 'proposed'] as const

/** One Renovation State, as a CSV cell spells it. */
export type RenovationState = (typeof RENOVATION_STATES)[number]

/**
 * Which Drawing Layers count.
 *
 * `'all'` is every layer including Unlayered content, which is the contract's default and, until
 * #18 gives a Project any layer, the only thing there is to select. The narrowed arm is written
 * now so that narrowing it is a dialog change and not a format change.
 */
export type LayerScope =
  | 'all'
  | { readonly layerIds: readonly EntityId[]; readonly includeUnlayered: boolean }

/** The four scope controls of the Lists tab, as data. */
export interface QuantityScope {
  /** Floor IDs, in the Project's display order; the default is every Floor. */
  readonly floorIds: readonly EntityId[]
  /**
   * The Design Options to count, or the Existing Model alone.
   *
   * `'existing-only'` is what a Project with no Design Options can offer, and what the dialog
   * shows as `Existing only`. The field exists now so that #73 only has to add choices to it.
   */
  readonly designOptionIds: readonly EntityId[] | 'existing-only'
  /** The Renovation States to count; nothing is ever summed across them. */
  readonly renovationStates: readonly RenovationState[]
  /** The Drawing Layers to count. */
  readonly drawingLayers: LayerScope
  /**
   * The one Item Design a Cut List covers, when the export came from an Item Detail View
   * (export contract §7). The Cut List then holds that design alone and counts one Placed Item —
   * the reader is holding one item, not a Floor of them. The Item List is grouped by Floor and
   * Item Design anyway, so it is unaffected.
   */
  readonly itemDesignId?: EntityId
}

/**
 * The two Design Option columns for one arm of a scope.
 *
 * Both are empty for the Existing Model alone (export contract §7). A Design Option's name is
 * not in the domain schema yet (#32), so an option named by ID has no name to write and the ID
 * is all there is to say; the columns are still there, because a table that grew one later would
 * be a major version.
 */
export interface OptionColumns {
  readonly designOptionId: EntityId
  readonly designOption: string
}

/** The Design Option columns for one option ID; `null` is the Existing Model alone. */
export function optionColumns(optionId: EntityId | null): OptionColumns {
  return { designOptionId: optionId ?? '', designOption: '' }
}

/** Whether content on `layerIds` is inside `scope`. Unlayered content carries no layer. */
export function layerMatches(scope: LayerScope, layerIds: readonly EntityId[]): boolean {
  if (scope === 'all') return true
  if (layerIds.length === 0) return scope.includeUnlayered
  return layerIds.some((layerId) => scope.layerIds.includes(layerId))
}
