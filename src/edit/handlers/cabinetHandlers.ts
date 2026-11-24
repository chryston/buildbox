/**
 * The cabinet half of the catalogue (#47).
 *
 * Every tree edit here is the same three steps: check the target against the Project as it
 * stands, run one of `cabinet`'s pure functions on the base tree, write the result into the
 * draft. `cabinet` is never modified and never sees a draft proxy (#20 §2), and the only
 * place a new space ID appears is the rename after `addShelf`/`addDivider` — which keeps
 * its own `nanoid` and stays untouched.
 */
import {
  addAccessory,
  addDivider,
  addShelf,
  deleteBoard,
  distributeEvenly,
  pinNode,
  removeAccessory,
  setDrawerConfig,
  setElementType,
  setNodeLabel,
  setNodeSize,
  setSplitRatio,
  unpinNode,
} from '../../cabinet'
import type { CabinetNode, EntityId, GlobalSettings, Project } from '../../domain'
import type { CabinetIntent, IntentType, Locator } from '../intents'
import { LEGACY_DEFAULT_SETTINGS } from '../defaults'
import type { Handler, IntentHandler } from './context'
import {
  assignChanged,
  cabinetPlacementsOn,
  designPath,
  findDesign,
  firstFloor,
  newNodeIds,
  nodeIds,
  placementsOf,
  refuse,
  renameNewNodeIds,
  requireCabinetDesign,
  requireNode,
  runCabinet,
  spendIds,
} from './support'
import { creationLayerField } from './creationLayer'

type CabinetHandlers = { [T in Extract<IntentType, `cabinet.${string}`>]: IntentHandler<T> }

// --- The tree ---------------------------------------------------------------

/**
 * Run one tree operation on the base tree and write the new root into the draft.
 *
 * `cabinet`'s `mapNode` always returns a fresh tree object, so the write goes through
 * `assignChanged`, which tells the draft only about the fields that differ: a no-op edit
 * then leaves no patch at all — which is what makes `Rejection: 'no-change'` true for
 * "setting the same label twice" — and a one-field edit stays one patch.
 */
function writeTree(project: Project, draft: Project, itemDesignId: EntityId, mutate: (root: CabinetNode) => CabinetNode): void {
  const design = requireCabinetDesign(project, itemDesignId)
  const nextRoot = runCabinet(() => mutate(design.construction.root), itemDesignId)
  const draftDesign = requireCabinetDesign(draft, itemDesignId)
  assignChanged(draftDesign.construction.root, nextRoot)
}

/**
 * Split one space, then rename the spaces `cabinet` just created to the caller's IDs in
 * depth-first order (#47). The new spaces are the only ones renamed, and only the path to
 * them is copied, so the rest of the tree keeps its identity.
 */
function writeSplit(
  project: Project,
  draft: Project,
  itemDesignId: EntityId,
  nodeId: string,
  ids: readonly string[],
  type: IntentType,
  split: (root: CabinetNode, nodeId: string) => CabinetNode,
): void {
  const design = requireCabinetDesign(project, itemDesignId)
  requireNode(design, nodeId, itemDesignId)
  const before = new Set(nodeIds(design.construction.root))
  const splitRoot = runCabinet(() => split(design.construction.root, nodeId), itemDesignId)
  const fresh = newNodeIds(splitRoot, before)
  if (fresh.length > ids.length) {
    refuse(
      'missing-ids',
      'ids',
      `${type} creates ${fresh.length} new space${fresh.length === 1 ? '' : 's'} and spends one pre-allocated ID each; this Intent carried ${ids.length}.`,
    )
  }
  const renamed = renameNewNodeIds(splitRoot, before, spendIds(ids, fresh.length, type))
  assignChanged(requireCabinetDesign(draft, itemDesignId).construction.root, renamed)
}

const sizeSpace: Handler<'cabinet.setNodeSize'> = (ctx) => {
  const { itemDesignId, nodeId, sizeMm } = ctx.intent.payload
  requireNode(requireCabinetDesign(ctx.project, itemDesignId), nodeId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => setNodeSize(root, nodeId, sizeMm))
}

