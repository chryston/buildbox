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
import type {
  DrawingLayerChip,
  DrawingToggles,
  ExportFailure,
  ExportProgress,
  ListsRecipe,
  ListsSummary,
  NotesSwitches,
  Recipe,
  RecipeViewRef,
  RecordedComposition,
} from '../../../export'
import type { RenovationDisplay } from '../../../domain'
import type { QuantityScope, Rect } from '../../../derive'

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
  if (ref.kind === 'plan') return `plan:${ref.viewId}`
  return ref.kind === 'elevation' ? `elevation:${ref.viewId}` : `item:${ref.itemDesignId}`
}

/** One Floor or Design Option the Lists tab can put in scope, named as the Project names it. */
export interface ListsChoice {
  readonly id: string
  readonly label: string
}

/**
 * What the Lists tab can offer.
 *
 * The dialog still never sees a Project: it is told which Floors there are, which Design Options
 * exist, which Drawing Layers there are, and what scope to open with — and that is the whole of
 * what it needs to draw its controls. `designOptions` is empty for every Project until #73 gives
 * them content, which is why the control reads `Existing only`, and `layers` is empty in a build
 * with no Drawing Layers, which is why the Layer group is absent rather than empty.
 */
export interface ListsOptions {
  readonly floors: readonly ListsChoice[]
  readonly designOptions: readonly ListsChoice[]
  /** The Drawing Layers, `Unlayered` last, in the order the Layers panel shows them. */
  readonly layers: readonly ListsChoice[]
  /** The scope the tab opens with: every Floor, the originating view's Option, every State, every Layer. */
  readonly defaultScope: QuantityScope
}

/** The one thing that stops a Drawing export (#73 §3): a Display with no Option to display. */
export interface BlockedView {
  readonly viewId: string
  /** The view's own name, because a Drawing Set can hold four views and one of them is the problem. */
  readonly viewName: string
  readonly display: RenovationDisplay
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

  /**
   * The Floors, Design Options and Drawing Layers the Lists tab offers, and the scope it opens
   * with. Asynchronous because the scope is `export`'s view of the Project, loaded on demand.
   */
  listsOptions(origin: RecipeViewRef): Promise<ListsOptions>
  /**
   * The chips the Drawing tab offers for one view (#73 §1): every Drawing Layer in paint order,
   * `Unlayered` among them, each starting from the visibility the saved view gives it. Asynchronous
   * for the same reason as `composition`: the layer rules live in `export`, which is loaded on demand.
   */
  drawingLayers(ref: RecipeViewRef): Promise<readonly DrawingLayerChip[]>
  /**
   * What the sheet would be drawn from with these toggles (#73 §1), which is what the collapsible
   * block shows and what the file's metadata will carry. Asynchronous because it is `export`'s.
   */
  composition(ref: RecipeViewRef, toggles: DrawingToggles, notes?: NotesSwitches): Promise<RecordedComposition | null>
  /**
   * The first selected view whose Drawing export is blocked (#73 §3), or `null`. The Lists tab is
   * never blocked: its scope is chosen here and never inherited from a view.
   */
  blocking(refs: readonly RecipeViewRef[]): Promise<BlockedView | null>
  /**
   * What a scope would export, as the controls move: the plain-words statement, the rows each
   * table would hold, whether a design with parts to cut is in scope at all, and how many of those
   * rows the originating view hides (#73 §2).
   *
   * Asynchronous for the same reason `measure` is: the derivation lives in `export`, which is
   * loaded on demand so that a reader who never presses Export does not download it.
   */
  summariseLists(scope: QuantityScope, origin: RecipeViewRef): Promise<ListsSummary>
  /** The last lists recipe used for this view on this device, if there is one. */
  recallLists(key: string): Promise<ListsRecipe | null>
  rememberLists(key: string, recipe: ListsRecipe): void
  runLists(recipe: ListsRecipe, onProgress: (progress: ExportProgress) => void): Promise<ExportRunOutcome>
  cancel(): void
}
