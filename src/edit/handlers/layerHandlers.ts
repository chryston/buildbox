/**
 * The Drawing Layer half of the catalogue (#71 §2–§5).
 *
 * Reachable from exactly one place: the renovation half of `../registry`'s catalogue, which is
 * what keeps it out of every other module's import list.
 *
 * Two kinds of Intent live here, and the difference matters to the guard in `../apply`:
 *
 *  - the **list** (`layer.*`) changes what layers the Project has and in which order they are drawn;
 *  - the **settings** (`view.*`, `entity.setLayer`) change what one view does with them and which
 *    layer one record sits on.
 *
 * Neither is a change to a model record. That is why re-filing an Existing Wall onto another layer
 * while Design Options exist is not a baseline correction (#71 §5), and why nothing here reads or
 * writes a Wall's geometry.
 */
import {
  DEFAULT_LAYER_SETTING,
  UNLAYERED_LAYER_KEY,
  designOptionsOf,
  drawingLayerById,
  drawingLayersOf,
  nameKey,
} from '../../domain'
import type { DrawingLayer, EntityId, PlanView, Project, ProposedModel } from '../../domain'
import type { DeleteLayerReview, Locator, RenovationIntentType } from '../intents'
import type { Handler, IntentHandler } from './context'
import { containerOf, findDesign, refuse, spendIds } from './support'

/** The layer half of the renovation set. */
type LayerIntentType = Extract<
  RenovationIntentType,
  `layer.${string}` | `view.setLayer${string}` | 'view.setActiveLayer' | 'view.setSnapToHidden' | 'entity.setLayer'
>

/** The IDs each layer Intent spends — only a new layer needs one. */
export const LAYER_INTENT_ID_ORDER: { [T in LayerIntentType]: readonly string[] } = {
  'layer.add': ['layerId'],
  'layer.rename': [],
  'layer.setColor': [],
  'layer.move': [],
  'layer.delete': [],
  'view.setLayerSetting': [],
  'view.setLayerOrder': [],
  'view.setActiveLayer': [],
  'view.setSnapToHidden': [],
  'entity.setLayer': [],
}

/**
 * The default label per layer Intent.
 *
 * Four of these are the base of a longer label: the row that sends them appends what was chosen —
 * `Rename layer: Services`, `Set layer visibility: Furniture — hidden` (#71 §8) — because a layer's
 * name is Project data and the setting's words are `ui/strings` copy, neither of which this table
 * may hold.
 */
export const LAYER_INTENT_LABELS: { [T in LayerIntentType]: string } = {
  'layer.add': 'New Layer',
  'layer.rename': 'Rename Layer',
  'layer.setColor': 'Set Layer Colour',
  'layer.move': 'Reorder Layer',
  'layer.delete': 'Delete Layer',
  'view.setLayerSetting': 'Set Layer',
  'view.setLayerOrder': 'Reorder Layers',
  'view.setActiveLayer': 'Set Active Layer',
  'view.setSnapToHidden': 'Snap to Hidden Content',
  'entity.setLayer': 'Move to Layer',
}

/** A colour the canvas can use: six lowercase hex digits, the form the validator accepts. */
const COLOR = /^#[0-9a-f]{6}$/

/** The saved view whose setting is being changed. */
function requireView(draft: Project, viewId: EntityId): PlanView {
  const view = draft.views.find((candidate) => candidate.id === viewId)
  if (view === undefined) refuse('unknown-target', `views[${viewId}]`, `There is no saved view ${viewId} to change.`)
  return view
}

/** The layer being acted on, or a refusal that names it. */
function requireLayer(project: Project, layerId: EntityId): DrawingLayer {
  const layer = drawingLayerById(project, layerId)
  if (layer === null) refuse('layer-blocked', 'drawingLayers', `There is no layer ${layerId} in this Project.`)
  return layer
}

/**
 * A layer name that can be used, or the sentence saying why it cannot (#71 §2).
 *
 * Filled, and one per Project folded the way the validator folds a Design Option's name: two layers
 * called `Structure` and `structure` are two rows of the list nobody can tell apart at a glance, and
 * the colour is doing double duty if it has to carry the difference.
 */
function layerNameProblem(project: Project, name: string, except: EntityId | undefined): string | null {
  if (name.trim() === '') return 'A layer needs a name.'
  const key = nameKey(name)
  const taken = drawingLayersOf(project).find((layer) => layer.id !== except && nameKey(layer.name) === key)
  return taken === undefined ? null : `A layer called "${taken.name.trim()}" already exists.`
}

/** A colour that can be used, or the sentence saying why it cannot. */
function layerColorProblem(color: string): string | null {
  return COLOR.test(color) ? null : 'A layer colour is six hex digits, like #5fb3ff.'
}

