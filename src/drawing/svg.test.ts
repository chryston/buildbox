/**
 * The display list as an SVG tree, and as bytes (#60 §6).
 *
 * What is asserted here is what a golden file cannot forgive: the attribute *order* (a
 * re-render that reorders attributes is a diff that means nothing), the number format (one
 * broken `-0` or one `1e-7` changes every byte of an export), which row emphasis picked, and
 * the one case that used to draw a broken image — an asset the host has not loaded, which
 * must be absent rather than present with an empty `href`.
 */
import { describe, expect, it } from 'vitest'
import { affineScale, affineTranslate, affineMultiply } from '../derive'
import type { Pt } from '../geometry'
import { rectCommands } from './path'
import { FONT_STACK } from './styles'
import { serializeSvg, toSvgTree } from './svg'
import type { SvgOptions } from './svg'
import type { DisplayItem, DisplayList, Rect } from './types'

/** The screen surface every test draws for: one pixel to the millimetre, refs written. */
const screen = (over: Partial<SvgOptions> = {}): SvgOptions => ({
  sizing: { kind: 'screen', pxPerMm: 1 },
  includeRefs: true,
  resolveAsset: () => 'blob:plan',
  ...over,
})

/** A one-layer list, so a test can read `children[0].children[0]` and know what it is. */
const listOf = (items: DisplayItem[], bounds?: Rect): DisplayList => ({
  space: 'floor',
  bounds: bounds ?? { x: 0, y: 0, w: 100, h: 50 },
  layers: [{ key: 'placed-items', items }],
  missingGlyphs: [],
})

const box = rectCommands(0, 0, 10, 10)

const pathItem = (over: Partial<Extract<DisplayItem, { kind: 'path' }>> = {}): DisplayItem => ({
  kind: 'path',
  ref: { id: 'p1', role: 'placement' },
  segments: box,
  closed: true,
  style: 'plan-item',
  color: '#475569',
  ...over,
})

const textItem = (over: Partial<Extract<DisplayItem, { kind: 'text' }>> = {}): DisplayItem => ({
  kind: 'text',
  text: 'Wardrobe',
  at: { x: 20, y: 30 },
  anchor: 'middle',
  baseline: 'middle',
  rotationDeg: 0,
  role: 'label',
  style: 'plan-label',
  color: '#475569',
  layout: { width: 12, ascent: 2, descent: 1 },
  ...over,
})

const imageItem = (over: Partial<Extract<DisplayItem, { kind: 'image' }>> = {}): DisplayItem => ({
  kind: 'image',
  assetHash: 'b'.repeat(64),
  widthPx: 1000,
  heightPx: 500,
  transform: affineScale(0.5, 0.5),
  opacity: 0.9,
  ...over,
})

/** The attributes of the first drawn node of the first layer. */
const firstAttrs = (list: DisplayList, o: SvgOptions): [string, string][] => {
  const tree = toSvgTree(list, o)
  const layer = tree.children?.[0]
  const node = layer?.children?.[0]
  expect(node).toBeDefined()
  return node?.attrs ?? []
}

const attr = (attrs: [string, string][], name: string): string | undefined =>
  attrs.find(([key]) => key === name)?.[1]

/** The canonical order, so a test can assert "these keys, in this order" without a regex. */
const orderedAs = (keys: string[], canonical: readonly string[]): void => {
  expect(keys).toEqual(canonical.filter((key) => keys.includes(key)))
}

const PATH_ATTRS = [
  'data-ref',
  'data-ref-role',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'opacity',
  'pointer-events',
] as const

const TEXT_ATTRS = [
  'data-ref',
  'data-ref-role',
  'x',
  'y',
  'font-family',
  'font-weight',
  'font-size',
  'text-anchor',
  'dominant-baseline',
  'fill',
  'text-decoration',
  'opacity',
  'transform',
  'pointer-events',
] as const

const IMAGE_ATTRS = [
  'data-ref',
  'data-ref-role',
  'href',
  'x',
  'y',
  'width',
  'height',
  'transform',
  'preserveAspectRatio',
  'opacity',
  'pointer-events',
] as const

