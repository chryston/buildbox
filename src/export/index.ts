/**
 * The export (#61).
 *
 * `exportFiles` is the whole feature seen from outside: a Project as it stood when Export was
 * pressed, a recipe, and the things this module cannot make for itself — the clock, the version,
 * the font, a rasterizer, the Asset Store. It returns either every file that was asked for or a
 * list of what failed and why, never a half-set, because a folder of drawings with one missing is
 * a folder someone has to audit.
 *
 * Three passes over the views, in this order:
 *
 * 1. **Compose** every view. Composition is where a drawing can fail to exist — a view that is
 *    gone, a floor with nothing on it, a scale that will not fit — and every failure is collected
 *    rather than thrown, so one report says everything that is wrong instead of one thing per
 *    attempt.
 * 2. **Name** the files, which needs every view's name at once: two saved views called `Kitchen`
 *    are two drawings, and the second one's name has to say so.
 * 3. **Write** the bytes, now that nothing can fail for a reason the first pass already knew about.
 *
 * Nothing here reads a clock, a file system, or a browser. `Date`, `Math.random` and the DOM are
 * off-limits by the module boundary, and the reason is criterion 1: the same inputs have to produce
 * the same bytes, in a Worker or out of one.
 */

import type { MissingGlyph } from '../drawing'
import { sha256Hex } from '../lib'
import { composeSheet, type ComposedDrawing } from './compose'
import { pngSize } from './fit'
import type { FlatOp } from './flatten'
import { flatten } from './flatten'
import { fileDate } from './format'
import { orderedViews, viewKey } from './pageOrder'
import { MEDIA_TYPE, drawingFileName, uniqueSegments, archiveName } from './slug'
import { SHEET_SIZING } from './sheet'
import { noGlyphFor } from './strings'
import { inlineAssets, writeSvg } from './svg'
import { writePng } from './png'
import { spliceITxt } from './pngMeta'
import { writePdf, type PdfImage } from './pdf'
import { provenanceForHash, provenanceJson, provenanceOf, type Provenance } from './provenance'
import { manifestBytes, manifestOf, zipOf, type ManifestFile } from './zip'
import type {
  ExportDeps,
  ExportFailure,
  ExportFile,
  ExportResult,
  ExportSnapshot,
  Orientation,
  RasterImage,
  Recipe,
  RecipeViewRef,
} from './types'

/** One view, composed and waiting for a name and a writer. */
interface Pending {
  readonly view: RecipeViewRef
  readonly composed: ComposedDrawing
}

/** A sheet that could not be written, and why. */
type Written =
  | {
      readonly ok: true
      readonly file: ExportFile
      readonly warnings: readonly string[]
      readonly missingGlyphs: readonly string[]
    }
  | {
      readonly ok: false
      readonly reason: ExportFailure['reason']
      /** The view at fault, when the file holds more than one and the file's own name says nothing. */
      readonly output?: string
    }

/**
 * The drawings, as files.
 *
 * `deps.font` is required for PDF and ignored otherwise; `deps.rasterizer` for PNG. A missing port
 * is reported as a failure to write, never worked around with a different format, because the user
 * asked for a PDF and a silent SVG is not one.
 */
