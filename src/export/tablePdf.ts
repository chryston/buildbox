/**
 * The printed table (#84 §3).
 *
 * One `TableModel` becomes as many pages of the same PDF writer a drawing uses: the same embedded
 * subset of Noto Sans, the same metadata packet, the same content-hash `/ID`, the same boxes where a
 * character the face has no glyph for sits. Nothing about a row is recomputed here — the rows arrive
 * already printed, and this file only decides where on the paper each one goes.
 *
 * The layout is a column-width problem and a pagination problem, in that order:
 *
 * 1. every column wants the width of its widest cell, and a measured column may not be wrapped at
 *    all, because `240.0` split over two lines is a number nobody can read;
 * 2. when the columns do not fit the tall page, the page turns;
 * 3. when they still do not fit, the word columns shrink to the width of their longest word and wrap,
 *    and only a word longer than its own column is broken mid-word.
 *
 * A row is never split, because a row is one thing in the room. The one exception is a row taller
 * than the page body — a Comment body of forty lines — which continues on the next page and says so
 * in its first cell.
 */
import { layoutText } from '../drawing'
import type { MissingGlyph } from '../drawing'
import type { Pt } from '../derive'
import { sha256Hex } from '../lib'
import { FOOTER_BAND_MM, MARGIN_MM, pageMm } from './fit'
import type { FlatOp } from './flatten'
import { writePdf } from './pdf'
import type { PdfSheet } from './pdf'
import type { Provenance } from './provenance'
import { provenanceForHash } from './provenance'
import {
  CONTINUED,
  EXPORT_FOOTER,
  SCOPE_TITLE_LABEL,
  TABLE_NAMES,
  TABLE_TITLE_LABEL,
  TITLE_BLOCK,
  ZERO_ROWS,
  unitStatement,
} from './strings'
import type { TableModel } from './tableModel'
import type { ExportClock, Orientation, PageSize } from './types'

/** Every sheet leaves this much paper, the same margin a drawing leaves. */
const MARGIN = MARGIN_MM

/** The printed body text. 2.5 mm is the size a drawing prints its values at, and a table is values. */
const BODY_SIZE = 2.5
/** The title block's own lines: the table's name, then the smaller lines under it. */
const TITLE_SIZE = 4
const LABEL_SIZE = 2.5
const FOOTER_SIZE = 2

/** A cell's text sits this far from its column's edges, so two columns never touch. */
const PAD_X = 1.2
/** And this far from the row's top and bottom. */
const PAD_Y = 0.9
/** Leading, as a multiple of the size: enough for a `g` under a `b` without the two touching. */
const LEAD = 1.32

/** The narrowest a column may be pushed. Below this a header is unreadable whatever wraps. */
const MIN_COLUMN = 8

/** The title block's height: the table's name, the scope in plain words, and one line of facts. */
const TITLE_BAND = 26
/** The gap between the title block and the first header row. */
const TITLE_GAP = 4

const INK = { r: 0, g: 0, b: 0, a: 1 }
const GREY = { r: 0.42, g: 0.42, b: 0.42, a: 1 }

/** What the renderer needs and nothing else. */
export interface TablePdfInput {
  readonly model: TableModel
  /** The plain-words scope statement, which is the reader's answer to "which rows are these?". */
  readonly scopeStatement: string
  readonly provenance: Provenance
  readonly fontBytes: Uint8Array
  readonly pageSize: PageSize
  readonly clock: ExportClock
}

const line = (from: Pt, to: Pt): FlatOp => ({
  kind: 'path',
  segments: [{ k: 'M', to: from }, { k: 'L', to: to }],
  closed: false,
  fill: null,
  stroke: INK,
  strokeWidth: 0.2,
  dash: [],
  opacity: 1,
})

const text = (
  value: string,
  at: Pt,
  size: number,
  anchor: 'start' | 'middle' | 'end',
  fill: typeof INK,
): FlatOp => {
  const layout = layoutText(value, size)
  return {
    kind: 'text',
    text: value,
    at,
    anchor,
    baseline: 'hanging',
    rotationDeg: 0,
    size,
    fill,
    opacity: 1,
    ascent: layout.ascent,
    descent: layout.descent,
    width: layout.width,
  }
}

