/**
 * The renovation surface (#69 §9, §13, §15) — dark until `VITE_FF_RENOVATION` is on.
 *
 * Everything here is reached only from a `FF_RENOVATION` branch, which is what keeps a flag-off
 * build from shipping a dialog for a command it cannot run, or a sentence about one: criterion 13
 * is measured on what ships, not on what compiles. The flag is read through `derive`, because #20
 * §2 keeps `lib` out of `ui`, and it is a build-time constant, so the branch it guards — and this
 * whole folder with it — is gone before the bundle is written.
 */
import { workspaceStore } from '../workspaceStore'

export { DesignOptionsSection, designOptionNameProblem, nextDesignOptionName } from './DesignOptionsSection'
export { DeleteDesignOptionDialog, deleteOptionRows } from './DeleteDesignOptionDialog'
export { DemolishWallDialog, demolishIsBlocked } from './DemolishWallDialog'
export { MoveToOptionAction } from './MoveToOptionAction'
export { MoveToOptionDialog, moveToOptionIsBlocked } from './MoveToOptionDialog'
export { RenovationOverlays } from './RenovationOverlays'

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
