/**
 * The floor-plan half of the catalogue (#47).
 *
 * A plan object is one generic Item Design and one Placed Item (#43 §3): the size, colour
 * and name belong to the design, the position and rotation to the placement. The legacy
 * store dragged and resized from the top-left corner, so a resize keeps that corner still
 * and moves the Item Origin — the placement's translation — by half the change.
 */
import type { EntityId, GenericItemDesign, Project } from '../../domain'
import { CUSTOM_PLAN_ENTRY, PLAN_CATALOGUE } from '../planCatalogue'
import type { IntentType, Locator, PlanIntent } from '../intents'
import type { Handler, IntentHandler } from './context'
import {
  designPath,
  findDesign,
  floorPath,
  genericPlacementsOn,
  placementsOf,
  refuse,
  requireFloor,
  requirePlacement,
  removePlacementAndDesign,
  sameJsonValue,
  spendIds,
} from './support'

type PlanHandlers = { [T in Extract<IntentType, `plan.${string}`>]: IntentHandler<T> }

/** The legacy 10 mm floor, which the UI clamps to before it sends the Intent. */
const MIN_PLAN_SIZE_MM = 10

/** The legacy sidebar drops a new object with its top-left corner here. */
const LEGACY_SPAWN_X_MM = 100
const LEGACY_SPAWN_Y_MM = 100

/** A generic Item Design, or a rejection: every plan-object Intent starts here. */
function requireGenericDesign(project: Project, itemDesignId: EntityId): GenericItemDesign {
  const design = findDesign(project, itemDesignId)
  if (design === undefined) refuse('unknown-target', designPath(itemDesignId), `No Item Design ${itemDesignId} is in this Project.`)
  if (design.kind !== 'generic') refuse('unknown-target', designPath(itemDesignId), `Item Design ${itemDesignId} is not a floor-plan object.`)
  return design
}

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
  const { floorId, catalogKey } = ctx.intent.payload
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
    footprint: { kind: 'rectangle', width: entry.w, depth: entry.h },
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
  })
}

/**
 * Place a custom shape. The template itself stays — placing it forks a copy the user can
 * then resize without touching the shape in the sidebar (#20 §3).
 */
const addFromTemplate: Handler<'plan.addFromTemplate'> = (ctx) => {
  const { floorId, templateItemDesignId } = ctx.intent.payload
  const [itemDesignId, placedItemId] = spendIds(ctx.intent.ids, 2, ctx.intent.type)
  requireFloor(ctx.project, floorId)
  const template = requireGenericDesign(ctx.project, templateItemDesignId)
  if (template.isCustom !== true) {
    refuse('unknown-target', designPath(templateItemDesignId), `Item Design ${templateItemDesignId} is not a custom shape.`)
  }
  ctx.draft.itemDesigns.push({ ...template, id: itemDesignId, isCustom: true })
  ctx.draft.existingModel.placedItems.push({
    id: placedItemId,
    itemDesignId,
    floorId,
    translation: centreAt(LEGACY_SPAWN_X_MM, LEGACY_SPAWN_Y_MM, template.footprint.width, template.footprint.depth),
    rotationDeg: 0,
    baseElevation: CUSTOM_PLAN_ENTRY.base,
  })
}

