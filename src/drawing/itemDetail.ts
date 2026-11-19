/**
 * The Item Detail View's display list (#60).
 *
 * One Item Design drawn on its own: a cabinet's whole scene — units, panels, voids, dividers,
 * hardware, measurements — or a generic Item Design's footprint and name. The cabinet half is
 * the arithmetic `CabinetCanvas`, `CanvasLayers` and `DimensionLabels` used to do in JSX, and
 * it is the reason this issue exists: the Plan View and the Item Detail were two renderers of
 * the same model, and only one of them was being improved.
 *
 * Everything is in the design's own millimetres. The canvas's `viewBox` and its
 * `matrix(zoom,0,0,zoom,pan.x,pan.y)` are the renderer's business; what the cabinet drew as
 * `strokeWidth={1}` or `rx={2}` is a millimetre size here, and what it drew as `2 / zoom` is a
 * device-pixel size — which is exactly the split `SIZE_ROLES` makes.
 */
import type { DerivedItemDetail } from '../derive'
import { affineMultiply, affineScale, affineTranslate } from '../derive'
import type { CabinetMaterialId } from '../domain'
import type { LayoutVoid, SceneLayout, UnitLayoutResult } from '../cabinet'
import { layoutText } from './font/layoutText'
import { pathToCommands, rectCommands, roundedRectCommands } from './path'
import { unionText } from './planView'
import { resolveSize } from './styles'
import { LAYER_ORDER } from './types'
import type {
  DisplayItem,
  DisplayLayer,
  DisplayList,
  DrawOptions,
  LayerKey,
  MissingGlyph,
  PathCommand,
  Rect,
  Sizing,
  StyleKey,
} from './types'

/** What the Item Detail surface knows that the derived design does not. */
export type ItemDetailView = {
  /**
   * The node whose measurements are pinned — locked, with a fixed size — so its numbers are
   * drawn dimmed and ununderlined, because clicking them would do nothing (#53).
   */
  pinnedNodeId?: string | null
}

/** What the Item Detail needs that a plain `DrawOptions` does not carry. */
export type ItemDetailOptions = DrawOptions & {
  /** Millimetres to the text a measurement shows, in the unit and precision in force. */
  formatLength: (mm: number) => string
}

/** How far a measurement sits inside the section it measures, in the scene's millimetres. */
const LABEL_INSET_MM = 2

/** The box the lock and unlock glyphs are authored in, in their own units. */
const MARK_BOX = 14

/** A space label longer than this is cut with an ellipsis: it is a hint, not a title. */
const SPACE_LABEL_MAX = 20

/** The bands a cabinet scene fills, in `LAYER_ORDER`'s own order. */
const CABINET_LAYERS: readonly LayerKey[] = LAYER_ORDER.filter((key) => key.startsWith('cabinet-'))

/** The bands a single Item Footprint fills, in `LAYER_ORDER`'s own order. */
const ITEM_LAYERS: readonly LayerKey[] = LAYER_ORDER.filter((key) => key.startsWith('item-'))

/**
 * The Item Detail's drawing, in the design's own millimetres.
 *
 * A cabinet's `space` is `design-local` just like a generic design's: its units are laid out
 * in scene millimetres and the renderer fits the whole thing to the sheet.
 */
export function drawItemDetail(
  d: DerivedItemDetail,
  view: ItemDetailView,
  options: ItemDetailOptions,
): DisplayList {
  return d.kind === 'cabinet' ? drawCabinet(d.layout, view, options) : drawGeneric(d, options)
}

/** A single Item Footprint and its name, which is all a generic Item Design has to show. */
function drawGeneric(
  d: Extract<DerivedItemDetail, { kind: 'generic' }>,
  options: DrawOptions,
): DisplayList {
  const missingGlyphs: MissingGlyph[] = []
  const size = resolveSize('plan-label', options.sizing)
  const layout = layoutText(d.label, size.mm)
  if (layout.missing.length > 0) {
    missingGlyphs.push({ ref: { id: d.designId, role: 'item-label' }, text: d.label, chars: layout.missing })
  }
  const bands: Partial<Record<LayerKey, DisplayItem[]>> = {
    'item-footprint': [{
      kind: 'path',
      ref: { id: d.designId, role: 'item-footprint' },
      segments: pathToCommands(d.footprint),
      closed: true,
      style: 'item-footprint',
      color: d.color,
    }],
    'item-labels': [{
      kind: 'text',
      ref: { id: d.designId, role: 'item-label' },
      text: d.label,
      at: { x: d.bounds.x + d.bounds.w / 2, y: d.bounds.y + d.bounds.h / 2 },
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'label',
      style: 'item-label',
      color: d.color,
      layout,
    }],
  }
  const genericLayers: DisplayLayer[] = ITEM_LAYERS
    .filter((key) => bands[key] !== undefined)
    .map((key) => ({ key, items: bands[key] ?? [] }))
  return {
    space: 'design-local',
    bounds: genericLayers.reduce<Rect>((box, layer) => unionText(box, layer.items), d.bounds),
    layers: genericLayers,
    missingGlyphs,
  }
}