/** One cell's text, cut to the lines its column allows: hard breaks first, then words, then characters. */
function wrap(value: string, width: number): string[] {
  if (value.length === 0) return ['']
  const lines: string[] = []
  for (const paragraph of value.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    const emit = (): void => {
      if (current.length > 0) lines.push(current)
      current = ''
    }
    for (const word of paragraph.split(' ')) {
      const candidate = current.length === 0 ? word : `${current} ${word}`
      if (layoutText(candidate, BODY_SIZE).width <= width || current.length === 0) {
        // A first word too long for its column is the only case a word gets broken: the alternative
        // is a column that silently grows past the page.
        current = candidate
        while (layoutText(current, BODY_SIZE).width > width && current.length > 1) {
          let cut = current.length
          while (cut > 1 && layoutText(current.slice(0, cut), BODY_SIZE).width > width) cut -= 1
          lines.push(current.slice(0, cut))
          current = current.slice(cut)
        }
        continue
      }
      emit()
      current = word
    }
    emit()
  }
  return lines.length === 0 ? [''] : lines
}

/** What a column wants, what it can be squeezed to, and the lines each cell wraps into. */
interface ColumnLayout {
  readonly want: number
  readonly floor: number
  /** The wrapped lines of every row's cell, filled in once the width is settled. */
  cells: string[][]
  width: number
}

const cellWidth = (value: string): number => layoutText(value, BODY_SIZE).width

/** The widest word a cell contains, which is how far a text column may be squeezed. */
function longestWord(value: string): number {
  let widest = 0
  for (const paragraph of value.split('\n')) {
    for (const word of paragraph.split(' ')) widest = Math.max(widest, cellWidth(word))
  }
  return widest
}

/**
 * The column widths for one page width.
 *
 * Measured columns keep the width of their widest value; word columns share whatever the measured
 * ones leave, in proportion to what they asked for, and never below their longest word.
 */
function widthsOf(model: TableModel, available: number): ColumnLayout[] {
  const layout: ColumnLayout[] = model.columns.map((column, at) => {
    let want = cellWidth(column.label)
    let floor = column.numeric ? 0 : longestWord(column.label)
    for (const row of model.rows) {
      const cell = row[at] ?? ''
      want = Math.max(want, cellWidth(cell))
      if (!column.numeric) floor = Math.max(floor, longestWord(cell))
    }
    return {
      want: want + 2 * PAD_X,
      floor: Math.max(MIN_COLUMN, Math.min(column.numeric ? want + 2 * PAD_X : floor + 2 * PAD_X, want + 2 * PAD_X)),
      cells: [],
      width: 0,
    }
  })
  const fixed = layout.reduce((sum, at, index) => (model.columns[index]!.numeric ? sum + at.want : sum), 0)
  const flexible = layout.filter((_, index) => !model.columns[index]!.numeric)
  const wanted = layout.reduce((sum, at) => sum + at.want, 0)
  if (wanted <= available) {
    layout.forEach((at, index) => {
      at.width = at.want
      void index
    })
  } else {
    const left = available - fixed
    const asked = flexible.reduce((sum, at) => sum + at.want, 0)
    const floors = flexible.reduce((sum, at) => sum + at.floor, 0)
    const room = Math.max(floors, left)
    for (const at of flexible) {
      const share = asked === 0 ? at.floor : (at.want / asked) * room
      at.width = Math.max(at.floor, Math.min(at.want, share))
    }
    for (const [index, at] of layout.entries()) if (model.columns[index]!.numeric) at.width = at.want
  }
  for (const [index, at] of layout.entries()) at.cells = model.rows.map((row) => wrap(row[index] ?? '', at.width - 2 * PAD_X))
  return layout
}

const rowHeight = (layout: ColumnLayout[], rowIndex: number): number =>
  LEAD * BODY_SIZE * Math.max(1, ...layout.map((at) => at.cells[rowIndex]?.length ?? 1)) + 2 * PAD_Y

/** One page's worth of rows: the ones drawn whole, and the over-tall row continued here. */
interface PagePlan {
  readonly rows: number[]
  split: { readonly row: number; readonly from: number; readonly lines: number } | null
}

const maxLines = (layout: ColumnLayout[], rowIndex: number): number =>
  Math.max(1, ...layout.map((at) => at.cells[rowIndex]?.length ?? 1))

