/**
 * The renovation surface (#69 §9, §13, §15).
 *
 * Everything here is reached from the workspace's own renovation state — which Option is active,
 * which Display is showing, which layers the view draws — so the folder holds the dialogs, the mode
 * bar, the legend and the overlay together, and `FloorWorkspace` is the only module that imports it.
 */
import type { RenovationDisplay } from '../../../domain'
import type { Intent } from '../../../edit'
import { workspaceStore } from '../workspaceStore'

export { DesignOptionsSection, designOptionNameProblem, nextDesignOptionName } from './DesignOptionsSection'
export { DeleteDesignOptionDialog, deleteOptionRows } from './DeleteDesignOptionDialog'
export { DemolishWallDialog, demolishIsBlocked } from './DemolishWallDialog'
export { CorrectExistingDialog, correctIsBlocked } from './CorrectExistingDialog'
export { RestoreDialog } from './RestoreDialog'
export { ForcedChoiceDialog } from './ForcedChoiceDialog'
export { MoveToOptionAction } from './MoveToOptionAction'
export { MoveToOptionDialog, moveToOptionIsBlocked } from './MoveToOptionDialog'
export { RenovationOverlays } from './RenovationOverlays'
// #70 §2, §3: the saved-view block and the one table of Display colours and States the rail, the
// mode bar, the tool strip and the canvas legend all read from.
export { RenovationViewSection } from './RenovationViewSection'
// #71 §3, §5: the Layers list in that slot, and the review that stands behind `Delete…`.
export { RenovationLayers, layerSettingWord } from './RenovationLayers'
export type { LayerSettingPatch, RenovationLayersProps } from './RenovationLayers'
export { DeleteLayerDialog } from './DeleteLayerDialog'
// #72 §5: the mapping review a cross-Project paste asks before anything is written.
export { PasteFromOtherProjectDialog } from './PasteFromOtherProjectDialog'
export type { PasteDestinationLayer, PasteDialogProps } from './PasteFromOtherProjectDialog'
export { LAYER_NEUTRAL_COLOR, layerSwatchClass } from './layersTheme'
export { RenovationModeBar } from './RenovationModeBar'
export { RenovationLegend } from './RenovationLegend'
export { OverlapCycleList } from './OverlapCycleList'
export { RenovationInspector } from './RenovationInspector'
export type {
  RenovationInspectorAction,
  RenovationInspectorLayer,
  RenovationInspectorLayerOption,
  RenovationInspectorLink,
  RenovationInspectorTarget,
} from './RenovationInspector'
export { RenovationErrorBanner } from './RenovationErrorBanner'
export { RenovationToolStrip } from './RenovationToolStrip'
export { DISPLAY_LABELS, DISPLAY_ORDER, DISPLAY_ROLES, DISPLAY_STATES, displayLabel, swatchClass } from './displayTheme'
export type { DisplayRoles } from './displayTheme'
export { entityFields, replaceEditOf, subjectOfIntent, successorOf } from './pendingEdit'
export { baselineEditLocked } from './baselineLock'
export type { BaselineLockInput } from './baselineLock'
export type { EntityFields, SuccessorHit } from './pendingEdit'
export { RENOVATION_TOOL_ROWS, availableTools, displaysAllowing, hiddenToolCount, toolIsAvailable } from './toolAvailability'
export type { RenovationToolId, RenovationToolRow } from './toolAvailability'

/**
 * Ask for the `Demolish W-3?` review of one Existing entity, on behalf of one Design Option
 * (#69 §9). This is what #70's `Mark demolition` calls: the dialog reads the cost of the demolition
 * from the Intent's own preview, so the request carries ids and nothing else.
 */
export const openDemolishDialog = (entityId: string, designOptionId: string): void => {
  workspaceStore.getState().openDemolishDialog(entityId, designOptionId)
}

/** Ask for `Move to a Design Option?` of the entities named (#69 §13). */
export const openMoveToOptionDialog = (entityIds: readonly string[]): void => {
  workspaceStore.getState().openMoveToOptionDialog(entityIds)
}

/**
 * Ask what an edit of an Existing entity was meant to be (#70 §7a). The Intent that was refused is
 * the pending edit: the dialog writes nothing, it only decides which of the two sanctioned commands
 * the person meant, and the refused Intent is what either of them carries.
 */
export const openForcedChoiceDialog = (
  intent: Intent,
  entityId: string,
  display: RenovationDisplay,
  optionId: string,
): void => {
  workspaceStore.getState().openForcedChoiceDialog(intent, entityId, display, optionId)
}

/** Ask the §7b danger question about the same pending edit. */
export const openCorrectExistingDialog = (intent: Intent, entityId: string | null): void => {
  workspaceStore.getState().openCorrectExistingDialog(intent, entityId)
}

/**
 * Ask `Restore <ref>?` before a demolition record leaves one Design Option (#70 §7d). The dialog
 * reads which of the Option's successors fall from the Intent's own preview, so this carries ids.
 */
export const openRestoreDialog = (entityId: string, designOptionId: string): void => {
  workspaceStore.getState().openRestoreDialog(entityId, designOptionId)
}

/**
 * Ask `Delete <layer>?` before a Drawing Layer goes away (#71 §5). The view the row stands in comes
 * along for one question of the review — whether the content that comes back Unlayered is still
 * drawn there — and changes nothing about the delete.
 */
export const openDeleteLayerDialog = (layerId: string, viewId: string | null): void => {
  workspaceStore.getState().openDeleteLayerDialog(layerId, viewId)
}

/**
 * Ask where this tab's copy lands in this Project (#72 §5). The copy itself is never carried: it
 * lives on the tab's clipboard, which is what keeps a copy made in another Project from ever being
 * mistaken for one made here. The saved view the question was asked in comes along, as it does for
 * every other write.
 */
export const openPasteDialog = (floorId: string, viewId: string): void => {
  workspaceStore.getState().openPasteDialog(floorId, viewId)
}
