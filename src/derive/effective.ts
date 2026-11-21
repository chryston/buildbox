/**
 * The effective model of one Floor, or of one Item Design in the Item Detail View (#60 §1,
 * #20 §8, #57 §6).
 *
 * The other files in `derive` each answer one question — where a Placed Item sits, what a
 * cabinet projects back into. This one answers the question a renderer asks: *what is on
 * screen right now*. It is the whole read-only projection of a Project at a revision, in the
 * order the Existing Model stores it, with every Floor-space number already computed — the
 * Plan Image's calibration as a matrix, each Item Footprint turned into Floor coordinates,
 * the union box a viewport fits. `drawing` builds its display list from this and nothing
 * else, which is what lets the Plan View, a later SVG export and a test read one picture
 * rather than three (#20 §9).
 *
 * Two rules keep it a derivation rather than a second model:
 *
 *  - **Nothing is stored.** Every value is a function of the arguments, so the same Project
 *    always gives a deep-equal result and no cache is needed for correctness — only for
 *    speed. All memoisation lives in `cache.ts`, and neither holds module-level state.
 *  - **Nothing is re-invented.** The transform is `placement`'s, the footprint is `domain`'s
 *    `footprintPath`, the cabinet layout is `cabinet`'s `computeSceneLayout` reached through
 *    `cabinetSceneUnits`. The renderer switch has to be a zero-diff one, so every value here
 *    was moved out of `ui`, not chosen again.
 *
 * `EntityId` is spelled as `domain` spells it. The issue names `FloorId`, `PlacedItemId` and
 * `ItemDesignId`; the schema has one opaque ID type and never generates one (#42 §3), so
 * three aliases of it would only let a call pass the wrong kind of ID to a parameter.
 */
import { computeSceneLayout } from '../cabinet'
import type { SceneLayout } from '../cabinet'
import { designOrigin } from '../domain'
import type { EntityId, ItemDesign, PlanImage, PlacedItem, Project } from '../domain'
import { applyTransform, bounds, pt, transformSegment } from '../geometry'
import type { Bounds, ClosedPath, Pt, Transform } from '../geometry'
import { affineMultiply, affineRotateDeg, affineScale, affineTranslate } from './affine'
import type { Affine } from './affine'
import { cabinetSceneUnits } from './cabinetSceneUnits'
import { designOutline, normaliseRotation, placementTransform } from './placement'

/**
 * An axis-aligned box in millimetres: the form a renderer writes into `x`/`y`/`width`/
 * `height`, and the form `cabinet`'s `SceneLayout.boundingBox` already uses. `geometry`'s
 * `Bounds` is the same box as two corners, which suits a measurement and not a drawing.
 *
 * `drawing` declares a box of its own rather than importing this one: `derive` and `drawing`
 * are separate seams and a shared type would be a shared dependency for no benefit (#20 §2).
 */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * The Floor's Plan Image, in the form a renderer draws it (#20 §3, #55).
 *
 * The asset bytes stay in the Asset Repository; this is only what it takes to place them:
 * a hash to resolve, a pixel size, and the calibration as a matrix from pixel space into
 * Floor millimetres.
 */
export interface DerivedPlanImage {
  readonly assetHash: string
  readonly widthPx: number
  readonly heightPx: number
  /** Pixels → Floor millimetres: `affineScale(1 / pixelsPerMm)`, or `affineScale(1)` raw. */
  readonly pxToFloor: Affine
  /** Always 1: no opacity is stored anywhere yet, so the Plan View draws it solid (#55). */
  readonly opacity: number
}

