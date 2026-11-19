/**
 * The `ui` module's face (#42 §2).
 *
 * `app` is the only module allowed to reach in here, and it reaches one thing: the Library home
 * and the props that drive it. The stylesheet and the self-hosted fonts arrive with the
 * component, so a mount cannot forget the CSS and render an unstyled grid.
 *
 * `ui/legacy` is deliberately absent. It is the pre-#42 surface the editor still runs on, claimed
 * out of this module by the `legacy-view` element in `eslint.config.js`, and nothing new should
 * be exported through it.
 */
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import './theme/tokens.css'
import './library/library.css'

export { STRINGS } from './strings'
export type { ActiveViewState, Viewport, ViewportCache } from './workspace'
export {
  FloorWorkspace,
  ItemDetailView,
  PLAN_IMAGE_ACCEPT,
  planItemsForFloor,
  planViewKey,
  workspaceStore,
  WorkspaceProvider,
  type PlanCatalogueOption,
  type PlanImageRead,
  type PreparedPlanImage,
  type PreparedPlanImageAsset,
  type WorkspaceAssetUrls,
  type WorkspaceIntentBuilder,
  useWorkspace,
  type ItemDetailViewProps,
  type WorkspaceServices,
} from './workspace'
export { LibraryHome, type LibraryHomeProps, type LibraryServices } from './library/LibraryHome'
export { MigrationReview, type MigrationReviewProps, type MigrationServices } from './library/MigrationReview'
export { formatSince } from './library/formatSince'
export { ReadOnlyStrip, StorageNotice, NowEditableToast } from './library/Notices'
export { ConflictDialog, type ConflictDialogProps } from './dialogs/ConflictDialog'
export {
  SaveFailedDialog,
  type SaveFailedDialogProps,
  type SaveFailedReason,
} from './dialogs/SaveFailedDialog'
