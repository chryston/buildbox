/**
 * The sheet, and whether a drawing fits on it (#61 §7).
 *
 * A sheet is millimetres of paper. The printable area is the page inside a margin, minus the
 * bands the title block and the footer need — and the *drawing* area is what `fitCheck` measures
 * against, because a drawing that fits the page but runs under the title block is a drawing that
 * did not fit. Criterion 12's 1:50 measurement is only true if the scale is applied to the
 * drawing area and nothing else.
 *
 * Nothing here reads a Project: `fitCheck` takes a `Rect` of model millimetres, which is what
 * makes it testable as a table and safe to call from the dialog on every keystroke.
 */

import type { Rect } from '../drawing'
import type { Orientation, PageSize, ScaleDenominator, ScaleSetting } from './types'

/** ISO 216: the short and long edge of each sheet we offer, in millimetres. */
export const PAGE_MM: Readonly<Record<PageSize, { readonly short: number; readonly long: number }>> = {
  A4: { short: 210, long: 297 },
  A3: { short: 297, long: 420 },
}

/** The margin every sheet leaves, so a printer's own registration never eats a label. */
export const MARGIN_MM = 10

/** The drawing sits this far inside the printed frame, so a rule never touches the art. */
export const FRAME_INSET_MM = 2

/** The band the fixed footer is centred in, at the bottom of the printable area. */
export const FOOTER_BAND_MM = 6

/** The band a title block occupies above the footer band. */
export const TITLE_BAND_MM = 30

/** The gap between the drawing area and the bands below it. */
export const BAND_GAP_MM = 3

/** The four scales the dialog lists, largest first: 1:10 is the biggest drawing. */
export const FIXED_SCALES: readonly ScaleDenominator[] = [10, 20, 50, 100]

/** PDF points in one millimetre. */
export const PT_PER_MM = 72 / 25.4

/** The most dots per inch a printed Plan Image may carry (#61 §2). */
export const PLAN_IMAGE_MAX_DPI = 300

/** The PNG long edges on offer, and the export contract's pixel cap read as 4096 × 4096. */
export const PNG_MAX_LONG_EDGE = 4096
export const PNG_MAX_PIXELS = 16_777_216

/** One sheet: the page, the drawing area, and where the furniture goes. */
export interface Sheet {
  readonly page: PageSize
  readonly orientation: Orientation
  readonly widthMm: number
  readonly heightMm: number
  /** Where a drawing may go. */
  readonly content: Rect
  /** Where the title block goes; `null` when the sheet has none (SVG and PNG without one). */
  readonly titleBlock: Rect | null
  /** The band the footer is centred in. */
  readonly footer: Rect
}

/** The page's own size held the given way. */
export function pageMm(page: PageSize, orientation: Orientation): { w: number; h: number } {
  const { short, long } = PAGE_MM[page]
  return orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short }
}

/**
 * The sheet for one page.
 *
 * The bands sit at the bottom, full width: a title block in a corner would leave the drawing
 * free to run behind it, and a scale that is true everywhere on the page is worth more than the
 * few millimetres a corner box would buy.
 */
export function sheetOf(
  page: PageSize,
  orientation: Orientation,
  options: { titleBlock: boolean },
): Sheet {
  const { w, h } = pageMm(page, orientation)
  const bands = (options.titleBlock ? TITLE_BAND_MM + BAND_GAP_MM : 0) + FOOTER_BAND_MM
  const inset = MARGIN_MM + FRAME_INSET_MM
  const content: Rect = {
    x: inset,
    y: inset,
    w: w - 2 * inset,
    h: h - 2 * inset - bands,
  }
  const titleBlock: Rect | null = options.titleBlock
    ? { x: inset, y: h - inset - TITLE_BAND_MM, w: w - 2 * inset, h: TITLE_BAND_MM }
    : null
  return {
    page,
    orientation,
    widthMm: w,
    heightMm: h,
    content,
    titleBlock,
    footer: { x: inset, y: h - inset - FOOTER_BAND_MM, w: w - 2 * inset, h: FOOTER_BAND_MM },
  }
}

/** The orientation the drawing itself prefers: whichever page holds it at the larger scale. */
export function autoOrientation(bounds: Rect, page: PageSize): Orientation {
  const portrait = fitDenominator(bounds, page, 'portrait')
  const landscape = fitDenominator(bounds, page, 'landscape')
  return landscape < portrait ? 'landscape' : 'portrait'
}

/** The smallest denominator that fits `bounds` in the drawing area — the largest scale that fits. */
export function fitDenominator(bounds: Rect, page: PageSize, orientation: Orientation): number {
  const sheet = sheetOf(page, orientation, { titleBlock: true })
  const byWidth = bounds.w / sheet.content.w
  const byHeight = bounds.h / sheet.content.h
  const least = Math.max(byWidth, byHeight, 1)
  // Rounded up to a tenth, so a denominator this function returns always truly fits.
  return Math.ceil(least * 10) / 10
}

