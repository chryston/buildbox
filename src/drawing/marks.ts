/**
 * The Annotation glyphs (#81 §5).
 *
 * Five kinds of mark, all in the view's own millimetres and all pure: the Text, the Leader, the
 * Arrow, the Revision Cloud and the Reference Marker. Every word and every hairline is screen-fixed
 * through `SIZE_ROLES` — a note the size of a cabinet at zoom 0.05 is a note nobody can read — and
 * every glyph carries an invisible target beside it, because a one-pixel line is a hard thing to
 * click (#65 §11).
 *
 * What the record says and what the glyph needs are different questions: the caller resolves the
 * endpoint (an anchored one follows its subject, §5.2), fills the effective style from the Layer
 * (§1) and names the Marker's target view (§5.6). This module only draws the answer.
 */
import { layoutText, measureRect } from './font/layoutText'
import { lineCommands, roundedRectCommands } from './path'
import { resolveSize } from './styles'
import type { AnnotationMarkerShape, AnnotationSize, AnnotationType } from '../domain'
import type { Pt } from '../geometry'
import type { DisplayItem, DisplayList, LayerKey, PathCommand, Rect, Sizing, StyleKey } from './types'

/** The style as the glyph reads it: every field resolved, none optional. */
export interface MarkStyle {
  readonly size: AnnotationSize
  readonly colour: string
  /** 1, 2 or 3 — the bounded weights of §1. */
  readonly weight: number
  readonly dashed: boolean
  /** Leader and Arrow only. */
  readonly arrowhead: boolean
  /** Revision Cloud only. */
  readonly cloudTint: boolean
  /** Reference Marker only. */
  readonly markerShape: AnnotationMarkerShape
}

/** One mark with its place: the points it needs already resolved, in the view's millimetres. */
export interface MarkSubject {
  readonly id: string
  readonly type: AnnotationType
  /** The label's corner, the tail, the cloud's box corner or the Marker's centre. */
  readonly at: Pt
  readonly text: string
  /** Resolved endpoint — present exactly for a Leader or an Arrow. */
  readonly endpointAt: Pt | null
  /** The cloud's box — present exactly for a Revision Cloud whose position is a rect. */
  readonly rect: Rect | null
  /** A Marker's target view name, §5.6; `null` for every other type. */
  readonly targetLabel: string | null
  readonly style: MarkStyle
}

export interface MarkOptions {
  readonly sizing: Sizing
}

/** The band the glyphs land in, named once so the caller never repeats the literal. */
export const MARK_LAYER: LayerKey = 'plan-marks'

const union = (a: Rect | null, b: Rect): Rect =>
  a === null ? b : {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
    h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
  }

const textStyle = (size: AnnotationSize): StyleKey =>
  size === 'S' ? 'plan-mark-text-s' : size === 'L' ? 'plan-mark-text-l' : 'plan-mark-text-m'

const lineStyle = (style: MarkStyle): StyleKey => {
  const base = style.weight >= 3 ? 3 : style.weight >= 2 ? 2 : 1
  return (style.dashed ? `plan-mark-${base}-dashed` : `plan-mark-${base}`) as StyleKey
}

/** The font size the record's bounded size resolves to, in millimetres. */
export const markFontSize = (size: AnnotationSize, sizing: Sizing): number =>
  resolveSize(size === 'S' ? 'plan-mark-s' : size === 'L' ? 'plan-mark-l' : 'plan-mark-m', sizing).mm

/**
 * The text broken into a column: words wrap at the screen-fixed width, a hard newline starts a new
 * line, and a text too long for twelve lines ends with an ellipsis — a note that runs across the
 * Flat is a note that hides the Flat.
 */
export function wrapMarkText(text: string, fontSizeMm: number, wrapMm: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter((one) => one.length > 0)) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (line !== '' && layoutText(candidate, fontSizeMm).width > wrapMm) {
        out.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    out.push(line)
  }
  if (out.length <= 12) return out
  const kept = out.slice(0, 12)
  kept[11] = `${kept[11] ?? ''}…`
  return kept
}

/** The two barbs of an arrowhead at `tip`, pointing back along `from → tip`, as one path. */
function arrowhead(from: Pt, tip: Pt, length: number): PathCommand[] {
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const length0 = Math.hypot(dx, dy)
  if (length0 === 0) return []
  const ux = dx / length0
  const uy = dy / length0
  const barb = (sign: number): Pt => ({
    x: tip.x + (ux * Math.cos(sign * 0.5) - uy * Math.sin(sign * 0.5)) * -length,
    y: tip.y + (ux * Math.sin(sign * 0.5) + uy * Math.cos(sign * 0.5)) * -length,
  })
  return [
    { k: 'M', to: barb(1) },
    { k: 'L', to: tip },
    { k: 'L', to: barb(-1) },
  ]
}

