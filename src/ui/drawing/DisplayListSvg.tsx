/**
 * The one renderer that turns a `DisplayList` into DOM (#60 criterion 14).
 *
 * Every canvas in the app — the Plan View, the Item Detail, the footprint preview — used to
 * carry its own JSX for panels, voids, footprints and labels, and the three of them had
 * drifted apart: the Plan View filled an oak panel with the design colour at twenty per cent
 * strength while the Item Detail filled it at full strength, and the same measurement was
 * 12 px in one and 11 px in the other. This is the only place that reads the style table and
 * the only place that knows what a `Ref` looks like in the DOM, so the two surfaces cannot
 * drift again without doing it in one file.
 *
 * ## Two coordinate spaces
 *
 * A list is drawn in one unit — Floor millimetres, or design-local millimetres — and the
 * caller supplies the `matrix` that puts it on screen. `textSpace` says where words go:
 *
 * - `'list'` leaves them where they are, under the same matrix as the geometry. That is what
 *   the Item Detail does today: its `<svg>` has a millimetre `viewBox`, so a label sized
 *   `12/zoom` millimetres lands at 12 CSS pixels and turns with the scene, which is what a
 *   height measurement alongside a rotated drawer front has always done.
 * - `'screen'` lifts every word out of the transformed group into a layer with no transform
 *   at all, and rewrites its `x`, `y` and `font-size` into CSS pixels. That is the Plan View:
 *   a footprint turns; its name never does (#57 criterion 11).
 *
 * ## The test ids
 *
 * `data-testid` is a public interface — the Playwright suite and the component tests select on
 * it — so it is derived here from `Ref.role`, once, rather than being written at each call
 * site. Event handlers are keyed off the same role: a `placed-item` group takes the pointer
 * that drags it, a `unit-hit` path takes the click that shows a unit, an `unlock-mark` group
 * is a button.
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { affineApply } from '../../derive'
import type { Affine, Pt } from '../../derive'
import { toSvgTree } from '../../drawing'
import type {
  DisplayItem,
  DisplayList,
  DisplayLayer,
  Emphasis,
  Sizing,
  SvgNode,
} from '../../drawing'

/** Where the words of a list are drawn: with the geometry, or flat on the screen. */
export type TextSpace = 'screen' | 'list'

/** Where one pass of a list puts its words, when several passes share a canvas. */
export type TextLayer = 'with' | 'none' | 'only'

/** The gestures a canvas hands back, keyed by the `Ref.id` the element was drawn for. */
export interface DisplayListInteractions {
  /** The group around a Placed Item's outline: it starts a drag or a pick. */
  onItemPointerDown?: (id: string, event: React.PointerEvent<SVGGElement>) => void
  /** A Wall band, clicked where it is drawn: it becomes the selected Wall (#64 §15). */
  onWallPointerDown?: (id: string, event: React.PointerEvent<SVGGElement>) => void
  /** The rotate grip: it starts a turn. */
  onRotatePointerDown?: (id: string, event: React.PointerEvent<SVGPathElement>) => void
  /** A click anywhere on a unit's own box. */
  onUnitClick?: (id: string) => void
  /** A section or a divider, picked where it is drawn: it becomes the selected node. */
  onSelectNode?: (id: string) => void
  /** `Unlock section`, by keyboard or by pointer. */
  onUnlock?: (id: string) => void
  /** One of a section's two measurements, clicked where it is drawn. */
  onDimensionClick?: (id: string, axis: 'w' | 'h', event: React.MouseEvent<SVGTextElement>) => void
}