/** Every unit of a cabinet scene, band by band, so one z-order rules both surfaces. */
function drawCabinet(
  layout: SceneLayout,
  view: ItemDetailView,
  options: ItemDetailOptions,
): DisplayList {
  const { sizing, formatLength } = options
  const missingGlyphs: MissingGlyph[] = []
  const bands = new Map<LayerKey, DisplayItem[]>()
  const add = (key: LayerKey, unit: UnitLayoutResult, items: DisplayItem[]): void => {
    if (items.length === 0) return
    const band = bands.get(key) ?? []
    band.push({
      kind: 'group',
      ref: { id: unit.unitId, role: 'unit-group' },
      transform: affineTranslate(unit.x, unit.y),
      items,
    })
    bands.set(key, band)
  }

  for (const unit of layout.units) {
    add('cabinet-units', unit, [{
      kind: 'path',
      ref: { id: unit.unitId, role: 'unit-hit' },
      segments: rectCommands(0, 0, unit.w, unit.h),
      closed: true,
      style: 'cabinet-unit-hit',
    }])
    add('cabinet-panels', unit, unit.panels.map((p) => ({
      kind: 'path' as const,
      ref: { id: p.id, role: 'panel' },
      segments: rectCommands(p.x, p.y, p.w, p.h),
      closed: true,
      style: panelStyle(p.material),
    })))
    add('cabinet-voids', unit, unit.voids.map((v) => ({
      kind: 'path' as const,
      ref: { id: v.nodeId, role: 'void' },
      segments: rectCommands(v.x, v.y, v.w, v.h),
      closed: true,
      style: 'cabinet-void' as const,
    })))
    add('cabinet-dividers', unit, unit.dividers.map((div) => ({
      kind: 'path' as const,
      // A divider is selected by the section above it, which is the id the canvas compared and
      // the id the inspector names — not the divider's own, which is a layout artefact.
      ref: { id: div.childAId, role: 'divider' },
      segments: rectCommands(div.x, div.y, div.w, div.h),
      closed: true,
      style: dividerStyle(div.material),
    })))
    add('cabinet-accessories', unit, accessoriesFor(unit, sizing))
    add('cabinet-dimensions', unit, dimensionsFor(unit, sizing, formatLength, view, missingGlyphs))
    add('cabinet-marks', unit, marksFor(unit, sizing, view))
  }

  const ordered: DisplayLayer[] = CABINET_LAYERS.filter((key) => (bands.get(key)?.length ?? 0) > 0)
    .map((key) => ({ key, items: bands.get(key)! }))

  return {
    space: 'design-local',
    bounds: ordered.reduce<Rect>((box, layer) => unionText(box, layer.items), layout.boundingBox),
    layers: ordered,
    missingGlyphs,
  }
}

