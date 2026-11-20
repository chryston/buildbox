/**
 * A sheet as a PNG (#61 §2).
 *
 * The painting happens here, in millimetres, into a surface `platform` made from an
 * `OffscreenCanvas`. Keeping the painter in `export` and the surface in `platform` is the split
 * that buys criterion 1's "byte-identical PNG within one engine": the same drawing code runs on
 * the main thread and in the Worker, so the only thing that can differ between them is the
 * encoder — which is the same browser, in the same tab, in the same process.
 *
 * Everything is painted through a transform of `pixelsPerMm`, so the geometry below is written in
 * millimetres of paper and never multiplies by a size. That is also what lets one 2048 px sheet and
 * one 4096 px sheet be the same picture rather than two.
 */

import type { DisplayList, PathCommand } from '../drawing'
import { baselineOffset, flatten, type FlatOp } from './flatten'
import type { RasterImage, RasterSurface } from './types'
import type { Sheet } from './fit'
import { PAPER } from './palette'
import { SHEET_SIZING } from './sheet'

/** The font stack a raster draws with — the same stack the SVG names. */
const FONT_STACK = '"Noto Sans", sans-serif'

const css = (rgba: { r: number; g: number; b: number; a: number } | null): string =>
  rgba === null
    ? 'rgba(0,0,0,0)'
    : `rgba(${Math.round(rgba.r * 255)},${Math.round(rgba.g * 255)},${Math.round(rgba.b * 255)},${round3(rgba.a)})`

const round3 = (value: number): number => Math.round(value * 1000) / 1000

const ALIGN: Record<string, string> = { start: 'left', middle: 'center', end: 'right' }

/**
 * An SVG arc as the ellipse a canvas draws.
 *
 * The display list spells arcs the way SVG does — endpoints, radii, two flags — because that is
 * what a path is made of. A canvas wants a centre and two angles, so the endpoint form is converted
 * here, with the radii scaled up rather than clamped: a radius too small for the two endpoints is
 * enlarged by the same rule SVG uses, so the curve is the one the path asked for.
 */
function arcToEllipse(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rxIn: number,
  ryIn: number,
  xRotDeg: number,
  largeArc: boolean,
  sweep: boolean,
): { cx: number; cy: number; rx: number; ry: number; rot: number; start: number; end: number; ccw: boolean } {
  const phi = (xRotDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from.x - to.x) / 2
  const dy = (from.y - to.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    const root = Math.sqrt(lambda)
    rx *= root
    ry *= root
  }
  const sign = largeArc === sweep ? -1 : 1
  const num = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const sq = Math.sqrt(Math.max(0, (rx * rx * ry * ry - num) / num))
  const cx1 = sign * sq * ((rx * y1) / ry)
  const cy1 = sign * sq * ((-ry * x1) / rx)
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
    const acos = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    return ux * vy - uy * vx < 0 ? -acos : acos
  }
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  const delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  return { cx, cy, rx, ry, rot: phi, start: theta1, end: theta1 + delta, ccw: !sweep }
}

/** One path, traced in millimetres of paper. */
function trace(ctx: RasterSurface, segments: readonly PathCommand[], closed: boolean): void {
  ctx.beginPath()
  let cursor = { x: 0, y: 0 }
  for (const cmd of segments) {
    switch (cmd.k) {
      case 'M':
        ctx.moveTo(cmd.to.x, cmd.to.y)
        cursor = cmd.to
        break
      case 'L':
        ctx.lineTo(cmd.to.x, cmd.to.y)
        cursor = cmd.to
        break
      case 'A': {
        const arc = arcToEllipse(cursor, cmd.to, cmd.r, cmd.r, 0, cmd.largeArc, cmd.sweep)
        ctx.ellipse(arc.cx, arc.cy, arc.rx, arc.ry, 0, arc.start, arc.end, arc.ccw)
        cursor = cmd.to
        break
      }
      case 'E': {
        const arc = arcToEllipse(cursor, cmd.to, cmd.rx, cmd.ry, cmd.xRotDeg, cmd.largeArc, cmd.sweep)
        ctx.ellipse(arc.cx, arc.cy, arc.rx, arc.ry, arc.rot, arc.start, arc.end, arc.ccw)
        cursor = cmd.to
        break
      }
    }
  }
  if (closed) ctx.closePath()
}

