/**
 * A sheet as a PDF (#61 §2).
 *
 * `pdf-lib` writes the file and `fontkit` subsets the font; everything else is arithmetic this
 * file owns. Two things make that worth writing down.
 *
 * **Coordinates.** A PDF page is y-up and a display list is y-down. `drawSvgPath` is the one
 * drawing call that knows about it — it emits `translate(x,y)` then `scale(1,-1)` — so paths are
 * handed to it in y-down points with `y` at the foot of the page, and the flip happens inside the
 * operator it writes. Text and images have no such mercy: their `y` is a baseline and a bottom-left
 * corner, so this file subtracts from the page height itself.
 *
 * **Determinism.** A PDF is a dictionary of dates and random tags, and criterion 1 wants the same
 * bytes twice. So the font's subset tag is derived from the content rather than drawn at random,
 * the trailer's `/ID` is set from a hash of what is actually on the page, and the two dates come
 * from the injected clock and nowhere else. `pdf-lib`'s own random number generator is seeded with
 * a constant, so nothing is left to chance.
 */

import fontkit from '@pdf-lib/fontkit'
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  degrees,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'
import { commandsToPath, layoutText } from '../drawing'
import type { MissingGlyph } from '../drawing'
import type { FlatOp } from './flatten'
import { baselineOffset } from './flatten'
import { PT_PER_MM } from './fit'
import { PRODUCT_NAME } from './strings'
import { xmpPacket, type Provenance } from './provenance'

/** One stored image, already downsampled to the size the sheet prints it at. */
export interface PdfImage {
  readonly bytes: Uint8Array
  readonly mediaType: string
}

/** What a PDF needs and nothing else. */
export interface PdfInput {
  readonly widthMm: number
  readonly heightMm: number
  readonly ops: readonly FlatOp[]
  readonly provenance: Provenance
  readonly fontBytes: Uint8Array
  /** Asset bytes by hash, for the Plan Image. */
  readonly images: ReadonlyMap<string, PdfImage>
  /** The content hash the `/ID` and the font subset tag are both derived from. */
  readonly contentHash: string
  /** The injected instant, as an ISO string; the only time in the file. */
  readonly when: string
}

/** Millimetres of paper to points. */
const pt = (mm: number): number => mm * PT_PER_MM

/** The six upper-case letters a font subset tag wants, from the content hash. */
function subsetTag(hash: string): string {
  const hex = hash.replace(/[^0-9a-f]/gi, '').padEnd(12, '0')
  let out = ''
  for (let index = 0; index < 6; index++) {
    out += String.fromCharCode(65 + (parseInt(hex.slice(index * 2, index * 2 + 2), 16) % 26))
  }
  return out
}

type Channel = { readonly r: number; readonly g: number; readonly b: number }

/** The colour a PDF draws with, or `null` for a paint that draws nothing. */
const inkOf = (rgba: Channel | null): Color | null => (rgba === null ? null : rgb(rgba.r, rgba.g, rgba.b))

/** One string cut into runs the embedded face has glyphs for, and runs it has none for. */
export type GlyphRun = { readonly text: string; readonly widthMm: number; readonly missing: boolean }

/**
 * A string as the runs an embedded Latin-1 face can draw.
 *
 * The bundled face covers Latin-1 and nothing else, so a label containing a house emoji has no
 * glyph for it in the subset either. `pdf-lib` would write `.notdef`, which most viewers paint as
 * nothing — and an invisible character is the one answer a reader cannot act on. So each character
 * the face has no glyph for becomes its own run, which the caller draws as a box, and the export
 * still completes (#61 criterion 11).
 */
export function splitByGlyph(text: string, sizeMm: number): GlyphRun[] {
  const runs: GlyphRun[] = []
  let buffer = ''
  let kind: boolean | null = null
  const flush = (): void => {
    if (kind === null || buffer.length === 0) return
    runs.push({ text: buffer, widthMm: kind ? 0 : layoutText(buffer, sizeMm).width, missing: kind })
    buffer = ''
  }
  for (const char of text) {
    const missing = layoutText(char, sizeMm).missing.length > 0
    if (kind !== null && kind !== missing) flush()
    kind = missing
    buffer += char
  }
  flush()
  return runs
}

/**
 * One text item, drawn run by run.
 *
 * The anchor is applied by shifting the run cursor by the laid-out width, because the width the
 * label was placed with is already on the item — measuring it again here would be a second answer
 * to a question the drawing already settled.
 */
function drawText(
  page: PDFPage,
  font: PDFFont,
  op: Extract<FlatOp, { kind: 'text' }>,
  pageHeightMm: number,
  missingGlyphs: MissingGlyph[],
): void {
  const colour = inkOf(op.fill)
  if (colour === null || op.text.length === 0) return
  const sizePt = pt(op.size)
  const baselineY = pt(pageHeightMm - (op.at.y + baselineOffset(op)))
  const shift = op.anchor === 'middle' ? op.width / 2 : op.anchor === 'end' ? op.width : 0
  const rotation = op.rotationDeg === 0 ? {} : { rotate: degrees(op.rotationDeg) }
  let cursor = op.at.x - shift
  for (const run of splitByGlyph(op.text, op.size)) {
    if (run.missing) {
      missingGlyphs.push({ ref: null, text: op.text, chars: [...run.text] })
      // A box about the width of the character it stands for, sitting on the baseline:
      // unmistakably a missing something, and about as wide as what should have been there.
      page.drawRectangle({
        x: pt(cursor),
        y: baselineY,
        width: sizePt * 0.6,
        height: sizePt * 0.52,
        borderColor: colour,
        borderWidth: Math.max(0.2, sizePt * 0.05),
        borderOpacity: op.opacity,
        ...rotation,
      })
      cursor += sizePt * 0.6 / PT_PER_MM
      continue
    }
    page.drawText(run.text, {
      x: pt(cursor),
      y: baselineY,
      size: sizePt,
      font,
      color: colour,
      opacity: op.opacity,
      ...rotation,
    })
    cursor += run.widthMm
  }
}

