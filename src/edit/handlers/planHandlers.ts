/**
 * The floor-plan half of the catalogue (#47, #57).
 *
 * A plan object is one Item Design and one Placed Item (#43 §3): the name, colour and size
 * belong to the design and are shared by every placement of it (#57 §2), the position and
 * the turn belong to the placement and belong to it alone. The legacy store dragged from the
 * top-left corner, so a new object still spawns with that corner at the legacy point — but
 * what it stores is the Item Origin's Floor position, which for a design whose Origin is its
 * centre is the same number (#43).
 */
import { designFootprintSize, designHeight, rectangleFootprint } from '../../domain'
import type { EntityId, Project } from '../../domain'
import { normaliseDeg } from '../../geometry'
import { CUSTOM_PLAN_ENTRY, PLAN_CATALOGUE } from '../planCatalogue'
import type { IntentType, Locator, PlanIntent } from '../intents'
import type { Handler, IntentHandler } from './context'
import {
  designPath,
  findDesign,
  floorPath,
  genericPlacementsOn,
  placedPath,
  placementsOf,
  refuse,
  requireExtentValue,
  requireFloor,
  requireGenericDesign,
  requirePlacement,
  removePlacementAndDesign,
  sameJsonValue,
  spendIds,
} from './support'
import { creationLayerField } from './creationLayer'

/**
 * The `plan.*` handlers, minus the three that are about another Floor — removing a Plan
 * Image and taking Placed Items across a Floor boundary live with the Floor handlers in
 * `floorHandlers.ts`, where the rules they share with duplicating a Floor are stated once.
 * `INTENT_HANDLERS` is the completeness check over all of them.
 */
type PlanHandlers = {
  [T in Exclude<
    Extract<IntentType, `plan.${string}`>,
    'plan.removeImage' | 'plan.copyToFloor' | 'plan.moveToFloor'
  >]: IntentHandler<T>
}

/** The legacy sidebar drops a new object with its top-left corner here. */
const LEGACY_SPAWN_X_MM = 100
const LEGACY_SPAWN_Y_MM = 100

/** `legacyTopLeft + size / 2`, the #43 placement convention. */
function centreAt(x: number, y: number, width: number, depth: number): { x: number; y: number } {
  return { x: x + width / 2, y: y + depth / 2 }
}

/**
 * The legacy `clearFloorPlan`: the objects go, and with them the designs that were theirs
 * alone. The Plan Image stays; its scale resets, because it described a plan that is gone.
 */
function clearGenericItems(draft: Project, floorId: EntityId): void {
  const removed = genericPlacementsOn(draft, floorId)
  // Assigning a filtered copy that is identical would make clearing an empty floor plan
  // look like an edit, so the lists are only rewritten when the floor really had objects.
  if (removed.length > 0) {
    const removedDesignIds = new Set(removed.map((placed) => placed.itemDesignId))
    draft.existingModel.placedItems = draft.existingModel.placedItems.filter(
      (placed) => !(placed.floorId === floorId && removedDesignIds.has(placed.itemDesignId)),
    )
    draft.itemDesigns = draft.itemDesigns.filter(
      (design) => !removedDesignIds.has(design.id) || placementsOf(draft, design.id).length > 0,
    )
  }
  const floor = requireFloor(draft, floorId)
  // Only a scale that was actually set counts as a change: assigning a fresh Plan Image
  // object with the same contents would make a no-op look like an edit.
  if (floor.planImage !== null && floor.planImage.pixelsPerMm !== null) {
    floor.planImage = { ...floor.planImage, pixelsPerMm: null }
  }
}

const addObject: Handler<'plan.addObject'> = (ctx) => {
  const { floorId, catalogKey, target } = ctx.intent.payload
  const [itemDesignId, placedItemId] = spendIds(ctx.intent.ids, 2, ctx.intent.type)
  requireFloor(ctx.project, floorId)
  const entry = PLAN_CATALOGUE[catalogKey]
  if (entry === undefined) {
    refuse('unknown-target', 'payload.catalogKey', `No floor-plan catalog entry ${catalogKey} exists.`)
  }
  ctx.draft.itemDesigns.push({
    id: itemDesignId,
    kind: 'generic',
    name: entry.label,
    footprint: rectangleFootprint(entry.w, entry.h),
    origin: { x: entry.w / 2, y: entry.h / 2 },
    height: entry.height,
    heightIsTypical: true,
    color: entry.color,
    catalogKey,
  })
  ctx.draft.existingModel.placedItems.push({
    id: placedItemId,
    itemDesignId,
    floorId,
    translation: centreAt(LEGACY_SPAWN_X_MM, LEGACY_SPAWN_Y_MM, entry.w, entry.h),
    rotationDeg: 0,
    baseElevation: entry.base,
    // A Placed Item is furniture, not fabric: it joins `Furniture` (#71 §2).
    ...creationLayerField(ctx.project, target?.viewId, 'item'),
  })
}

