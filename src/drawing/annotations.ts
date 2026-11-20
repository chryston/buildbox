/**
 * What the Plan View draws because something is *selected* (#60).
 *
 * The measurement lines, the `Floor bounds` chip and the Item Origin crosshairs are not part
 * of the Floor: they exist only while a Placed Item is picked, and they go away when it is
 * not. They are a second list rather than extra layers in the first one because the first is
 * cached by the Project's revision and this is keyed by a click — rebuilding a hundred
 * footprints to move a measurement line would be a poor trade.
 *
 * Everything here is still millimetres and still pure. What stays in `ui` is only what needs
 * a pointer: the rotate handle, the snap markers, the hatched overlays, the inline editors.
 */
import type { DerivedFloor } from '../derive'
import { affineApply, affineTranslate } from '../derive'
import type { EntityId } from '../domain'
import { layoutText, measureRect } from './font/layoutText'
import { placeLabels } from './labels'
import { lineCommands, roundedRectCommands } from './path'
import { drawPlacement, unionText, type DrawnPlacement, type PlanPreview } from './planView'
import { resolveSize } from './styles'
import type { DisplayItem, DisplayLayer, DisplayList, DrawOptions, MissingGlyph, Rect } from './types'

/** What the annotations need that a plain `DrawOptions` does not carry. */
export type AnnotationOptions = DrawOptions & {
  /**
   * Millimetres to the text the measurement shows, in the unit and precision the inspector is
   * set to.
   *
   * A callback rather than an import: unit formatting is a display preference that lives in
   * `ui`, and `drawing` may not reach into `ui` (#20 §2). The goldens pin it to a fixed
   * millimetre formatter, so the bytes they compare do not depend on a preference.
   */
  formatLength: (mm: number) => string
  /** The same preview the Floor is being drawn with, so the crosshairs follow the pointer. */
  preview?: PlanPreview | null
}

/** How many characters of `Floor bounds …` fit the chip: the placer's own width per character. */
const CHIP_LABEL = 'floor-bounds'

/**
 * The selection's measurement, chip and Item Origins, or `null` when nothing is selected.
 *
 * `null` and not an empty list: a renderer should have nothing to draw, rather than an empty
 * `<g>` for it to notice.
 */
export function drawSelectionAnnotations(
  d: DerivedFloor,
  placementId: EntityId | null,
  options: AnnotationOptions,
): DisplayList | null {
  if (placementId === null) return null
  const selected = d.placements.find((p) => p.id === placementId)
  if (selected === undefined) return null

  const { sizing, formatLength } = options
  const drawn = new Map<EntityId, DrawnPlacement>()
  for (const p of d.placements) {
    if (p.designId === selected.designId) drawn.set(p.id, drawPlacement(p, options.preview))
  }
  const focus = drawn.get(placementId) ?? drawPlacement(selected, options.preview)

  const missingGlyphs: MissingGlyph[] = []
  const annotations: DisplayItem[] = []
  // The pending pivot first and the committed one over it: a design edit shows on every
  // Placed Item of that design, and the crosshair it moves is the one the Item already had
  // (#57 criterion 3), so both are on screen until `Apply`.
  for (const f of drawn.values()) {
    if (f.previewOriginAt !== null) annotations.push(originMarker(f, sizing, true))
  }
  for (const f of drawn.values()) annotations.push(originMarker(f, sizing, false))

  const dimensions: DisplayItem[] = []
  const chipItems: DisplayItem[] = []
  if (focus !== null) {
    const measurement = measurePlacement(focus, sizing, formatLength, missingGlyphs)
    dimensions.push(...measurement.items)
    const chip = boundsChip(focus, measurement.obstacles, sizing, formatLength, missingGlyphs)
    if (chip !== null) chipItems.push(chip)
  }

  const layers: DisplayLayer[] = []
  if (annotations.length > 0) layers.push({ key: 'plan-annotations', items: annotations })
  if (dimensions.length > 0) layers.push({ key: 'plan-dimensions', items: dimensions })
  if (chipItems.length > 0) layers.push({ key: 'plan-chip', items: chipItems })
  if (focus !== null) layers.push({ key: 'plan-handle', items: [rotateHandle(focus, sizing)] })
  if (layers.length === 0) return null

  let bounds = focus.world
  for (const layer of layers) bounds = unionText(bounds, layer.items)

  return { space: 'floor', bounds, layers, missingGlyphs }
}

