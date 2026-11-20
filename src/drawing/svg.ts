/**
 * A display list as an SVG tree, and that tree as bytes (#60 §6).
 *
 * Two steps rather than one string builder because the tree is what a test can read: the
 * attribute *order*, the absence of a broken `href`, the `:selected` row that emphasis picked
 * and the number format are all properties of the tree, and asserting them on a concatenated
 * string means asserting them with a regular expression. `serializeSvg` then does the one
 * thing a tree cannot do wrong — it writes what it is given, in the order it is given, with
 * no whitespace between siblings, so the same list serialises to the same bytes twice and a
 * Backup preview can be compared byte for byte.
 *
 * Everything measurable is resolved here and nowhere else: the emphasis suffix, the size
 * role, the `'item'` paint. The display list stays emphasis-free, which is what lets the Plan
 * View and the Item Detail share one list-building pass.
 */
import type { Affine } from '../derive'
import { mmText as n } from './format'
import { commandsToPath } from './path'
import { STYLES, resolveSize } from './styles'
import type {
  DisplayItem,
  DisplayList,
  Paint,
  PathCommand,
  Ref,
  Sizing,
  Style,
  StyleKey,
} from './types'

/** One element: its attributes in the order they are to be written, and its children. */
export type SvgNode = {
  tag: string
  attrs: [string, string][]
  children?: SvgNode[]
  text?: string
}

/**
 * Which entities the caller wants drawn differently.
 *
 * The display list itself never mentions emphasis: a drag or a hover changes what the caller
 * passes here, not the list, so a gesture repaints without deriving anything (#60).
 */
export type Emphasis = { selected?: ReadonlySet<string>; hovered?: string }

/**
 * What the caller knows that the list does not: which entities are emphasised, where an
 * image's bytes actually live, and how big a millimetre is on this surface.
 *
 * `sizing` is here rather than in the list because the same list is drawn on a screen and on
 * a sheet; `resolveAsset` returns `null` for an asset the host has not loaded, and an image
 * with nothing to show is left out of the tree entirely rather than written with a broken
 * `href`.
 */
export type SvgOptions = {
  sizing: Sizing
  includeRefs: boolean
  emphasis?: Emphasis
  resolveAsset: (hash: string) => string | null
}

/**
 * The `d` of one path, closed with `Z` only when the item says it is closed (#58 §8).
 *
 * The commands themselves are written by `path.ts`, which is also the thing that read them
 * out of a `ClosedPath`: one file owns the letters, this one owns the element they go on.
 */
const pathData = (segments: readonly PathCommand[], closed: boolean): string =>
  commandsToPath(segments) + (closed ? ' Z' : '')

/**
 * The item's own colour at a fraction of its alpha, as the eight-digit hex the Plan View
 * wrote by hand: `fill={color + '33'}` is `#47556933`, and that is what this returns for
 * `'#475569'` at 0x33/0xff.
 *
 * A colour that is not a hex literal comes back untouched. A `var(--bb-text)` cannot carry an
 * alpha suffix — `var(--bb-text)33` is not CSS — and inventing a `color-mix` for it would
 * change what the browser paints, which this module is not allowed to do.
 */
const withAlpha = (colour: string, alpha: number): string => {
  const hex = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(colour)
  if (hex === null) return colour
  const digits = hex[1]
  const six = digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits
  const clamped = Math.max(0, Math.min(1, alpha))
  return `#${six}${Math.round(clamped * 255).toString(16).padStart(2, '0')}`
}

/** One paint, with `'item'` read as the drawn thing's own colour. */
const paint = (
  value: Paint | undefined,
  color: string | undefined,
  alpha: number | undefined,
): string | undefined => {
  if (value === undefined) return undefined
  if (value !== 'item') return value
  if (color === undefined) return 'none'
  return alpha === undefined ? color : withAlpha(color, alpha)
}

