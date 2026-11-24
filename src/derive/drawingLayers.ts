/**
 * What a saved view lets you see, pick and change (#71 §4, criteria 9–13).
 *
 * Three questions, each answered by the most restrictive rule that applies — the Renovation Display,
 * the `Pick:` filter, the Display's own edit rules, and this view's setting for the entity's layer:
 *
 * | Question             | Rule                                                            |
 * | ------------------- | --------------------------------------------------------------- |
 * | Is it drawn?        | included by the Display **and** its layer is visible here        |
 * | Can it be picked?   | drawn **and** layer selectable **and** the `Pick:` filter allows |
 * | Can it be modified? | pickable **and** layer editable **and** the Display allows edit  |
 *
 * The layer's switches are ANDed in, never ORed: a hidden layer hides its content even in Combined,
 * and a read-only layer is read-only even where the Display would let you edit. Nothing here knows
 * about a layer *name*, and nothing here is a second copy of the model — these are predicates over
 * rows `effectiveModel` and `displayModel` already produced.
 *
 * **These rules are drawing rules, so they never reach `derive.warnings()` or `quantities()`.** A
 * hidden Wall still has a length, a Room still has an area, and a warning still applies to content
 * the view has chosen not to draw (#71 criterion 9: the Warnings List keeps it, with a line saying
 * why). That separation is what `drawingLayers.test.ts` pins: the same Project with its layer
 * settings toggled derives byte-identical warnings and quantities, and a memo slot built before the
 * toggle still answers after it.
 *
 * **The view is any saved view (#75 criterion 12).** Every function here reads `SavedViewSettings` —
 * the layer overrides, the order, the active layer and `Snap to hidden content` — and nothing reads a
 * Plan View field, so an Elevation View is answered by these same rules rather than by a second copy
 * that would drift the first time a rule moved.
 */
import type { EntityId, Project, SavedViewSettings } from '../domain'
import { DEFAULT_LAYER_SETTING, UNLAYERED_LAYER_KEY, drawingLayerById, drawingLayersOf, viewLayerOrder, viewSnapToHidden } from '../domain'
import { effectiveModel } from './effectiveModel'

/** What one view lets you do with the content of one layer key. */
export interface EffectiveLayerSetting {
  readonly visible: boolean
  readonly selectable: boolean
  readonly editable: boolean
  /** The colour the rows and markers draw in: the view override, else the layer's own, else none. */
  readonly color: string | null
}

/** The three questions of §4, answered for one entity. */
export interface LayerAccess {
  readonly drawn: boolean
  readonly pickable: boolean
  readonly modifiable: boolean
}

/** The drawing rules of the Display and the `Pick:` filter, as the caller's booleans. */
export interface DrawingGates {
  /** Does this Display draw this entity's Renovation State at all? */
  readonly displayIncluded: boolean
  /** Does the `Pick:` filter let this entity be picked? */
  readonly pickAllowed?: boolean
  /** Do this Display's edit rules let this entity be modified? */
  readonly editAllowed?: boolean
}

/**
 * The layer keys of one view, back to front: the view's own order when it has one, otherwise the
 * Project order with Unlayered front-most.
 *
 * The rows of the Layers list are the reverse of this — front-first — which is why the order is
 * stated once here rather than in the panel.
 */
export function effectiveLayerOrder(project: Project, view: SavedViewSettings | null): EntityId[] {
  const override = view === null ? null : viewLayerOrder(view)
  if (override !== null) return [...override]
  return [...drawingLayersOf(project).map((layer) => layer.id), UNLAYERED_LAYER_KEY]
}

/** The same keys in the order the Layers list shows them: front-most first. */
export function layerRowsFrontFirst(project: Project, view: SavedViewSettings | null): EntityId[] {
  return effectiveLayerOrder(project, view).reverse()
}

/**
 * Which Drawing Layer each entity of one Floor stands on, keyed by entity ID (#71 §4).
 *
 * The canvas gates, the snap gate and an exported sheet all ask this the same question, and an answer
 * that differed between them would let a sheet draw content the screen hides. Entities of the Option
 * are in here too, which is why the Option is an argument: a proposed Wall is on a layer like any
 * other. An entity the Project never named a layer for is absent, and `Unlayered` is the caller's
 * default — the same default `entityLayerId` gives the tables.
 */
export function entityLayerKeys(project: Project, floorId: EntityId, optionId: EntityId | null): ReadonlyMap<EntityId, EntityId> {
  const model = effectiveModel(project, floorId, optionId)
  const layerOf = new Map<EntityId, EntityId>()
  for (const { entity } of model.walls) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
  for (const { entity } of model.openings) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
  for (const { entity } of model.rooms) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
  for (const { entity } of model.placedItems) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
  for (const { entity } of model.beams) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
  for (const { entity } of model.skirting) layerOf.set(entity.id, entity.drawingLayerId ?? UNLAYERED_LAYER_KEY)
  return layerOf
}

/**
 * What this view says about one layer key, with the defaults filled in.
 *
 * `Unlayered` has no Project entry and so no colour of its own: `null` means "draw in the neutral
 * token colour", which is a drawing decision the panel makes, not a colour stored on the Project.
 */
export function effectiveLayerSetting(project: Project, view: SavedViewSettings | null, layerKey: EntityId): EffectiveLayerSetting {
  const override = view?.layerSettings?.[layerKey]
  const layer = drawingLayerById(project, layerKey)
  return {
    visible: override?.visible ?? DEFAULT_LAYER_SETTING.visible,
    selectable: override?.selectable ?? DEFAULT_LAYER_SETTING.selectable,
    editable: override?.editable ?? DEFAULT_LAYER_SETTING.editable,
    color: override?.color ?? layer?.color ?? null,
  }
}

/**
 * The three answers of §4 for one entity of one layer key.
 *
 * `displayIncluded` is the Display's own table (`displayRows` left the entity out, or did not);
 * `pickAllowed` and `editAllowed` are the `Pick:` filter and the Display's edit rules, which the
 * canvas already computes for other reasons. Both default to allowed, so a caller that only cares
 * about visibility cannot accidentally make content unpickable by forgetting a gate.
 */
export function layerAccessOf(
  project: Project,
  view: SavedViewSettings | null,
  layerKey: EntityId,
  gates: DrawingGates,
): LayerAccess {
  const setting = effectiveLayerSetting(project, view, layerKey)
  const drawn = gates.displayIncluded && setting.visible
  const pickable = drawn && setting.selectable && gates.pickAllowed !== false
  return { drawn, pickable, modifiable: pickable && setting.editable && gates.editAllowed !== false }
}

/**
 * Whether content of this layer key is a snap target (#71 §6, criterion 12).
 *
 * Content the view is not drawing, or will not let you pick, is not a snap target — unless the view
 * says `Snap to hidden content`, which makes it a target and nothing more: a snap is not a
 * selection, so `pickable` stays false either way.
 */
export function snapCandidateAllowed(project: Project, view: SavedViewSettings | null, layerKey: EntityId): boolean {
  const setting = effectiveLayerSetting(project, view, layerKey)
  return (setting.visible && setting.selectable) || (view === null ? false : viewSnapToHidden(view))
}