/** One op, painted. `k` is millimetres to pixels and is folded into the transform only. */
function paint(ctx: RasterSurface, op: FlatOp, k: number, images: ReadonlyMap<string, RasterImage>): void {
  if (op.kind === 'path') {
    ctx.save()
    ctx.globalAlpha = op.opacity
    trace(ctx, op.segments, op.closed)
    if (op.fill !== null) {
      ctx.fillStyle = css(op.fill)
      ctx.fill()
    }
    if (op.stroke !== null && op.strokeWidth > 0) {
      ctx.strokeStyle = css(op.stroke)
      ctx.lineWidth = op.strokeWidth
      ctx.setLineDash(op.dash)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.restore()
    return
  }
  if (op.kind === 'text') {
    if (op.fill === null || op.text.length === 0) return
    ctx.save()
    ctx.globalAlpha = op.opacity
    ctx.fillStyle = css(op.fill)
    ctx.font = `${op.size}px ${FONT_STACK}`
    ctx.textAlign = ALIGN[op.anchor] ?? 'left'
    // The baseline is always alphabetic and always offset by hand: `dominant-baseline` is a
    // browser's business, and the PDF places the same text with the same arithmetic.
    ctx.textBaseline = 'alphabetic'
    const y = op.at.y + baselineOffset(op)
    if (op.rotationDeg === 0) {
      ctx.fillText(op.text, op.at.x, y)
    } else {
      ctx.translate(op.at.x, op.at.y)
      ctx.rotate((op.rotationDeg * Math.PI) / 180)
      ctx.fillText(op.text, 0, y - op.at.y)
    }
    ctx.restore()
    return
  }
  const image = images.get(op.assetHash)
  if (image === undefined) return
  ctx.save()
  ctx.globalAlpha = op.opacity
  const m = op.transform
  ctx.setTransform(m.a * k, m.b * k, m.c * k, m.d * k, m.e * k, m.f * k)
  ctx.drawImage(image, 0, 0, op.widthPx, op.heightPx)
  ctx.restore()
}

/** The answer to a raster request: the bytes, or why there are none. */
export type PngWrite =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly pixels: { widthPx: number; heightPx: number } }
  | { readonly ok: false; readonly reason: 'no-surface' | 'no-encode' }

/**
 * The sheet, rasterized.
 *
 * The surface is filled with paper white first: a PNG with an alpha channel is a PNG whose empty
 * areas print as nothing, and a drawing sheet is not transparent.
 */
export async function writePng(
  sheet: Sheet,
  list: DisplayList,
  options: {
    pixelsPerMm: number
    rasterizer: { create(w: number, h: number): RasterSurface | null }
    images: ReadonlyMap<string, RasterImage>
  },
): Promise<PngWrite> {
  const widthPx = Math.max(1, Math.round(sheet.widthMm * options.pixelsPerMm))
  const heightPx = Math.max(1, Math.round(sheet.heightMm * options.pixelsPerMm))
  const ctx = options.rasterizer.create(widthPx, heightPx)
  if (ctx === null) return { ok: false, reason: 'no-surface' }
  const k = options.pixelsPerMm
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, sheet.widthMm, sheet.heightMm)
  for (const op of flatten(list, SHEET_SIZING)) paint(ctx, op, k, options.images)
  const bytes = await ctx.toBlob()
  if (bytes === null) return { ok: false, reason: 'no-encode' }
  return { ok: true, bytes, pixels: { widthPx, heightPx } }
}