/** The scalloped outline of a Revision Cloud: semicircular arcs bulging outward, walked clockwise. */
export function cloudCommands(rect: Rect, scallop: number): PathCommand[] {
  const { x, y, w, h } = rect
  const edges: { from: Pt; to: Pt }[] = [
    { from: { x, y }, to: { x: x + w, y } },
    { from: { x: x + w, y }, to: { x: x + w, y: y + h } },
    { from: { x: x + w, y: y + h }, to: { x, y: y + h } },
    { from: { x, y: y + h }, to: { x, y } },
  ]
  const out: PathCommand[] = []
  for (const edge of edges) {
    const length = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y)
    const steps = Math.max(2, Math.round(length / (2 * scallop)))
    for (let i = 0; i < steps; i += 1) {
      const t1 = (i + 1) / steps
      const to = {
        x: edge.from.x + (edge.to.x - edge.from.x) * t1,
        y: edge.from.y + (edge.to.y - edge.from.y) * t1,
      }
      if (i === 0) out.push({ k: 'M', to: edge.from })
      out.push({ k: 'A', to, r: (length / steps) / 2, largeArc: false, sweep: true })
    }
  }
  return out
}

/** The six points of a flat-topped hexagon around `at`. */
function hexagon(at: Pt, r: number): PathCommand[] {
  const points: PathCommand[] = []
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i
    const p = { x: at.x + r * Math.cos(angle), y: at.y + r * Math.sin(angle) }
    points.push({ k: i === 0 ? 'M' as const : 'L' as const, to: p })
  }
  return points
}

/** One line of the column, as the item the renderer will set the record's colour on. */
function textLine(line: string, at: Pt, style: MarkStyle, fontSize: number): DisplayItem {
  return {
    kind: 'text',
    text: line,
    at,
    anchor: 'start',
    baseline: 'hanging',
    rotationDeg: 0,
    role: 'label',
    style: textStyle(style.size),
    color: style.colour,
    layout: layoutText(line, fontSize),
  }
}

/** The wrapped column at `at`, and the box it covers — the words and their target in one pass. */
function textBlock(at: Pt, text: string, style: MarkStyle, sizing: Sizing): { items: DisplayItem[]; box: Rect | null } {
  if (text.length === 0) return { items: [], box: null }
  const fontSize = markFontSize(style.size, sizing)
  const lines = wrapMarkText(text, fontSize, resolveSize('plan-mark-wrap', sizing).mm)
  const items: DisplayItem[] = []
  let box: Rect | null = null
  lines.forEach((line, i) => {
    const lineAt = { x: at.x, y: at.y + i * fontSize * 1.3 }
    items.push(textLine(line, lineAt, style, fontSize))
    box = union(box, measureRect(layoutText(line, fontSize), lineAt, 'start'))
  })
  return { items, box }
}

const rectPath = (r: Rect): PathCommand[] => [
  { k: 'M', to: { x: r.x, y: r.y } },
  { k: 'L', to: { x: r.x + r.w, y: r.y } },
  { k: 'L', to: { x: r.x + r.w, y: r.y + r.h } },
  { k: 'L', to: { x: r.x, y: r.y + r.h } },
]