const pinNodeSize: Handler<'cabinet.pinNode'> = (ctx) => {
  const { itemDesignId, nodeId, sizeMm } = ctx.intent.payload
  requireNode(requireCabinetDesign(ctx.project, itemDesignId), nodeId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => pinNode(root, nodeId, sizeMm))
}

const unpinNodeSize: Handler<'cabinet.unpinNode'> = (ctx) => {
  const { itemDesignId, nodeId } = ctx.intent.payload
  requireNode(requireCabinetDesign(ctx.project, itemDesignId), nodeId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => unpinNode(root, nodeId))
}

const setSpaceLabel: Handler<'cabinet.setNodeLabel'> = (ctx) => {
  const { itemDesignId, nodeId, label } = ctx.intent.payload
  requireNode(requireCabinetDesign(ctx.project, itemDesignId), nodeId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => setNodeLabel(root, nodeId, label))
}

const setSpaceType: Handler<'cabinet.setElementType'> = (ctx) => {
  const { itemDesignId, nodeId, elementType } = ctx.intent.payload
  requireNode(requireCabinetDesign(ctx.project, itemDesignId), nodeId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => setElementType(root, nodeId, elementType))
}

const changeDrawerConfig: Handler<'cabinet.setDrawerConfig'> = (ctx) => {
  const { itemDesignId, nodeId, config } = ctx.intent.payload
  requireNode(requireCabinetDesign(ctx.project, itemDesignId), nodeId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => setDrawerConfig(root, nodeId, config))
}

const resizeSection: Handler<'cabinet.setSplitRatio'> = (ctx) => {
  const { itemDesignId, parentNodeId, ratio } = ctx.intent.payload
  requireNode(requireCabinetDesign(ctx.project, itemDesignId), parentNodeId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => setSplitRatio(root, parentNodeId, ratio))
}

const deleteBoardAbove: Handler<'cabinet.deleteBoard'> = (ctx) => {
  const { itemDesignId, nodeId } = ctx.intent.payload
  const design = requireCabinetDesign(ctx.project, itemDesignId)
  requireNode(design, nodeId, itemDesignId)
  // The root has no board above it. The legacy store returned without touching anything,
  // and so do we — the board of a split node is the divider between its two children.
  if (nodeId === design.construction.root.id) {
    refuse('no-change', designPath(itemDesignId), 'The root space has no board above it to delete.')
  }
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => deleteBoard(root, nodeId))
}

const addShelfSpace: Handler<'cabinet.addShelf'> = (ctx) => {
  const { itemDesignId, nodeId } = ctx.intent.payload
  writeSplit(ctx.project, ctx.draft, itemDesignId, nodeId, ctx.intent.ids, ctx.intent.type, addShelf)
}

const addDividerSpace: Handler<'cabinet.addDivider'> = (ctx) => {
  const { itemDesignId, nodeId } = ctx.intent.payload
  writeSplit(ctx.project, ctx.draft, itemDesignId, nodeId, ctx.intent.ids, ctx.intent.type, addDivider)
}

const distributeSpaces: Handler<'cabinet.distributeEvenly'> = (ctx) => {
  const { itemDesignId, columnRootId, evenH } = ctx.intent.payload
  const design = requireCabinetDesign(ctx.project, itemDesignId)
  requireNode(design, columnRootId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) =>
    distributeEvenly(root, columnRootId, evenH, design.construction.settings.thickness),
  )
}

const addSpaceAccessory: Handler<'cabinet.addAccessory'> = (ctx) => {
  const { itemDesignId, nodeId, accessory } = ctx.intent.payload
  const [accessoryId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  requireNode(requireCabinetDesign(ctx.project, itemDesignId), nodeId, itemDesignId)
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => addAccessory(root, nodeId, { ...accessory, id: accessoryId }))
}