/** One path, drawn through `drawSvgPath`'s own flip. */
function drawPath(page: PDFPage, op: Extract<FlatOp, { kind: 'path' }>, pageHeightMm: number): void {
  const fill = inkOf(op.fill)
  const stroke = inkOf(op.stroke)
  const stroked = stroke !== null && op.strokeWidth > 0
  if (fill === null && !stroked) return
  page.drawSvgPath(commandsToPath(op.segments) + (op.closed ? ' Z' : ''), {
    x: 0,
    y: pt(pageHeightMm),
    ...(fill === null ? {} : { color: fill, opacity: op.opacity }),
    ...(stroked && stroke !== null
      ? { borderColor: stroke, borderWidth: pt(op.strokeWidth), borderOpacity: op.opacity }
      : {}),
    ...(op.dash.length === 0 || !stroked ? {} : { borderDashArray: op.dash.map(pt) }),
  })
}

/**
 * The Plan Image, placed.
 *
 * `pdf-lib` places an image axis-aligned: it writes the matrix itself and offers no rotation. A
 * Plan Image's matrix is a calibration — a scale and a translation — because a tracing underlay is
 * never rotated, so the axis-aligned box is the right answer today. A matrix that does carry
 * rotation is drawn at its bounding box rather than dropped: a straightened underlay beats a
 * missing one, and the drawing on top of it is unaffected.
 */
function drawImage(
  page: PDFPage,
  image: PDFImage,
  op: Extract<FlatOp, { kind: 'image' }>,
  pageHeightMm: number,
): void {
  const m = op.transform
  const corners = [
    { x: 0, y: 0 },
    { x: op.widthPx, y: 0 },
    { x: op.widthPx, y: op.heightPx },
    { x: 0, y: op.heightPx },
  ].map((corner) => ({ x: m.a * corner.x + m.c * corner.y + m.e, y: m.b * corner.x + m.d * corner.y + m.f }))
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  page.drawImage(image, {
    x: pt(left),
    y: pt(pageHeightMm - Math.max(...ys)),
    width: pt(Math.max(...xs) - left),
    height: pt(Math.max(...ys) - top),
    opacity: op.opacity,
  })
}

/**
 * The sheet as PDF bytes.
 *
 * Object streams are off: they save a few hundred bytes on a one-page sheet and make the file's
 * structure harder to assert on, and the golden test asserts the object count rather than the size.
 */
export async function writePdf(input: PdfInput): Promise<{ bytes: Uint8Array; missingGlyphs: MissingGlyph[] }> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(input.fontBytes, {
    subset: true,
    customName: `${subsetTag(input.contentHash)}+NotoSans`,
  })
  const page = doc.addPage([pt(input.widthMm), pt(input.heightMm)])

  const embedded = new Map<string, PDFImage>()
  for (const op of input.ops) {
    if (op.kind !== 'image' || embedded.has(op.assetHash)) continue
    const stored = input.images.get(op.assetHash)
    if (stored === undefined) continue
    embedded.set(
      op.assetHash,
      stored.mediaType === 'image/jpeg' ? await doc.embedJpg(stored.bytes) : await doc.embedPng(stored.bytes),
    )
  }

  const missingGlyphs: MissingGlyph[] = []
  for (const op of input.ops) {
    if (op.kind === 'path') drawPath(page, op, input.heightMm)
    else if (op.kind === 'text') drawText(page, font, op, input.heightMm, missingGlyphs)
    else if (op.kind === 'image') {
      const handle = embedded.get(op.assetHash)
      if (handle !== undefined) drawImage(page, handle, op, input.heightMm)
    }
  }

  const when = new Date(input.when)
  doc.setProducer(PRODUCT_NAME)
  doc.setCreator(PRODUCT_NAME)
  doc.setCreationDate(when)
  doc.setModificationDate(when)

  // The packet goes out as bytes, not as a string: pdf-lib encodes a string as PDFDocEncoding, which
  // has no room for the `·` a view name carries, and XMP is UTF-8 by its own specification.
  const metadata = doc.context.stream(new TextEncoder().encode(xmpPacket(input.provenance)), {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML'),
  })
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(metadata))

  // The trailer's `/ID` is the content and not the clock: two exports of the same drawing a second
  // apart are the same file, which is what makes it a hash worth comparing.
  const id = PDFArray.withContext(doc.context)
  const tag = input.contentHash.slice(0, 32)
  id.push(PDFHexString.of(tag))
  id.push(PDFHexString.of(tag))
  doc.context.trailerInfo.ID = id

  return { bytes: new Uint8Array(await doc.save({ useObjectStreams: false })), missingGlyphs }
}