export interface DisplayListSvgProps {
  list: DisplayList
  sizing: Sizing
  /** The `matrix(...)` that puts the list's unit on screen; `undefined` draws it untransformed. */
  matrix?: string
  textSpace: TextSpace
  /**
   * Whether this pass draws the words. `'with'` (the default) puts them above the geometry,
   * `'none'` leaves them to a later pass, `'only'` draws nothing but words.
   *
   * Two lists that share one canvas — a Floor and its selection annotations — have to interleave
   * the way a single canvas does: all the geometry, then every word. Otherwise an Item label that
   * crosses an Item Origin paints under the crosshair instead of over it.
   */
  textLayer?: TextLayer
  /**
   * CSS pixels per list unit, and the pan, both only read when `textSpace` is `'screen'`:
   * they are what a millimetre coordinate and a millimetre font size are multiplied by.
   */
  screen?: { pxPerUnit: number; panX: number; panY: number }
  emphasis?: Emphasis
  resolveAsset: (hash: string) => string | null
  interactions?: DisplayListInteractions
  /** Drawn inside the transformed group, after the last layer — the rotate handle, an overlay. */
  children?: ReactNode
}

/** The `data-testid` each role answers with, or nothing when the role is not addressable. */
const TEST_IDS: Readonly<Record<string, (id: string) => string>> = {
  'placed-item': (id) => `placed-object-${id}`,
  'item-label': (id) => `item-label-${id}`,
  'origin-marker': (id) => `origin-marker-${id}`,
  'origin-preview': (id) => `origin-preview-${id}`,
  'dimension-lines': () => 'dimension-lines',
  'dimension-width-line': () => 'dimension-width-line',
  'dimension-depth-line': () => 'dimension-depth-line',
  'dimension-width': () => 'dimension-width',
  'dimension-depth': () => 'dimension-depth',
  'floor-bounds-chip': () => 'floor-bounds-chip',
  'wall': (id) => `wall-band-${id}`,
  'rotate-handle-group': () => 'rotate-handle-group',
  'rotate-handle': () => 'rotate-handle',
  void: (id) => `void-${id}`,
  // A divider is *addressed* by its own layout id (`<section>-divider`) and *selected* by the
  // section above it, which is the id the inspector names and the id that decides its emphasis.
  // The `Ref` carries the second, because that is what a click has to hand back; the name the
  // suite reaches for is the first, so it gets the suffix the layout gives it.
  divider: (id) => `divider-${id}-divider`,
  'space-label': (id) => `space-label-${id}`,
  'dim-label-w': (id) => `dim-label-${id}-w`,
  'dim-label-h': (id) => `dim-label-${id}-h`,
  'lock-icon-w': (id) => `lock-icon-${id}-w`,
  'lock-icon-h': (id) => `lock-icon-${id}-h`,
  'unit-group': () => 'unit-group',
}

/** The attributes React's DOM needs spelled its own way. Everything else passes through. */
const REACT_ATTR: Readonly<Record<string, string>> = {
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-linecap': 'strokeLinecap',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'text-anchor': 'textAnchor',
  'dominant-baseline': 'dominantBaseline',
  'text-decoration': 'textDecoration',
}

const attr = (attrs: readonly [string, string][], name: string): string | undefined =>
  attrs.find(([key]) => key === name)?.[1]

/**
 * The three attributes of a screen-space word, moved from list units to CSS pixels.
 *
 * Only `x`, `y` and `font-size` need it: `text-anchor` and `dominant-baseline` name a
 * relationship to the box rather than a length, so they survive a scale unchanged, and a
 * Plan View word never carries a `transform` for the same reason.
 */
function toScreenAttrs(
  attrs: readonly [string, string][],
  screen: NonNullable<DisplayListSvgProps['screen']>,
): [string, string][] {
  const { pxPerUnit, panX, panY } = screen
  const at = (value: string | undefined, pan: number): string | undefined =>
    value === undefined ? undefined : String(Number(value) * pxPerUnit + pan)
  /* A millimetre font size is stored on the list's three-decimal grid, so multiplying it back
     out lands a hair off the size that was asked for — `12` comes back as `12.0004`. Centred
     text is laid out from its own width, so that hair slides every glyph sideways; the size
     goes back onto the grid it left. */
  const grid = (value: number): string => String(Math.round(value * 1000) / 1000)
  return attrs.map(([key, value]) => {
    if (key === 'x') return ['x', at(value, panX) as string]
    if (key === 'y') return ['y', at(value, panY) as string]
    if (key === 'font-size') return ['font-size', grid(Number(value) * pxPerUnit)]
    return [key, value]
  })
}