const removeSpaceAccessory: Handler<'cabinet.removeAccessory'> = (ctx) => {
  const { itemDesignId, nodeId, accessoryId } = ctx.intent.payload
  const node = requireNode(requireCabinetDesign(ctx.project, itemDesignId), nodeId, itemDesignId)
  // `cabinet` filters without complaining, which would leave an empty list behind where
  // there was none: an accessoryId that is not there is a stale selection, not an edit.
  if (!(node.accessories ?? []).some((accessory) => accessory.id === accessoryId)) {
    refuse('unknown-target', `${designPath(itemDesignId)}.construction.root`, `No accessory ${accessoryId} is in this space.`)
  }
  writeTree(ctx.project, ctx.draft, itemDesignId, (root) => removeAccessory(root, nodeId, accessoryId))
}

// --- The design and its placements ------------------------------------------

/**
 * Write new settings into the draft and shift this design's placements by half the change.
 *
 * A placement's translation is its footprint centre (#43 §3), while the legacy store kept a
 * unit's top-left corner: keeping that corner still under a new width or depth means the
 * centre moves by half the difference.
 */
export function writeSettings(draft: Project, itemDesignId: EntityId, patch: Partial<GlobalSettings>): void {
  const settings = requireCabinetDesign(draft, itemDesignId).construction.settings
  const deltaWidth = typeof patch.width === 'number' ? patch.width - settings.width : 0
  const deltaDepth = typeof patch.depth === 'number' ? patch.depth - settings.depth : 0
  Object.assign(settings, patch)
  if (deltaWidth === 0 && deltaDepth === 0) return
  for (const placed of draft.existingModel.placedItems) {
    if (placed.itemDesignId !== itemDesignId) continue
    placed.translation.x += deltaWidth / 2
    placed.translation.y += deltaDepth / 2
  }
}

const changeCabinetSize: Handler<'cabinet.updateSettings'> = (ctx) => {
  requireCabinetDesign(ctx.project, ctx.intent.payload.itemDesignId)
  writeSettings(ctx.draft, ctx.intent.payload.itemDesignId, ctx.intent.payload.patch)
}

const changeMaterial: Handler<'cabinet.setMaterial'> = (ctx) => {
  const { itemDesignId, material } = ctx.intent.payload
  requireCabinetDesign(ctx.project, itemDesignId)
  writeSettings(ctx.draft, itemDesignId, { material })
}

const renameUnit: Handler<'cabinet.renameUnit'> = (ctx) => {
  const { itemDesignId, name } = ctx.intent.payload
  requireCabinetDesign(ctx.project, itemDesignId)
  requireCabinetDesign(ctx.draft, itemDesignId).name = name
}

/** The legacy `addUnit`: a copy of a unit's settings, 20 mm right of the rightmost one. */
const addUnit: Handler<'cabinet.addUnit'> = (ctx) => {
  const [itemDesignId, placedItemId, rootNodeId] = spendIds(ctx.intent.ids, 3, ctx.intent.type)
  const floor = firstFloor(ctx.project)
  if (floor === undefined) refuse('unknown-target', 'floors', 'This Project has no Floor for a new cabinet to stand on.')
  const source =
    ctx.intent.payload.sourceItemDesignId === null
      ? ctx.project.itemDesigns.find((design) => design.kind === 'cabinet')
      : requireCabinetDesign(ctx.project, ctx.intent.payload.sourceItemDesignId)
  const settings = { ...(source === undefined || source.kind !== 'cabinet' ? LEGACY_DEFAULT_SETTINGS : source.construction.settings) }
  const units = cabinetPlacementsOn(ctx.project, floor.id)
  // Legacy x of the right edge: the centre minus half the width, plus the width.
  const rightEdge = units.reduce((edge, placed) => {
    const design = findDesign(ctx.project, placed.itemDesignId)
    return design === undefined || design.kind !== 'cabinet' ? edge : Math.max(edge, placed.translation.x + design.construction.settings.width / 2)
  }, 0)
  ctx.draft.itemDesigns.push({
    id: itemDesignId,
    kind: 'cabinet',
    name: `Unit ${units.length + 1}`,
    construction: { settings, root: { id: rootNodeId, elementType: 'void' } },
  })
  ctx.draft.existingModel.placedItems.push({
    id: placedItemId,
    itemDesignId,
    floorId: floor.id,
    translation: { x: rightEdge + 20 + settings.width / 2, y: settings.depth / 2 },
    rotationDeg: 0,
    baseElevation: 0,
    // A cabinet is a Placed Item, so it joins `Furniture` like anything else stood on the floor.
    // This legacy path has no saved view to consult, so the Project's own layer decides (#71 §2).
    ...creationLayerField(ctx.project, null, 'item'),
  })
}

