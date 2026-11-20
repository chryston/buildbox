/**
 * The sheet around the drawing (#61 §5).
 *
 * A title block, a footer, a frame, an optional scale bar and an optional grid — composed as
 * ordinary display-list items so that the SVG writer, the PDF writer and the rasterizer each draw
 * the same furniture without a second implementation. That is the whole reason this file returns
 * `DisplayItem[]` instead of writing bytes: criterion 13's "every PDF and every title-blocked
 * SVG/PNG carries the exact footer" is one code path, not three.
 *
 * Everything here is in millimetres of paper, the frame the whole sheet is in.
 */

import type { DisplayItem, LayerKey, PathCommand, SizeRole, StyleKey } from '../drawing'
import type { Pt, Rect } from '../derive'
import { layoutText, lineCommands, rectCommands, resolveSize } from '../drawing'
import type { Sheet } from './fit'
import { FOOTER_BAND_MM } from './fit'
import {
  DESIGN_OPTION,
  EXPORT_FOOTER,
  SCALE_BAR_LABEL,
  TITLE_BLOCK,
  pageStatement,
  unitStatement,
} from './strings'

/** The sheet is paper at one to one: the drawing arrived in millimetres of paper already. */
export const SHEET_SIZING = { kind: 'paper', scale: 1 } as const

/** One row of the title block: what the field is called, and what it says. */
export interface TitleBlockFields {
  readonly project: string
  /** `Floor` for a Plan View, `Item` for an Item Detail View. */
  readonly subjectLabel: string
  readonly subject: string
  readonly view: string
  /** `Scale 1:50`, or `Not to scale`. */
  readonly scale: string
  /** `Dimensions in mm`. */
  readonly unit: string
  readonly date: string
  readonly version: string
}

/** The unit statement for a display unit, as the title block prints it. */
export const unitRow = (unit: string): string => unitStatement(unit)

/** How big a role's ink is on this sheet. */
const ink = (role: SizeRole): number => resolveSize(role, SHEET_SIZING).mm

/** Text on the sheet, laid out with the same font metrics the drawing's labels used. */
function text(style: StyleKey, content: string, at: Pt, anchor: 'start' | 'middle' | 'end' = 'start'): DisplayItem {
  const role: SizeRole = style === 'sheet-title' ? 'sheet-title' : style === 'sheet-footer' ? 'sheet-footer' : 'sheet-label'
  const layout = layoutText(content, ink(role))
  return {
    kind: 'text',
    text: content,
    at,
    anchor,
    baseline: 'hanging',
    rotationDeg: 0,
    role: 'label',
    style,
    layout: { width: layout.width, ascent: layout.ascent, descent: layout.descent },
  }
}

const rule = (from: Pt, to: Pt): DisplayItem => ({
  kind: 'path',
  segments: lineCommands(from, to),
  closed: false,
  style: 'sheet-rule',
})

const path = (segments: PathCommand[], style: StyleKey): DisplayItem => ({
  kind: 'path',
  segments,
  closed: true,
  style,
})

/** The printed frame, one inset inside the margin. */
export function frameItems(sheet: Sheet): DisplayItem[] {
  const inset = sheet.content.x
  return [path(rectCommands(inset, inset, sheet.widthMm - 2 * inset, sheet.heightMm - 2 * inset), 'sheet-frame')]
}

/** The fixed footer, centred in its band. */
export function footerItems(sheet: Sheet): DisplayItem[] {
  const band = sheet.footer
  const at: Pt = { x: band.x + band.w / 2, y: band.y + (FOOTER_BAND_MM - ink('sheet-footer')) / 2 }
  return [text('sheet-footer', EXPORT_FOOTER, at, 'middle')]
}

const ROW_PITCH_MM = 7
const VALUE_OFFSET_MM = 3.4
const PAD_MM = 1.5

/** One `Label` over its value. */
function pair(label: string, value: string, at: Pt): DisplayItem[] {
  return [text('sheet-label', label, at), text('sheet-value', value, { x: at.x, y: at.y + VALUE_OFFSET_MM })]
}

/**
 * The title block.
 *
 * Three columns, each a stack of label-over-value pairs, with the Project name set larger above
 * them: the name is how a sheet is identified when it arrives in a pile, and the rest is read only
 * when the name is not enough. The rule above the block separates the drawing from the words about
 * it, which is the one job a title block's border has.
 *
 * No author and no logo (#61 §5). The BuildBox version is on the face and nowhere else, so a sheet
 * can be traced to the build that drew it without anyone opening the file in a reader.
 */