// -------------------------------------------------------------------- splitting a list
interface Split {
  readonly geometry: DisplayItem[]
  readonly text: DisplayItem[]
}

/**
 * The geometry and the words of one layer, apart.
 *
 * A word inside a transformed group is lifted out with its position taken through that
 * transform, because the layer it lands in has no transform of its own to put it back.
 */
function splitItems(items: readonly DisplayItem[], outer: Affine | null): Split {
  const geometry: DisplayItem[] = []
  const text: DisplayItem[] = []
  for (const item of items) {
    if (item.kind === 'text') {
      text.push(outer === null ? item : { ...item, at: affineApply(outer, item.at as Pt) as typeof item.at })
    } else if (item.kind === 'group') {
      const inner = splitItems(item.items, item.transform ?? outer)
      if (inner.geometry.length === 0) {
        // Nothing to draw under the transform: the words come up on their own.
        text.push(...inner.text)
      } else {
        geometry.push({ ...item, items: inner.geometry })
        text.push(...inner.text)
      }
    } else {
      geometry.push(item)
    }
  }
  return { geometry, text }
}

const splitList = (list: DisplayList, keep: 'geometry' | 'text' | 'all'): DisplayList => ({
  ...list,
  layers: keep === 'all'
    ? list.layers
    : list.layers
      .map((layer): DisplayLayer => ({ key: layer.key, items: splitItems(layer.items, null)[keep] }))
      .filter((layer) => layer.items.length > 0),
})

// -------------------------------------------------------------------- rendering a node
/**
 * One `SvgNode` as a React element, with the test id and the handlers its role asks for.
 *
 * A `key` is the node's `data-ref` and its index together: several nodes of one layer carry
 * the same `Ref` — a Placed Item's outline, its label and its origin all name the same
 * placement — and a layer's order is the drawing's order, so an index is stable for the life
 * of a list, which is rebuilt whole.
 */