/** A layer is a Project-level thing: no Floor, no View, nothing to select. */
const projectLocator = (): Locator => ({ floorId: null, viewId: null, view: 'plan', itemDesignIds: [], placedItemIds: [] })

/**
 * A saved-view setting navigates to the view it changed (#70 §9): undoing it has to land the user
 * back on the view whose layer list it put right.
 */
function viewSettingLocator(project: Project, intent: { payload: { viewId: EntityId } }): Locator {
  const view = project.views.find((candidate) => candidate.id === intent.payload.viewId)
  return {
    floorId: view?.floorId ?? null,
    viewId: intent.payload.viewId,
    view: 'plan',
    itemDesignIds: [],
    placedItemIds: [],
  }
}

const addLayer: Handler<'layer.add'> = (ctx) => {
  const name = ctx.intent.payload.name.trim()
  const nameProblem = layerNameProblem(ctx.project, name, undefined)
  if (nameProblem !== null) refuse('layer-blocked', 'drawingLayers', nameProblem)
  const colorProblem = layerColorProblem(ctx.intent.payload.color)
  if (colorProblem !== null) refuse('layer-blocked', 'drawingLayers', colorProblem)
  const [layerId] = spendIds(ctx.intent.ids, 1, ctx.intent.type)
  if (ctx.draft.drawingLayers === undefined) ctx.draft.drawingLayers = []
  // The end of the array is the front of the drawing and the top of the list (#71 §1), so a layer
  // the user has just made is the one they can see their new work on straight away.
  ctx.draft.drawingLayers.push({ id: layerId, name, color: ctx.intent.payload.color })
  // A view with an order of its own holds a full order, so the new layer joins each of them at the
  // same place it joined the Project's — the front. A view that follows the Project has nothing to
  // write, and gets it for free.
  for (const view of ctx.draft.views) if (view.layerOrder !== undefined && view.layerOrder !== null) view.layerOrder.push(layerId)
}

const renameLayer: Handler<'layer.rename'> = (ctx) => {
  const { layerId } = ctx.intent.payload
  const name = ctx.intent.payload.name.trim()
  const layer = requireLayer(ctx.draft, layerId)
  const problem = layerNameProblem(ctx.project, name, layerId)
  if (problem !== null) refuse('layer-blocked', 'drawingLayers', problem)
  // Only the name moves. Every record keeps the layer's ID, so renaming `Structure` to `Shell`
  // re-labels the row and changes nothing about which row anything is on.
  layer.name = name
}

const setLayerColor: Handler<'layer.setColor'> = (ctx) => {
  const { layerId } = ctx.intent.payload
  const layer = requireLayer(ctx.draft, layerId)
  const problem = layerColorProblem(ctx.intent.payload.color)
  if (problem !== null) refuse('layer-blocked', 'drawingLayers', problem)
  layer.color = ctx.intent.payload.color
}

const moveLayer: Handler<'layer.move'> = (ctx) => {
  const { layerId, direction } = ctx.intent.payload
  requireLayer(ctx.draft, layerId)
  const layers = ctx.draft.drawingLayers
  if (layers === undefined) refuse('layer-blocked', 'drawingLayers', 'This Project has no layers to reorder.')
  const at = layers.findIndex((layer) => layer.id === layerId)
  // `forward` is toward the front, which is the end of the array (#71 §1). A layer already at an end
  // has nowhere to go, and the row says so rather than snapping back without a word.
  const to = direction === 'forward' ? at + 1 : at - 1
  if (to < 0 || to >= layers.length)
    refuse('layer-blocked', 'drawingLayers', `That layer is already at the ${direction === 'forward' ? 'front' : 'back'} of the order.`)
  const [moved] = layers.splice(at, 1)
  layers.splice(to, 0, moved!)
}

/** One model record, seen only as something a layer can hold. */
interface LayerRecord {
  readonly id: EntityId
  /** `W-3`, `Door 2`, `Kitchen` — the label the canvas gives it. */
  readonly label: string
  readonly record: { drawingLayerId?: EntityId | null }
}

/** Every record of one model, whichever collection it lives in (#71 §5). */
function recordsOf(project: Project, model: ProposedModel): LayerRecord[] {
  const records: LayerRecord[] = []
  for (const wall of model.walls) records.push({ id: wall.id, label: wall.ref, record: wall })
  for (const opening of model.openings) records.push({ id: opening.id, label: opening.label, record: opening })
  for (const room of model.rooms) records.push({ id: room.id, label: room.name, record: room })
  // A Placed Item is named by the design it is an instance of, which is how the canvas names it too.
  for (const item of model.placedItems)
    records.push({ id: item.id, label: findDesign(project, item.itemDesignId)?.name ?? item.itemDesignId, record: item })
  return records
}

/** Every model of the Project: the Existing one, then each Option's proposed work. */
function modelsOf(project: Project): ProposedModel[] {
  return [project.existingModel, ...designOptionsOf(project).map((option) => option.proposed)]
}

