/**
 * Moving a display list into another frame (#61).
 *
 * `drawing` builds a list in the model's millimetres. A sheet is millimetres of paper, so the
 * list has to be mapped before it can be drawn — and the mapping has to reach inside every item,
 * because a `group`'s transform and an `image`'s calibration are both in the old frame.
 *
 * Only geometry is mapped. A stroke width and a text size are `SizeRole`s that the *writer*
 * resolves against the sheet, so scaling a list never thickens a line or shrinks a label: a 0.25
 * mm rule is 0.25 mm of ink at every scale, which is the whole reason a drawing at 1:50 is
 * legible.
 */

import { AFFINE_IDENTITY, affineApply, affineMultiply, affineTranslate } from '../derive'
import type { Affine, Pt, Rect } from '../derive'
import type { DisplayItem, DisplayLayer, DisplayList, PathCommand } from '../drawing'

/** The four corners of `rect`, mapped, as the box that holds them all. */
export function mapRect(m: Affine, rect: Rect): Rect {
  const corners: Pt[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const corner of corners) {
    const at = affineApply(m, corner)
    if (at.x < minX) minX = at.x
    if (at.y < minY) minY = at.y
    if (at.x > maxX) maxX = at.x
    if (at.y > maxY) maxY = at.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * A path command in the new frame.
 *
 * An arc's radius scales and its rotation does not; the flags survive untouched, because a
 * positive uniform scale turns a circle into a circle and keeps the sweep the same way round. A
 * negative scale would flip that, and nothing here scales negatively — a sheet is not a mirror.
 */
function mapCommand(m: Affine, cmd: PathCommand): PathCommand {
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

/** One item in the new frame. */
export function mapItem(m: Affine, item: DisplayItem): DisplayItem {
  switch (item.kind) {
    case 'path':
      return { ...item, segments: item.segments.map((cmd) => mapCommand(m, cmd)) }
    case 'text': {
      // The layout box is measured in the old frame; the writer draws glyphs at a size it
      // resolves itself, so only the box has to follow the geometry.
      const at = affineApply(m, item.at)
      return {
        ...item,
        at,
        layout: {
          width: item.layout.width * Math.hypot(m.a, m.c),
          ascent: item.layout.ascent * Math.hypot(m.b, m.d),
          descent: item.layout.descent * Math.hypot(m.b, m.d),
        },
      }
    }
    case 'image':
      return { ...item, transform: affineMultiply(m, item.transform) }
    case 'group':
      return {
        ...item,
        transform: item.transform === undefined ? m : affineMultiply(m, item.transform),
        items: item.items.map((child) => mapItem(AFFINE_IDENTITY, child)),
      }
  }
}

/** A whole list in the new frame, bounds included. */
export function mapList(m: Affine, list: DisplayList): DisplayList {
  return {
    space: list.space,
    bounds: mapRect(m, list.bounds),
    layers: mapLayers(m, list.layers),
    missingGlyphs: list.missingGlyphs,
  }
}

/** The bands of a list in the new frame. */
export function mapLayers(m: Affine, layers: readonly DisplayLayer[]): DisplayLayer[] {
  return layers.map((layer) => ({ key: layer.key, items: layer.items.map((item) => mapItem(m, item)) }))
}

/**
 * A list moved without being resized.
 *
 * The identity case of {@link mapList}, spelled out because centring a drawing on a sheet is by
 * far the most common thing done to one.
 */
export function translateList(dx: number, dy: number, list: DisplayList): DisplayList {
  if (dx === 0 && dy === 0) return list
  return mapList(affineTranslate(dx, dy), list)
}

