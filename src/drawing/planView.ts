/**
 * The Plan View's display list (#60).
 *
 * Everything the Floor surface draws that is *what the model says*, in Floor millimetres:
 * the Plan Image, every Placed Item's Item Footprint, and the Item Design's name beside it.
 * What the pointer is doing — the rotate handle, the snap markers, the hatched renovation
 * overlay — stays in `ui`, because a display list is a description of a drawing and not a
 * record of a gesture.
 *
 * The arithmetic here is the arithmetic `PlanViewCanvas` used to do in JSX. It moved for the
 * reason the whole issue exists: the Item Detail View needs the same footprints and the same
 * words, and two copies of a projection drift.
 */
import type { Affine, DerivedFloor, DerivedPlacement } from '../derive'
import { affineApply, affineMultiply, affineRotateDeg, affineTranslate } from '../derive'
import type { EntityId } from '../domain'
import { bounds as boundsOf } from '../geometry'
import type { ClosedPath, Pt, Transform } from '../geometry'
import { layoutText, measureRect } from './font/layoutText'
import { pathToCommands, rectCommands } from './path'
import { resolveSize } from './styles'
import type {
  DisplayItem,
  DisplayLayer,
  DisplayList,
  DrawOptions,
  MissingGlyph,
  PathCommand,
  Rect,
} from './types'

/**
 * What the pointer is doing to the drawing, and nothing else.
 *
 * A preview is an argument rather than a mutation: `derive`'s cache is keyed by the Project's
 * revision and a drag does not revise the Project until it commits, so the list is rebuilt
 * for the length of the drag and thrown away after it. `scope: 'design'` is the Shape tab's
 * pending Item Footprint edit, which shows on every Placed Item of that Item Design at once
 * (#57 D3) — one Item Design, many Placed Items, one edit.
 */
export type PlanPreview =
  | {
      scope: 'placement'
      id: EntityId
      translation?: Pt
      rotationDeg?: number
      footprint?: ClosedPath
      origin?: Pt
    }
  | { scope: 'design'; id: EntityId; footprint: ClosedPath; origin?: Pt }

/** What the Plan View surface knows that the derived Floor does not. */
export type PlanViewInput = {
  /** The Plan View's own switch; a Floor can show its Plan Image in one view and not another. */
  showPlanImage: boolean
  preview?: PlanPreview | null
}

/** The box a Floor with no Plan Image is drawn in: the same sheet of paper the canvas used. */
const PLACEHOLDER_MM = { w: 800, h: 600 }

/**
 * The Plan View's drawing.
 *
 * Layers come out in `LAYER_ORDER` order and only when they have something in them; an empty
 * band is noise a renderer would have to skip.
 */