const updateObject: Handler<'plan.updateObject'> = (ctx) => {
  const { placedItemId, patch } = ctx.intent.payload
  const placement = requirePlacement(ctx.project, placedItemId)
  const design = requireGenericDesign(ctx.project, placement.itemDesignId)
  const nextWidth = patch.w ?? design.footprint.width
  const nextDepth = patch.h ?? design.footprint.depth
  if (nextWidth < MIN_PLAN_SIZE_MM || nextDepth < MIN_PLAN_SIZE_MM) {
    refuse(
      'invalid-size',
      designPath(design.id),
      `A floor-plan object is at least ${MIN_PLAN_SIZE_MM} mm across; this one asked for ${Math.min(nextWidth, nextDepth)} mm.`,
    )
  }
  const draftPlacement = requirePlacement(ctx.draft, placedItemId)
  const draftDesign = requireGenericDesign(ctx.draft, design.id)
  // A drag keeps the top-left corner the legacy store recorded, so the Item Origin moves
  // by half the change in size. An explicit `x`/`y` is that corner, restated.
  if (patch.x === undefined) draftPlacement.translation.x += (nextWidth - design.footprint.width) / 2
  else draftPlacement.translation.x = patch.x + nextWidth / 2
  if (patch.y === undefined) draftPlacement.translation.y += (nextDepth - design.footprint.depth) / 2
  else draftPlacement.translation.y = patch.y + nextDepth / 2
  // The validator keeps rotation in one turn; a drag past 360° lands back inside it.
  if (patch.rotation !== undefined) draftPlacement.rotationDeg = ((patch.rotation % 360) + 360) % 360
  if (patch.label !== undefined) draftDesign.name = patch.label
  if (patch.color !== undefined) draftDesign.color = patch.color
  if (patch.w !== undefined || patch.h !== undefined) {
    draftDesign.footprint = { ...draftDesign.footprint, width: nextWidth, depth: nextDepth }
    draftDesign.origin = { ...draftDesign.origin, x: nextWidth / 2, y: nextDepth / 2 }
  }
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
    footprint: { kind: 'rectangle', width: w, depth: h },
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
  const { floorId, image, clearExisting } = ctx.intent.payload
  const floor = requireFloor(ctx.project, floorId)
  // Replacing the picture keeps the scale the user calibrated, unless this upload is the
  // confirm-after-clearing path, which clears the floor plan in the same transaction.
  const keptPixelsPerMm = clearExisting ? null : floor.planImage?.pixelsPerMm ?? null
  const draftFloor = requireFloor(ctx.draft, floorId)
  if (clearExisting) clearGenericItems(ctx.draft, floorId)
  const next = image === null ? null : { ...image, pixelsPerMm: keptPixelsPerMm }
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

export function planLocator(project: Project, intent: PlanIntent): Locator {
  switch (intent.type) {
    case 'plan.addObject':
    case 'plan.addFromTemplate':
      return {
        floorId: intent.payload.floorId,
        view: 'plan',
        itemDesignIds: intent.ids.slice(0, 1),
        placedItemIds: intent.ids.slice(1, 2),
      }
    case 'plan.updateObject':
    case 'plan.removeObject': {
      const placement = project.existingModel.placedItems.find((item) => item.id === intent.payload.placedItemId)
      return {
        floorId: placement?.floorId ?? null,
        view: 'plan',
        itemDesignIds: placement === undefined ? [] : [placement.itemDesignId],
        placedItemIds: [intent.payload.placedItemId],
      }
    }
    case 'plan.addTemplate':
      return { floorId: null, view: 'plan', itemDesignIds: intent.ids.slice(0, 1), placedItemIds: [] }
    case 'plan.removeTemplate':
      return {
        floorId: null,
        view: 'plan',
        itemDesignIds: [intent.payload.itemDesignId],
        placedItemIds: placementsOf(project, intent.payload.itemDesignId).map((item) => item.id),
      }
    case 'plan.setImage':
    case 'plan.calibrate':
      return { floorId: intent.payload.floorId, view: 'plan', itemDesignIds: [], placedItemIds: [] }
    case 'plan.clear': {
      const removed = genericPlacementsOn(project, intent.payload.floorId)
      return {
        floorId: intent.payload.floorId,
        view: 'plan',
        itemDesignIds: removed.map((item) => item.itemDesignId),
        placedItemIds: removed.map((item) => item.id),
      }
    }
  }
}

export const PLAN_HANDLERS: PlanHandlers = {
  'plan.addObject': { run: addObject, locate: planLocator },
  'plan.addFromTemplate': { run: addFromTemplate, locate: planLocator },
  'plan.updateObject': { run: updateObject, locate: planLocator },
  'plan.removeObject': { run: removeObject, locate: planLocator },
  'plan.addTemplate': { run: addTemplate, locate: planLocator },
  'plan.removeTemplate': { run: removeTemplate, locate: planLocator },
  'plan.setImage': { run: setPlanImage, locate: planLocator },
  'plan.calibrate': { run: calibrateScale, locate: planLocator },
  'plan.clear': { run: clearPlan, locate: planLocator },
}