/** One Placed Item as the Floor draws it: its footprint in Floor coordinates, and what to call it. */
export interface DerivedPlacement {
  readonly id: EntityId
  readonly designId: EntityId
  readonly kind: ItemDesign['kind']
  /** The Item Design's name — a Placed Item owns no name of its own (#57 §3). */
  readonly label: string
  readonly translation: Pt
  readonly rotationDeg: number
  /**
   * Footprint-local millimetres → Floor millimetres: `affineApply(worldTransform, local)` is
   * `worldPointOf(placementContext(design, placed), local)`, the very matrix `worldPath` was
   * built with. A renderer needs it for the points *outside* the footprint — a dimension line
   * 22 mm below it, a chip anchor beside it — and may not recompute the Item Origin those
   * turn about, which is what keeps that out of `ui` (#60 criterion 6).
   */
  readonly worldTransform: Affine
  /** The Item Footprint through `placementTransform`, arcs still arcs (#16). */
  readonly worldPath: ClosedPath
  /** Analytic: `geometry.bounds` of the footprint through the placement, never a flattened box. */
  readonly worldBounds: Rect
  /** The footprint's own box, which the Item Design canvas and the Measurements tab read. */
  readonly localBounds: Rect
  /**
   * The Item Origin in footprint-local millimetres — the point the rotate handle turns the
   * placement about, and the one number the handle cannot recover from `worldTransform`, which
   * has already folded it in.
   */
  readonly origin: Pt

  /** The Item Design's colour; a cabinet has none, so it takes the one slate the Plan View uses. */
  readonly color: string
}

/** Everything one Floor shows, derived (#60 criterion 3). */
export interface DerivedFloor {
  readonly revision: number
  readonly floorId: EntityId
  /** Always `null` until #69; in the shape and in the cache key now so that issue changes behaviour, not signature. */
  readonly optionId: EntityId | null
  readonly planImage: DerivedPlanImage | null
  /** Existing-Model order, so a re-derive never reorders what is on screen. */
  readonly placements: DerivedPlacement[]
  /** The union of every footprint and the Plan Image, or `null` for an empty Floor. */
  readonly bounds: Rect | null
}

/**
 * Everything one Item Design shows in the Item Detail View (#57 §6).
 *
 * A generic design carries its own footprint, because that is all there is to it. A cabinet
 * carries the whole Floor's `SceneLayout` with this design the active unit — the scene the
 * cabinet canvas draws today, which is the picture the renderer switch has to reproduce.
 */
export type DerivedItemDetail =
  | { readonly kind: 'cabinet'; readonly designId: EntityId; readonly layout: SceneLayout }
  | {
    readonly kind: 'generic'
    readonly designId: EntityId
    /** The Item Footprint in footprint-local millimetres — the design is drawn as it is stored. */
    readonly footprint: ClosedPath
    readonly origin: Pt
    readonly bounds: Rect
    readonly label: string
    readonly color: string
  }

/**
 * How a cabinet's footprint is drawn.
 *
 * A cabinet has no `color` of its own — its appearance is its construction (#42 §2) — so
 * every cabinet placement takes this one slate. The value is `ui`'s `CABINET_PLAN_COLOR`
 * moved, not re-chosen: `derive` may not import `ui` (#20 §2) and the switch must be a
 * zero-diff one, so the constant is restated here with its provenance instead.
 */
const CABINET_PLAN_COLOR = '#475569'

/** `geometry`'s two-corner box as the four numbers a renderer wants. */
const rectOf = (box: Bounds): Rect => ({
  x: box.minX,
  y: box.minY,
  w: box.maxX - box.minX,
  h: box.maxY - box.minY,
})