export async function exportFiles(
  snapshot: ExportSnapshot,
  recipe: Recipe,
  deps: ExportDeps,
): Promise<ExportResult> {
  const { clock } = deps
  const provenance = provenanceOf(snapshot, recipe, deps)
  const failures: ExportFailure[] = []
  const pending: Pending[] = []
  // A Drawing Set is one list of views in one order (#85 §1.1): the page a view lands on is decided
  // before anything is drawn, so the title block can say `Page 2/3` and the PDF can put the pages in
  // that order without either of them asking again.
  const views = orderedViews(snapshot.project, recipe)
  const total = views.length

  for (const [index, view] of views.entries()) {
    deps.onProgress?.({ stage: 'drawing', done: index, total, label: labelOf(snapshot, view) })
    const composed = composeSheet(snapshot, view, recipe, clock, deps.buildboxVersion, {
      number: index + 1,
      of: total,
      ...pageOrientation(recipe, view),
    })
    if (!composed.ok) {
      failures.push({ output: labelOf(snapshot, view), reason: composed.reason })
      continue
    }
    pending.push({ view, composed })
  }

  const names = nameAll(snapshot, pending, recipe, clock)
  const files: ExportFile[] = []
  const entries: ManifestFile[] = []
  // Criterion 11: the labels the PDF font could not draw. The manifest carries the full sentence per
  // file; the dialog only needs to name the label, and it needs it whether the export came back as
  // one file or as an archive — the manifest only exists for the archive.
  const glyphLabels: string[] = []

  // A PDF set is one file with one page per view, so it is written once rather than per view; SVG
  // and PNG give one file per view and go into the archive beside the manifest (#85 §1.3, §1.5).
  if (recipe.format === 'pdf' && pending.length > 0) {
    const written = await writePdfSet(
      deps,
      provenance,
      pending,
      names[0]!,
      pending.map((item) => labelOf(snapshot, item.view)),
    )
    if (!written.ok) {
      return { ok: false, failures: [{ output: written.output ?? names[0]!, reason: written.reason }] }
    }
    for (const label of written.missingGlyphs) {
      if (!glyphLabels.includes(label)) glyphLabels.push(label)
    }
    return { ok: true, kind: 'single', file: written.file, missingGlyphs: glyphLabels }
  }

  for (const [index, item] of pending.entries()) {
    const name = names[index]!
    deps.onProgress?.({ stage: 'file', done: index, total, label: name })
    const written = await writeOne(recipe, deps, provenance, item.composed, name)
    if (!written.ok) {
      failures.push({ output: written.output ?? name, reason: written.reason })
      continue
    }
    files.push(written.file)
    for (const label of written.missingGlyphs) {
      if (!glyphLabels.includes(label)) glyphLabels.push(label)
    }
    entries.push({
      path: name,
      kind: 'drawing',
      format: recipe.format,
      media_type: written.file.mediaType,
      bytes: written.file.bytes.length,
      sha256: await sha256Hex(written.file.bytes),
      contract_version: provenance.contract_version,
      view: item.composed.viewName,
      subject: item.composed.subject,
      scale: item.composed.scale,
      warnings: written.warnings,
    })
  }

  if (failures.length > 0) return { ok: false, failures }
  if (files.length === 0) {
    return { ok: false, failures: [{ output: snapshot.project.meta.name, reason: 'empty-drawing' }] }
  }
  if (files.length === 1) return { ok: true, kind: 'single', file: files[0]!, missingGlyphs: glyphLabels }

  const manifestFile: ExportFile = {
    name: 'manifest.json',
    mediaType: 'application/json',
    bytes: manifestBytes(
      await manifestOf(snapshot, recipe, provenance, [
        ...entries,
        {
          path: 'manifest.json',
          kind: 'manifest',
          format: 'json',
          media_type: 'application/json',
          contract_version: provenance.contract_version,
          warnings: [],
        },
      ]),
    ),
  }
  const archive = archiveName(snapshot.project.meta.name, fileDate(clock.localDate()))
  deps.onProgress?.({ stage: 'archive', done: total, total, label: archive })
  return {
    ok: true,
    kind: 'archive',
    files,
    missingGlyphs: glyphLabels,
    manifest: manifestFile,
    // The manifest leads the archive (#85 §2.1): a reader that stops after the first entry, or that
    // streams the file, learns what it is holding before it holds any of it.
    archive: { name: archive, mediaType: 'application/zip', bytes: zipOf([manifestFile, ...files]) },
  }
}

/** What a view is called before anything has been composed for it. */
function labelOf(snapshot: ExportSnapshot, view: RecipeViewRef): string {
  if (view.kind === 'plan') {
    return snapshot.project.views.find((each) => each.id === view.viewId)?.name ?? view.viewId
  }
  if (view.kind === 'elevation') {
    return (snapshot.project.elevationViews ?? []).find((each) => each.id === view.viewId)?.name ?? view.viewId
  }
  return snapshot.project.itemDesigns.find((each) => each.id === view.itemDesignId)?.name ?? view.itemDesignId
}