/**
 * Place an Item Design that already exists (#57 §2): reuse, never a copy.
 *
 * This is what the library's `In this Project` section does, and it is the end of the
 * fork-on-place behaviour #20 §3 allowed until S5 — a migrated `CustomTemplate` design now
 * gains a placement instead of a twin, so a design placed on two Floors is one design.
 * The new Placed Item spawns at the legacy corner with no turn and on the Floor Datum.
 */
const placeDesign: Handler<'plan.placeDesign'> = (ctx) => {
  const { floorId, itemDesignId, target } = ctx.intent.payload
  const [placedItemId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  requireFloor(ctx.project, floorId)
  const design = findDesign(ctx.project, itemDesignId)
  if (design === undefined) {
    refuse('unknown-target', designPath(itemDesignId), `No Item Design ${itemDesignId} is in this Project.`)
  }
  const { width, depth } = designFootprintSize(design)
  ctx.draft.existingModel.placedItems.push({
    id: placedItemId,
    itemDesignId,
    floorId,
    translation: centreAt(LEGACY_SPAWN_X_MM, LEGACY_SPAWN_Y_MM, width, depth),
    rotationDeg: 0,
    baseElevation: 0,
    ...creationLayerField(ctx.project, target?.viewId, 'item'),
  })
}

/**
 * Where the Item Origin stands (#57 behaviour 33): the drag and the `Position X` /
 * `Position Y` fields both write this one point. The Placed Item owns no pivot and no size,
 * so there is nothing else here for a move to touch.
 */
const movePlacement: Handler<'plan.movePlacement'> = (ctx) => {
  const { placedItemId, translation } = ctx.intent.payload
  requirePlacement(ctx.project, placedItemId)
  const draftPlacement = requirePlacement(ctx.draft, placedItemId)
  draftPlacement.translation.x = translation.x
  draftPlacement.translation.y = translation.y
}

/**
 * One Vertical Extent box of a Placed Item (#74 §5). Both answers move the item, because a Placed Item
 * owns its base and nothing else: `base` stands it at the entered elevation, `top` stands it so that
 * the height its Item Design owns lands just under the entered top.
 *
 * Nothing here is written to the Design, and there is nowhere on a Placed Item to write a height — the
 * schema has no such field, which is #74 §7's guard against the prototype's per-placement copy. The
 * Height line the inspector shows under these two boxes is read from the Design, and stays true for
 * every other placement of it.
 */
const setPlacementVerticalExtent: Handler<'plan.setPlacementVerticalExtent'> = (ctx) => {
  const { placedItemId, field, value } = ctx.intent.payload
  const placement = requirePlacement(ctx.project, placedItemId)
  const design = findDesign(ctx.project, placement.itemDesignId)
  if (design === undefined) {
    refuse('unknown-target', placedPath(placedItemId), 'This item has no item design to take a height from.')
  }
  // A Placed Item owns no top of its own — its Item Design's height sits on the base — and it has no
  // `bottom` field to check against one, so there is no top for the check to hold.
  requireExtentValue(field, value, `${placedPath(placedItemId)}.baseElevation`, placement.baseElevation, null)
  requirePlacement(ctx.draft, placedItemId).baseElevation =
    field === 'base' ? value : value - designHeight(design)
}

/**
 * One turn about the Item Origin (#57 behaviour 33). Free rotation: any decimal, clockwise
 * with +Y down, normalised into the one turn the validator asks for. The Item Footprint is
 * never re-authored by a turn, which is why a 600 × 400 design at 90° still reads 600 wide.
 */
const rotatePlacement: Handler<'plan.rotatePlacement'> = (ctx) => {
  const { placedItemId, rotationDeg } = ctx.intent.payload
  requirePlacement(ctx.project, placedItemId)
  const draftPlacement = requirePlacement(ctx.draft, placedItemId)
  draftPlacement.rotationDeg = normaliseDeg(rotationDeg)
}

const removeObject: Handler<'plan.removeObject'> = (ctx) => {
  const { placedItemId } = ctx.intent.payload
  requirePlacement(ctx.project, placedItemId)
  removePlacementAndDesign(ctx.draft, placedItemId)
}

/** A custom shape is a design with no placement: the sidebar's entry, not a floor object. */
const addTemplate: Handler<'plan.addTemplate'> = (ctx) => {
  const { label, w, h, color } = ctx.intent.payload
  const [itemDesignId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  ctx.draft.itemDesigns.push({
    id: itemDesignId,
    kind: 'generic',
    name: label,
    footprint: rectangleFootprint(w, h),
    origin: { x: w / 2, y: h / 2 },
    height: CUSTOM_PLAN_ENTRY.height,
    heightIsTypical: true,
    color,
    isCustom: true,
  })
}

const removeTemplate: Handler<'plan.removeTemplate'> = (ctx) => {
  const { itemDesignId } = ctx.intent.payload
  requireGenericDesign(ctx.project, itemDesignId)
  const placed = placementsOf(ctx.project, itemDesignId)
  if (placed.length > 0) {
    refuse(
      'unknown-target',
      designPath(itemDesignId),
      `This custom shape is placed ${placed.length} time${placed.length === 1 ? '' : 's'} on the floor plan. Remove those items first.`,
    )
  }
  ctx.draft.itemDesigns = ctx.draft.itemDesigns.filter((design) => design.id !== itemDesignId)
}

const setPlanImage: Handler<'plan.setImage'> = (ctx) => {
  const { floorId, image } = ctx.intent.payload
  const floor = requireFloor(ctx.project, floorId)
  const draftFloor = requireFloor(ctx.draft, floorId)
  // A different picture is a different picture: its pixels mean nothing until the user says
  // what a known distance measures, so the old calibration goes with the old bytes (#56).
  // Nothing else on the Floor is touched — clearing a Plan Image never clears Placed Items.
  const sameBytes = floor.planImage !== null && floor.planImage.assetHash === image.assetHash
  const next = { ...image, pixelsPerMm: sameBytes ? floor.planImage?.pixelsPerMm ?? null : null }
  if (!sameJsonValue(draftFloor.planImage, next)) draftFloor.planImage = next
}

const calibrateScale: Handler<'plan.calibrate'> = (ctx) => {
  const { floorId, pixelsPerMm } = ctx.intent.payload
  const image = requireFloor(ctx.project, floorId).planImage
  if (image === null) refuse('unknown-target', floorPath(floorId), 'This Floor has no Plan Image to calibrate.')
  const draftFloor = requireFloor(ctx.draft, floorId)
  if (image.pixelsPerMm !== pixelsPerMm) draftFloor.planImage = { ...image, pixelsPerMm }
}

const clearPlan: Handler<'plan.clear'> = (ctx) => {
  const { floorId } = ctx.intent.payload
  requireFloor(ctx.project, floorId)
  clearGenericItems(ctx.draft, floorId)
}

// --- Where a floor-plan edit lands ------------------------------------------

export function planLocator(
  project: Project,
  intent: Exclude<PlanIntent, { type: 'plan.removeImage' | 'plan.copyToFloor' | 'plan.moveToFloor' }>,
): Locator {
  switch (intent.type) {
    case 'plan.addObject':
      return {
        floorId: intent.payload.floorId,
        viewId: null, view: 'plan',
        itemDesignIds: intent.ids.slice(0, 1),
        placedItemIds: intent.ids.slice(1, 2),
      }
    case 'plan.placeDesign':
      return {
        floorId: intent.payload.floorId,
        viewId: null, view: 'plan',
        itemDesignIds: [intent.payload.itemDesignId],
        placedItemIds: intent.ids.slice(0, 1),
      }
    case 'plan.movePlacement':
    case 'plan.setPlacementVerticalExtent':
    case 'plan.rotatePlacement':
    case 'plan.removeObject': {
      const placement = project.existingModel.placedItems.find((item) => item.id === intent.payload.placedItemId)
      return {
        floorId: placement?.floorId ?? null,
        viewId: null, view: 'plan',
        itemDesignIds: placement === undefined ? [] : [placement.itemDesignId],
        placedItemIds: [intent.payload.placedItemId],
      }
    }
    case 'plan.addTemplate':
      return { floorId: null, viewId: null, view: 'plan', itemDesignIds: intent.ids.slice(0, 1), placedItemIds: [] }
    case 'plan.removeTemplate':
      return {
        floorId: null,
        viewId: null, view: 'plan',
        itemDesignIds: [intent.payload.itemDesignId],
        placedItemIds: placementsOf(project, intent.payload.itemDesignId).map((item) => item.id),
      }
    case 'plan.setImage':
    case 'plan.calibrate':
      return { floorId: intent.payload.floorId, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] }
    case 'plan.clear': {
      const removed = genericPlacementsOn(project, intent.payload.floorId)
      return {
        floorId: intent.payload.floorId,
        viewId: null, view: 'plan',
        itemDesignIds: removed.map((item) => item.itemDesignId),
        placedItemIds: removed.map((item) => item.id),
      }
    }
  }
}

export const PLAN_HANDLERS: PlanHandlers = {
  'plan.addObject': { run: addObject, locate: planLocator },
  'plan.placeDesign': { run: placeDesign, locate: planLocator },
  'plan.movePlacement': { run: movePlacement, locate: planLocator },
  'plan.setPlacementVerticalExtent': { run: setPlacementVerticalExtent, locate: planLocator },
  'plan.rotatePlacement': { run: rotatePlacement, locate: planLocator },
  'plan.removeObject': { run: removeObject, locate: planLocator },
  'plan.addTemplate': { run: addTemplate, locate: planLocator },
  'plan.removeTemplate': { run: removeTemplate, locate: planLocator },
  'plan.setImage': { run: setPlanImage, locate: planLocator },
  'plan.calibrate': { run: calibrateScale, locate: planLocator },
  'plan.clear': { run: clearPlan, locate: planLocator },
}