/**
 * The style table read by an arbitrary string.
 *
 * The emphasis suffix is built at run time, so the key it produces is not one of the
 * `StyleKey`s the table is typed over — the suffix exists precisely so that a row can be
 * *absent*, which is how a caller says "this one does not change when it is selected".
 */
const EMPHASIS_ROWS: Readonly<Record<string, Style | undefined>> = STYLES

/** The row this item is drawn with, once the caller's emphasis is taken into account. */
function emphasised(
  key: StyleKey,
  ref: Ref | undefined,
  emphasis: SvgOptions['emphasis'],
): StyleKey {
  if (ref === undefined || emphasis === undefined) return key
  if (emphasis.selected?.has(ref.id) === true) {
    const row = `${key}:selected`
    if (EMPHASIS_ROWS[row] !== undefined) return row as StyleKey
  }
  if (emphasis.hovered !== undefined && emphasis.hovered === ref.id) {
    const row = `${key}:hovered`
    if (EMPHASIS_ROWS[row] !== undefined) return row as StyleKey
  }
  return key
}

/** The two hit-test attributes, or nothing at all when the caller does not want them. */
const refAttrs = (ref: Ref | undefined, includeRefs: boolean): [string, string][] =>
  ref === undefined || !includeRefs ? [] : [['data-ref', ref.id], ['data-ref-role', ref.role]]

/** The matrix without its scale, and the two scale factors that came out of it. */
function splitScale(m: Affine): { matrix: Affine; sx: number; sy: number } {
  const sx = Math.hypot(m.a, m.b) || 1
  const sy = Math.hypot(m.c, m.d) || 1
  return {
    matrix: { a: m.a / sx, b: m.b / sx, c: m.c / sy, d: m.d / sy, e: m.e, f: m.f },
    sx,
    sy,
  }
}

/** `matrix(a,b,c,d,e,f)`, with no spaces after the commas, as `derive/affine.ts` spells it. */
const matrixToSvg = (m: Affine): string =>
  `matrix(${n(m.a)},${n(m.b)},${n(m.c)},${n(m.d)},${n(m.e)},${n(m.f)})`

/** The dash, in millimetres: the two roles the style names, resolved side by side. */
const dashArray = (style: Style, sizing: Sizing): string | undefined => {
  if (style.dash === undefined) return undefined
  const [on, off] = style.dash
  return `${n(resolveSize(on, sizing).mm)} ${n(resolveSize(off, sizing).mm)}`
}

/**
 * The rectangle a closed four-corner path describes, or nothing when it is not one.
 *
 * SVG draws an axis-aligned `<rect>` through a fast path that lands its edges on whole device
 * pixels; the same box written as a `<path>` goes through analytic coverage antialiasing and
 * comes back with a lighter fringe down every side. Same shape, different picture — and the
 * cabinet's sections are hundreds of pixels of straight edge each, so the writer picks the
 * element the browser was built for. A rounded corner is an arc the builder baked into the
 * commands and stays a path; so does anything that is not square to the axes.
 */
function rectOf(
  segments: readonly PathCommand[],
  closed: boolean,
): { x: number; y: number; w: number; h: number } | null {
  if (!closed || segments.length !== 4) return null
  const [head, ...rest] = segments
  if (head === undefined || head.k !== 'M' || rest.some((each) => each.k !== 'L')) return null
  const corners = [head, ...rest].map((each) => each.to)
  const xs = [...new Set(corners.map((p) => p.x))]
  const ys = [...new Set(corners.map((p) => p.y))]
  if (xs.length !== 2 || ys.length !== 2) return null
  const [x, x2] = [Math.min(...xs), Math.max(...xs)] as [number, number]
  const [y, y2] = [Math.min(...ys), Math.max(...ys)] as [number, number]
  const w = x2 - x
  const h = y2 - y
  if (w <= 0 || h <= 0) return null
  // Two distinct x's and two distinct y's is not yet a rectangle: a parallelogram has those
  // too. Every corner has to sit on the box the extremes describe.
  if (!corners.every((p) => (p.x === x || p.x === x2) && (p.y === y || p.y === y2))) return null
  return { x, y, w, h }
}

