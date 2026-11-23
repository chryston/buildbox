/**
 * The Export dialog's side of the seam (#61 §11–§17).
 *
 * The dialog describes a recipe; this file is what makes it real: the snapshot at the revision the
 * session is holding, the Plan Images the drawing needs, the font, the Worker, the download, and
 * the remembered recipe. It is `app`'s because it is the only place all of those are reachable at
 * once — `ui` may not touch `platform` or `persistence`, and `export` may touch neither at all.
 *
 * Three things it exists to get right:
 *
 * **Nothing heavy is loaded until an export starts.** `export`, `pdf-lib`, fontkit and the Noto
 * Sans subset arrive by dynamic `import()`, so a reader who never presses Export downloads none of
 * them (§11). That is the one reason `exportFiles` is not imported at the top of this file: the
 * specifier is known at author time, and the module is not — it must not be in the graph the first
 * paint waits for.
 *
 * **The fallback is invisible.** If the Worker cannot be built or dies, the same `exportFiles` runs
 * here on the main thread with the same inputs, and the user sees no difference (§9). The inputs
 * are identical in both paths — the same snapshot object, the same asset bytes — which is what
 * makes the two files byte-identical.
 *
 * **One download, or none.** The archive is handed to the browser only when every output was
 * written (§15), and a cancel before that point discards everything.
 */
import { createExportRunner, createRasterizer, downloadFile } from '../platform'
import type { ExportRunRequest } from '../platform'
import type {
  DrawingLayerChip,
  DrawingToggles,
  ExportClock,
  ExportProgress,
  ExportResult,
  ExportSnapshot,
  ListsRecipe,
  Rasterizer,
  Recipe,
  RecipeViewRef,
  RecordedComposition,
} from '../export'
import type { QuantityScope } from '../derive'
import { countUnacknowledged, warningMessages } from '../derive'
import { warningSentence } from '../ui'
import type {
  BlockedView,
  ExportMeasurement,
  ExportPort,
  ExportRunOutcome,
  ExportableView,
  ListsOptions,
} from '../ui'
import type { PrefsRepository } from '../persistence'
import type { ProjectSession } from '../session'
import type { Project, SavedView } from '../domain'
import { designOptionsOf, elevationViewsOf, savedViewById, viewRenovationDisplay } from '../domain'

export interface ExportPortDeps {
  /**
   * The open session, read when an export runs rather than captured when the port was built.
   *
   * The port is built once for the tab and the session changes when a Project is opened or
   * closed; capturing one would let a drawing be made from a Project that is no longer on screen.
   * Reaching this while no Project is open is a bug, not a case: the dialog only exists inside a
   * workspace.
   */
  session(): ProjectSession
  readonly prefs: PrefsRepository
  /** The Asset Store, narrowed to the one question an export asks. */
  readAsset(sha256: string): Promise<{ bytes: Uint8Array; mediaType: string } | null>
  readonly clock: ExportClock
  readonly buildboxVersion: string
}

/** One remembered recipe: the view it belongs to and the recipe itself. */
interface RememberedRecipe {
  readonly key: string
  readonly recipe: Recipe
}

/** The same pair for the Lists tab, kept under its own preference key (#62 criterion 11). */
interface RememberedListsRecipe {
  readonly key: string
  readonly recipe: ListsRecipe
}

const TABLE_IDS = ['items', 'cut-list'] as const
const RENOVATION_STATES = ['existing', 'demolition', 'proposed'] as const

/**
 * Is this the shape of a lists recipe?
 *
 * The same rule as `asRecipe`: the device's own history is read back before it is trusted, so a
 * recipe written by a build this one has not met is ignored rather than half-applied. A scope with
 * no Floor in it is refused — the dialog would show an empty statement and write an empty file.
 */