/** The rows that fit on each page. A row moves whole; only a row taller than a body is cut. */
function planPages(model: TableModel, layout: ColumnLayout[], bodyHeight: number): PagePlan[] {
  const header = LEAD * BODY_SIZE + 2 * PAD_Y
  const lineHeight = LEAD * BODY_SIZE
  const pages: PagePlan[] = []
  let page: PagePlan = { rows: [], split: null }
  let used = 0
  let row = 0
  /** The lines of the row being split that earlier pages already carry. */
  let drawn = 0
  while (row < model.rows.length) {
    const height = rowHeight(layout, row)
    if (height <= bodyHeight - header - used) {
      page.rows.push(row)
      used += height
      row += 1
      continue
    }
    if (height > bodyHeight - header) {
      // The row is taller than a whole page body — a Comment body of forty lines. It is the one row
      // that gets cut, and the page it lands on says so.
      const lines = maxLines(layout, row)
      const fits = Math.max(1, Math.floor((bodyHeight - header - 2 * PAD_Y) / lineHeight))
      const take = Math.min(fits, lines - drawn)
      page.split = { row, from: drawn, lines: take }
      pages.push(page)
      page = { rows: [], split: null }
      used = 0
      if (drawn + take >= lines) {
        drawn = 0
        row += 1
      } else {
        drawn += take
      }
      continue
    }
    pages.push(page)
    page = { rows: [], split: null }
    used = 0
  }
  if (page.rows.length > 0 || page.split !== null || pages.length === 0) pages.push(page)
  return pages
}

export interface TablePdfResult {
  readonly bytes: Uint8Array
  readonly missingGlyphs: readonly MissingGlyph[]
}

/**
 * The table as PDF bytes.
 *
 * Two passes: the first settles the paper, the columns and where each page ends, the second writes
 * the operations. The content hash is taken over the operations and the metadata together, so the
 * `/ID` changes when any printed value changes and changes when nothing printed does not.
 */
export function tableSheets(input: TablePdfInput): PdfSheet[] {
  const { model } = input
  const portrait = pageMm(input.pageSize, 'portrait')
  const landscape = pageMm(input.pageSize, 'landscape')
  const textOf = (paper: { w: number; h: number }): number => paper.w - 2 * MARGIN
  const layoutPortrait = widthsOf(model, textOf(portrait))
  const tooWide = (layout: ColumnLayout[]): number => layout.reduce((sum, at) => sum + at.width, 0)
  const orientation: Orientation = tooWide(layoutPortrait) > textOf(portrait) ? 'landscape' : 'portrait'
  const paper = orientation === 'portrait' ? portrait : landscape
  const layout = orientation === 'portrait' ? layoutPortrait : widthsOf(model, textOf(paper))
  const bodyTop = MARGIN + TITLE_BAND + TITLE_GAP
  const bodyBottom = paper.h - MARGIN - FOOTER_BAND_MM
  const headerHeight = LEAD * BODY_SIZE + 2 * PAD_Y
  const plans = planPages(model, layout, bodyBottom - bodyTop - headerHeight)
  const total = plans.length

  const columnX: number[] = []
  let cursor = MARGIN
  for (const at of layout) {
    columnX.push(cursor)
    cursor += at.width
  }

  const sheets = plans.map((plan, pageNumber): { widthMm: number; heightMm: number; ops: FlatOp[] } => {
    const ops: FlatOp[] = []
    // The title block, on every page: a page that has left its siblings behind still says what it is.
    ops.push(text(`${TABLE_TITLE_LABEL}: ${TABLE_NAMES[model.table]}`, { x: MARGIN, y: MARGIN }, TITLE_SIZE, 'start', INK))
    ops.push(text(`${SCOPE_TITLE_LABEL}: ${input.scopeStatement}`, { x: MARGIN, y: MARGIN + 7 }, LABEL_SIZE, 'start', INK))
    const facts = [
      `${TITLE_BLOCK.version} ${input.provenance.buildbox_version}`,
      unitStatement(model.unit),
      input.clock.localDate(),
      `${TITLE_BLOCK.page} ${pageNumber + 1}/${total}`,
    ].join('  ·  ')
    ops.push(text(facts, { x: MARGIN, y: MARGIN + 13 }, LABEL_SIZE, 'start', GREY))
    ops.push(line({ x: MARGIN, y: MARGIN + TITLE_BAND - 2 }, { x: paper.w - MARGIN, y: MARGIN + TITLE_BAND - 2 }))

    // The header row, repeated: a reader three pages into the Register is still entitled to know
    // which column is which.
    let y = bodyTop
    for (const [index, column] of model.columns.entries()) {
      const width = layout[index]!.width
      const x = columnX[index]!
      ops.push(
        text(column.label, { x: x + (column.numeric ? width - PAD_X : PAD_X), y: y + PAD_Y }, BODY_SIZE,
          column.numeric ? 'end' : 'start', INK),
      )
    }
    y += headerHeight
    ops.push(line({ x: MARGIN, y: y - PAD_Y }, { x: paper.w - MARGIN, y: y - PAD_Y }))

    if (model.rows.length === 0 && pageNumber === 0) {
      ops.push(text(ZERO_ROWS, { x: MARGIN + PAD_X, y: y + PAD_Y }, BODY_SIZE, 'start', GREY))
    }

    for (const row of plan.rows) {
      drawRow(ops, layout, columnX, model, row, y, 0, null)
      y += rowHeight(layout, row)
      ops.push(line({ x: MARGIN, y: y - PAD_Y }, { x: paper.w - MARGIN, y: y - PAD_Y }))
    }
    if (plan.split !== null) {
      drawRow(ops, layout, columnX, model, plan.split.row, y, plan.split.from, plan.split.lines)
      y += LEAD * BODY_SIZE * plan.split.lines + 2 * PAD_Y
      ops.push(line({ x: MARGIN, y: y - PAD_Y }, { x: paper.w - MARGIN, y: y - PAD_Y }))
    }

    ops.push(text(EXPORT_FOOTER, { x: paper.w / 2, y: paper.h - MARGIN - FOOTER_BAND_MM + 2 }, FOOTER_SIZE, 'middle', GREY))
    return { widthMm: paper.w, heightMm: paper.h, ops }
  })
  return sheets
}

