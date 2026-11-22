/**
 * The shapes every part of `export` shares (#61, #20 §10).
 *
 * A recipe is data, a snapshot is data, and the answer is bytes. Nothing here holds a promise,
 * a port, or a reference to the app: `exportFiles` is one pure function over these three, which
 * is what lets the same call run in a Worker, on the main thread, and in a Node test with the
 * same bytes out.
 */

import type { QuantityScope } from '../derive'
import type { DisplayUnit, EntityId, Project, RenovationDisplay } from '../domain'
import type { TableId } from './csv/tables'

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
 * The dialog's temporary chips over one Plan View (#73 §1).
 *
 * They are the only way an export differs from the saved view it was opened from, and they are
 * deliberately not a view edit: `layers` is the complete set of layer keys to draw (`unlayered`
 * among them) rather than a diff, because a chip that is off has to say so whether the view showed
 * that layer or hid it. Nothing consumes them except `export`, and nothing writes them back.
 */
export interface DrawingToggles {
  readonly layers?: readonly EntityId[]
  /** The `Notes overlay` chip, which stays off until #80 and #81 give it something to overlay. */
  readonly notesOverlay?: boolean
}

/** One Drawing Layer as the composition names it: its ID and the name it had when it was drawn. */
export interface CompositionLayer {
  readonly id: EntityId
  readonly name: string
}

/** One layer this view paints in a colour of its own. */
export interface CompositionColorOverride {
  readonly layer_id: EntityId
  readonly name: string
  readonly color: string
}

/** The Notes switches. Only the overlay exists yet; the rest arrive with S10. */
export interface CompositionNotes {
  readonly overlay: boolean
}

/**
 * What one sheet was actually drawn from (#73 §1, export contract §9).
 *
 * The keys are snake_case because this is file metadata, read by whatever a customer opens it with,
 * and it sits beside `project_id` and `buildbox_version` rather than beside the recipe's own
 * camelCase fields. It holds no timestamp: a repeat export of the same revision with the same
 * recipe has to produce the same bytes, and the composition is part of what is hashed.
 */
export interface RecordedComposition {
  readonly view_id: EntityId
  readonly view_name: string
  readonly design_option_id: EntityId | null
  readonly renovation_display: RenovationDisplay
  /** Back to front, which is paint order. */
  readonly layer_order: readonly CompositionLayer[]
  /** The layers that reached the paper, `unlayered` among them, in the same order. */
  readonly included_layers: readonly CompositionLayer[]
  readonly color_overrides: readonly CompositionColorOverride[]
  readonly notes: CompositionNotes
}

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
  | { readonly kind: 'plan'; readonly viewId: string; readonly toggles?: DrawingToggles }
  | { readonly kind: 'item-detail'; readonly itemDesignId: string; readonly viewId?: string }

/**
 * Everything the user chose. The recipe is the whole input; nothing else is remembered.
 *
 * `pageSize`, `orientation` and `scale` are PDF-only, but they are always present rather than
 * conditional: a recipe that changes shape with the format would have to be re-read everywhere
 * it is used, and the dialog keeps the values the user last set whatever the format.
 *
 * `composition` is written by `provenanceOf` and never by the dialog: it is what the sheets were
 * actually drawn from, recorded per view so a repeat export says so and hashes the same (#73 §1).
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
  /** What the sheets were drawn from, recorded by `provenanceOf` for the file's metadata. */
  readonly composition?: readonly RecordedComposition[]
}

/**
 * The Lists tab's recipe: which tables, and the scope they are counted over (#62 §10).
 *
 * `tables` is a list rather than two booleans because the ZIP writes them in the contract's order
 * and a list is that order. `scope` is `derive`'s own scope, unchanged: the recipe is what the
 * dialog's controls say, and the derivation is what the rows are. A recipe from an Item Detail
 * View carries `scope.itemDesignId`, which is what makes its Cut List one item's list.
 */
export interface ListsRecipe {
  readonly tables: readonly TableId[]
  readonly scope: QuantityScope
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
  /** Nothing was written at all: a recipe that named no view. An empty view still exports (#61 criterion 7). */
  | 'empty-drawing'
  /** The recipe named a view or an Item Design the Project does not have. */
  | 'unknown-view'
  /** A lists recipe named no table, so there was nothing to write (#62). */
  | 'empty-tables'
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
  | {
      readonly ok: true
      readonly kind: 'single'
      readonly file: ExportFile
      /** The labels whose characters the PDF font could not draw (#61 criterion 11). */
      readonly missingGlyphs: readonly string[]
    }
  | {
      readonly ok: true
      readonly kind: 'archive'
      readonly files: readonly ExportFile[]
      readonly manifest: ExportFile
      readonly archive: ExportFile
      readonly missingGlyphs: readonly string[]
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
  /**
   * The Warnings List's sentences, keyed by `Warning.key`: the copy `ui/strings` owns, rendered for
   * the recipe's scope by `app` with `derive`'s `warningMessages`. `export` may not import the copy
   * table and a Worker cannot be sent a function, so the strings cross instead (#68 criterion 5).
   * A recipe that names the Warnings List without it fails rather than writing an empty column.
   */
  readonly warningMessages?: Readonly<Record<string, string>>
  /** The bundled Noto Sans subset, as TrueType: a PDF embeds it, a raster labels with it. */
  readonly font?: { readonly bytes: Uint8Array }
  readonly rasterizer?: Rasterizer
  readonly assets?: AssetBytes
  readonly onProgress?: (progress: ExportProgress) => void
}