function asListsRecipe(value: unknown): ListsRecipe | null {
  const held = fields(value)
  if (held === null) return null
  if (!Array.isArray(held.tables) || !held.tables.every((table) => oneOf(table, TABLE_IDS))) return null
  const scope = fields(held.scope)
  if (scope === null) return null
  if (!Array.isArray(scope.floorIds) || scope.floorIds.length === 0) return null
  if (!scope.floorIds.every((id) => typeof id === 'string')) return null
  const options = scope.designOptionIds
  if (options !== 'existing-only' && !(Array.isArray(options) && options.every((id) => typeof id === 'string'))) {
    return null
  }
  if (!Array.isArray(scope.renovationStates) || scope.renovationStates.length === 0) return null
  if (!scope.renovationStates.every((state) => oneOf(state, RENOVATION_STATES))) return null
  if (scope.drawingLayers !== 'all' && !(Array.isArray(scope.drawingLayers) && scope.drawingLayers.every((id) => typeof id === 'string'))) {
    return null
  }
  if (scope.itemDesignId !== undefined && typeof scope.itemDesignId !== 'string') return null
  return value as ListsRecipe
}

const FORMATS = ['svg', 'png', 'pdf'] as const
const PAGE_SIZES = ['A4', 'A3'] as const
const ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/**
 * The fields of an `unknown` object, or `null` when it is not one.
 *
 * The one assertion in this file, and the smallest honest one: `PrefsMap` hands back `unknown[]`,
 * and every field read through this is checked before it is used.
 */