/**
 * The table as PDF bytes.
 *
 * The layout is `tableSheets`; this asks the drawing's own writer to put those pages in a file, and
 * takes the `/ID` from the metadata line and the operations together, so it changes when any printed
 * value changes and does not change when nothing printed has.
 */
export async function writeTablePdf(input: TablePdfInput): Promise<TablePdfResult> {
  const sheets = tableSheets(input)
  const geometry = JSON.stringify(sheets, (_key, value: unknown) =>
    typeof value === 'number' ? Math.round(value * 1000) / 1000 : value,
  )
  const contentHash = await sha256Hex(
    new TextEncoder().encode(`${provenanceForHash(input.provenance)}\n${geometry}`),
  )
  const pdf = await writePdf({
    pages: sheets,
    provenance: input.provenance,
    fontBytes: input.fontBytes,
    images: new Map(),
    contentHash,
    when: input.clock.now(),
  })
  return { bytes: pdf.bytes, missingGlyphs: pdf.missingGlyphs }
}

/** One row's cells, from line `from` of each cell, `lines` of them, with the continuation marker. */
function drawRow(
  ops: FlatOp[],
  layout: ColumnLayout[],
  columnX: number[],
  model: TableModel,
  row: number,
  y: number,
  from: number,
  lines: number | null,
): void {
  for (const [index, column] of model.columns.entries()) {
    const width = layout[index]!.width
    const all = layout[index]!.cells[row] ?? ['']
    const shown = lines === null ? all.slice(from) : all.slice(from, from + lines)
    // A column shorter than the row's tallest has no line inside this window — but the first column of
    // a continued row still has to say the row continues, so the window is never left empty.
    const printed = shown.length > 0 ? shown : ['']
    const x = columnX[index]!
    const first = index === 0
    printed.forEach((lineText, lineIndex) => {
      const value = first && lineIndex === 0 && from > 0 ? `${lineText} ${CONTINUED}` : lineText
      ops.push(
        text(value, { x: x + (column.numeric ? width - PAD_X : PAD_X), y: y + PAD_Y + lineIndex * LEAD * BODY_SIZE },
          BODY_SIZE, column.numeric ? 'end' : 'start', INK),
      )
    })
  }
}