/**
 * The Item Origin: a crosshair with a dot, at the placement's own `translation`.
 *
 * The group carries its position as a translation and its children are drawn about the origin
 * of their own frame, because that position is the one thing the rotate handle needs to read
 * back off the rendered node.
 */
function originMarker(f: DrawnPlacement, sizing: DrawOptions['sizing'], preview: boolean): DisplayItem {
  const arm = resolveSize('plan-origin-arm', sizing).mm
  const dot = resolveSize('plan-origin-dot', sizing).mm
  const style = preview ? 'plan-origin:preview' as const : 'plan-origin' as const
  const dotStyle = preview ? 'plan-origin-dot:preview' as const : 'plan-origin-dot' as const
  const at = preview ? f.previewOriginAt ?? f.originAt : f.originAt
  return {
    kind: 'group',
    ref: { id: f.placement.id, role: preview ? 'origin-preview' : 'origin-marker' },
    transform: affineTranslate(at.x, at.y),
    items: [
      // Two arms, two paths. One `d` with two subpaths is stroked as a single unioned
      // outline, and Chromium antialiases that union across the whole crosshair: the arms
      // come out a hair heavier than the two `<line>`s this replaces. Separate paths paint
      // separately and land on the same pixels.
      { kind: 'path', segments: lineCommands({ x: -arm, y: 0 }, { x: arm, y: 0 }), closed: false, style },
      { kind: 'path', segments: lineCommands({ x: 0, y: -arm }, { x: 0, y: arm }), closed: false, style },
      {
        kind: 'path',
        segments: roundedRectCommands(-dot, -dot, dot * 2, dot * 2, dot),
        closed: true,
        style: dotStyle,
      },
    ],
  }
}

/**
 * The selected Placed Item's Width and Depth, drawn outside its own outline so the outline
 * does not have to be read through them.
 *
 * The lines and the two words are one layer: a measurement nobody can read is a scribble, and
 * a number with no line against it is a guess.
 */
function measurePlacement(
  f: DrawnPlacement,
  sizing: DrawOptions['sizing'],
  formatLength: (mm: number) => string,
  missingGlyphs: MissingGlyph[],
): { items: DisplayItem[]; obstacles: Rect[] } {
  const offset = resolveSize('plan-dim-offset', sizing).mm
  const gap = resolveSize('plan-dim-gap', sizing).mm
  const tick = resolveSize('plan-dim-tick', sizing).mm
  const size = resolveSize('plan-dimension', sizing).mm
  const { x, y, w, h } = f.local
  const toFloor = f.toFloor
  const at = (lx: number, ly: number) => affineApply(toFloor, { x: lx, y: ly })
  const id = f.placement.id

  const widthY = y + h + offset
  const depthX = x - offset
  const items: DisplayItem[] = [
    {
      kind: 'path',
      ref: { id, role: 'dimension-width-line' },
      segments: lineCommands(at(x, widthY), at(x + w, widthY)),
      closed: false,
      style: 'plan-dimension-line',
    },
    {
      kind: 'path',
      ref: { id, role: 'dimension-depth-line' },
      segments: lineCommands(at(depthX, y), at(depthX, y + h)),
      closed: false,
      style: 'plan-dimension-line',
    },
    {
      kind: 'path',
      ref: { id, role: 'dimension-tick' },
      segments: [
        ...lineCommands(at(x, widthY - tick), at(x, widthY + tick)),
        ...lineCommands(at(x + w, widthY - tick), at(x + w, widthY + tick)),
        ...lineCommands(at(depthX - tick, y), at(depthX + tick, y)),
        ...lineCommands(at(depthX - tick, y + h), at(depthX + tick, y + h)),
      ],
      closed: false,
      style: 'plan-dimension-line',
    },
  ]

  const obstacles: Rect[] = []
  const text = (
    role: 'dimension-width' | 'dimension-depth',
    label: string,
    lx: number,
    ly: number,
    anchor: 'middle' | 'end',
  ): void => {
    const layout = layoutText(label, size)
    if (layout.missing.length > 0) {
      missingGlyphs.push({ ref: { id, role }, text: label, chars: layout.missing })
    }
    const point = at(lx, ly)
    obstacles.push(measureRect(layout, point, anchor))
    items.push({
      kind: 'text',
      ref: { id, role },
      text: label,
      at: point,
      anchor,
      baseline: 'middle',
      rotationDeg: 0,
      role: 'dimension',
      style: 'plan-dimension',
      layout,
    })
  }
  text('dimension-width', formatLength(w), x + w / 2, widthY + gap, 'middle')
  text('dimension-depth', formatLength(h), depthX - gap, y + h / 2, 'end')

  return {
    items: [{ kind: 'group', ref: { id, role: 'dimension-lines' }, items }],
    obstacles,
  }
}