/**
 * One name per composed view, with the view segment made unique.
 *
 * A Plan View's name carries the Floor and the `_existing_` marker, because that is what the
 * drawing is of and a reader sorting a folder of downloads sees only the name. An Item Detail
 * View's name carries the Item Design where the Floor's name would go.
 */
function nameAll(
  snapshot: ExportSnapshot,
  pending: readonly Pending[],
  recipe: Recipe,
  clock: ExportDeps['clock'],
): string[] {
  const date = fileDate(clock.localDate())
  // A Drawing Set of more than one view is one PDF, and it is named for the set and not for a view:
  // no single view's name describes the file the other views are in (#85 §1.3).
  if (recipe.format === 'pdf' && pending.length > 1) {
    const name = archiveName(snapshot.project.meta.name, date, 'pdf')
    return pending.map(() => name)
  }
  const views = uniqueSegments(pending.map((item) => item.composed.viewName))
  return pending.map((item, index) =>
    drawingFileName(
      item.view.kind === 'plan'
        ? { project: snapshot.project.meta.name, floor: item.composed.subject, view: views[index]!, existing: true, date }
        : item.view.kind === 'elevation'
          ? // `<project>_<floor>_<view>_<date>`: the Floor it looks across and the view's own name,
            // which is what says the drawing is sideways. The `_existing_` marker belongs to a Plan
            // View's existing-conditions drawing and says nothing an Elevation View adds.
            { project: snapshot.project.meta.name, floor: item.composed.subject, view: views[index]!, date }
          : { project: snapshot.project.meta.name, itemDesign: item.composed.subject, view: views[index]!, date },
      recipe.format,
    ),
  )
}

/** The orientation the person forced on one page of a set, if they forced one (#85 §1.3). */
function pageOrientation(recipe: Recipe, view: RecipeViewRef): { orientation?: Orientation } {
  const held = recipe.pageOrientations?.[viewKey(view)]
  return held === undefined ? {} : { orientation: held }
}

/**
 * A Drawing Set as one PDF: one page per view, in page order, sharing one embedded face.
 *
 * The font is subset once for the whole file and the trailer's `/ID` is taken over every page's own
 * geometry, so a set exported twice from one revision is the same bytes and a set with one page
 * moved is not. A Plan Image is embedded once however many pages draw it.
 */
async function writePdfSet(
  deps: ExportDeps,
  provenance: Provenance,
  pending: readonly Pending[],
  name: string,
  labels: readonly string[],
): Promise<Written> {
  if (deps.font === undefined) return { ok: false, reason: 'no-font' }
  const sheets = pending.map((item) => ({ composed: item.composed, ops: flatten(item.composed.list, SHEET_SIZING) }))
  const images = new Map<string, PdfImage>()
  for (const [index, sheet] of sheets.entries()) {
    const held = await pdfImages(sheet.ops, deps)
    // The set is one file, but the thing that went wrong belongs to one page: a person who is told
    // `the PDF couldn't be made` cannot act on it, and a person who is told which view can (#61
    // criterion 6, #85 §2.4).
    if (held === null) return { ok: false, reason: 'image-format', output: labels[index] }
    for (const [hash, image] of held) if (!images.has(hash)) images.set(hash, image)
  }
  const pdf = await writePdf({
    pages: sheets.map((sheet) => ({
      widthMm: sheet.composed.sheet.widthMm,
      heightMm: sheet.composed.sheet.heightMm,
      ops: sheet.ops,
    })),
    provenance,
    fontBytes: deps.font.bytes,
    images,
    contentHash: await contentHashOf(
      provenance,
      sheets.flatMap((sheet) => flatten(sheet.composed.drawing, SHEET_SIZING)),
    ),
    when: deps.clock.now(),
  })
  // The writer is asked last and answers for every sheet, title block and dimension labels included:
  // each drawing reports only its own text, and a label the frame carries would otherwise go missing
  // in silence (#61 criterion 11).
  const lost: MissingGlyph[] = []
  for (const glyph of [...pending.flatMap((item) => item.composed.missingGlyphs), ...pdf.missingGlyphs]) {
    const at = `${glyph.text}\u0000${glyph.chars.join('')}`
    if (!lost.some((each) => `${each.text}\u0000${each.chars.join('')}` === at)) lost.push(glyph)
  }
  return {
    ok: true,
    ...glyphNotice(lost),
    file: { name, mediaType: MEDIA_TYPE.pdf, bytes: pdf.bytes },
  }
}

