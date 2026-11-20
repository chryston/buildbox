/**
 * What the Export dialog is allowed to ask for (#61 criterion 11, architecture §13.16).
 *
 * The dialog lives in `ui` and knows the recipe; everything else — the Worker, the main-thread
 * fallback, the font bytes, the Plan Images, the download, the remembered recipe — belongs to
 * `app`, which is the only module allowed to reach `platform` and `persistence`. This file is the
 * whole seam between them, and it is deliberately narrow: the dialog can describe a recipe, ask
 * the port to run it, and stop it.
 *
 * Two rules the shape encodes. The dialog never dispatches an Intent and never writes to a saved
 * view (criterion 17), so nothing here takes a Project or a mutation — the port reads the
 * session's own snapshot when it runs, at the revision it finds there. And the dialog never
 * decides whether a Worker exists: `run` answers with a finished download or a failure, because
 * a fallback the user has to understand is a fallback that did not work.
 */
import type { ExportFailure, ExportProgress, Recipe, RecipeViewRef } from '../../../export'
import type { Rect } from '../../../derive'

/** One view the picker can offer, already named the way the Project names it. */
export interface ExportableView {
  readonly ref: RecipeViewRef
  /** The view's own name. */
  readonly label: string
  /** What it belongs to — the Floor, or `Item Design` — so two views can share a name. */
  readonly group: string
}

/**
 * How a run ended.
 *
 * `downloaded` means the browser was handed the file; `missingGlyphs` names the labels whose
 * characters the PDF font cannot draw, which is criterion 11's notice and arrives with the run
 * that succeeded rather than replacing it. `failed` is all-or-nothing: nothing was downloaded,
 * and `failures` says which output and why (criterion 15).
 */
export type ExportRunOutcome =
  | { readonly kind: 'downloaded'; readonly files: number; readonly missingGlyphs: readonly string[] }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly failures: readonly ExportFailure[] }

/** What the dialog knows about one view before it draws anything. */
export interface ExportMeasurement {
  /** The drawing's bounds in model millimetres, or `null` when the view holds nothing. */
  readonly bounds: Rect | null
}

/** The stable key a recipe is remembered under: one per Project and saved view. */
export function viewKey(ref: RecipeViewRef): string {
  return ref.kind === 'plan' ? `plan:${ref.viewId}` : `item:${ref.itemDesignId}`
}

export interface ExportPort {
  /** Every view Export can draw, in the order the picker lists them. */
  views(): readonly ExportableView[]
  /** What the view holds, for the fit check and the empty-view notice. */
  measure(ref: RecipeViewRef): Promise<ExportMeasurement>
  /** The warnings engine is #66's; until it lands this reads zero and the line says so. */
  unacknowledgedWarnings(): number
  /** The last recipe used for this view on this device, if there is one. */
  recall(key: string): Promise<Recipe | null>
  remember(key: string, recipe: Recipe): void
  run(recipe: Recipe, onProgress: (progress: ExportProgress) => void): Promise<ExportRunOutcome>
  cancel(): void
}
