/**
 * Which Drawing Layer new content lands on (#71 §2), and when a creation tool may not be used here.
 *
 * One rule, in this order, for every creation tool:
 *
 *  1. the layer whose **name** is the subtype's default — `Structure` for built fabric (Walls,
 *     Openings, Rooms) and `Services` for Service Runs and Risers, `Furniture` for Placed Items;
 *  2. failing that, the saved view's active layer;
 *  3. failing that, nothing: the content is Unlayered.
 *
 * A default layer is never recreated. Renaming `Structure` to `Fabric` moves new Walls to the active
 * layer, which is the whole point of resolving by name rather than by ID or by a reserved row — the
 * three defaults are ordinary layers, and this is the one place in the codebase a layer name decides
 * anything (#71 §9).
 *
 * When the layer the rule lands on is not editable in this view the creation is refused: content is
 * never silently redirected to a layer the person did not choose, and nothing is committed, so the
 * revision is unchanged. The notice says what to press instead.
 *
 * The field is returned rather than assigned so a flag-off build writes nothing at all: the spread
 * folds away with the flag, and a Project saved by production stays byte-identical to one saved
 * before layers existed. Unlayered content omits the field too — absent and `null` read the same, and
 * a Project with no layers then keeps the bytes it had.
 */
import { FF_RENOVATION } from '../../lib'
import type { CreationSubtype, EntityId, PlanView, Project } from '../../domain'
import { DEFAULT_LAYER_NAMES, DEFAULT_LAYER_SETTING, drawingLayerById, drawingLayerByName } from '../../domain'
import { refuse } from './support'

/** The layer field of a record a creation tool is about to make — empty when there is nothing to say. */
export interface CreationLayerField {
  readonly drawingLayerId?: EntityId
}

const viewOf = (project: Project, viewId: EntityId | null | undefined): PlanView | null =>
  viewId === null || viewId === undefined ? null : project.views.find((view) => view.id === viewId) ?? null

/**
 * The layer new `subtype` content belongs to, resolved against `viewId` (#71 §2).
 *
 * `viewId` is the saved view the tool was used in. Without one there is no per-view setting to
 * consult, so the Project's own layer is used as it stands — a Project-level surface still files new
 * content, it just cannot be told the layer is read-only.
 */
export function creationLayerField(
  project: Project,
  viewId: EntityId | null | undefined,
  subtype: CreationSubtype,
): CreationLayerField {
  if (!FF_RENOVATION) return {}
  const view = viewOf(project, viewId)
  const named = drawingLayerByName(project, DEFAULT_LAYER_NAMES[subtype])
  // The active layer is the fallback, and `Unlayered` (null) or an ID the Project no longer has ends
  // the rule the same way: the content is Unlayered, and no layer is quietly brought back.
  const layer = named ?? drawingLayerById(project, view === null ? null : view.activeLayerId)
  if (layer === null) return {}
  const setting = view?.layerSettings?.[layer.id] ?? DEFAULT_LAYER_SETTING
  if (!setting.editable) {
    refuse(
      'layer-blocked',
      `views[${view?.id ?? viewId ?? ''}].layerSettings[${layer.id}]`,
      `${layer.name} is read-only in this view. Make it editable or choose another active layer.`,
    )
  }
  return { drawingLayerId: layer.id }
}
