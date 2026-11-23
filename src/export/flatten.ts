/**
 * A display list as the two things a writer actually paints (#61).
 *
 * A display list is a tree: groups carry a matrix, styles carry role names, colours carry CSS
 * custom properties. A PDF page and a canvas both want a flat run of absolute shapes with real
 * numbers on them, and neither wants to be told what `plan-item` means. Flattening once here is
 * what keeps the PDF and the PNG the same picture — the alternative is two walkers that disagree
 * about how a group's matrix reaches a child, which is the kind of difference nobody notices until
 * a screenshot diff fails in one format only.
 *
 * The SVG writer does not use this. It hands the tree to `drawing`'s own serialiser, because a
 * tree is what SVG is.
 */

import type { Affine, Rect } from '../derive'
import { affineApply, affineMultiply } from '../derive'
import type { DisplayItem, DisplayList, PathCommand, Sizing, StyleKey, TextAnchor, TextBaseline } from '../drawing'
import { STYLES, rangeStyle, resolveSize, unionRect } from '../drawing'
import type { Rgba } from './palette'
import { colourToRgba, resolveColour } from './palette'

/** One shape, in the frame the sheet is in, with every number resolved. */
export type FlatOp =
  | {
      kind: 'path'
      segments: PathCommand[]
      closed: boolean
      fill: Rgba | null
      stroke: Rgba | null
      strokeWidth: number
      dash: number[]
      opacity: number
    }
  | {
      kind: 'text'
      text: string
      at: { x: number; y: number }
      anchor: TextAnchor
      baseline: TextBaseline
      rotationDeg: number
      size: number
      fill: Rgba | null
      opacity: number
      /** The metrics the list was laid out with, so a writer can place a baseline identically. */
      ascent: number
      descent: number
      width: number
    }
  | {
      kind: 'image'
      assetHash: string
      widthPx: number
      heightPx: number
      transform: Affine
      opacity: number
    }

/**
 * The baseline a `baseline` of `hanging` or `middle` means, in the sheet's own y-down frame.
 *
 * `dominant-baseline` is a browser's business and `y` in a PDF is a baseline, so the offset has to
 * be computed rather than asked for. The factors are the ones the font's own metrics imply — a
 * hanging baseline sits near the top of the em box, a middle one between the ascender and the
 * descender — and they are written down here once so the PDF and the PNG cannot drift.
 */
export function baselineOffset(item: { baseline: TextBaseline; ascent: number; descent: number }): number {
  if (item.baseline === 'alphabetic') return 0
  if (item.baseline === 'hanging') return item.ascent * 0.8
  return (item.ascent - item.descent) / 2
}

/** One paint from the style table, as numbers, with the item's own colour read if asked for. */
function paintOf(
  value: string | undefined,
  itemColour: string | undefined,
  alpha: number | undefined,
): Rgba | null {
  if (value === undefined) return null
  if (value !== 'item') return colourToRgba(resolveColour(value))
  if (itemColour === undefined) return null
  const rgba = colourToRgba(resolveColour(itemColour))
  if (rgba === null) return null
  return alpha === undefined ? rgba : { ...rgba, a: rgba.a * alpha }
}

/** The opacity that applies: an item's own, else the row's. */
const opacityOf = (itemOpacity: number | undefined, styleOpacity: number | undefined): number =>
  itemOpacity ?? styleOpacity ?? 1

