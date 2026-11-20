/**
 * Drawing files, off the main thread (#61 §9).
 *
 * This is the Worker entry of a pair: `./exportRunner.ts` is its host and lives on the main
 * thread. Writing a twelve-view PDF is seconds of path flattening, font subsetting and deflate,
 * and #61 criterion 14 is explicit that the Library must keep painting through it — so the whole
 * of `export` runs here. It is pure by construction: no DOM, no ports, no `persistence`. The
 * Project, the recipe, the clock, the version, the font and the asset bytes all arrive in the
 * request, and the answer is bytes back.
 *
 * PNG is the one format that needs a rasterizer, and `OffscreenCanvas` exists in a Worker, so the
 * Worker makes its own (`./rasterizer.ts`) rather than having pixels proxied across the boundary.
 * The same implementation on both sides is what makes a PNG byte-stable whichever thread painted
 * it.
 *
 * The request and the answers are declared here rather than imported from the host, so this file
 * stays the only place the wire format is written down; the host reads these types, not the other
 * way round.
 */
import { exportFiles } from '../export'
import type { ExportProgress, ExportResult, ExportSnapshot, Recipe } from '../export'
import { createRasterizer } from './rasterizer'

/** The parts of `ExportDeps` that are plain data, and so cross the boundary as themselves. */
export interface ExportWorkerDeps {
  readonly clock: { now(): string; localDate(): string }
  readonly buildboxVersion: string
  readonly contractVersion?: string
  readonly unsavedChanges?: boolean
}

/** One asset as it crosses into the Worker: its hash, its bytes, and what it claims to be. */
export interface ExportWorkerAsset {
  readonly sha256: string
  readonly bytes: Uint8Array
  readonly mediaType: string
}

/**
 * One export request.
 *
 * `assets` is the whole set rather than a pull protocol: a Worker that asked the main thread for
 * each Plan Image as it came to it would serialise the Asset Store reads behind the drawing, and
 * a Project's images are a few megabytes at worst. They are copied, never transferred — the
 * caller may still need them for the main-thread fallback, and a detached buffer would arrive
 * there empty.
 */
export interface ExportRequest {
  readonly id: number
  readonly snapshot: ExportSnapshot
  readonly recipe: Recipe
  readonly deps: ExportWorkerDeps
  /** The Noto Sans subset a PDF embeds; absent when the format does not need it. */
  readonly font?: Uint8Array
  readonly assets: readonly ExportWorkerAsset[]
}

/** How one request comes back: as it goes, when it is finished, or not at all. */
export type ExportAnswer =
  | { readonly id: number; readonly kind: 'progress'; readonly progress: ExportProgress }
  | { readonly id: number; readonly kind: 'done'; readonly result: ExportResult }
  | { readonly id: number; readonly kind: 'failed' }

interface WorkerScope {
  onmessage: ((event: MessageEvent<ExportRequest>) => void) | null
  postMessage(message: ExportAnswer): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const { id, snapshot, recipe, deps, font, assets } = event.data
  const byHash = new Map(assets.map((asset) => [asset.sha256, asset]))
  const rasterizer = createRasterizer() ?? undefined
  void exportFiles(snapshot, recipe, {
    ...deps,
    ...(font === undefined ? {} : { font: { bytes: font } }),
    ...(rasterizer === undefined ? {} : { rasterizer }),
    assets: async (sha256) => {
      const asset = byHash.get(sha256)
      return asset === undefined ? null : { bytes: asset.bytes, mediaType: asset.mediaType }
    },
    onProgress: (progress) => scope.postMessage({ id, kind: 'progress', progress }),
  })
    .then((result) => scope.postMessage({ id, kind: 'done', result }))
    // A throw here is a bug in `export`, not a drawing that could not be written — `exportFiles`
    // answers every ordinary failure as data. Saying so as `failed` lets the host fall back to
    // running the same code on its own thread, where the same bug will at least be visible.
    .catch(() => scope.postMessage({ id, kind: 'failed' }))
}