function pathNode(item: Extract<DisplayItem, { kind: 'path' }>, o: SvgOptions, ref?: Ref): SvgNode {
  const style = STYLES[emphasised(item.style, ref, o.emphasis)]
  const rect = rectOf(item.segments, item.closed)
  const attrs: [string, string][] = [...refAttrs(item.ref, o.includeRefs)]
  if (rect !== null) attrs.push(['x', n(rect.x)], ['y', n(rect.y)], ['width', n(rect.w)], ['height', n(rect.h)])
  else attrs.push(['d', pathData(item.segments, item.closed)])
  const fill = paint(style.fill, item.color, style.fillAlpha)
  if (fill !== undefined) attrs.push(['fill', fill])
  // A stroke carries no alpha: only the fill was ever the item's colour at 0x33.
  const stroke = paint(style.stroke, item.color, undefined)
  if (stroke !== undefined) attrs.push(['stroke', stroke])
  if (style.strokeWidth !== undefined) {
    attrs.push(['stroke-width', n(resolveSize(style.strokeWidth, o.sizing).mm)])
  }
  const dash = dashArray(style, o.sizing)
  if (dash !== undefined) attrs.push(['stroke-dasharray', dash])
  if (style.opacity !== undefined) attrs.push(['opacity', n(style.opacity)])
  if (style.hit === 'none') attrs.push(['pointer-events', 'none'])
  // `corner` is deliberately unread here: a rounded corner is a radius the *builder* baked
  // into the commands, because a path's shape is one thing and its paint is another.
  return { tag: rect === null ? 'path' : 'rect', attrs }
}

function textNode(item: Extract<DisplayItem, { kind: 'text' }>, o: SvgOptions, ref?: Ref): SvgNode {
  const style = STYLES[emphasised(item.style, ref, o.emphasis)]
  if (style.size === undefined) {
    // A text row with no size is a bug in the table, not a thing a caller can recover from:
    // the alternative is a `<text>` the browser sizes from its own default, silently mislaid
    // against the box the label placer was given.
    throw new Error(`drawing: style "${item.style}" paints text but names no SIZE_ROLES row`)
  }
  const attrs: [string, string][] = [
    ...refAttrs(item.ref, o.includeRefs),
    ['x', n(item.at.x)],
    ['y', n(item.at.y)],
  ]
  if (style.fontFamily !== undefined) attrs.push(['font-family', style.fontFamily])
  if (style.fontWeight !== undefined) attrs.push(['font-weight', n(style.fontWeight)])
  attrs.push(['font-size', n(resolveSize(style.size, o.sizing).mm)])
  // `start` is SVG's own default, so it is left out rather than written on every label.
  if (item.anchor !== 'start') attrs.push(['text-anchor', item.anchor])
  if (item.baseline !== 'alphabetic') attrs.push(['dominant-baseline', item.baseline])
  const fill = paint(style.fill, item.color, style.fillAlpha)
  if (fill !== undefined) attrs.push(['fill', fill])
  if (item.decoration !== undefined) attrs.push(['text-decoration', item.decoration])
  const opacity = item.opacity ?? style.opacity
  if (opacity !== undefined) attrs.push(['opacity', n(opacity)])
  if (item.rotationDeg !== 0) {
    attrs.push(['transform', `rotate(${n(item.rotationDeg)}, ${n(item.at.x)}, ${n(item.at.y)})`])
  }
  if (style.hit === 'none') attrs.push(['pointer-events', 'none'])
  return { tag: 'text', attrs, text: item.text }
}