/** One one-click fix for a drawing that does not fit. */
export interface FitSuggestion {
  readonly page: PageSize
  readonly orientation: Orientation
  readonly scale: ScaleSetting
}

/** The answer to `fitCheck`: does it fit, and what would. */
export interface FitResult {
  readonly fits: boolean
  readonly suggestions: readonly FitSuggestion[]
}

/**
 * Would this sheet hold this drawing at this scale?
 *
 * The predicate both `fitCheck` and {@link suggestionsFor} need. It is separate because the two
 * call each other in a circle otherwise: a check that does not fit asks for suggestions, and a
 * suggestion is found by checking.
 */
function holds(bounds: Rect, page: PageSize, orientation: Orientation, scale: ScaleSetting): boolean {
  // `fit` always fits — that is the whole point of it — unless the drawing has no extent at all,
  // which is the empty view's case and still exports.
  if (scale === 'fit') return true
  const sheet = sheetOf(page, orientation, { titleBlock: true })
  return bounds.w / scale <= sheet.content.w + 1e-9 && bounds.h / scale <= sheet.content.h + 1e-9
}

/**
 * Does this drawing fit, and if not, what would?
 *
 * A fixed scale answers honestly, and the suggestions are ordered so that the first one is the
 * smallest change: the same sheet and orientation at the largest scale that fits, then
 * `Fit to page`, then the other orientation, then the other sheet.
 */
export function fitCheck(
  bounds: Rect,
  page: PageSize,
  orientation: Orientation,
  scale: ScaleSetting,
): FitResult {
  if (holds(bounds, page, orientation, scale)) return { fits: true, suggestions: [] }
  return { fits: false, suggestions: suggestionsFor(bounds, page, orientation) }
}

/** Every combination that would hold this drawing, nearest fix first, capped at six. */
export function suggestionsFor(bounds: Rect, page: PageSize, orientation: Orientation): FitSuggestion[] {
  const other: Orientation = orientation === 'portrait' ? 'landscape' : 'portrait'
  const otherPage: PageSize = page === 'A4' ? 'A3' : 'A4'
  const order: readonly [PageSize, Orientation][] = [
    [page, orientation],
    [page, other],
    [otherPage, orientation],
    [otherPage, other],
  ]
  const found: FitSuggestion[] = []
  for (const [size, hold] of order) {
    for (const denominator of FIXED_SCALES) {
      if (holds(bounds, size, hold, denominator)) found.push({ page: size, orientation: hold, scale: denominator })
    }
    if (found.length === 0 || found[found.length - 1]?.page === size) found.push({ page: size, orientation: hold, scale: 'fit' })
    if (found.length >= 6) break
  }
  return found.slice(0, 6)
}

/**
 * The pixel size a Plan Image is printed at, capped at {@link PLAN_IMAGE_MAX_DPI}.
 *
 * The stored resolution is a ceiling, never a floor: an image already coarser than 300 dpi at
 * its printed size is embedded as it is, because inventing pixels would be the one way to make a
 * drawing lie about what was measured.
 */
export function downsampledSize(
  storedWidthPx: number,
  storedHeightPx: number,
  printedWidthMm: number,
  printedHeightMm: number,
): { widthPx: number; heightPx: number } {
  if (printedWidthMm <= 0 || printedHeightMm <= 0) return { widthPx: storedWidthPx, heightPx: storedHeightPx }
  const dpiX = storedWidthPx / (printedWidthMm / 25.4)
  const dpiY = storedHeightPx / (printedHeightMm / 25.4)
  const dpi = Math.max(dpiX, dpiY)
  if (dpi <= PLAN_IMAGE_MAX_DPI) return { widthPx: storedWidthPx, heightPx: storedHeightPx }
  const scale = PLAN_IMAGE_MAX_DPI / dpi
  return {
    widthPx: Math.max(1, Math.round(storedWidthPx * scale)),
    heightPx: Math.max(1, Math.round(storedHeightPx * scale)),
  }
}

/**
 * The pixel size of a PNG: the long edge the recipe asked for, inside the 16.7 MP cap.
 *
 * The cap wins over the long edge, because a sheet that cannot be allocated is a failure the
 * user can read, and a browser tab killed mid-export is not.
 */
export function pngSize(widthMm: number, heightMm: number, longEdge: number): { widthPx: number; heightPx: number } {
  const long = Math.max(widthMm, heightMm)
  if (long <= 0) return { widthPx: 1, heightPx: 1 }
  const perMm = longEdge / long
  let widthPx = Math.max(1, Math.round(widthMm * perMm))
  let heightPx = Math.max(1, Math.round(heightMm * perMm))
  if (widthPx === longEdge || heightPx === longEdge) {
    const pixels = widthPx * heightPx
    if (pixels > PNG_MAX_PIXELS) {
      const shrink = Math.sqrt(PNG_MAX_PIXELS / pixels)
      widthPx = Math.max(1, Math.floor(widthPx * shrink))
      heightPx = Math.max(1, Math.floor(heightPx * shrink))
    }
  }
  return { widthPx, heightPx }
}