/** One composed view as bytes, or the reason it has none. */
async function writeOne(
  recipe: Recipe,
  deps: ExportDeps,
  provenance: Provenance,
  composed: ComposedDrawing,
  name: string,
): Promise<Written> {
  const ops = flatten(composed.list, SHEET_SIZING)

  if (recipe.format === 'svg') {
    const uris = await inlineAssets(composed.list, deps.assets)
    return {
      ok: true,
      ...glyphNotice(composed.missingGlyphs),
      file: { name, mediaType: MEDIA_TYPE.svg, bytes: writeSvg(composed.sheet, composed.list, provenance, uris) },
    }
  }

  if (deps.rasterizer === undefined) return { ok: false, reason: 'no-rasterizer' }
  const pixels = pngSize(composed.sheet.widthMm, composed.sheet.heightMm, recipe.pngLongEdge)
  const images = await rasterImages(ops, deps)
  const written = await writePng(composed.sheet, composed.list, {
    pixelsPerMm: pixels.widthPx / composed.sheet.widthMm,
    rasterizer: deps.rasterizer,
    images,
  })
  if (!written.ok) return { ok: false, reason: written.reason === 'no-surface' ? 'no-rasterizer' : 'raster-failed' }
  const withMeta = spliceITxt(written.bytes, provenanceJson(provenance))
  if (withMeta === null) return { ok: false, reason: 'raster-failed' }
  return {
    ok: true,
    ...glyphNotice(composed.missingGlyphs),
    file: { name, mediaType: MEDIA_TYPE.png, bytes: withMeta },
  }
}

/**
 * What a sheet lost, in the two shapes it is asked for: the manifest's sentence per character, and
 * the plain label the dialog names (#61 criterion 11).
 */
function glyphNotice(glyphs: readonly MissingGlyph[]): {
  warnings: string[]
  missingGlyphs: string[]
} {
  return {
    warnings: glyphs.map((glyph) => noGlyphFor(glyph.chars.join(' '), glyph.text)),
    missingGlyphs: [...new Set(glyphs.map((glyph) => glyph.text))],
  }
}

/**
 * The hash a PDF's `/ID` and font tag are both derived from: the provenance without its timestamp,
 * and the drawing's own geometry.
 *
 * The bytes of a file cannot be hashed into itself, so the hash is of what the file is *about*.
 * That is the property criterion 1 actually needs: two exports of the same drawing a second apart
 * agree on it, and a drawing that has changed does not. The geometry is rounded to micrometres so
 * that a float that differs in the last bit does not look like a new drawing.
 */
async function contentHashOf(provenance: Provenance, ops: readonly FlatOp[]): Promise<string> {
  const geometry = JSON.stringify(ops, (_key, value: unknown) =>
    typeof value === 'number' ? Math.round(value * 1000) / 1000 : value,
  )
  return sha256Hex(new TextEncoder().encode(`${provenanceForHash(provenance)}\n${geometry}`))
}

/** The stored bytes of every Plan Image a PDF draws, by hash; `null` for a format it cannot place. */
async function pdfImages(ops: readonly FlatOp[], deps: ExportDeps): Promise<Map<string, PdfImage> | null> {
  const images = new Map<string, PdfImage>()
  if (deps.assets === undefined) return images
  for (const op of ops) {
    if (op.kind !== 'image' || images.has(op.assetHash)) continue
    const found = await deps.assets(op.assetHash)
    if (found === null) continue
    if (found.mediaType !== 'image/png' && found.mediaType !== 'image/jpeg') return null
    images.set(op.assetHash, { bytes: found.bytes, mediaType: found.mediaType })
  }
  return images
}