/**
 * The Plan Image, in millimetres.
 *
 * The item's `transform` maps the image's own pixel space into the drawing, so its width in
 * millimetres is `widthPx` through that matrix's scale — which is today's
 * `width={widthPx / pixelsPerMm}`. The scale is then normalised out of the emitted matrix,
 * because a width that already carries it must not be scaled a second time; what is left is
 * the rotation and the placement, which is what keeps the picture pixel-exact.
 */
function imageNode(item: Extract<DisplayItem, { kind: 'image' }>, o: SvgOptions): SvgNode | null {
  const href = o.resolveAsset(item.assetHash)
  if (href === null) return null
  const { matrix, sx, sy } = splitScale(item.transform)
  return {
    tag: 'image',
    attrs: [
      ...refAttrs(item.ref, o.includeRefs),
      ['href', href],
      ['x', '0'],
      ['y', '0'],
      ['width', n(item.widthPx * sx)],
      ['height', n(item.heightPx * sy)],
      ['transform', matrixToSvg(matrix)],
      ['preserveAspectRatio', 'none'],
      ['opacity', n(item.opacity)],
      // The Plan Image is a tracing reference laid under the drawing: the pointer has to
      // reach the footprints on top of it, and the canvas itself takes the pan.
      ['pointer-events', 'none'],
    ],
  }
}

function itemNode(item: DisplayItem, o: SvgOptions, inherited?: Ref): SvgNode | null {
  switch (item.kind) {
    case 'path':
      return pathNode(item, o, item.ref ?? inherited)
    case 'text':
      return textNode(item, o, item.ref ?? inherited)
    case 'image':
      return imageNode(item, o)
    case 'group': {
      // A group's `ref` is what its children stand for, so it is what an emphasis looks up —
      // the Placed Item's footprint is a `<path>` inside a `<g data-ref="p1">`, and the
      // selected outline has to thicken even though the path itself names nothing.
      const ref = item.ref ?? inherited
      const children = item.items
        .map((child) => itemNode(child, o, ref))
        .filter((child): child is SvgNode => child !== null)
      const attrs: [string, string][] = [...refAttrs(item.ref, o.includeRefs)]
      if (item.transform !== undefined) attrs.push(['transform', matrixToSvg(item.transform)])
      return { tag: 'g', attrs, children }
    }
  }
}

/**
 * The whole list as one `<svg>`: the root, then one `<g>` per layer in the list's own order.
 *
 * The `viewBox` is the list's `bounds` in millimetres, so the drawing carries its own
 * coordinate system and a caller that wants the Plan View's viewport matrix wraps the tree in
 * a group of its own rather than rewriting these numbers.
 */
export function toSvgTree(list: DisplayList, o: SvgOptions): SvgNode {
  const { x, y, w, h } = list.bounds
  return {
    tag: 'svg',
    attrs: [
      ['xmlns', 'http://www.w3.org/2000/svg'],
      ['viewBox', `${n(x)} ${n(y)} ${n(w)} ${n(h)}`],
    ],
    children: list.layers.map((layer) => ({
      tag: 'g',
      attrs: [['data-layer', layer.key]],
      children: layer.items
        .map((item) => itemNode(item, o))
        .filter((item): item is SvgNode => item !== null),
    })),
  }
}

/** The four characters an attribute value cannot contain. */
const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The three a text node cannot contain. */
const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The tree as bytes: attributes in the node's stored order, children with no whitespace
 * between them, and an element with neither children nor text written self-closing.
 *
 * No pretty-printing, on purpose: the output is compared byte for byte by #62's export test
 * and hashed into a Backup, and an indentation that depends on nesting depth is a difference
 * that means nothing.
 */
export function serializeSvg(node: SvgNode): string {
  const attrs = node.attrs.map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join('')
  if (node.text !== undefined) return `<${node.tag}${attrs}>${escapeText(node.text)}</${node.tag}>`
  if (node.children === undefined || node.children.length === 0) {
    return `<${node.tag}${attrs} />`
  }
  return `<${node.tag}${attrs}>${node.children.map(serializeSvg).join('')}</${node.tag}>`
}