const removeUnit: Handler<'cabinet.removeUnit'> = (ctx) => {
  const { itemDesignId } = ctx.intent.payload
  requireCabinetDesign(ctx.project, itemDesignId)
  const floor = firstFloor(ctx.project)
  const units = floor === undefined ? [] : cabinetPlacementsOn(ctx.project, floor.id)
  if (units.length === 1 && units[0]?.itemDesignId === itemDesignId) {
    refuse('last-unit', designPath(itemDesignId), 'This is the last cabinet on the floor plan. Add another before removing it.')
  }
  ctx.draft.itemDesigns = ctx.draft.itemDesigns.filter((design) => design.id !== itemDesignId)
  ctx.draft.existingModel.placedItems = ctx.draft.existingModel.placedItems.filter(
    (placed) => placed.itemDesignId !== itemDesignId,
  )
}

// --- Where a cabinet edit lands ---------------------------------------------

function designLocator(project: Project, itemDesignId: EntityId): Locator {
  const placements = placementsOf(project, itemDesignId)
  return {
    floorId: placements[0]?.floorId ?? null,
    viewId: null, view: 'cabinet',
    itemDesignIds: [itemDesignId],
    placedItemIds: placements.map((placed) => placed.id),
  }
}

export function cabinetLocator(project: Project, intent: CabinetIntent): Locator {
  if (intent.type === 'cabinet.addUnit') {
    return {
      floorId: firstFloor(project)?.id ?? null,
      viewId: null, view: 'cabinet',
      itemDesignIds: intent.ids.slice(0, 1),
      placedItemIds: intent.ids.slice(1, 2),
    }
  }
  return designLocator(project, intent.payload.itemDesignId)
}

export const CABINET_HANDLERS: CabinetHandlers = {
  'cabinet.updateSettings': { run: changeCabinetSize, locate: cabinetLocator },
  'cabinet.setMaterial': { run: changeMaterial, locate: cabinetLocator },
  'cabinet.addUnit': { run: addUnit, locate: cabinetLocator },
  'cabinet.removeUnit': { run: removeUnit, locate: cabinetLocator },
  'cabinet.renameUnit': { run: renameUnit, locate: cabinetLocator },
  'cabinet.addShelf': { run: addShelfSpace, locate: cabinetLocator },
  'cabinet.addDivider': { run: addDividerSpace, locate: cabinetLocator },
  'cabinet.deleteBoard': { run: deleteBoardAbove, locate: cabinetLocator },
  'cabinet.setNodeSize': { run: sizeSpace, locate: cabinetLocator },
  'cabinet.pinNode': { run: pinNodeSize, locate: cabinetLocator },
  'cabinet.unpinNode': { run: unpinNodeSize, locate: cabinetLocator },
  'cabinet.setNodeLabel': { run: setSpaceLabel, locate: cabinetLocator },
  'cabinet.distributeEvenly': { run: distributeSpaces, locate: cabinetLocator },
  'cabinet.setElementType': { run: setSpaceType, locate: cabinetLocator },
  'cabinet.setDrawerConfig': { run: changeDrawerConfig, locate: cabinetLocator },
  'cabinet.setSplitRatio': { run: resizeSection, locate: cabinetLocator },
  'cabinet.addAccessory': { run: addSpaceAccessory, locate: cabinetLocator },
  'cabinet.removeAccessory': { run: removeSpaceAccessory, locate: cabinetLocator },
}
