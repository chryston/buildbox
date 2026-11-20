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
  ExportClock,
  ExportProgress,
  ExportResult,
  ExportSnapshot,
  Rasterizer,
  Recipe,
  RecipeViewRef,
} from '../export'
import type { ExportMeasurement, ExportPort, ExportRunOutcome, ExportableView } from '../ui'
import type { PrefsRepository } from '../persistence'
import type { ProjectSession } from '../session'
import type { Project } from '../domain'

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

/** The manifest's warnings, which is where criterion 11's unrenderable-character notice lives. */
function manifestWarnings(result: ExportResult): string[] {
  if (!result.ok || result.kind !== 'archive') return []
  const parsed: unknown = JSON.parse(new TextDecoder().decode(result.manifest.bytes))
  if (typeof parsed !== 'object' || parsed === null || !('warnings' in parsed)) return []
  const warnings: unknown = parsed.warnings
  return Array.isArray(warnings) ? warnings.filter((one): one is string => typeof one === 'string') : []
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
    const { exportFiles } = await import('../export')
    if (mainThread === null) mainThread = createRasterizer() ?? null
    const lookup = new Map(request.assets.map((one) => [one.sha256, one]))
    return exportFiles(request.snapshot, request.recipe, {
      clock: { now: () => request.deps.instant, localDate: () => request.deps.localDay },
      buildboxVersion: request.deps.buildboxVersion,
      contractVersion: request.deps.contractVersion,
      unsavedChanges: request.deps.unsavedChanges,
      font: request.font === undefined ? undefined : { bytes: request.font },
      rasterizer: mainThread ?? undefined,
      assets: async (sha256) => {
        const held = lookup.get(sha256)
        return held === undefined ? null : { bytes: held.bytes, mediaType: held.mediaType }
      },
      onProgress,
    })
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
      const details: ExportableView[] = project.itemDesigns.map((design) => ({
        ref: { kind: 'item-detail', itemDesignId: design.id },
        label: design.name,
        group: 'Item Design',
      }))
      return [...planViews, ...details]
    },

    async measure(ref: RecipeViewRef): Promise<ExportMeasurement> {
      // `modelBounds` is the only thing in `export` the dialog wants before an export starts, and
      // it is small: the heavy half of the module is the writers, which stay unloaded.
      const { modelBounds } = await import('../export')
      return { bounds: modelBounds(snapshotOf(), ref) }
    },

    unacknowledgedWarnings(): number {
      // The warnings engine is #66's. The line reads 0 until then, which is the truth rather
      // than an omission: the dialog has to carry the line before it can carry a count.
      return 0
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
        recipe,
        deps: {
          instant: deps.clock.now(),
          localDay: deps.clock.localDate(),
          buildboxVersion: deps.buildboxVersion,
          unsavedChanges,
        },
        font: recipe.format === 'pdf' ? await loadFont() : undefined,
        assets: gathered.filter((one) => one !== null),
      }
      if (cancelled) return { kind: 'cancelled' }

      const outcome = await runner.run(request, onProgress)
      if (cancelled || outcome.kind === 'cancelled') return { kind: 'cancelled' }
      // The Worker declined: same function, same arguments, this thread. No message, because
      // there is nothing the reader could do with one.
      const result = outcome.kind === 'done' ? outcome.result : await runHere(request, onProgress)
      if (cancelled) return { kind: 'cancelled' }
      if (!result.ok) return { kind: 'failed', failures: result.failures }

      const files = result.kind === 'single' ? [result.file] : [...result.files, result.manifest, result.archive]
      for (const file of files) downloadFile(file.name, file.mediaType, file.bytes)
      return { kind: 'downloaded', files: files.length, missingGlyphs: manifestWarnings(result) }
    },
  }
}

function isRemembered(value: unknown): value is RememberedRecipe {
  const held = fields(value)
  if (held === null) return false
  return typeof held.key === 'string' && typeof held.recipe === 'object' && held.recipe !== null
}