function renderNode(
  node: SvgNode,
  index: number,
  o: RenderOptions,
): ReactNode {
  const props: Record<string, unknown> = {}
  for (const [key, value] of node.attrs) {
    props[REACT_ATTR[key] ?? key] = value
  }
  const id = attr(node.attrs, 'data-ref')
  const role = attr(node.attrs, 'data-ref-role')
  const interactions = o.interactions
  if (id !== undefined && role !== undefined) {
    const testId = TEST_IDS[role]?.(id)
    if (testId !== undefined) props['data-testid'] = testId
    if (role === 'unit-group') props['data-unit-id'] = id
    // The Item Origin's own position, which the e2e suite reads back off the element rather
    // than recomputing the matrix out of a `transform` attribute.
    if (role === 'origin-marker' || role === 'origin-preview') {
      const matrix = attr(node.attrs, 'transform')
      const numbers = matrix === undefined ? null : matrix.slice(7, -1).split(',').map(Number)
      if (numbers !== null && numbers.length === 6) {
        props['data-x'] = String(numbers[4])
        props['data-y'] = String(numbers[5])
      }
    }
    if (role === 'placed-item' && interactions?.onItemPointerDown !== undefined) {
      const start = interactions.onItemPointerDown
      props.onPointerDown = ((event: React.PointerEvent<SVGGElement>) => start(id, event)) as never
      props.onClick = ((event: React.MouseEvent) => event.stopPropagation()) as never
      props.style = { cursor: 'move' }
    }
    if (role === 'wall' && interactions?.onWallPointerDown !== undefined) {
      const pick = interactions.onWallPointerDown
      props.onPointerDown = ((event: React.PointerEvent<SVGGElement>) => {
        event.stopPropagation()
        pick(id, event)
      }) as never
      props.style = { cursor: 'pointer' }
    }
    if (role === 'rotate-handle' && interactions?.onRotatePointerDown !== undefined) {
      const start = interactions.onRotatePointerDown
      props.onPointerDown = ((event: React.PointerEvent<SVGPathElement>) => {
        event.stopPropagation()
        start(id, event)
      }) as never
      props.onClick = ((event: React.MouseEvent) => event.stopPropagation()) as never
      props.style = { cursor: 'grab' }
    }
    if (role === 'unit-hit') {
      props.style = { cursor: 'pointer' }
      if (interactions?.onUnitClick !== undefined) {
        const click = interactions.onUnitClick
        props.onClick = (() => click(id)) as never
      }
    }
    // A section and a divider are both picked where they are drawn. The outline that says the
    // pick worked is the emphasis on the same shape, never a second one laid over it.
    if ((role === 'void' || role === 'divider') && interactions?.onSelectNode !== undefined) {
      const select = interactions.onSelectNode
      props.style = { cursor: 'pointer' }
      props.onClick = ((event: React.MouseEvent) => {
        event.stopPropagation()
        select(id)
      }) as never
    }
    // A measurement opens the inline field where it is drawn, so the words themselves are the
    // target — but only the editable ones, which is the style row that says so.
    if (role === 'dim-label-w' || role === 'dim-label-h') {
      const axis = role === 'dim-label-w' ? 'w' as const : 'h' as const
      const click = interactions?.onDimensionClick
      if (click !== undefined && attr(node.attrs, 'text-decoration') === 'underline') {
        props.onClick = ((event: React.MouseEvent<SVGTextElement>) => {
          event.stopPropagation()
          click(id, axis, event)
        }) as never
        props.style = { cursor: 'pointer' }
      }
    }
    if (role === 'unlock-mark' && interactions?.onUnlock !== undefined) {
      const unlock = interactions.onUnlock
      props.role = 'button'
      props.tabIndex = 0
      props['aria-label'] = 'Unlock section'
      props.onClick = ((event: React.MouseEvent) => {
        event.stopPropagation()
        unlock(id)
      }) as never
      props.onKeyDown = ((event: React.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') unlock(id)
      }) as never
    }
  }
  if (o.screen !== undefined && node.tag === 'text') {
    const moved = toScreenAttrs(node.attrs, o.screen)
    for (const [key, value] of moved) props[REACT_ATTR[key] ?? key] = value
  }
  const children = node.text !== undefined
    ? node.text
    : (node.children ?? []).map((child, childIndex) => renderNode(child, childIndex, o))
  return createElement(node.tag, { ...props, key: id === undefined ? `n${index}` : `${id}-${index}` }, children)
}

interface RenderOptions {
  readonly interactions?: DisplayListInteractions
  readonly screen?: DisplayListSvgProps['screen']
}

/**
 * The two groups a canvas needs: the drawing under the caller's matrix, and — for a Plan
 * View — its words flat on the screen above it.
 */
export function DisplayListSvg(props: DisplayListSvgProps): ReactNode {
  const { list, sizing, matrix, textSpace, screen, emphasis, resolveAsset, interactions, children } = props
  const layer = props.textLayer ?? 'with'
  const options = { sizing, includeRefs: true, emphasis, resolveAsset }
  const render = (keep: 'geometry' | 'text' | 'all', screenAttrs: DisplayListSvgProps['screen']): ReactNode =>
    (toSvgTree(splitList(list, keep), options).children ?? [])
      .map((band, index) => renderNode(band, index, { interactions, screen: screenAttrs }))
  return (
    <>
      {layer !== 'only' && (
        <g transform={matrix}>
          {render(textSpace === 'screen' ? 'geometry' : 'all', undefined)}
          {children}
        </g>
      )}
      {textSpace === 'screen' && layer !== 'none' && (
        /* Every word, in CSS pixels and with no transform of any kind: a footprint turns, its
           name never does (#57 criterion 11). */
        <g data-testid="plan-text-layer" style={{ pointerEvents: 'none', userSelect: 'none' }}>
          {render('text', screen)}
        </g>
      )}
    </>
  )
}
