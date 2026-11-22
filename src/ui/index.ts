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

export { STRINGS, WARNING_COPY, warningSentence } from './strings'
// #69's copy is kept apart from the table because the surface it names is dark: a flag-off build
// ships neither those dialogs nor a word of what they say. `app`'s banned-word scan reads this
// table with the others, which is why it is exported rather than read off the filesystem.
export { RENOVATION_STRINGS } from './strings/renovation'
// #69's dark surface, reached by shipped code only from `FF_RENOVATION` branches (`FloorWorkspace`
// imports the folder directly). It is exported here because #20 §2 makes a module's `index.ts` the
// only way in: nothing in the shipped graph imports these bindings, so a flag-off build drops the
// modules with their copy, which `scripts/check-bundle-strings.mjs` now proves twice over.
export {
  DesignOptionsSection,
  MoveToOptionAction,
  RenovationOverlays,
  openDemolishDialog,
  openMoveToOptionDialog,
} from './workspace/renovation'
export type { ActiveViewState, Viewport, ViewportCache } from './workspace'
export { ExportDialog, UNIT_LABEL, type ExportDialogProps } from './workspace/export/ExportDialog'
export {
  viewKey,
  type ExportMeasurement,
  type ExportPort,
  type ListsOptions,
  type ListsChoice,
  type ExportRunOutcome,
  type ExportableView,
} from './workspace/export/port'
export {
  CabinetCanvas,
  FloorWorkspace,
  ItemDetailView,
  PLAN_IMAGE_ACCEPT,
  canCommit,
  discard,
  displayFormatOf,
  ghostFootprint,
  markerPoint,
  markedField,
  needsPreview,
  openShape,
  planItemsForFloor,
  propose,
  proposalFootprint,
  proposalMessage,
  shapeTarget,
  shownFootprint,
  planViewKey,
  useWorkspace,
  workspaceStore,
  WorkspaceProvider,
  type PlanCatalogueOption,
  type PlanImageRead,
  type PreparedPlanImage,
  type PreparedPlanImageAsset,
  type ShapeDraft,
  type ShapeGesture,
  type ShapeProblem,
  type ShapeProposal,
  type ShapeTarget,
  type WorkspaceAssetUrls,
  type WorkspaceIntentBuilder,
  type CabinetCanvasProps,
  type CabinetDetail,
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