/** The hardware a section carries: a drawer's frame and pull, a door's leaf, hinge positions. */
function accessoriesFor(unit: UnitLayoutResult, sizing: Sizing): DisplayItem[] {
  const items: DisplayItem[] = []
  const corner = resolveSize('cabinet-corner', sizing).mm
  const smallCorner = resolveSize('cabinet-corner-small', sizing).mm
  for (const v of unit.voids) {
    if (v.elementType === 'drawer') {
      items.push({
        kind: 'path',
        ref: { id: v.nodeId, role: 'drawer-frame' },
        segments: roundedRectCommands(v.x + 6, v.y + 6, v.w - 12, v.h - 12, corner),
        closed: true,
        style: 'cabinet-drawer-frame',
      })
      const cx = v.x + v.w / 2
      const cy = v.y + v.h / 2
      items.push({
        kind: 'path',
        ref: { id: v.nodeId, role: 'drawer-pull-dot' },
        segments: circleCommands(cx, cy, 4),
        closed: true,
        style: 'cabinet-drawer-pull-dot',
      })
    }
    for (const a of v.accessories) {
      if (a.type === 'door' || a.type === 'drawer-front') {
        items.push({
          kind: 'path',
          ref: { id: a.id, role: a.type },
          segments: roundedRectCommands(v.x + 4, v.y + 4, v.w - 8, v.h - 8, corner),
          closed: true,
          style: a.type === 'door' ? 'cabinet-door' : 'cabinet-drawer-front',
        })
      } else if (a.type === 'pull') {
        items.push({
          kind: 'path',
          ref: { id: a.id, role: 'pull' },
          segments: roundedRectCommands(v.x + v.w / 2 - 10, v.y + v.h / 2 - 1.5, 20, 3, smallCorner),
          closed: true,
          style: 'cabinet-pull',
        })
      } else {
        for (const cy of [v.y + 16, v.y + v.h - 16]) {
          items.push({
            kind: 'path',
            ref: { id: a.id, role: 'hinge' },
            segments: circleCommands(v.x + 6, cy, 3),
            closed: true,
            style: 'cabinet-hinge',
          })
        }
      }
    }
  }
  return items
}

/**
 * The two measurements of every section, and the space label in the middle of it.
 *
 * The height is turned to read up the side of the section — `rotate(-90, x, y)` about its own
 * anchor. It is the one rotation the Item Detail keeps: a Plan View's words never turn, but a
 * number crammed down the left edge of a 60 mm drawer has to.
 */
function dimensionsFor(
  unit: UnitLayoutResult,
  sizing: Sizing,
  formatLength: (mm: number) => string,
  view: ItemDetailView,
  missingGlyphs: MissingGlyph[],
): DisplayItem[] {
  const size = resolveSize('cabinet-dimension', sizing).mm
  const spaceSize = resolveSize('cabinet-space-label', sizing).mm
  const items: DisplayItem[] = []
  for (const v of unit.voids) {
    const canEditW = editable(v, 'w', view)
    const canEditH = editable(v, 'h', view)
    items.push(measurement(v.nodeId, 'w', formatLength(v.w), v.x + v.w / 2, v.y + size + LABEL_INSET_MM, 0, canEditW, size, missingGlyphs))
    items.push(measurement(v.nodeId, 'h', formatLength(v.h), v.x + size + LABEL_INSET_MM, v.y + v.h / 2, -90, canEditH, size, missingGlyphs))

    const space = v.spaceLabel ?? ''
    if (space !== '') {
      const label = space.length > SPACE_LABEL_MAX ? `${space.slice(0, SPACE_LABEL_MAX)}…` : space
      const layout = layoutText(label, spaceSize)
      if (layout.missing.length > 0) {
        missingGlyphs.push({ ref: { id: v.nodeId, role: 'space-label' }, text: label, chars: layout.missing })
      }
      items.push({
        kind: 'text',
        ref: { id: v.nodeId, role: 'space-label' },
        text: label,
        at: { x: v.x + v.w / 2, y: v.y + v.h / 2 },
        anchor: 'middle',
        baseline: 'middle',
        rotationDeg: 0,
        role: 'space-label',
        style: 'cabinet-space-label',
        layout,
      })
    }
  }
  return items
}

/** Whether one measurement can be clicked and typed into: it has a node to change and is not pinned. */
const editable = (v: LayoutVoid, axis: 'w' | 'h', view: ItemDetailView): boolean =>
  (axis === 'w' ? v.widthControlNodeId : v.heightControlNodeId) !== undefined
  && v.nodeId !== (view.pinnedNodeId ?? null)

function measurement(
  nodeId: string,
  axis: 'w' | 'h',
  label: string,
  x: number,
  y: number,
  rotationDeg: number,
  canEdit: boolean,
  size: number,
  missingGlyphs: MissingGlyph[],
): DisplayItem {
  const layout = layoutText(label, size)
  if (layout.missing.length > 0) {
    missingGlyphs.push({ ref: { id: nodeId, role: `dim-label-${axis}` }, text: label, chars: layout.missing })
  }
  return {
    kind: 'text',
    ref: { id: nodeId, role: `dim-label-${axis}` },
    text: label,
    at: { x, y },
    anchor: 'middle',
    // The canvas set no `dominantBaseline` on a measurement, so it sits on its baseline; the
    // space label in the middle of the section is the one that is centred on its `y`.
    baseline: 'alphabetic',
    rotationDeg,
    role: 'dimension',
    style: canEdit ? 'cabinet-dimension' : 'cabinet-dimension:locked',
    ...(canEdit ? { decoration: 'underline' as const } : {}),
    layout,
  }
}

