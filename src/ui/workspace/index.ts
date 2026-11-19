/**
 * The Floor workspace (#55): the production Plan View and the shell around it.
 *
 * The module is deliberately self-contained — it speaks to the rest of the app through
 * structural ports (`WorkspaceIntentBuilder`, `WorkspaceAssetUrls`, `ViewportCache`, …)
 * supplied by `app` at the seam, the way `ui/legacy` does, so the eslint boundary can
 * hold it to `session`, `drawing`, `derive`, `domain` and `export` only.
 */
export * from './displayUnits'
export * from './planModel'
export * from './shape/proposal'
export * from './shape/shapeTarget'
export * from './toolbarRegistry'
export * from './viewport'
export { WorkspaceProvider, useWorkspaceRoot, useWorkspaceProject } from './WorkspaceRoot'
export type {
  PlanCatalogueOption,
  PlanImageRead,
  PreparedPlanImage,
  PreparedPlanImageAsset,
  WorkspaceAssetUrls,
  WorkspaceHost,
  WorkspaceIntentBuilder,
  WorkspaceServices,
} from './WorkspaceRoot'
export { FloorWorkspace } from './FloorWorkspace'
export { ItemDetailView } from './ItemDetailView'
export type { ItemDetailViewProps } from './ItemDetailView'
export { WorkspaceShell } from './WorkspaceShell'
export type { WorkspaceShellProps } from './WorkspaceShell'
export { ToolbarMenu, ToolbarMenuItem, WorkspaceToolbar } from './WorkspaceToolbar'
export type { ToolbarGroup } from './WorkspaceToolbar'
export { useWorkspace, workspaceStore } from './workspaceStore'
export type { WorkspaceTool } from './workspaceStore'