function flattenItem(item: DisplayItem, m: Affine, sizing: Sizing, out: FlatOp[]): void {
  switch (item.kind) {
    case 'path': {
      // #74 §3: the same mark the SVG writer reads, so a sheet and a screen cannot disagree
      // about which cabinet the section plane is standing under.
      const style = rangeStyle(item.paint, STYLES[item.style as StyleKey], 'path')
      out.push({
        kind: 'path',
        segments: item.segments.map((cmd) => mapCommand(cmd, m)),
        closed: item.closed,
        fill: paintOf(style.fill, item.color, style.fillAlpha),
        stroke: paintOf(style.stroke, item.color, undefined),
        strokeWidth: style.strokeWidth === undefined ? 0 : resolveSize(style.strokeWidth, sizing).mm,
        dash: style.dash === undefined ? [] : style.dash.map((role) => resolveSize(role, sizing).mm),
        opacity: opacityOf(undefined, style.opacity),
      })
      return
    }
    case 'text': {
      const style = rangeStyle(item.paint, STYLES[item.style as StyleKey], 'text')
      if (style.size === undefined) {
        throw new Error(`export: style "${item.style}" paints text but names no SIZE_ROLES row`)
      }
      const at = affineApply(m, item.at)
      out.push({
        kind: 'text',
        text: item.text,
        at,
        anchor: item.anchor,
        baseline: item.baseline,
        rotationDeg: item.rotationDeg,
        size: resolveSize(style.size, sizing).mm,
        fill: paintOf(style.fill, item.color, style.fillAlpha),
        opacity: opacityOf(item.opacity, style.opacity),
        ascent: item.layout.ascent,
        descent: item.layout.descent,
        width: item.layout.width,
      })
      return
    }
    case 'image':
      out.push({
        kind: 'image',
        assetHash: item.assetHash,
        widthPx: item.widthPx,
        heightPx: item.heightPx,
        transform: affineMultiply(m, item.transform),
        opacity: item.opacity,
      })
      return
    case 'group': {
      const inner = item.transform === undefined ? m : affineMultiply(m, item.transform)
      for (const child of item.items) flattenItem(child, inner, sizing, out)
      return
    }
  }
}

/** A path command through a matrix, the same way `transform.ts` maps one. */
function mapCommand(cmd: PathCommand, m: Affine): PathCommand {
  switch (cmd.k) {
    case 'M':
    case 'L':
      return { k: cmd.k, to: affineApply(m, cmd.to) }
    case 'A':
      return {
        k: 'A',
        to: affineApply(m, cmd.to),
        r: cmd.r * Math.hypot(m.a, m.c),
        largeArc: cmd.largeArc,
        sweep: cmd.sweep,
      }
    case 'E':
      return {
        k: 'E',
        to: affineApply(m, cmd.to),
        rx: cmd.rx * Math.hypot(m.a, m.c),
        ry: cmd.ry * Math.hypot(m.b, m.d),
        xRotDeg: cmd.xRotDeg,
        largeArc: cmd.largeArc,
        sweep: cmd.sweep,
      }
  }
}

/**
 * The whole list, in paint order.
 *
 * Layers are walked in the list's own order, which is `LAYER_ORDER`'s order, which is the z-order
 * #60 fixed. A writer that sorted these again would be a second answer to a question already
 * answered.
 */
export function flatten(list: DisplayList, sizing: Sizing): FlatOp[] {
  const out: FlatOp[] = []
  for (const layer of list.layers) for (const item of layer.items) flattenItem(item, IDENTITY, sizing, out)
  return out
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** The box a run of ops covers, for the writers' own bounds checks. */
export function flatBounds(ops: readonly FlatOp[]): Rect | null {
  let box: Rect | null = null
  const add = (rect: Rect): void => {
    box = box === null ? rect : unionRect(box, rect)
  }
  for (const op of ops) {
    if (op.kind === 'image') {
      add(cornersRect(op.transform, op.widthPx, op.heightPx))
    } else if (op.kind === 'text') {
      add({ x: op.at.x, y: op.at.y - op.ascent, w: op.width, h: op.ascent + op.descent })
    } else {
      const points = op.segments.flatMap((cmd) => (cmd.k === 'A' || cmd.k === 'E' || cmd.k === 'M' || cmd.k === 'L' ? [cmd.to] : []))
      if (points.length === 0) continue
      const xs = points.map((p) => p.x)
      const ys = points.map((p) => p.y)
      add({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) })
    }
  }
  return box
}

/** The four corners of a `widthPx × heightPx` image through its matrix. */
export function cornersRect(transform: Affine, widthPx: number, heightPx: number): Rect {
  const corners = [
    { x: 0, y: 0 },
    { x: widthPx, y: 0 },
    { x: widthPx, y: heightPx },
    { x: 0, y: heightPx },
  ].map((corner) => affineApply(transform, corner))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

/** The smallest box holding both is `drawing`'s `unionRect`, used here and not re-declared. */