export function titleBlockItems(rect: Rect, fields: TitleBlockFields): DisplayItem[] {
  const left = rect.x + PAD_MM
  const top = rect.y + PAD_MM
  const row1 = top + 6.5
  const row2 = row1 + ROW_PITCH_MM
  const row3 = row2 + ROW_PITCH_MM
  const col2 = rect.x + rect.w * 0.34
  const col3 = rect.x + rect.w * 0.7
  return [
    rule({ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }),
    text('sheet-title', fields.project, { x: left, y: top }),
    ...pair(fields.subjectLabel, fields.subject, { x: left, y: row1 }),
    ...pair(TITLE_BLOCK.designOption, DESIGN_OPTION, { x: left, y: row2 }),
    ...pair(TITLE_BLOCK.view, fields.view, { x: col2, y: row1 }),
    ...pair(TITLE_BLOCK.scale, fields.scale, { x: col2, y: row2 }),
    text('sheet-value', fields.unit, { x: col2, y: row3 }),
    ...pair(TITLE_BLOCK.date, fields.date, { x: col3, y: row1 }),
    ...pair(TITLE_BLOCK.version, fields.version, { x: col3, y: row2 }),
    text('sheet-value', pageStatement(1, 1), { x: col3, y: row3 }),
  ]
}

/** One metre of the model, in millimetres of paper. */
export function metreOnPaper(denominator: number): number {
  return 1000 / denominator
}

/**
 * The scale bar: one metre of the model, drawn at the sheet's own scale.
 *
 * A printed scale statement is a promise a photocopier breaks; a printed bar survives the
 * photocopy, which is why every fixed-scale sheet carries one. Four quarters alternate filled and
 * clear so it reads at a glance and can be measured with a ruler — criterion 2 measures exactly
 * that, and `metreOnPaper` is the number it measures against.
 */
export function scaleBarItems(sheet: Sheet, denominator: number): DisplayItem[] {
  const lengthMm = metreOnPaper(denominator)
  const baseY = (sheet.titleBlock ?? sheet.footer).y - 4
  const right = sheet.content.x + sheet.content.w
  const left = right - lengthMm
  const height = 1.6
  const quarter = lengthMm / 4
  const items: DisplayItem[] = [
    text('sheet-scale', SCALE_BAR_LABEL, { x: left + lengthMm / 2, y: baseY - 4 }, 'middle'),
  ]
  for (let index = 0; index < 4; index++) {
    items.push(path(rectCommands(left + index * quarter, baseY, quarter, height), index % 2 === 0 ? 'sheet-rule' : 'sheet-frame'))
  }
  items.push(rule({ x: left, y: baseY + height }, { x: right, y: baseY + height }))
  return items
}

/** The model-space steps a grid may be drawn at, coarse to fine. */
const GRID_STEPS_MM = [10_000, 5000, 2000, 1000, 500, 200, 100] as const

/** The closest together two grid lines may be on paper and still be lines rather than a tone. */
const GRID_MIN_PAPER_MM = 5

/**
 * The optional model grid, off by default.
 *
 * The grid belongs to the model, not the sheet: a 1 m grid is 20 mm apart at 1:50 and 10 mm at
 * 1:20, so it says something true about the room at every scale. The step is the finest metric
 * step that still reads, and the lines are aligned to the model's zero, so a line that is a room's
 * wall in one drawing is the same line in the next whatever the drawing's bounds happen to be.
 */
export function gridItems(sheet: Sheet, modelBounds: Rect, denominator: number): DisplayItem[] {
  const step =
    GRID_STEPS_MM.find((candidate) => candidate / denominator >= GRID_MIN_PAPER_MM) ??
    GRID_STEPS_MM[GRID_STEPS_MM.length - 1]!
  const area = sheet.content
  const items: DisplayItem[] = []
  const lines = (origin: number, extent: number, axis: 'x' | 'y'): void => {
    const last = origin + extent
    for (let model = Math.ceil(origin / step) * step; model <= last; model += step) {
      const at = axis === 'x'
        ? area.x + (model - modelBounds.x) / denominator
        : area.y + (model - modelBounds.y) / denominator
      const from: Pt = axis === 'x' ? { x: at, y: area.y } : { x: area.x, y: at }
      const to: Pt = axis === 'x' ? { x: at, y: area.y + area.h } : { x: area.x + area.w, y: at }
      items.push({ kind: 'path', segments: lineCommands(from, to), closed: false, style: 'sheet-grid' })
    }
  }
  lines(modelBounds.x, modelBounds.w, 'x')
  lines(modelBounds.y, modelBounds.h, 'y')
  return items
}

/** The furniture as the layer a list ends with. */
export function furnitureLayer(items: readonly DisplayItem[]): { key: LayerKey; items: DisplayItem[] } {
  return { key: 'sheet-furniture', items: [...items] }
}