/** The smallest box holding both; `null` is the empty box, so a union with it is the other one. */
const unionRect = (a: Rect | null, b: Rect): Rect => {
  if (a === null) return b
  const x1 = Math.min(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const x2 = Math.max(a.x + a.w, b.x + b.w)
  const y2 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/**
 * The Floor's Plan Image record as a drawing input.
 *
 * An uncalibrated image is evidence, not a scale (#55): it is drawn raw, one pixel to one
 * millimetre, which is what the Plan View does today. `pxToFloor` stays a real matrix rather
 * than a `null`, so a renderer has no calibration branch of its own to get wrong.
 */
const derivePlanImage = (image: PlanImage | null): DerivedPlanImage | null => {
  if (image === null) return null
  return {
    assetHash: image.assetHash,
    widthPx: image.widthPx,
    heightPx: image.heightPx,
    pxToFloor: affineScale(image.pixelsPerMm === null ? 1 : 1 / image.pixelsPerMm),
    opacity: 1,
  }
}

/**
 * `geometry`'s rigid placement as the matrix a renderer applies: turn about `pivot`, then
 * move to `pivot + translation` — the same arithmetic `applyTransform` does, in one matrix.
 */
const affineOf = (transform: Transform): Affine => affineMultiply(
  affineTranslate(transform.pivot.x + transform.translation.x, transform.pivot.y + transform.translation.y),
  affineMultiply(
    affineRotateDeg(transform.rotationDeg),
    affineTranslate(-transform.pivot.x, -transform.pivot.y),
  ),
)

/** One placement against its design: the same transform the Plan View applies today, applied once. */
const derivePlacement = (design: ItemDesign, placed: PlacedItem): DerivedPlacement => {
  const outline = designOutline(design)
  const transform = placementTransform(design, placed)
  const origin = designOrigin(design)
  return {
    id: placed.id,
    designId: design.id,
    kind: design.kind,
    label: design.name,
    translation: pt(placed.translation.x, placed.translation.y),
    rotationDeg: normaliseRotation(placed.rotationDeg),
    worldTransform: affineOf(transform),
    worldPath: {
      start: applyTransform(outline.start, transform),
      segments: outline.segments.map((segment) => transformSegment(segment, transform)),
    },
    worldBounds: rectOf(bounds(outline, transform)),
    localBounds: rectOf(bounds(outline)),
    origin: pt(origin.x, origin.y),
    color: design.kind === 'cabinet' ? CABINET_PLAN_COLOR : design.color,
  }
}

/**
 * Everything one Floor shows, derived from the Project as it stands.
 *
 * `revision` and `optionId` are carried into the result and into the cache key; neither
 * changes what is computed, because there is nothing else for them to mean until #69 gives a
 * Floor more than one Renovation Option. A `floorId` no Floor answers to is not an error —
 * it derives an empty Floor, which is the honest answer for a Floor that was just deleted
 * while a view was still holding its ID.
 *
 * A placement that points at no Item Design is skipped, exactly as `cabinetSceneUnits`
 * skips one: such a Project is refused by the validator, and the derivation is not the place
 * that says so.
 */
export function effectiveFloor(
  project: Project,
  revision: number,
  floorId: EntityId,
  optionId: EntityId | null,
): DerivedFloor {
  const designs = new Map<EntityId, ItemDesign>()
  for (const design of project.itemDesigns) designs.set(design.id, design)

  const placements: DerivedPlacement[] = []
  for (const placed of project.existingModel.placedItems) {
    if (placed.floorId !== floorId) continue
    const design = designs.get(placed.itemDesignId)
    if (design === undefined) continue
    placements.push(derivePlacement(design, placed))
  }

  const floor = project.floors.find((candidate) => candidate.id === floorId)
  const planImage = derivePlanImage(floor === undefined ? null : floor.planImage)

  let box: Rect | null = null
  for (const placement of placements) box = unionRect(box, placement.worldBounds)
  if (planImage !== null) {
    // The image stands at the Floor origin, scaled by its calibration — the same
    // `width / pixelsPerMm` the Plan View's `<image>` element carries today (#55).
    box = unionRect(box, {
      x: 0,
      y: 0,
      w: planImage.widthPx * planImage.pxToFloor.a,
      h: planImage.heightPx * planImage.pxToFloor.d,
    })
  }

  return { revision, floorId, optionId, planImage, placements, bounds: box }
}

/**
 * What the user calls each Placed Item of one Floor (#67 §16).
 *
 * `Base 600 #2`: a Placed Item owns no name, so two of the same Design on one Floor are told apart
 * by the order they were placed. A Design with one item on this Floor gets no ordinal, because
 * there is nothing to tell apart. The warnings strip, the inspector and the Placed Items table
 * (#68) all read an item by this one label, so they cannot disagree about which `Base 600` a row
 * or a warning means.
 */
export const placementLabels = (placements: readonly DerivedPlacement[]): Map<EntityId, string> => {
  const perDesign = new Map<EntityId, number>()
  for (const placement of placements) perDesign.set(placement.designId, (perDesign.get(placement.designId) ?? 0) + 1)
  const seen = new Map<EntityId, number>()
  const labels = new Map<EntityId, string>()
  for (const placement of placements) {
    const ordinal = (seen.get(placement.designId) ?? 0) + 1
    seen.set(placement.designId, ordinal)
    labels.set(
      placement.id,
      (perDesign.get(placement.designId) ?? 1) > 1 ? `${placement.label} #${String(ordinal)}` : placement.label,
    )
  }
  return labels
}

/**
 * The cabinet's `SceneLayout`: the whole Floor's scene, through `cabinet`'s own engine.
 *
 * The Item Detail's cabinet canvas has always drawn every cabinet on its Floor and marked
 * the shown one active — `App.tsx`'s `computeSceneLayout(units, shownDesignId)` over
 * `projectUnits(project)` — so that is exactly what it gets here, and the object
 * `computeSceneLayout` returns is passed straight through rather than re-projected. Filtering
 * to the one design would be the obvious reading of "the Item Detail of a design", and it
 * would move pixels: the scene's `boundingBox` is what the canvas fits itself to, and the
 * renderer switch is required to be a zero-diff one (#60 criterion 14).
 *
 * `floorId` defaults to Floor 1, the route `projectUnits` takes (#49); naming a Floor draws
 * that Floor's scene instead. A Floor with no cabinets has an empty scene, which is what an
 * empty canvas draws.
 */
function cabinetLayout(project: Project, designId: EntityId, floorId: EntityId | undefined): SceneLayout {
  const sceneFloorId = floorId ?? project.floors[0]?.id
  if (sceneFloorId === undefined) return computeSceneLayout([], null)
  return computeSceneLayout(cabinetSceneUnits(project, sceneFloorId), designId)
}

/**
 * Everything one Item Design shows in the Item Detail View (#57 §6).
 *
 * A generic design is drawn as it is stored: its footprint, its Item Origin, that footprint's
 * box. A cabinet is drawn by `cabinet`'s layout engine, because its plan view is panels,
 * voids and dividers rather than a rectangle — and its scene is the whole Floor's, with this
 * design the active unit, because that is the scene the cabinet canvas draws today.
 *
 * `revision` is the cache's business, not this function's: the same Project always gives the
 * same Item Detail. `floorId` names the Floor whose scene a cabinet is drawn in and defaults
 * to Floor 1, the route `projectUnits` takes (#49); pass the Floor the design was opened from
 * when that is not it. A design that is not in the Project is a caller bug, not a state to
 * draw: it throws.
 */
export function effectiveItemDetail(
  project: Project,
  revision: number,
  designId: EntityId,
  floorId?: EntityId,
): DerivedItemDetail {
  const design = project.itemDesigns.find((candidate) => candidate.id === designId)
  if (design === undefined) {
    throw new Error(`effectiveItemDetail: no Item Design ${designId} is in this Project`)
  }
  if (design.kind === 'generic') {
    const footprint = designOutline(design)
    const origin = designOrigin(design)
    return {
      kind: 'generic',
      designId: design.id,
      footprint,
      origin: pt(origin.x, origin.y),
      bounds: rectOf(bounds(footprint)),
      label: design.name,
      color: design.color,
    }
  }
  return { kind: 'cabinet', designId: design.id, layout: cabinetLayout(project, design.id, floorId) }
}
