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
import { MEDIA_TYPE, drawingFileName, uniqueSegments, archiveName } from './slug'
import { SHEET_SIZING } from './sheet'
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
  | { readonly ok: false; readonly reason: ExportFailure['reason'] }

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
  const total = recipe.views.length

  for (const [index, view] of recipe.views.entries()) {
    deps.onProgress?.({ stage: 'drawing', done: index, total, label: labelOf(snapshot, view) })
    const composed = composeSheet(snapshot, view, recipe, clock, deps.buildboxVersion)
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

  for (const [index, item] of pending.entries()) {
    const name = names[index]!
    deps.onProgress?.({ stage: 'file', done: index, total, label: name })
    const written = await writeOne(recipe, deps, provenance, item.composed, name)
    if (!written.ok) {
      failures.push({ output: name, reason: written.reason })
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
    archive: { name: archive, mediaType: 'application/zip', bytes: zipOf([...files, manifestFile]) },
  }
}

/** What a view is called before anything has been composed for it. */
function labelOf(snapshot: ExportSnapshot, view: RecipeViewRef): string {
  if (view.kind === 'plan') {
    return snapshot.project.views.find((each) => each.id === view.viewId)?.name ?? view.viewId
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
  const views = uniqueSegments(pending.map((item) => item.composed.viewName))
  return pending.map((item, index) =>
    drawingFileName(
      item.view.kind === 'plan'
        ? { project: snapshot.project.meta.name, floor: item.composed.subject, view: views[index]!, existing: true, date }
        : { project: snapshot.project.meta.name, itemDesign: item.composed.subject, view: views[index]!, date },
      recipe.format,
    ),
  )
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

  if (recipe.format === 'pdf') {
    if (deps.font === undefined) return { ok: false, reason: 'no-font' }
    const images = await pdfImages(ops, deps)
    if (images === null) return { ok: false, reason: 'image-format' }
    const pdf = await writePdf({
      widthMm: composed.sheet.widthMm,
      heightMm: composed.sheet.heightMm,
      ops,
      provenance,
      fontBytes: deps.font.bytes,
      images,
      contentHash: await contentHashOf(provenance, flatten(composed.drawing, SHEET_SIZING)),
      when: deps.clock.now(),
    })
    // The writer is asked last and answers for the whole sheet, title block and dimension labels
    // included: the drawing reports only its own text, and a label the frame carries would otherwise
    // go missing in silence (#61 criterion 11).
    return {
      ok: true,
      ...glyphNotice([...composed.missingGlyphs, ...pdf.missingGlyphs]),
      file: { name, mediaType: MEDIA_TYPE.pdf, bytes: pdf.bytes },
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
    warnings: glyphs.map((glyph) => `No glyph for ${glyph.chars.join(' ')} in "${glyph.text}"`),
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
export { fitCheck, suggestionsFor, downsampledSize, pngSize, PAGE_MM, MARGIN_MM, FIXED_SCALES } from './fit'
export { EXPORT_FOOTER, NOT_TO_SCALE, scaleStatement, SCOPE } from './strings'
// The whole table as one namespace, for the CI scan over shipped strings (#66 criterion 8),
// which has to see every word the writers can put in a file rather than the four the dialog asks for.
export * as EXPORT_WORDS from './strings'
export { defaultCutListStates, describeScope } from './scope'
export { exportLists, listsSummary, CSV_MEDIA_TYPE } from './lists'
export type { ListsSummary } from './lists'
export { LENGTH_DP, AREA_DP, ANGLE_DP, INTEGER_DP, formatNumber, neutralise, quote } from './csv/format'
export {
  CSV_CONTRACT_VERSION,
  CUT_LIST_TABLE,
  ITEMS_TABLE,
  TABLES,
  headerLine,
} from './csv/tables'
export type { Column, ColumnKind, TableId, TableSpec } from './csv/tables'
export { CSV_BOM, writeCsv } from './csv/write'
export type { Cell, CsvRow } from './csv/write'
export { slug, drawingFileName, archiveName, listFileName, listsArchiveName } from './slug'
export { provenanceOf, provenanceJson } from './provenance'
export { manifestOf, manifestBytes, zipOf } from './zip'
export type { Manifest, ManifestFile } from './zip'
export type {
  DrawingFormat,
  ExportClock,
  ExportDeps,
  ExportFailure,
  ExportFailureReason,
  ExportFile,
  ExportProgress,
  ExportResult,
  ExportSnapshot,
  ListsRecipe,
  Orientation,
  OrientationSetting,
  PageSize,
  PngLongEdge,
  RasterImage,
  Rasterizer,
  RasterSurface,
  Recipe,
  RecipeViewRef,
  ScaleDenominator,
  ScaleSetting,
} from './types'
export type { AssetBytes } from './types'