describe('toSvgTree', () => {
  it('writes the root and one group per layer, in the list\'s own order', () => {
    const list: DisplayList = {
      space: 'floor',
      bounds: { x: -1.0004, y: 0, w: 10 / 3, h: 50 },
      layers: [
        { key: 'plan-image', items: [] },
        { key: 'plan-chip', items: [pathItem()] },
      ],
      missingGlyphs: [],
    }
    const tree = toSvgTree(list, screen())
    expect(tree.tag).toBe('svg')
    expect(tree.attrs).toEqual([
      ['xmlns', 'http://www.w3.org/2000/svg'],
      ['viewBox', '-1 0 3.333 50'],
    ])
    expect(tree.children?.map((g) => g.attrs[0])).toEqual([
      ['data-layer', 'plan-image'],
      ['data-layer', 'plan-chip'],
    ])
  })

  it('writes a path in the fixed attribute order', () => {
    const attrs = firstAttrs(listOf([pathItem()]), screen())
    orderedAs(attrs.map(([key]) => key), PATH_ATTRS)
    expect(attr(attrs, 'data-ref')).toBe('p1')
    expect(attr(attrs, 'data-ref-role')).toBe('placement')
    expect(attr(attrs, 'd')).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z')
    expect(attr(attrs, 'fill')).toBe('#47556933')
    expect(attr(attrs, 'stroke')).toBe('#475569')
    expect(attr(attrs, 'stroke-width')).toBe('1')
  })

  it('writes the dash and the opacity after the width', () => {
    const dashed = firstAttrs(
      listOf([pathItem({ style: 'cabinet-unit-active', color: undefined })]),
      screen(),
    )
    orderedAs(dashed.map(([key]) => key), PATH_ATTRS)
    expect(attr(dashed, 'fill')).toBe('none')
    expect(attr(dashed, 'stroke')).toBe('var(--color-accent)')
    expect(attr(dashed, 'stroke-width')).toBe('2')
    expect(attr(dashed, 'stroke-dasharray')).toBe('6 3')

    const faded = firstAttrs(listOf([pathItem({ style: 'cabinet-lock-mark' })]), screen())
    orderedAs(faded.map(([key]) => key), PATH_ATTRS)
    expect(attr(faded, 'stroke')).toBe('var(--color-dim-label)')
    expect(attr(faded, 'opacity')).toBe('0.4')
  })

  it('leaves out every attribute the style does not set', () => {
    const attrs = firstAttrs(listOf([pathItem({ style: 'cabinet-unit-hit' })]), screen())
    expect(attrs.map(([key]) => key)).toEqual(['data-ref', 'data-ref-role', 'd', 'fill'])
    expect(attr(attrs, 'fill')).toBe('transparent')
  })

  // The Plan View's measurements and Item Origins lie on top of the footprints they annotate,
  // so the attribute that keeps a click reaching the Item below is part of the drawing, not of
  // whichever host happens to be showing it.
  // The Placed Item's footprint is a `<path>` inside a `<g data-ref="p1">`: the group names
  // what is drawn and the path is the shape, so the selected outline only thickens if the
  // group's ref reaches the path's style lookup.
  it('emphasises a child of a group that names it', () => {
    const list = listOf([{
      kind: 'group',
      ref: { id: 'p1', role: 'placed-item' },
      items: [{ kind: 'path', segments: box, closed: true, style: 'plan-item', color: '#475569' }],
    }])
    const footprintOf = (o: SvgOptions): [string, string][] => {
      const group = toSvgTree(list, o).children?.[0]?.children?.[0]
      const path = group?.children?.[0]
      expect(path).toBeDefined()
      return path?.attrs ?? []
    }
    expect(attr(footprintOf(screen()), 'stroke-width')).toBe('1')
    const chosen = footprintOf({ ...screen(), emphasis: { selected: new Set(['p1']) } })
    expect(attr(chosen, 'stroke')).toBe('var(--bb-text)')
    expect(attr(chosen, 'stroke-width')).toBe('2')
  })

  it('writes pointer-events for a row that takes no pointer', () => {
    const cross = firstAttrs(listOf([pathItem({ style: 'plan-origin' })]), screen())
    expect(attr(cross, 'pointer-events')).toBe('none')
    const label = firstAttrs(listOf([textItem({ style: 'plan-label' })]), screen())
    expect(attr(label, 'pointer-events')).toBe('none')
    const footprint = firstAttrs(listOf([pathItem()]), screen())
    expect(attr(footprint, 'pointer-events')).toBeUndefined()
  })

  it('writes text in millimetres, with the anchor and baseline only when they differ', () => {
    const attrs = firstAttrs(listOf([textItem()]), screen())
    orderedAs(attrs.map(([key]) => key), TEXT_ATTRS)
    expect(attr(attrs, 'x')).toBe('20')
    expect(attr(attrs, 'y')).toBe('30')
    expect(attr(attrs, 'font-family')).toBe(FONT_STACK)
    expect(attr(attrs, 'font-size')).toBe('12')
    expect(attr(attrs, 'text-anchor')).toBe('middle')
    expect(attr(attrs, 'dominant-baseline')).toBe('middle')
    expect(attr(attrs, 'fill')).toBe('#475569')

    const plain = firstAttrs(
      listOf([textItem({ anchor: 'start', baseline: 'alphabetic', rotationDeg: 0 })]),
      screen(),
    )
    expect(plain.map(([key]) => key)).toEqual([
      'x',
      'y',
      'font-family',
      'font-size',
      'fill',
      'pointer-events',
    ])
  })

  it('rotates text about its own point, the way the legacy canvas did', () => {
    const attrs = firstAttrs(listOf([textItem({ rotationDeg: -90 })]), screen())
    expect(attr(attrs, 'transform')).toBe('rotate(-90, 20, 30)')
  })

  it('lets an item dim itself past what its style says', () => {
    const attrs = firstAttrs(
      listOf([textItem({ style: 'cabinet-dimension:locked', opacity: 0.2 })]),
      screen(),
    )
    expect(attr(attrs, 'opacity')).toBe('0.2')
    expect(attr(attrs, 'fill')).toBe('var(--color-dim-label)')
  })

  it('refuses to draw text whose style names no size', () => {
    // A `<text>` the browser sizes from its own default would silently misalign against the
    // box the label placer was handed, so the table bug has to surface here.
    expect(() => toSvgTree(listOf([textItem({ style: 'plan-dimension-line' })]), screen())).toThrow(
      /plan-dimension-line/,
    )
  })

  it('puts the image in millimetres and normalises the scale out of its matrix', () => {
    const attrs = firstAttrs(listOf([imageItem()]), screen())
    orderedAs(attrs.map(([key]) => key), IMAGE_ATTRS)
    expect(attr(attrs, 'href')).toBe('blob:plan')
    expect(attr(attrs, 'width')).toBe('500')
    expect(attr(attrs, 'height')).toBe('250')
    expect(attr(attrs, 'transform')).toBe('matrix(1,0,0,1,0,0)')
    expect(attr(attrs, 'preserveAspectRatio')).toBe('none')
    expect(attr(attrs, 'opacity')).toBe('0.9')
  })

  it('keeps an image\'s placement while dropping its scale', () => {
    const placed = imageItem({
      transform: affineMultiply(affineTranslate(10, 20), affineScale(0.25, 0.5)),
    })
    const attrs = firstAttrs(listOf([placed]), screen())
    expect(attr(attrs, 'width')).toBe('250')
    expect(attr(attrs, 'height')).toBe('250')
    expect(attr(attrs, 'transform')).toBe('matrix(1,0,0,1,10,20)')
  })

  it('omits an image whose bytes the host has not loaded', () => {
    const tree = toSvgTree(listOf([imageItem(), pathItem()]), screen({ resolveAsset: () => null }))
    const nodes = tree.children?.[0].children ?? []
    expect(nodes).toHaveLength(1)
    expect(nodes[0].tag).toBe('path')
    expect(serializeSvg(tree)).not.toContain('<image')
  })

  it('writes the hit-test attributes only when the caller asks for them', () => {
    const withRefs = serializeSvg(toSvgTree(listOf([pathItem(), textItem()]), screen()))
    expect(withRefs).toContain('data-ref="p1" data-ref-role="placement"')
    const bare = serializeSvg(toSvgTree(listOf([pathItem(), textItem()]), screen({ includeRefs: false })))
    expect(bare).not.toContain('data-ref')
  })

  it('draws a selected item from its :selected row, and nothing for a hover with no row', () => {
    const emphasis = { selected: new Set(['p1']), hovered: 'p1' }
    const attrs = firstAttrs(listOf([pathItem()]), screen({ emphasis }))
    expect(attr(attrs, 'stroke')).toBe('var(--bb-text)')
    expect(attr(attrs, 'stroke-width')).toBe('2')

    // No `plan-label:hovered` row exists, so hovering a label changes nothing: the suffix is
    // how a caller says "this one does not change", not a rendering mode.
    const label = firstAttrs(
      listOf([textItem()]),
      screen({ emphasis: { hovered: undefined } }),
    )
    expect(attr(label, 'fill')).toBe('#475569')
  })

  it('leaves an item with no ref unemphasised', () => {
    const attrs = firstAttrs(
      listOf([pathItem({ ref: undefined })]),
      screen({ emphasis: { selected: new Set(['p1']) } }),
    )
    expect(attr(attrs, 'stroke')).toBe('#475569')
  })

  it('nests a group under its own transform, dropping an unloaded image inside it', () => {
    const group: DisplayItem = {
      kind: 'group',
      ref: { id: 'u1', role: 'unit' },
      transform: affineTranslate(5, 5),
      items: [imageItem(), pathItem({ ref: undefined })],
    }
    const tree = toSvgTree(listOf([group]), screen({ resolveAsset: () => null }))
    const node = tree.children?.[0].children?.[0]
    expect(node?.tag).toBe('g')
    expect(node?.attrs).toEqual([
      ['data-ref', 'u1'],
      ['data-ref-role', 'unit'],
      ['transform', 'matrix(1,0,0,1,5,5)'],
    ])
    expect(node?.children).toHaveLength(1)
  })
})

