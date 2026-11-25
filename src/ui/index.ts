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
// #69's copy is kept apart from the table because its surface is a feature of its own: the
// banned-word scan in `app` reads this table with the others, which is why it is exported rather
// than read off the filesystem.
export { RENOVATION_STRINGS } from './strings/renovation'
export { COMMENT_STRINGS } from './strings/comments'
// #69's renovation surface. It is exported here because #20 §2 makes a module's `index.ts` the only
// way in; `FloorWorkspace` imports the folder directly, as the one consumer.
export {
  DesignOptionsSection,
  MoveToOptionAction,
  RenovationOverlays,
  openDemolishDialog,
  openForcedChoiceDialog,
  openMoveToOptionDialog,
  openCorrectExistingDialog,
  openRestoreDialog,
} from './workspace/renovation'
export type { ActiveViewState, PaneState, Viewport, ViewportCache } from './workspace'
// #70's two pure halves: the tool table the contextual strip reads, and the overlap cycle the canvas
// selection walks. Both are copy-free and store-free, so they are testable without a canvas and the
// strip and the inspector can be written against them later. `cycleOrder` is exported because #74
// extends *this* ordering with Plan View Range grouping rather than writing a second one (#70 §8).
export {
  RENOVATION_TOOL_ROWS,
  availableTools,
  displaysAllowing,
  hiddenToolCount,
  toolIsAvailable,
  type RenovationToolId,
  type RenovationToolRow,
} from './workspace/renovation/toolAvailability'
export {
  cycleOrder,
  isSameSpot,
  nextCycle,
  reachableCandidates,
  type CanvasPoint,
  type CycleCandidate,
  type CycleOutcome,
  type CycleState,
} from './workspace/selection/overlapCycle'
// #74 §5: the Vertical Extent rows of the inspector, as data.
export {
  openingExtentView,
  placementExtentView,
  wallExtentView,
  type ExtentField,
  type ExtentNumberFormat,
  type ExtentRow,
  type VerticalExtentView,
} from './workspace/verticalExtentFields'
// #70 §2: the renovation block of the saved-view card, and the one Display-name and Display-colour
// table the rail, the mode bar and the legend read.
export { RenovationViewSection } from './workspace/renovation/RenovationViewSection'
// #71 §3, §5: the Layers list and the delete review.
export { RenovationLayers, layerSettingWord, type LayerSettingPatch } from './workspace/renovation/RenovationLayers'
export { DeleteLayerDialog } from './workspace/renovation/DeleteLayerDialog'
export { RenovationModeBar } from './workspace/renovation/RenovationModeBar'
export { RenovationErrorBanner } from './workspace/renovation/RenovationErrorBanner'
export { RenovationToolStrip } from './workspace/renovation/RenovationToolStrip'
export { DISPLAY_ORDER, DISPLAY_ROLES, DISPLAY_STATES, displayLabel } from './workspace/renovation/displayTheme'
export { ExportDialog, UNIT_LABEL, type ExportDialogProps } from './workspace/export/ExportDialog'
export {
  viewKey,
  type BlockedView,
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
  pasteClipboardStore,
  planItemsForFloor,
  planViewsForFloor,
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
  type CabinetNoteBadge,
  type CabinetNotePin,
  notesSessionStore,
  useNotesSession,
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