/**
 * The `Floor bounds` chip: how much Floor this one Placed Item covers, which is not the same
 * number as its own Width and Depth once it has been turned.
 *
 * It is placed by the same placer that keeps Item labels apart, and it is given the two
 * measurement words as obstacles so the three never land on each other.
 */
function boundsChip(
  f: DrawnPlacement,
  obstacles: readonly Rect[],
  sizing: DrawOptions['sizing'],
  formatLength: (mm: number) => string,
  missingGlyphs: MissingGlyph[],
): DisplayItem | null {
  const text = `Floor bounds ${formatLength(f.world.w)} × ${formatLength(f.world.h)}`
  const size = resolveSize('plan-chip', sizing).mm
  const layout = layoutText(text, size)
  if (layout.missing.length > 0) {
    missingGlyphs.push({ ref: { id: f.placement.id, role: 'floor-bounds-chip' }, text, chars: layout.missing })
  }
  const box = placeLabels({
    footprint: f.world,
    obstacles,
    labels: [{
      id: CHIP_LABEL,
      anchor: { x: f.world.x + f.world.w / 2, y: f.world.y },
      w: text.length * resolveSize('plan-chip-char', sizing).mm,
      h: resolveSize('plan-chip-height', sizing).mm,
    }],
  })[0]
  if (box === undefined) return null
  const corner = resolveSize('plan-chip-corner', sizing).mm
  return {
    kind: 'group',
    items: [
      {
        kind: 'path',
        ref: { id: f.placement.id, role: 'floor-bounds-chip-box' },
        segments: roundedRectCommands(box.x, box.y, box.w, box.h, Math.min(corner, box.w / 2, box.h / 2)),
        closed: true,
        style: 'plan-chip-box',
      },
      {
        // The word carries the address, not the box around it: the box is geometry and stays
        // behind the transform, while the number is lifted into the flat text layer, and the
        // number is what a reader — or a test — asks the chip for.
        kind: 'text',
        ref: { id: f.placement.id, role: 'floor-bounds-chip' },
        text,
        at: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
        anchor: 'middle',
        baseline: 'middle',
        rotationDeg: 0,
        role: 'chip',
        style: 'plan-chip-text',
        layout,
      },
    ],
  }
}

/**
 * The rotate handle: a stem from the Item Origin to a grip past the footprint's furthest
 * corner, far enough out that it stays a 24 CSS px reach whatever the zoom.
 *
 * It is drawn here rather than left in the canvas because its geometry is a Floor-space
 * transform — the grip is a footprint-local point taken through the placement's own matrix —
 * and criterion 6 is that no such transform happens in `ui`. What stays in `ui` is the drag:
 * the angle the pointer asks for, and the one Intent that commits the whole turn.
 */
function rotateHandle(f: DrawnPlacement, sizing: DrawOptions['sizing']): DisplayItem {
  const reach = resolveSize('plan-handle-reach', sizing).mm
  const r = resolveSize('plan-handle-r', sizing).mm
  const { origin } = f.placement
  const { w, h } = f.local
  let corner = 0
  for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]] as const) {
    corner = Math.max(corner, Math.hypot(x - origin.x, y - origin.y))
  }
  const grip = affineApply(f.toFloor, { x: origin.x, y: origin.y - (corner + reach) })
  return {
    kind: 'group',
    ref: { id: f.placement.id, role: 'rotate-handle-group' },
    items: [
      {
        kind: 'path',
        segments: lineCommands(f.originAt, grip),
        closed: false,
        style: 'plan-rotate-stem',
      },
      {
        kind: 'path',
        ref: { id: f.placement.id, role: 'rotate-handle' },
        // A circle, which is a rounded rect whose radius is half its side.
        segments: roundedRectCommands(grip.x - r, grip.y - r, r * 2, r * 2, r),
        closed: true,
        style: 'plan-handle',
      },
    ],
  }
}