describe('number format', () => {
  /** The `d` of a one-point open path, so nothing but the number format is under test. */
  const d = (to: Pt): string =>
    attr(
      firstAttrs(listOf([pathItem({ closed: false, segments: [{ k: 'M', to }] })]), screen()),
      'd',
    ) ?? ''

  it('rounds to a micrometre and drops the trailing zeros', () => {
    expect(d({ x: 1 / 3, y: 1234.56789 })).toBe('M 0.333 1234.568')
  })

  it('never prints minus zero', () => {
    const path = d({ x: -0.00004, y: -0 })
    expect(path).toBe('M 0 0')
    expect(path).not.toContain('-0')
  })

  it('never prints an exponent', () => {
    expect(d({ x: 1e30, y: -1e25 })).toMatch(/^M \d+ -\d+$/)
    expect(d({ x: 1e-9, y: -1e-9 })).toBe('M 0 0')
  })

  it('keeps at most three decimals anywhere it prints', () => {
    const svg = serializeSvg(
      toSvgTree(
        listOf([pathItem(), textItem({ at: { x: Math.PI, y: Math.E } })]),
        screen({ sizing: { kind: 'screen', pxPerMm: 1 / 3 } }),
      ),
    )
    for (const number of svg.match(/-?\d+\.\d+/g) ?? []) {
      expect(number.split('.')[1]?.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('serializeSvg', () => {
  it('is byte-identical for the same list', () => {
    const items = [pathItem(), textItem(), imageItem()]
    const first = serializeSvg(toSvgTree(listOf(items), screen()))
    expect(serializeSvg(toSvgTree(listOf(items), screen()))).toBe(first)
  })

  it('writes no whitespace between siblings', () => {
    const svg = serializeSvg(toSvgTree(listOf([pathItem(), textItem()]), screen()))
    expect(svg).not.toMatch(/> </)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">')).toBe(true)
  })

  it('self-closes an element with nothing in it', () => {
    const svg = serializeSvg(toSvgTree(listOf([pathItem()]), screen()))
    expect(svg).toContain('/></g></svg>')
    expect(svg).toContain('<path ')
  })

  it('escapes what text cannot contain', () => {
    const svg = serializeSvg(
      toSvgTree(listOf([textItem({ text: 'A & B <c>' })]), screen()),
    )
    expect(svg).toContain('>A &amp; B &lt;c&gt;</text>')
    expect(svg).not.toContain('<c>')
  })

  it('escapes what an attribute cannot contain', () => {
    const svg = serializeSvg(
      toSvgTree(listOf([pathItem({ ref: { id: 'a"b&c<d>', role: 'x' } })]), screen()),
    )
    expect(svg).toContain('data-ref="a&quot;b&amp;c&lt;d&gt;"')
  })
})