/** One glyph: the group the pointer owns, its invisible target and the record's colour on every part. */
function glyph(subject: MarkSubject, sizing: Sizing): { item: DisplayItem; box: Rect } | null {
  const style = subject.style
  const items: DisplayItem[] = []
  let box: Rect | null = null
  const line = lineStyle(style)

  if (subject.type === 'text') {
    const block = textBlock(subject.at, subject.text, style, sizing)
    items.push(...block.items)
    if (block.box !== null) {
      box = block.box
      items.push({ kind: 'path', segments: rectPath(block.box), closed: true, style: 'plan-mark-hit' })
    }
  } else if (subject.type === 'leader' || subject.type === 'arrow') {
    // Both run from the record's point to the resolved endpoint and point at the endpoint: the
    // Leader's point is its label, the Arrow's is its tail, and the words sit at the point either
    // way (§5.2: the label/tail stays where it was composed; the head follows the subject).
    const tail = subject.at
    const head = subject.endpointAt
    if (head === null) return null
    items.push({ kind: 'path', segments: lineCommands(tail, head), closed: false, style: line, color: style.colour })
    if (style.arrowhead) {
      items.push({
        kind: 'path',
        segments: arrowhead(tail, head, resolveSize('plan-mark-arrow', sizing).mm),
        closed: false,
        style: lineStyle({ ...style, dashed: false }),
        color: style.colour,
      })
    }
    const block = textBlock(subject.at, subject.text, style, sizing)
    items.push(...block.items)
    box = union(box, { x: Math.min(tail.x, head.x), y: Math.min(tail.y, head.y), w: Math.abs(head.x - tail.x), h: Math.abs(head.y - tail.y) })
    if (block.box !== null) box = union(box, block.box)
    if (box !== null) {
      // The target is the line itself stroked wide, not the box around it: the empty corner a
      // leader's bounding box sweeps belongs to whatever stands there (#81 §5).
      items.push({ kind: 'path', segments: lineCommands(tail, head), closed: false, style: 'plan-mark-hit-line' })
      if (block.box !== null) {
        items.push({ kind: 'path', segments: rectPath(block.box), closed: true, style: 'plan-mark-hit' })
      }
    }
  } else if (subject.type === 'revision_cloud') {
    const rect = subject.rect ?? {
      x: subject.at.x - resolveSize('plan-mark-wrap', sizing).mm,
      y: subject.at.y - markFontSize(style.size, sizing),
      w: resolveSize('plan-mark-wrap', sizing).mm * 2,
      h: markFontSize(style.size, sizing) * 3,
    }
    const outline = cloudCommands(rect, resolveSize('plan-mark-scallop', sizing).mm)
    if (style.cloudTint) items.push({ kind: 'path', segments: outline, closed: true, style: 'plan-mark-tint', color: style.colour })
    items.push({ kind: 'path', segments: outline, closed: true, style: line, color: style.colour })
    items.push({ kind: 'path', segments: outline, closed: true, style: 'plan-mark-hit' })
    const label = `△ ${subject.text}`
    const fontSize = markFontSize(style.size, sizing)
    const labelAt = { x: rect.x + rect.w, y: rect.y - fontSize * 0.4 }
    items.push({
      kind: 'text',
      text: label,
      at: labelAt,
      anchor: 'end',
      baseline: 'alphabetic',
      rotationDeg: 0,
      role: 'label',
      style: 'plan-mark-label',
      color: style.colour,
      layout: layoutText(label, fontSize),
    })
    box = union(rect, measureRect(layoutText(label, fontSize), labelAt, 'end'))
  } else {
    // The Reference Marker: the shape wears its label inside and points at its target beside it.
    const fontSize = markFontSize(style.size, sizing)
    const inner = layoutText(subject.text, fontSize)
    const r = Math.max(fontSize * 1.6, inner.width / 2 + fontSize * 0.5)
    const shape = style.markerShape === 'hexagon'
      ? hexagon(subject.at, r)
      : roundedRectCommands(subject.at.x - r, subject.at.y - r, 2 * r, 2 * r, r)
    items.push({ kind: 'path', segments: shape, closed: true, style: line, color: style.colour })
    items.push({ kind: 'path', segments: shape, closed: true, style: 'plan-mark-hit' })
    items.push({
      kind: 'text',
      text: subject.text,
      at: subject.at,
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'badge',
      style: textStyle(style.size),
      color: style.colour,
      layout: inner,
    })
    box = { x: subject.at.x - r, y: subject.at.y - r, w: 2 * r, h: 2 * r }
    if (subject.targetLabel !== null) {
      const label = `→ ${subject.targetLabel}`
      const labelAt = { x: subject.at.x + r + fontSize * 0.4, y: subject.at.y }
      items.push({
        kind: 'text',
        text: label,
        at: labelAt,
        anchor: 'start',
        baseline: 'middle',
        rotationDeg: 0,
        role: 'label',
        style: 'plan-mark-label',
        color: style.colour,
        layout: layoutText(label, fontSize),
      })
      box = union(box, measureRect(layoutText(label, fontSize), labelAt, 'start'))
    }
  }

  if (box === null) return null
  return { item: { kind: 'group', ref: { id: subject.id, role: 'mark' }, items }, box }
}

/**
 * The marks of one view, or `null` when there is nothing to show — `null` rather than an empty
 * list, as the Notes overlay does: a renderer should have nothing to draw rather than an empty
 * `<g>` to notice.
 */
export function drawMarks(subjects: readonly MarkSubject[], options: MarkOptions): DisplayList | null {
  const items: DisplayItem[] = []
  let bounds: Rect | null = null
  for (const subject of subjects) {
    const drawn = glyph(subject, options.sizing)
    if (drawn === null) continue
    items.push(drawn.item)
    bounds = union(bounds, drawn.box)
  }
  if (items.length === 0 || bounds === null) return null
  return { space: 'floor', bounds, layers: [{ key: MARK_LAYER, items }], missingGlyphs: [] }
}
