/**
 * The shapes every part of `export` shares (#61, #20 §10).
 *
 * A recipe is data, a snapshot is data, and the answer is bytes. Nothing here holds a promise,
 * a port, or a reference to the app: `exportFiles` is one pure function over these three, which
 * is what lets the same call run in a Worker, on the main thread, and in a Node test with the
 * same bytes out.
 */

import type { DisplayList, LayerKey, Rect } from '../drawing'
import type { DisplayUnit, Project } from '../domain'

/** The three formats #61 writes. One export writes one of them. */
export type DrawingFormat = 'svg' | 'png' | 'pdf'

/** The two sheet sizes the dialog offers. */
export type PageSize = 'A4' | 'A3'

/** How a sheet is held once chosen. */
export type Orientation = 'portrait' | 'landscape'

/** `auto` lets each page take the orientation its own drawing suits (#61 §4). */
export type OrientationSetting = Orientation | 'auto'

/** The four fixed scales the dialog lists, as denominators: `1:50` is `50`. */
export type ScaleDenominator = 10 | 20 | 50 | 100

/** `fit` is the sheet taking the largest drawing that fits, and saying `Not to scale`. */
export type ScaleSetting = 'fit' | ScaleDenominator

/** The two PNG long edges (#61 §2). */
export type PngLongEdge = 2048 | 4096

/**
 * One drawing a recipe asks for.
 *
 * A Plan View is named by its saved view. An Item Detail View is named by the Item Design it
 * shows, because the domain stores no saved Item Detail Views — `Project.views` holds
 * `kind: 'plan'` views only, so there is no ID to name one by. The optional `viewId` on that
 * arm is where a saved Item Detail View would hang when the domain grows one, which is why it is
 * optional rather than absent (S8, S10).
 */
export type RecipeViewRef =
  | { readonly kind: 'plan'; readonly viewId: string }
  | { readonly kind: 'item-detail'; readonly itemDesignId: string; readonly viewId?: string }

/**
 * Everything the user chose. The recipe is the whole input; nothing else is remembered.
 *
 * `pageSize`, `orientation` and `scale` are PDF-only, but they are always present rather than
 * conditional: a recipe that changes shape with the format would have to be re-read everywhere
 * it is used, and the dialog keeps the values the user last set whatever the format.
 *
 * `layers` is the S8 layer override, absent until that issue adds it. It is the one override
 * this issue can already honour — a display list is a list of named layers — so it is wired
 * rather than reserved.
 */
export interface Recipe {
  /** The drawings to export, in the order the user listed them. */
  readonly views: readonly RecipeViewRef[]
  readonly format: DrawingFormat
  readonly pageSize: PageSize
  readonly orientation: OrientationSetting
  readonly scale: ScaleSetting
  readonly pngLongEdge: PngLongEdge
  /** Always on for PDF; default on and switchable for SVG and PNG. */
  readonly titleBlock: boolean
  readonly grid: boolean
  /** Copied from the Project's preferences when the dialog opens. */
  readonly unit: DisplayUnit
  readonly precision: number
  /** The layers to draw; absent is the view's own. S8. */
  readonly layers?: readonly LayerKey[]
}

/** The Project as it was when Export was pressed, and the revision those bytes are. */
export interface ExportSnapshot {
  readonly project: Project
  readonly revision: number
}