function fields(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/**
 * Is this the shape of a recipe?
 *
 * `PrefsMap` stores recipes as `unknown[]` because the shape belongs to `export` and persistence
 * must not name it. So the one place that knows both reads the device's own history back before
 * trusting it: a recipe written by a future build with a field this one has never heard of is
 * ignored rather than half-applied.
 */
function asRecipe(value: unknown): Recipe | null {
  const held = fields(value)
  if (held === null) return null
  // The dialog cannot run a recipe with no view in it, so one that arrived with none was not
  // written by the dialog and has nothing to say about what the next one should default to.
  if (!Array.isArray(held.views) || held.views.length === 0 || !held.views.every(isViewRef)) return null
  if (!oneOf(held.format, FORMATS)) return null
  if (!oneOf(held.pageSize, PAGE_SIZES)) return null
  if (!oneOf(held.orientation, ORIENTATIONS)) return null
  if (held.scale !== 'fit' && held.scale !== 10 && held.scale !== 20 && held.scale !== 50 && held.scale !== 100) {
    return null
  }
  if (held.pngLongEdge !== 2048 && held.pngLongEdge !== 4096) return null
  if (typeof held.titleBlock !== 'boolean' || typeof held.grid !== 'boolean') return null
  if (held.unit !== 'mm' && held.unit !== 'cm' && held.unit !== 'm') return null
  if (typeof held.precision !== 'number') return null
  return value as Recipe
}

function isViewRef(value: unknown): boolean {
  const held = fields(value)
  if (held === null) return false
  if (held.kind === 'plan') return typeof held.viewId === 'string'
  return held.kind === 'item-detail' && typeof held.itemDesignId === 'string'
}

/** The Plan Images a view can draw, so those are the only assets worth shipping to the Worker. */
function assetHashes(project: Project, views: readonly RecipeViewRef[]): string[] {
  const hashes = new Set<string>()
  for (const view of views) {
    if (view.kind !== 'plan') continue
    const planView = project.views.find((each) => each.id === view.viewId)
    const image = project.floors.find((each) => each.id === planView?.floorId)?.planImage
    if (image !== undefined && image !== null) hashes.add(image.assetHash)
  }
  return [...hashes]
}

/**
 * The saved view a recipe entry names, or `null` for an Item Detail View and for a view deleted
 * since the recipe was remembered. Everything the dialog asks about a view answers `null` rather
 * than guessing: no chips, no composition, no blocking, and a scope of the Existing Model alone.
 */
/**
 * The saved view a Recipe points at, Plan View or Elevation View, or null when the Recipe points at an
 * Item Design — which is not a view of a Floor and has no layers, no Display and no Option.
 *
 * An Elevation View is addressed by ID alone, exactly as a Plan View is: the two collections share one
 * ID space, so a Recipe that named a kind as well as an ID would only add a way to be wrong.
 */
function savedViewOf(project: Project, ref: RecipeViewRef): SavedView | null {
  if (ref.kind === 'item-detail') return null
  return savedViewById(project, ref.viewId)
}

export function createExportPort(deps: ExportPortDeps): ExportPort {
  const runner = createExportRunner()
  /** The main-thread rasterizer, made once. `null` where this browser has no canvas. */
  let mainThread: Rasterizer | null = null
  let fontBytes: Uint8Array | null = null
  let cancelled = false

  const snapshotOf = (): ExportSnapshot => {
    const held = deps.session().getSnapshot()
    return { project: held.project, revision: held.revision }
  }

  const readRecipes = async (): Promise<RememberedRecipe[]> => {
    const found = await deps.prefs.get('exportRecipes')
    const rows: unknown = found.ok ? found.value : undefined
    if (!Array.isArray(rows)) return []
    return rows.filter(isRemembered)
  }

  const readListsRecipes = async (): Promise<RememberedListsRecipe[]> => {
    const found = await deps.prefs.get('exportListsRecipes')
    const rows: unknown = found.ok ? found.value : undefined
    if (!Array.isArray(rows)) return []
    return rows.filter(isRememberedLists)
  }

  const loadFont = async (): Promise<Uint8Array> => {
    if (fontBytes !== null) return fontBytes
    // The asset URL lives in a module of its own, loaded on demand, so the font's name never
    // reaches the app shell — which is what `scripts/check-size-budget.mjs` fails the build for.
    const { fontUrl } = await import('./exportFont')
    const response = await fetch(fontUrl)
    fontBytes = new Uint8Array(await response.arrayBuffer())
    return fontBytes
  }

  /** The same export, on this thread, with the same inputs (#61 §9). */
  const runHere = async (
    request: ExportRunRequest,
    onProgress: (progress: ExportProgress) => void,
  ): Promise<ExportResult> => {
    const { exportFiles, exportLists } = await import('../export')
    const clock = { now: () => request.deps.instant, localDate: () => request.deps.localDay }
    if (request.job.kind === 'lists') {
      return exportLists(request.snapshot, request.job.recipe, { ...request.deps, clock, onProgress })
    }
    if (mainThread === null) mainThread = createRasterizer() ?? null
    const lookup = new Map(request.job.assets.map((one) => [one.sha256, one]))
    return exportFiles(request.snapshot, request.job.recipe, {
      ...request.deps,
      clock,
      font: request.job.font === undefined ? undefined : { bytes: request.job.font },
      rasterizer: mainThread ?? undefined,
      assets: async (sha256) => {
        const held = lookup.get(sha256)
        return held === undefined ? null : { bytes: held.bytes, mediaType: held.mediaType }
      },
      onProgress,
    })
  }

  /** One handover per export, and none at all when the run did not finish (#61 criterion 15). */
  const handOver = (result: ExportResult): ExportRunOutcome => {
    if (!result.ok) return { kind: 'failed', failures: result.failures }
    // A set goes as the archive alone — the parts are inside it, and handing the browser the
    // parts as well would be a folder of loose files wherever the person asked for one thing.
    const handed = result.kind === 'single' ? [result.file] : [result.archive]
    for (const file of handed) downloadFile(file.name, file.mediaType, file.bytes)
    return {
      kind: 'downloaded',
      files: result.kind === 'single' ? 1 : result.files.length,
      missingGlyphs: result.missingGlyphs,
    }
  }

  /** Worker first, this thread if it declines: one run, whichever thread wrote it. */
  const runJob = async (
    request: ExportRunRequest,
    onProgress: (progress: ExportProgress) => void,
    fallback: () => Promise<ExportResult>,
  ): Promise<ExportRunOutcome> => {
    if (cancelled) return { kind: 'cancelled' }
    const outcome = await runner.run(request, onProgress)
    if (cancelled || outcome.kind === 'cancelled') return { kind: 'cancelled' }
    // The Worker declined: the same function, the same arguments, this thread. No message,
    // because there is nothing the reader could do with one.
    const result = outcome.kind === 'done' ? outcome.result : await fallback()
    if (cancelled) return { kind: 'cancelled' }
    return handOver(result)
  }

  return {
    views(): ExportableView[] {
      const project = deps.session().getSnapshot().project
      const floorName = (floorId: string): string =>
        project.floors.find((each) => each.id === floorId)?.name ?? ''
      const planViews: ExportableView[] = project.views.map((view) => ({
        ref: { kind: 'plan', viewId: view.id },
        label: view.name,
        group: floorName(view.floorId),
      }))
      // An Elevation View is a drawing of the Floor like any other, so it is picked from the same list
      // and grouped under the same Floor (#75 §8). Its name is its own, and two views of one Floor can
      // share it — which is what the group is for.
      const elevations: ExportableView[] = elevationViewsOf(project).map((view) => ({
        ref: { kind: 'elevation', viewId: view.id },
        label: view.name,
        group: floorName(view.floorId),
      }))
      const details: ExportableView[] = project.itemDesigns.map((design) => ({
        ref: { kind: 'item-detail', itemDesignId: design.id },
        label: design.name,
        group: 'Item Design',
      }))
      return [...planViews, ...elevations, ...details]
    },

    async measure(ref: RecipeViewRef): Promise<ExportMeasurement> {
      // `modelBounds` is the only thing in `export` the dialog wants before an export starts, and
      // it is small: the heavy half of the module is the writers, which stay unloaded.
      const { modelBounds } = await import('../export')
      return { bounds: modelBounds(snapshotOf(), ref) }
    },

    unacknowledgedWarnings(): number {
      // Every Floor of the Project under the Existing-only option (#66 §15). The dialog's own
      // tick-boxes are finer than this, and the port has no scope argument to carry them — so
      // the line counts what the Project holds rather than pretending to count what was ticked.
      const project = snapshotOf().project
      return countUnacknowledged(
        project,
        project.floors.map((floor) => floor.id),
        [null],
      )
    },

    async recall(key: string): Promise<Recipe | null> {
      const rows = await readRecipes()
      const row = rows.find((each) => each.key === key)
      return row === undefined ? null : asRecipe(row.recipe)
    },

    remember(key: string, recipe: Recipe): void {
      // Fire-and-forget like every other device preference: losing it costs the next dialog its
      // defaults, which is not worth a spinner in front of an export.
      void readRecipes()
        .then((rows) => [...rows.filter((each) => each.key !== key), { key, recipe }])
        .then((rows) => deps.prefs.set('exportRecipes', rows))
    },

    cancel(): void {
      cancelled = true
      runner.cancel()
    },

    async run(recipe: Recipe, onProgress: (progress: ExportProgress) => void): Promise<ExportRunOutcome> {
      cancelled = false
      const snapshot = snapshotOf()
      const unsavedChanges = deps.session().getSnapshot().save.kind !== 'saved'
      const gathered = await Promise.all(
        assetHashes(snapshot.project, recipe.views).map(async (sha256) => {
          const asset = await deps.readAsset(sha256)
          return asset === null ? null : { sha256, bytes: asset.bytes, mediaType: asset.mediaType }
        }),
      )
      const request: ExportRunRequest = {
        snapshot,
        deps: {
          instant: deps.clock.now(),
          localDay: deps.clock.localDate(),
          buildboxVersion: deps.buildboxVersion,
          unsavedChanges,
        },
        job: {
          kind: 'drawings',
          recipe,
          ...(recipe.format === 'pdf' ? { font: await loadFont() } : {}),
          assets: gathered.filter((one) => one !== null),
        },
      }
      return runJob(request, onProgress, () => runHere(request, onProgress))
    },

    async listsOptions(origin: RecipeViewRef): Promise<ListsOptions> {
      const project = deps.session().getSnapshot().project
      const { defaultListsScope, drawingLayerChips } = await import('../export')
      const view = savedViewOf(project, origin)
      return {
        floors: project.floors.map((floor) => ({ id: floor.id, label: floor.name })),
        designOptions: designOptionsOf(project).map((option) => ({ id: option.id, label: option.name })),
        // The Project's own layers with no view's visibility in the way, `Unlayered` last: the
        // Lists scope is chosen here and starts with everything on (#73 §2).
        layers: drawingLayerChips(project, null).map((chip) => ({ id: chip.id, label: chip.name })),
        defaultScope: defaultListsScope(project, view),
      }
    },

    async drawingLayers(ref: RecipeViewRef): Promise<readonly DrawingLayerChip[]> {
      const { drawingLayerChips } = await import('../export')
      const project = deps.session().getSnapshot().project
      return drawingLayerChips(project, savedViewOf(project, ref))
    },

    async composition(ref: RecipeViewRef, toggles: DrawingToggles): Promise<RecordedComposition | null> {
      const { drawingComposition } = await import('../export')
      const project = deps.session().getSnapshot().project
      const view = savedViewOf(project, ref)
      // An Item Detail View has no layers and no Display: its sheet is one elevation of one design,
      // so the Drawing tab shows no composition block for it rather than an empty one.
      return view === null ? null : drawingComposition(project, view, view.floorId, toggles).recorded
    },

    async blocking(refs: readonly RecipeViewRef[]): Promise<BlockedView | null> {
      const { needsActiveOption } = await import('../export')
      const project = deps.session().getSnapshot().project
      for (const ref of refs) {
        const view = savedViewOf(project, ref)
        if (view !== null && needsActiveOption(view)) {
          return { viewId: view.id, viewName: view.name, display: viewRenovationDisplay(view) }
        }
      }
      return null
    },

    async summariseLists(scope: QuantityScope, origin: RecipeViewRef) {
      // `listsSummary` is the cheap half of `export` — the derivation, not the writers — and it is
      // still loaded on demand so the first paint never waits for the module. The originating view
      // goes with the scope because the dialog's hidden-in-view count is that view's, not the
      // Project's (#73 §2); an Item Detail View hides nothing, so it answers `null`.
      const { listsSummary } = await import('../export')
      const { project } = deps.session().getSnapshot()
      const view = origin.kind === 'plan' ? project.views.find((each) => each.id === origin.viewId) ?? null : null
      return listsSummary(snapshotOf(), scope, view)
    },

    async recallLists(key: string): Promise<ListsRecipe | null> {
      const rows = await readListsRecipes()
      const row = rows.find((each) => each.key === key)
      return row === undefined ? null : asListsRecipe(row.recipe)
    },

    rememberLists(key: string, recipe: ListsRecipe): void {
      void readListsRecipes()
        .then((rows) => [...rows.filter((each) => each.key !== key), { key, recipe }])
        .then((rows) => deps.prefs.set('exportListsRecipes', rows))
    },

    async runLists(recipe: ListsRecipe, onProgress: (progress: ExportProgress) => void): Promise<ExportRunOutcome> {
      cancelled = false
      const unsavedChanges = deps.session().getSnapshot().save.kind !== 'saved'
      const snapshot = snapshotOf()
      // The Warnings List's sentences are the strip's own copy, which `export` may not read and a
      // Worker may not be sent — so they are rendered here, for this scope, and the strings go over
      // as data. Both paths take them from this one call, so the Worker's CSV and the main thread's
      // say the same thing (#68 criterion 5).
      const sentences = warningMessages(snapshot.project, recipe.scope, warningSentence)
      const request: ExportRunRequest = {
        snapshot,
        deps: {
          instant: deps.clock.now(),
          localDay: deps.clock.localDate(),
          buildboxVersion: deps.buildboxVersion,
          unsavedChanges,
          warningMessages: sentences,
        },
        job: { kind: 'lists', recipe },
      }
      return runJob(request, onProgress, () => runHere(request, onProgress))
    },
  }
}

function isRememberedLists(value: unknown): value is RememberedListsRecipe {
  const held = fields(value)
  if (held === null) return false
  return typeof held.key === 'string' && typeof held.recipe === 'object' && held.recipe !== null
}

function isRemembered(value: unknown): value is RememberedRecipe {
  const held = fields(value)
  if (held === null) return false
  return typeof held.key === 'string' && typeof held.recipe === 'object' && held.recipe !== null
}