export function drawPlanView(
  d: DerivedFloor,
  view: PlanViewInput,
  options: DrawOptions,
): DisplayList {
  const { sizing } = options
  const missingGlyphs: MissingGlyph[] = []
  const image = view.showPlanImage ? d.planImage : null

  const drawn = d.placements.map((p) => drawPlacement(p, view.preview))

  const itemItems: DisplayItem[] = drawn.map((f) => ({
    kind: 'group' as const,
    ref: { id: f.placement.id, role: 'placed-item' },
    ...(f.transform === null ? {} : { transform: f.transform }),
    items: [{
      kind: 'path' as const,
      segments: f.segments,
      closed: true,
      style: 'plan-item' as const,
      color: f.placement.color,
    }],
  }))

  const labelItems: DisplayItem[] = drawn.map((f) => {
    const size = resolveSize('plan-label', sizing)
    const layout = layoutText(f.placement.label, size.mm)
    if (layout.missing.length > 0) {
      missingGlyphs.push({
        ref: { id: f.placement.id, role: 'item-label' },
        text: f.placement.label,
        chars: layout.missing,
      })
    }
    return {
      kind: 'text' as const,
      ref: { id: f.placement.id, role: 'item-label' },
      text: f.placement.label,
      at: f.labelAt,
      anchor: 'middle' as const,
      baseline: 'middle' as const,
      rotationDeg: 0,
      role: 'label' as const,
      style: 'plan-label' as const,
      color: f.placement.color,
      layout,
    }
  })

  const layers: DisplayLayer[] = []
  const imageItems: DisplayItem[] = image === null
    ? [{
        kind: 'path' as const,
        ref: { id: d.floorId, role: 'plan-placeholder' },
        segments: rectCommands(0, 0, PLACEHOLDER_MM.w, PLACEHOLDER_MM.h),
        closed: true,
        style: 'plan-placeholder' as const,
      }]
    : [{
        kind: 'image' as const,
        ref: { id: d.floorId, role: 'plan-image' },
        assetHash: image.assetHash,
        widthPx: image.widthPx,
        heightPx: image.heightPx,
        transform: image.pxToFloor,
        opacity: image.opacity,
      }]
  layers.push({ key: 'plan-image', items: imageItems })
  if (itemItems.length > 0) layers.push({ key: 'placed-items', items: itemItems })
  if (labelItems.length > 0) layers.push({ key: 'placed-item-labels', items: labelItems })

  // The sheet is the geometry `derive` measured widened to the words drawn on it: a label
  // that hangs off the edge of the Plan Image still has to be on the paper (#60 criterion 12).
  let box = image === null
    ? { x: 0, y: 0, w: PLACEHOLDER_MM.w, h: PLACEHOLDER_MM.h }
    : imageBounds(image.pxToFloor, image.widthPx, image.heightPx)
  if (d.bounds !== null) box = unionRect(box, d.bounds)
  for (const item of labelItems) {
    if (item.kind === 'text') box = unionRect(box, measureRect(item.layout, item.at, item.anchor))
  }

  return { space: 'floor', bounds: box, layers, missingGlyphs }
}

/**
 * One Placed Item as the Floor draws it: its outline in Floor millimetres, the matrix that
 * would have put it there, and where its name and its Item Origin go.
 *
 * The outline is normally `DerivedPlacement.worldPath`, already in Floor millimetres, so the
 * common case carries no transform at all. A preview is the exception: a pending Item
 * Footprint has never been through the placement, so it travels with the matrix that does it.
 */
export interface DrawnPlacement {
  placement: DerivedPlacement
  segments: PathCommand[]
  /** The matrix the emitted outline travels under, or `null` when it needs none. */
  transform: Affine | null
  /**
   * Footprint-local millimetres → Floor millimetres, preview included.
   *
   * Always there, even when the outline does not need it, because a measurement is taken in
   * footprint-local millimetres and drawn outside the footprint — `(0, depth + 22)` is not a
   * point any path passes through.
   */
  toFloor: Affine
  /** Where the Item Origin sits on the Floor right now: the rotate handle turns it about this. */
  originAt: Pt
  /** Where a pending Item Origin would sit, or `null` when nothing is pending (#57 D3). */
  previewOriginAt: Pt | null
  labelAt: Pt
  /** The box this Placed Item covers on the Floor, preview included. */
  world: Rect
  /** The Item Footprint's own box, in footprint-local millimetres. */
  local: Rect
}