/**
 * The lock marks of a pinned measurement, the unlock button of an over-constrained section,
 * and the dashed outline of the unit that is currently active.
 *
 * Both glyphs are authored once in a box of their own and scaled into place, which is what the
 * canvas did with a `scale()` on the group: the mark is made to match the number beside it
 * rather than to a size of its own that would drift from the text it annotates.
 */
function marksFor(unit: UnitLayoutResult, sizing: Sizing, view: ItemDetailView): DisplayItem[] {
  const size = resolveSize('cabinet-dimension', sizing).mm
  const markScale = size / MARK_BOX
  const hairline = resolveSize('hairline', sizing).mm
  const items: DisplayItem[] = []
  for (const v of unit.voids) {
    if (!editable(v, 'w', view)) {
      items.push(lockMark(v.nodeId, 'w', v.x + v.w / 2 + size * 1.8, v.y + size + LABEL_INSET_MM - size * 0.7, markScale))
    }
    if (!editable(v, 'h', view)) {
      items.push(lockMark(v.nodeId, 'h', v.x + size + LABEL_INSET_MM - size * 0.4, v.y + v.h / 2 - size * 2.5, markScale))
    }
    if (unit.overConstrainedIds.includes(v.nodeId)) {
      items.push({
        kind: 'group',
        ref: { id: v.nodeId, role: 'unlock-mark' },
        transform: affineMultiply(
          affineMultiply(affineTranslate(v.x + v.w - 12, v.y + 13.5), affineScale(hairline)),
          affineTranslate(-6, -9.5),
        ),
        items: [
          {
            kind: 'path',
            segments: [
              { k: 'M', to: { x: 3, y: 7 } },
              { k: 'L', to: { x: 3, y: 5 } },
              { k: 'A', to: { x: 9, y: 5 }, r: 3, largeArc: true, sweep: true },
              { k: 'L', to: { x: 9, y: 7 } },
            ],
            closed: false,
            style: 'cabinet-unlock-mark',
          },
          {
            kind: 'path',
            segments: roundedRectCommands(2, 7, 8, 7, 1.5),
            closed: true,
            style: 'cabinet-unlock-mark',
          },
        ],
      })
    }
  }
  if (unit.isActive) {
    items.push({
      kind: 'path',
      ref: { id: unit.unitId, role: 'unit-active' },
      segments: rectCommands(-2, -2, unit.w + 4, unit.h + 4),
      closed: true,
      style: 'cabinet-unit-active',
    })
  }
  return items
}

/** The closed padlock of a pinned measurement, drawn in its own 14-unit box. */
function lockMark(nodeId: string, axis: 'w' | 'h', x: number, y: number, scale: number): DisplayItem {
  return {
    kind: 'group',
    ref: { id: nodeId, role: `lock-icon-${axis}` },
    transform: affineMultiply(affineTranslate(x, y), affineScale(scale)),
    items: [
      {
        kind: 'path',
        segments: [
          { k: 'M', to: { x: 2, y: 5 } },
          { k: 'L', to: { x: 2, y: 3.5 } },
          { k: 'A', to: { x: 7, y: 3.5 }, r: 2.5, largeArc: false, sweep: true },
          { k: 'L', to: { x: 7, y: 5 } },
        ],
        closed: false,
        style: 'cabinet-lock-mark',
      },
      {
        kind: 'path',
        segments: roundedRectCommands(1, 5, 7, 5, 1),
        closed: true,
        style: 'cabinet-lock-mark',
      },
    ],
  }
}

/** A circle as a rounded square whose corner is its own radius: a display list has one shape. */
const circleCommands = (cx: number, cy: number, r: number): PathCommand[] =>
  roundedRectCommands(cx - r, cy - r, r * 2, r * 2, r)

/** A panel's style, named by its material — the one place the two surfaces agree on paint. */
const panelStyle = (material: CabinetMaterialId): StyleKey => `cabinet-panel-${material}`

/** A divider's style, named by its material; selection is layered on by the renderer. */
const dividerStyle = (material: CabinetMaterialId): StyleKey => `cabinet-divider-${material}`