/**
 * What deleting a layer would do, in the order the dialog lists it (#71 §5).
 *
 * The counts are read from the same sweep the handler makes, so the dialog cannot promise a number
 * the transaction does not deliver.
 */
function reviewDeleteLayer(project: Project, layerId: EntityId, viewId: EntityId | null): DeleteLayerReview | null {
  const layer = drawingLayerById(project, layerId)
  if (layer === null) return null
  const members = modelsOf(project).flatMap((model) => recordsOf(project, model)).filter((entry) => entry.record.drawingLayerId === layerId)
  // A view is affected when it says something about this layer that the delete makes meaningless:
  // an override of its own, or an order of its own that names it.
  const affected = project.views.filter((view) => view.layerSettings?.[layerId] !== undefined || view.layerOrder !== undefined)
  const view = viewId === null ? undefined : project.views.find((candidate) => candidate.id === viewId)
  // The question the dialog answers with this: content that comes back Unlayered is governed by the
  // Unlayered row from now on, and a hidden row means it stops being drawn in this view.
  const unlayeredHidden = view === undefined ? false : view.layerSettings?.[UNLAYERED_LAYER_KEY]?.visible === false
  return {
    kind: 'delete-layer',
    layerId,
    layerName: layer.name,
    counts: { model: members.length, annotations: 0, overrides: affected.length },
    viewNames: affected.map((candidate) => candidate.name),
    members: members.slice(0, 8).map((entry) => ({ id: entry.id, label: entry.label })),
    unused: members.length === 0,
    unlayeredHidden,
    message:
      members.length === 0
        ? 'Unused. Nothing else changes.'
        : `Delete ${layer.name}? ${members.length} ${members.length === 1 ? 'item is' : 'items are'} on it and will become Unlayered.`,
  }
}

const deleteLayer: Handler<'layer.delete'> = (ctx) => {
  const { layerId } = ctx.intent.payload
  requireLayer(ctx.draft, layerId)
  const layers = ctx.draft.drawingLayers
  if (layers === undefined) refuse('layer-blocked', 'drawingLayers', 'This Project has no layers to delete.')
  layers.splice(layers.findIndex((layer) => layer.id === layerId), 1)
  // Nothing is destroyed (#71 §5): every record on the layer is un-filed, which is the same state a
  // record written before layers existed is in. One undo brings the layer, its members and each
  // view's settings back together.
  for (const model of modelsOf(ctx.draft)) {
    for (const entry of recordsOf(ctx.draft, model)) {
      if (entry.record.drawingLayerId === layerId) entry.record.drawingLayerId = null
    }
  }
  for (const view of ctx.draft.views) {
    if (view.layerSettings?.[layerId] !== undefined) {
      delete view.layerSettings[layerId]
      // An empty map is the same statement as no map (#71 §3), so a view whose only override was for
      // this layer ends up byte-identical to one that never had one.
      if (Object.keys(view.layerSettings).length === 0) delete view.layerSettings
    }
    // A view following the Project order has nothing to rewrite, and one with an order of its own
    // loses exactly the one entry — the rest keeps its arrangement, including where Unlayered sits.
    if (view.layerOrder !== undefined && view.layerOrder !== null)
      view.layerOrder = view.layerOrder.filter((key) => key !== layerId)
    if (view.activeLayerId === layerId) view.activeLayerId = null
  }
}

const setLayerSetting: Handler<'view.setLayerSetting'> = (ctx) => {
  const { viewId, layerKey, setting } = ctx.intent.payload
  const view = requireView(ctx.draft, viewId)
  if (layerKey !== UNLAYERED_LAYER_KEY && drawingLayerById(ctx.draft, layerKey) === null)
    refuse('layer-blocked', 'drawingLayers', `There is no layer ${layerKey} in this Project.`)
  if (setting.color !== undefined && setting.color !== null && layerColorProblem(setting.color) !== null)
    refuse('layer-blocked', 'drawingLayers', layerColorProblem(setting.color)!)
  const current = view.layerSettings?.[layerKey] ?? { ...DEFAULT_LAYER_SETTING }
  const next = {
    visible: setting.visible === null ? DEFAULT_LAYER_SETTING.visible : (setting.visible ?? current.visible ?? DEFAULT_LAYER_SETTING.visible),
    selectable:
      setting.selectable === null ? DEFAULT_LAYER_SETTING.selectable : (setting.selectable ?? current.selectable ?? DEFAULT_LAYER_SETTING.selectable),
    editable:
      setting.editable === null ? DEFAULT_LAYER_SETTING.editable : (setting.editable ?? current.editable ?? DEFAULT_LAYER_SETTING.editable),
    color: setting.color === undefined ? (current.color ?? null) : setting.color,
  }
  if (view.layerSettings === undefined) view.layerSettings = {}
  // An override that says the default in other words is no override (#71 §3): dropping the key keeps
  // a view that was toggled back byte-identical to one that was never touched, which is what lets the
  // layer panel's state be read from the data rather than remembered.
  const isDefault =
    next.visible === DEFAULT_LAYER_SETTING.visible &&
    next.selectable === DEFAULT_LAYER_SETTING.selectable &&
    next.editable === DEFAULT_LAYER_SETTING.editable &&
    next.color === null
  if (isDefault) delete view.layerSettings[layerKey]
  else view.layerSettings[layerKey] = { visible: next.visible, selectable: next.selectable, editable: next.editable, ...(next.color === null ? {} : { color: next.color }) }
  // An empty map is the same statement as no map, and `canonicalJson` can tell them apart — so the
  // view that was toggled back is byte-identical to the view that was never touched.
  if (view.layerSettings !== undefined && Object.keys(view.layerSettings).length === 0) delete view.layerSettings
}