/** The decoded bytes of every Plan Image a PNG paints, by hash. */
async function rasterImages(ops: readonly FlatOp[], deps: ExportDeps): Promise<Map<string, RasterImage>> {
  const images = new Map<string, RasterImage>()
  if (deps.assets === undefined || deps.rasterizer === undefined) return images
  for (const op of ops) {
    if (op.kind !== 'image' || images.has(op.assetHash)) continue
    const found = await deps.assets(op.assetHash)
    if (found === null) continue
    const decoded = await deps.rasterizer.decode(found.bytes, found.mediaType)
    if (decoded !== null) images.set(op.assetHash, decoded)
  }
  return images
}

export { composeSheet, modelBounds } from './compose'
export type { ComposedDrawing, ComposedSheet } from './compose'
// The sizing every sheet is drawn at, so the dialog's preview and the file agree on what a
// millimetre of paper is; one declaration, because the preview that sized differently is a second
// renderer wearing the first one's clothes.
export { SHEET_SIZING } from './sheet'
export { fitCheck, suggestionsFor, downsampledSize, pngSize, PAGE_MM, MARGIN_MM, FIXED_SCALES } from './fit'
export { EXPORT_FOOTER, NOT_TO_SCALE, NOTES_SWITCH_LABELS, notesStatement, roomLabel, scaleStatement, SCOPE } from './strings'
// The whole table as one namespace, for the CI scan over shipped strings (#66 criterion 8),
// which has to see every word the writers can put in a file rather than the four the dialog asks for.
export * as EXPORT_WORDS from './strings'
export { defaultCutListStates, defaultListsScope, describeScope } from './scope'
export { hiddenInView } from './hiddenInView'
export type { HiddenInView } from './hiddenInView'
export { needsActiveOption } from './blocking'
export { drawingComposition, drawingLayerChips } from './composition'
export type { DrawingComposition, DrawingLayerChip } from './composition'
export { exportLists, listsSummary, CSV_MEDIA_TYPE } from './lists'
export type { ListsSummary } from './lists'
// The printed model (#84 §1): the CSV's rows as display strings. Public because the dialog shows the
// row count and the notice a PDF of it carries, and both have to be read from the same model the
// page is drawn from.
export { tableModel } from './tableModel'
export type { CellAlign, TableModel, TableColumn } from './tableModel'
export { tableSheets, writeTablePdf } from './tablePdf'
export type { TablePdfInput, TablePdfResult } from './tablePdf'
export { LENGTH_DP, AREA_DP, ANGLE_DP, INTEGER_DP, formatNumber, neutralise, quote } from './csv/format'
export {
  CSV_CONTRACT_VERSION,
  CUT_LIST_TABLE,
  ITEMS_TABLE,
  TABLES,
  headerLine,
} from './csv/tables'
export type { Column, ColumnKind, ListTableId, TableId, TableSpec } from './csv/tables'
export { CSV_BOM, writeCsv } from './csv/write'
export type { Cell, CsvRow } from './csv/write'
export { slug, drawingFileName, archiveName, listFileName, listsArchiveName, handoffArchiveName } from './slug'
export { defaultPageOrder, orderedViews, pageOrderOf, viewKey } from './pageOrder'
export type { SheetPage } from './compose'
export { SINGLE_PAGE } from './compose'
export { provenanceOf, provenanceJson } from './provenance'
export { manifestOf, manifestBytes, zipOf } from './zip'
export type { Manifest, ManifestFile } from './zip'
export type {
  CompositionColorOverride,
  CompositionLayer,
  CompositionNotes,
  DrawingFormat,
  DrawingToggles,
  ExportClock,
  ExportDeps,
  ExportFailure,
  ExportFailureReason,
  ExportFile,
  ExportProgress,
  ExportResult,
  ExportSnapshot,
  ListsRecipe,
  ListFormat,
  NotesSwitches,
  Orientation,
  OrientationSetting,
  PageSize,
  PngLongEdge,
  RasterImage,
  Rasterizer,
  RasterSurface,
  Recipe,
  RecipeViewRef,
  RecordedComposition,
  ScaleDenominator,
  ScaleSetting,
} from './types'
export type { AssetBytes } from './types'
export { DEFAULT_NOTES_SWITCHES } from './types'
export { exportNotes } from './notes'
export type { ExportNotesInput, ExportNotePlacement } from './notes'