/** One file's bytes and what to call them. */
export interface ExportFile {
  readonly name: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** Why one output was not written. */
export type ExportFailureReason =
  /** Criterion 14: the drawing does not fit the sheet at the chosen scale. */
  | 'out-of-paper'
  /** The drawing has nothing in it; it still exports, so this is only for a view with no bounds. */
  | 'empty-drawing'
  /** The recipe named a view or an Item Design the Project does not have. */
  | 'unknown-view'
  /** No font bytes were handed in, so no text could be set. */
  | 'no-font'
  /** fontkit refused the font bytes. */
  | 'font-refused'
  /** No `Rasterizer` was handed in, so PNG has nothing to paint into. */
  | 'no-rasterizer'
  /** The rasterizer refused, produced nothing, or ran out of memory. */
  | 'raster-failed'
  /** The Plan Image is bytes this writer cannot place. */
  | 'image-format'

/** One output that was not written. `output` is the file name the user would have got. */
export interface ExportFailure {
  readonly output: string
  readonly reason: ExportFailureReason
}

/** Where the export has got to. `label` names the drawing or the file. */
export interface ExportProgress {
  readonly stage: 'drawing' | 'file' | 'archive'
  readonly done: number
  readonly total: number
  readonly label: string
}

/**
 * The answer, all-or-nothing (criterion 15).
 *
 * Either every requested output was written — as one file, or as an archive plus the files that
 * went into it — or nothing was, and `failures` says which outputs and why. There is no partial
 * result for the caller to notice and discard.
 */
export type ExportResult =
  | { readonly ok: true; readonly kind: 'single'; readonly file: ExportFile }
  | {
      readonly ok: true
      readonly kind: 'archive'
      readonly files: readonly ExportFile[]
      readonly manifest: ExportFile
      readonly archive: ExportFile
    }
  | { readonly ok: false; readonly failures: readonly ExportFailure[] }

/**
 * The clock, narrowed to the two questions `export` asks it.
 *
 * `now` is the UTC instant that goes into the metadata; `localDate` is the calendar date the
 * title block prints and the file name ends with, which is the reader's date, not UTC's.
 * `session`'s `ClockPort` satisfies `now`; `platform`'s clock supplies `localDate`.
 */
export interface ExportClock {
  now(): string
  localDate(): string
}

/** One decoded image, as a `Rasterizer` sees it. */
export interface RasterImage {
  readonly width: number
  readonly height: number
}

/**
 * The narrow slice of `CanvasRenderingContext2D` a PNG needs.
 *
 * Declared here rather than taken from `OffscreenCanvas` so that `export` stays free of DOM
 * globals and a test can hand in a recorder. `platform` implements it over an `OffscreenCanvas`,
 * and the real context satisfies it structurally.
 */
export interface RasterSurface {
  readonly width: number
  readonly height: number
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineDashOffset: number
  globalAlpha: number
  font: string
  textAlign: string
  textBaseline: string
  save(): void
  restore(): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  translate(x: number, y: number): void
  rotate(angleRad: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    anticlockwise?: boolean,
  ): void
  closePath(): void
  fill(): void
  stroke(): void
  fillRect(x: number, y: number, width: number, height: number): void
  setLineDash(segments: readonly number[]): void
  fillText(text: string, x: number, y: number): void
  drawImage(image: RasterImage, dx: number, dy: number, dw: number, dh: number): void
  /** The PNG bytes, or `null` when the surface could not encode one. */
  toBlob(): Promise<Uint8Array | null>
}

/**
 * The port PNG rasterization goes through.
 *
 * One implementation, in `platform`, over `OffscreenCanvas` — the same object in a Worker and on
 * the main thread, which is what makes a PNG byte-stable across the two (#61 §9). Absent means
 * this environment cannot rasterize, and PNG is reported as not written rather than faked.
 */
export interface Rasterizer {
  /** Decode one image for `drawImage`, or `null` for a format this cannot read. */
  decode(bytes: Uint8Array, mediaType: string): Promise<RasterImage | null>
  /** A surface of exactly `width` × `height`, or `null` when it cannot be made. */
  create(width: number, height: number): RasterSurface | null
}

/** One stored asset's bytes, resolved by hash. `platform` reads these from the Asset Store. */
export type AssetBytes = (sha256: string) => Promise<{ bytes: Uint8Array; mediaType: string } | null>

/** Everything `exportFiles` cannot derive: time, version, ports, the font. */
export interface ExportDeps {
  readonly clock: ExportClock
  readonly buildboxVersion: string
  /** `1.0` unless a test says otherwise; written into every output's metadata. */
  readonly contractVersion?: string
  /** True only while the Project has changes Save could not write (#14). */
  readonly unsavedChanges?: boolean
  /** The bundled Noto Sans subset, as TrueType: a PDF embeds it, a raster labels with it. */
  readonly font?: { readonly bytes: Uint8Array }
  readonly rasterizer?: Rasterizer
  readonly assets?: AssetBytes
  readonly onProgress?: (progress: ExportProgress) => void
}

/** One drawing's geometry on the sheet, in millimetres of paper. */
export interface PlacedDrawing {
  /** The display list already in paper millimetres, sheet coordinates. */
  readonly list: DisplayList
  /** Where the drawing sits on the sheet. */
  readonly rect: Rect
  /** The denominator actually used; `null` when the sheet is not to scale. */
  readonly denominator: number | null
  /** True when the scale was chosen to fit rather than named. */
  readonly fitted: boolean
}