export function drawPlacement(p: DerivedPlacement, preview: PlanPreview | undefined | null): DrawnPlacement {
  const over = preview !== null && preview !== undefined && matches(p, preview) ? preview : null
  if (over === null) {
    return {
      placement: p,
      segments: pathToCommands(p.worldPath),
      transform: null,
      toFloor: p.worldTransform,
      originAt: p.translation,
      previewOriginAt: null,
      labelAt: centre(p.worldBounds),
      world: p.worldBounds,
      local: p.localBounds,
    }
  }

  const origin = over.origin ?? localOrigin(p)
  const translation = 'translation' in over && over.translation !== undefined
    ? over.translation
    : p.translation
  const rotationDeg = 'rotationDeg' in over && over.rotationDeg !== undefined
    ? over.rotationDeg
    : p.rotationDeg

  if (over.footprint !== undefined) {
    const toFloor = affineMultiply(
      affineMultiply(affineTranslate(translation.x, translation.y), affineRotateDeg(rotationDeg)),
      affineTranslate(-origin.x, -origin.y),
    )
    const local = rectOfBounds(boundsOf(over.footprint))
    return {
      placement: p,
      segments: pathToCommands(over.footprint),
      transform: toFloor,
      toFloor,
      originAt: translation,
      previewOriginAt: over.scope === 'design' && over.origin !== undefined
        ? affineApply(toFloor, over.origin)
        : null,
      labelAt: centre(local),
      world: rectOfBounds(boundsOf(over.footprint, {
        rotationDeg,
        translation: { x: translation.x - origin.x, y: translation.y - origin.y },
        pivot: origin,
      })),
      local,
    }
  }

  // The footprint itself is unchanged, so the preview is a movement of what `derive` has
  // already projected: `R(θ)(q − o) + t` to `R(θ′)(q − o) + t′` is a turn of `θ′ − θ` about
  // the Item Origin's own Floor position, followed by the slide the pointer asked for.
  const delta = affineMultiply(
    affineMultiply(
      affineTranslate(translation.x, translation.y),
      affineRotateDeg(rotationDeg - p.rotationDeg),
    ),
    affineTranslate(-p.translation.x, -p.translation.y),
  )
  const shift: Transform = {
    rotationDeg: rotationDeg - p.rotationDeg,
    translation: { x: translation.x - p.translation.x, y: translation.y - p.translation.y },
    pivot: p.translation,
  }
  const world = rectOfBounds(boundsOf(p.worldPath, shift))
  return {
    placement: p,
    segments: pathToCommands(p.worldPath),
    transform: delta,
    toFloor: affineMultiply(delta, p.worldTransform),
    originAt: translation,
    previewOriginAt: null,
    labelAt: centre(world),
    world,
    local: p.localBounds,
  }
}

/** Whether a preview touches this Placed Item: itself, or every Placed Item of its design. */
const matches = (p: DerivedPlacement, preview: PlanPreview): boolean =>
  preview.scope === 'placement' ? p.id === preview.id : p.designId === preview.id

/**
 * The Item Origin in footprint-local millimetres, read back out of the placement's matrix.
 *
 * `placementTransform` is `rotate about the Item Origin, then translate`, so it carries the
 * Item Origin to `placed.translation` — and inverting the matrix is the only way to ask it
 * where it started.
 */
function localOrigin(p: DerivedPlacement): Pt {
  const dx = p.translation.x - p.worldTransform.e
  const dy = p.translation.y - p.worldTransform.f
  return {
    x: p.worldTransform.a * dx + p.worldTransform.b * dy,
    y: -p.worldTransform.b * dx + p.worldTransform.a * dy,
  }
}

/** A `geometry` two-corner box as the four numbers a drawing wants. */
const rectOfBounds = (b: { minX: number; minY: number; maxX: number; maxY: number }): Rect =>
  ({ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY })

/**
 * The middle of a box, which is where a Placed Item's name goes.
 *
 * A rectangle is centrally symmetric, so this is also the middle of whatever box it has been
 * turned into — which is why the label can be anchored off `worldBounds` and need never know
 * the placement's rotation.
 */
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Where an image's own pixel box lands in the drawing's millimetres. */
function imageBounds(transform: Affine, widthPx: number, heightPx: number): Rect {
  const lo = affineApply(transform, { x: 0, y: 0 })
  const hi = affineApply(transform, { x: widthPx, y: heightPx })
  return {
    x: Math.min(lo.x, hi.x),
    y: Math.min(lo.y, hi.y),
    w: Math.abs(hi.x - lo.x),
    h: Math.abs(hi.y - lo.y),
  }
}

/**
 * The smallest box that holds both.
 *
 * Exported because the selection's annotations widen the sheet the same way the Floor does,
 * and a second copy of four `Math.min`s is how two surfaces stop agreeing (#60).
 */
export const unionRect = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}
