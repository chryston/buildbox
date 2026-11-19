/**
 * Placing a preset by hand (#58 §5, behaviours 4 and 5).
 *
 * Two gestures make a shape: drag a box, or click for the default size. Both end the same way —
 * a preset of the armed kind at a centre with a size — and the difference between them is one
 * test on how far the pointer travelled, so it lives here as a value rather than inside a
 * pointer handler where a test would need a browser to see it.
 *
 * The chips are the part the prototype got wrong, and the reason this is a function returning
 * rectangles instead of markup. Variant B floated them over the middle of the shape being
 * drawn, which is the one place a chip cannot be: the thing you are squinting at is the corner
 * you are dragging. Both chips here are placed wholly beyond the box's right and bottom edges,
 * so their rectangles cannot meet the box's at any drag size, and `chipsFor` is pure — the
 * non-intersection is a property of the arithmetic, checked in `placement.test.ts` and again
 * against the rendered boxes in `e2e/smoke/shape-editor.spec.ts`.
 */
import type { PresetKind, Pt, SizeBox } from '../../../derive'
import { presetInBox } from '../../../derive'
import type { ItemFootprint, PresetItemFootprint } from '../../../domain'
import { footprintBounds } from '../../../domain'

/** What a click places when the design has no footprint to take a size from (#58 §5). */
export const DEFAULT_FOOTPRINT_MM = 600

/**
 * A drag this small in both axes was a click.
 *
 * Measured in local millimetres rather than screen pixels so the rule does not change when the
 * canvas is zoomed: 25 mm is under a pixel at the zoom a whole sofa is drawn at, and a deliberate
 * drag of a shape this size is always longer than this.
 */
export const CLICK_SLOP_MM = 25

/** The four sides of a dragged box, in local millimetres, always left-to-right top-to-bottom. */
export interface DragBox {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The live `W` and `D` readouts, each with the rectangle it is drawn in. */
export interface PlacementChips {
  readonly width: Rect & { readonly label: string }
  readonly depth: Rect & { readonly label: string }
}

/** The box a drag describes, whichever way the pointer went. */
export function dragBox(from: Pt, to: Pt): DragBox {
  return {
    minX: Math.min(from.x, to.x),
    minY: Math.min(from.y, to.y),
    maxX: Math.max(from.x, to.x),
    maxY: Math.max(from.y, to.y),
  }
}

/** True when the pointer barely moved, so the gesture is a click for the default size. */
export const isClick = (box: DragBox): boolean =>
  box.maxX - box.minX <= CLICK_SLOP_MM && box.maxY - box.minY <= CLICK_SLOP_MM

/**
 * Where a pointer is, in the canvas's own millimetres.
 *
 * Written out as arithmetic rather than read off `getScreenCTM`, because the browser's matrix
 * needs a `DOMMatrix` to hand back — which jsdom does not implement, so no jsdom test could
 * have dragged anything. This is the same answer: `xMidYMid meet` scales by the tighter axis and
 * centres the frame in the host, so the frame's top-left is inset by half the slack.
 *
 * `null` when the host has no size yet, which is the first paint and every jsdom test that has
 * not said what the canvas is drawn as.
 */
export function clientToLocal(
  host: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  frame: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
  clientX: number,
  clientY: number,
): Pt | null {
  const frameWidth = frame.maxX - frame.minX
  const frameHeight = frame.maxY - frame.minY
  if (host.width <= 0 || host.height <= 0 || frameWidth <= 0 || frameHeight <= 0) return null
  const mmPerPx = Math.max(frameWidth / host.width, frameHeight / host.height)
  const originX = host.left + (host.width - frameWidth / mmPerPx) / 2
  const originY = host.top + (host.height - frameHeight / mmPerPx) / 2
  return { x: frame.minX + (clientX - originX) * mmPerPx, y: frame.minY + (clientY - originY) * mmPerPx }
}

/** What the pointer did: dragged a box, or clicked a point. */
export type PlacementGesture = { readonly box: DragBox } | { readonly point: Pt }

/** What a placement keeps from the shape it replaces: its size and which way it was turned. */
export interface PlacementDefaults {
  readonly size: SizeBox
  readonly orientationDeg: number
}

/**
 * The size a click places and the orientation a new kind inherits (#58 §5).
 *
 * The default size is the local bounds the design already has, so picking Circle on a
 * 1,200 × 400 Rectangle and clicking once gives the Ø400 Circle that fits where it was — the
 * same answer as dragging a 400 mm box, which is the point: the two gestures differ only in
 * whether the person drew the size or accepted the one on offer. With no shape to measure,
 * 600 × 600 mm.
 */
export function placementDefaults(footprint: ItemFootprint | null): PlacementDefaults {
  if (footprint === null) return { size: { width: DEFAULT_FOOTPRINT_MM, depth: DEFAULT_FOOTPRINT_MM }, orientationDeg: 0 }
  const bounds = footprintBounds(footprint)
  return {
    size: { width: bounds.maxX - bounds.minX, depth: bounds.maxY - bounds.minY },
    orientationDeg: footprint.kind === 'preset' ? footprint.orientationDeg : 0,
  }
}

/**
 * The footprint a finished gesture places.
 *
 * A drag puts the shape at the box's centre, at the box's size. A click — or a drag too small to
 * have meant a size — puts the default size centred on the point that was clicked, because a
 * click says "here" and says nothing at all about size.
 */
export function placementFootprint(
  kind: PresetKind,
  gesture: PlacementGesture,
  defaults: PlacementDefaults,
): PresetItemFootprint {
  const box = 'box' in gesture && !isClick(gesture.box) ? gesture.box : null
  const centre: Pt = box !== null
    ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
    : 'point' in gesture
      ? gesture.point
      : { x: (gesture.box.minX + gesture.box.maxX) / 2, y: (gesture.box.minY + gesture.box.maxY) / 2 }
  return {
    kind: 'preset',
    preset: presetInBox(kind, box === null ? defaults.size : { width: box.maxX - box.minX, depth: box.maxY - box.minY }),
    centre,
    orientationDeg: defaults.orientationDeg,
  }
}

/** Chip size, in screen pixels: they are chrome, so they do not grow with the shape. */
const CHIP_HEIGHT_PX = 17
const CHIP_GAP_PX = 8
const CHIP_PAD_PX = 6
const CHIP_CHAR_PX = 6.4

const chipWidth = (label: string): number => CHIP_PAD_PX * 2 + label.length * CHIP_CHAR_PX

/**
 * Where the two readouts go: `W` beyond the right edge, level with the middle of the box;
 * `D` beyond the bottom edge, centred under it.
 *
 * `mmPerPx` turns the pixel sizes into the canvas's own units. Neither chip's rectangle starts
 * before the box ends, which is the whole guarantee — a longer label makes a wider chip, and a
 * wider chip starts further out, never further in.
 */
export function chipsFor(
  box: DragBox,
  labels: { readonly width: string; readonly depth: string },
  mmPerPx: number,
): PlacementChips {
  const height = CHIP_HEIGHT_PX * mmPerPx
  const gap = CHIP_GAP_PX * mmPerPx
  const widthChipWidth = chipWidth(labels.width) * mmPerPx
  const depthChipWidth = chipWidth(labels.depth) * mmPerPx
  return {
    width: {
      label: labels.width,
      x: box.maxX + gap,
      y: (box.minY + box.maxY) / 2 - height / 2,
      width: widthChipWidth,
      height,
    },
    depth: {
      label: labels.depth,
      x: (box.minX + box.maxX) / 2 - depthChipWidth / 2,
      y: box.maxY + gap,
      width: depthChipWidth,
      height,
    },
  }
}