const setLayerOrder: Handler<'view.setLayerOrder'> = (ctx) => {
  const { viewId, layerOrder } = ctx.intent.payload
  const view = requireView(ctx.draft, viewId)
  if (layerOrder === null) {
    view.layerOrder = null
    return
  }
  // The whole list or nothing (#71 §3): a view whose order leaves a layer out would have to be asked
  // where the missing one goes, and the answer would be a guess.
  const expected = new Set<string>([...drawingLayersOf(ctx.draft).map((layer) => layer.id), UNLAYERED_LAYER_KEY])
  const seen = new Set<string>()
  for (const key of layerOrder) {
    if (!expected.has(key)) refuse('layer-blocked', 'drawingLayers', `The order names ${key}, which is not a layer of this Project.`)
    if (seen.has(key)) refuse('layer-blocked', 'drawingLayers', `The order names ${key} twice.`)
    seen.add(key)
  }
  if (seen.size !== expected.size) refuse('layer-blocked', 'drawingLayers', 'The order has to name every layer and Unlayered once each.')
  view.layerOrder = [...layerOrder]
}

const setActiveLayer: Handler<'view.setActiveLayer'> = (ctx) => {
  const { viewId, layerId } = ctx.intent.payload
  const view = requireView(ctx.draft, viewId)
  if (layerId !== null && drawingLayerById(ctx.draft, layerId) === null)
    refuse('layer-blocked', 'drawingLayers', `There is no layer ${layerId} in this Project.`)
  view.activeLayerId = layerId
}

const setSnapToHidden: Handler<'view.setSnapToHidden'> = (ctx) => {
  const { viewId, snapToHidden } = ctx.intent.payload
  requireView(ctx.draft, viewId).snapToHiddenContent = snapToHidden
}

const setEntityLayer: Handler<'entity.setLayer'> = (ctx) => {
  const { entityId, layerId } = ctx.intent.payload
  if (layerId !== null && drawingLayerById(ctx.draft, layerId) === null)
    refuse('layer-blocked', 'drawingLayers', `There is no layer ${layerId} in this Project.`)
  // The container comes from the Intent's target, the same way every other record edit addresses one
  // (#69 §7): the Existing Model, or the proposed work of the Option the view is looking through.
  const container = containerOf(ctx.draft, ctx.intent.payload.target?.designOptionId)
  const entry = recordsOf(ctx.draft, container).find((candidate) => candidate.id === entityId)
  if (entry === undefined)
    refuse('unknown-target', 'existingModel', `There is no record ${entityId} to move to another layer.`)
  entry.record.drawingLayerId = layerId
}

/** Where a layer edit is seen: the Project's layer list, which every view draws from. */
const layerLocator = (): Locator => projectLocator()

/** The layer half of the catalogue, as one gated spread. */
export const LAYER_HANDLERS: { [T in LayerIntentType]: IntentHandler<T> } = {
  'layer.add': { run: addLayer, locate: layerLocator },
  'layer.rename': { run: renameLayer, locate: layerLocator },
  'layer.setColor': { run: setLayerColor, locate: layerLocator },
  'layer.move': { run: moveLayer, locate: layerLocator },
  'layer.delete': {
    run: deleteLayer,
    locate: layerLocator,
    review: (project, intent) => reviewDeleteLayer(project, intent.payload.layerId, intent.payload.viewId),
  },
  'view.setLayerSetting': { run: setLayerSetting, locate: viewSettingLocator },
  'view.setLayerOrder': { run: setLayerOrder, locate: viewSettingLocator },
  'view.setActiveLayer': { run: setActiveLayer, locate: viewSettingLocator },
  'view.setSnapToHidden': { run: setSnapToHidden, locate: viewSettingLocator },
  'entity.setLayer': { run: setEntityLayer, locate: projectLocator },
}
