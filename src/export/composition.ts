/**
 * What a sheet was drawn from, and the gates that drew it (#73 §1).
 *
 * Two things have to agree and are built here in one call so that they cannot disagree: the
 * `LayerGates` the Floor View is painted through, and the `RecordedComposition` that says afterwards
 * what was painted. A composition written out of the recipe instead of beside the gates would
 * describe what the user asked for; the metadata is a record of what the file contains, and the two
 * only part company when something overrode a layer — which is exactly when someone will be reading
 * it.
 *
 * The starting point is always the saved view: its Design Option, its Renovation Display, its
 * effective layer order, its per-layer visibility and colour. The recipe's `toggles` are the one
 * thing that may differ, and they are temporary — they reach this function and stop there. Nothing
 * here writes: the Project is read, the view is read, and the gates are a closure over a lookup.
 */
import type { LayerGates } from '../drawing'
import { UNLAYERED_LAYER, effectiveLayerOrder, effectiveLayerSetting, entityLayerKeys, layerAccessOf } from '../derive'
import type { ElevationView, EntityId, PlanView, Project } from '../domain'
import { UNLAYERED_LAYER_KEY, drawingLayerById, viewDesignOptionId, viewLayerSettingOverride, viewRenovationDisplay } from '../domain'
import type {
  CompositionColorOverride,
  CompositionLayer,
  DrawingToggles,
  RecordedComposition,
  RecordedElevation,
} from './types'

/** The gates and the record for one saved view, from one set of temporary toggles. */
export interface DrawingComposition {
  /** What `drawFloorView` and `drawElevationView` paint through. */
  readonly gates: LayerGates
  /** What the metadata says this sheet was drawn from. */
  readonly recorded: RecordedComposition
  /** The Design Option this view draws, or `null` for the Existing Model alone. */
  readonly optionId: EntityId | null
}

/** What one layer key is called on the sheet: the Project's own name, or `Unlayered`. */
const layerName = (project: Project, key: EntityId): string => drawingLayerById(project, key)?.name ?? UNLAYERED_LAYER

/** The Elevation definition the metadata records: the three fields and the name they belong to. */
const elevationOf = (view: ElevationView): RecordedElevation => ({
  name: view.name,
  line: { start: { x: view.line.start.x, y: view.line.start.y }, end: { x: view.line.end.x, y: view.line.end.y } },
  side: view.side,
  depth: view.depth,
})

/**
 * The composition of one saved view: its own layer access, with the dialog's chips over the top.
 *
 * A Plan View and an Elevation View are composed the same way — both are a `SavedViewSettings`
 * standing on one Floor, and #71's layer access does not care which kind is asking. Only the record
 * differs: an Elevation sheet also says what it was aimed at.
 *
 * `toggles.layers` is either absent — every layer this view draws, which is the saved view exactly —
 * or the complete set of keys the chips leave on. It *replaces* the view's visibility rather than
 * narrowing it, because a chip starts from the view and can be turned on as well as off: a layer the
 * view hides and the user ticks is content they asked to see on this sheet.
 */
export function drawingComposition(
  project: Project,
  view: PlanView | ElevationView,
  floorId: EntityId,
  toggles: DrawingToggles | undefined,
): DrawingComposition {
  // Flag off, no sheet may say it was drawn from a Design Option: the drawing is the Existing Model
  // whatever the saved view holds, and the metadata and the title block have to agree with it.
  const optionId = viewDesignOptionId(view)
  const keys = entityLayerKeys(project, floorId, optionId)
  const keyOf = (id: EntityId): EntityId => keys.get(id) ?? UNLAYERED_LAYER_KEY
  const order = effectiveLayerOrder(project, view)
  const chips = toggles?.layers === undefined ? null : new Set<EntityId>(toggles.layers)
  const drawnKey = (key: EntityId): boolean =>
    chips === null ? layerAccessOf(project, view, key, { displayIncluded: true }).drawn : chips.has(key)
  const row = (key: EntityId): CompositionLayer => ({ id: key, name: layerName(project, key) })
  const override = (key: EntityId): CompositionColorOverride | null => {
    const color = viewLayerSettingOverride(view, key)?.color
    return color === undefined ? null : { layer_id: key, name: layerName(project, key), color }
  }
  return {
    gates: {
      drawn: (id) => drawnKey(keyOf(id)),
      // A sheet is not clicked on. Picking and editing are the screen's questions, and the honest
      // answer for paper is that nothing on it can be touched.
      pickable: () => false,
      modifiable: () => false,
      // The colour this view was given and not the Project default — the rule the canvas paints by
      // too (#71 §4) — because a sheet in other colours than the screen is a drawing of someone
      // else's kitchen.
      colorOf: (id) => viewLayerSettingOverride(view, keyOf(id))?.color ?? null,
      orderOf: (id) => order.indexOf(keyOf(id)),
      readOnlyLayerOf: () => null,
    },
    recorded: {
      view_id: view.id,
      view_name: view.name,
      design_option_id: optionId,
      renovation_display: viewRenovationDisplay(view),
      // Back to front, which is paint order and the order the composition records; the Layers list
      // shows the reverse and is the panel's business (#71 §2).
      layer_order: order.map(row),
      included_layers: order.filter(drawnKey).map(row),
      color_overrides: order.map(override).filter((each): each is CompositionColorOverride => each !== null),
      notes: { overlay: toggles?.notesOverlay ?? false },
      ...(view.kind === 'elevation' ? { elevation: elevationOf(view) } : {}),
    },
    optionId,
  }
}

/** One layer as the Export dialog's chip: what it is called, and whether the view shows it. */
export interface DrawingLayerChip {
  readonly id: EntityId
  readonly name: string
  readonly visible: boolean
}

/**
 * The chips the Drawing tab offers, in the order the sheet paints them.
 *
 * The saved view's own visibility is what a chip starts on, and `Unlayered` is a chip like any
 * other — it is the layer the Project files unfiled things on, and hiding it hides real content
 * (#71 §2). The `Notes overlay` chip is not here: it has nothing to overlay until #80 and #81 land,
 * so the dialog renders it disabled and this list stays the Project's own.
 */
export function drawingLayerChips(
  project: Project,
  view: PlanView | ElevationView | null,
): readonly DrawingLayerChip[] {
  return effectiveLayerOrder(project, view).map((key) => ({
    id: key,
    name: layerName(project, key),
    visible: effectiveLayerSetting(project, view, key).visible,
  }))
}
