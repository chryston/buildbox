/**
 * Every word the Project Library says (#50, #14, #19 §12).
 *
 * One table for the whole surface, so #66's banned-word check has a single file to scan
 * and a reviewer comparing production against the `8787ba4` archive can read the two side
 * by side. The strings are quoted from issue #50 exactly; where the archive printed a
 * grammatical slip — `1 Design Options` — production is corrected and the correction is
 * named as deviation 6, not silently improved.
 *
 * Two house rules hold here:
 *
 * - **Vocabulary is the glossary's.** A Project Backup is a "Backup" on a button, never an
 *   "export"; a Recovery Point is never a "version"; a stored record is never "backed up"
 *   or "saved" on the Backup line (#14: BuildBox records only that a download was
 *   *initiated*).
 * - **No reassurance words.** #19 §12 bans "safe", "secure" and their synonyms. The
 *   surfaces state what BuildBox does and what it cannot know, and stop there.
 *
 * A `{name}`-shaped placeholder means the function takes that value; nothing here builds a
 * sentence by string concatenation at a call site, which is where the plurals go wrong.
 */

import type { MigrationStage, PersistenceError, RecoveryPointKind, SaveFailureReason } from '../../session'
import type { ExportFailureReason } from '../../export'
import { openingNoun } from '../../domain'
import type { FitFailure, OpeningKind } from '../../domain'
import type { WarningParams } from '../../derive'

/** `1 Floor` / `2 Floors` and the same for every countable noun the Library shows. */
export const plural = (count: number, one: string, many: string): string =>
  count === 1 ? `${count} ${one}` : `${count} ${many}`

export const STRINGS = {
  brand: 'BuildBox',
  brandSuffix: 'Project Library',

  navProjects: 'Projects',
  navMigration: 'Migration review',
  navTrash: 'Trash',

  /** `n` is the number of Projects `isBackupDue` answers yes for. */
  headerStatus: (n: number): string => `Local only · ${n} backup ${n === 1 ? 'reminder' : 'reminders'}`,

  eyebrowYourProperties: 'Your properties',
  libraryHeading: 'Pick up where you left off',
  libraryLede: 'Projects save automatically in this browser. Download backups to keep your own copies.',

  restoreBackup: 'Restore Backup',
  newProject: 'New Project',
  startAPropertyRecord: 'Start a property record',

  reminderTitle: 'Keep a copy you control',
  reminderBody: (n: number): string =>
    `${n} ${n === 1 ? 'Project has' : 'Projects have'} meaningful changes without a recent backup download. Local saves can be removed with browser data.`,
  downloadBackup: 'Download Backup',
  dismissBackupReminder: 'Dismiss backup reminder',

  noAddress: 'No address added',
  moreActions: (name: string): string => `More actions for ${name}`,
  rename: 'Rename',
  duplicate: 'Duplicate',

  saving: 'Saving…',
  savedLocally: (since: string): string => `Saved locally ${since}`,
  saveFailed: 'Save failed · changes not stored',

  backupStarted: (since: string): string => `Backup download started ${since}`,
  backupNone: 'No backup downloaded yet',

  floors: (n: number): string => plural(n, 'Floor', 'Floors'),
  designOptions: (n: number): string => plural(n, 'Design Option', 'Design Options'),
  recoveryPoints: (n: number): string => plural(n, 'Recovery Point', 'Recovery Points'),
  floorBadge: (n: number): string => `${n}F`,

  open: 'Open',
  backup: 'Backup',
  recover: 'Recover',
  delete: 'Delete',
  cancel: 'Cancel',
  close: 'Close',
  dismiss: 'Dismiss',
  viewTrash: 'View Trash',

  /** #14: Trash lasts 30 days, and the toast says so rather than "are you sure". */
  toastTrashed: (name: string): string => `Moved ${name} to Trash. You can restore it for 30 days.`,
  toastBackup: (name: string): string =>
    `Backup download started for ${name}. BuildBox cannot verify where the file is kept.`,
  toastRestoredNew: (name: string): string => `Restored ${name} from Backup.`,
  toastReplaced: (name: string): string => `Backup restored over ${name}. Previous state saved as Recovery Point.`,
  toastCopied: (name: string): string => `Imported as “${name}” with new IDs.`,

  eyebrowProjectBackup: 'Project Backup',
  backupHeading: 'Download a complete copy?',
  /** Deviation 10: the archive rendered literal backticks; production says the file name. */
  backupBody: 'The .buildbox file contains the full property record, including Plan Images and comments. It is not encrypted.',
  backupSize: (size: string): string => `Estimated size ${size} · all assets included`,
  backupSizeUnknown: '< 0.1 MB',
  backupHelper: 'BuildBox can record that the download started, but cannot verify where you keep the file.',

  eyebrowRestore: 'Restore Backup',
  collisionHeading: 'This Project already exists here',
  /**
   * The collision paragraph, in three pieces.
   *
   * #50 sets the Project name in bold inside it, and the only way to keep the sentence in this
   * table *and* render the emphasis is to hand the view the parts. Splitting a stored string at
   * the name would break the moment a Project is called `The` or `for`.
   */
  collisionBody: (name: string): { before: string; strong: string; after: string } => ({
    before: 'The backup for ',
    strong: name,
    after: ' has the same Project identity as a local Project. It passed validation and migration.',
  }),
  collisionReplace: 'Replace existing Project',
  collisionReplaceBody:
    'Preserve the current Project as a Recovery Point, then restore this backup with the same identity.',
  collisionCopy: 'Import as a copy',
  collisionCopyBody: (copyName: string): string =>
    `Create “${copyName}” and assign new IDs to every owned record.`,
  collisionCancel: 'Cancel—change nothing',

  renameHeading: 'Rename Project',
  renameLabel: 'Project name',
  renameSave: 'Save name',

  /** The one h2 #19 fixes word for word; everything else is `restoreProblem*`. */
  restoreProblemExport: 'This is an export, not a BuildBox Backup',
  restoreProblemNewer: 'This Backup was saved by a newer BuildBox',
  restoreProblemNewerPackage: (detected: string, supported: string): string =>
    `It was written by BuildBox package version ${detected}. This build reads up to ${supported}.`,
  restoreProblemNewerSchema: (detected: string, supported: string): string =>
    `Its records are at domain schema version ${detected}. This build reads up to ${supported}.`,
  restoreProblemPreview: 'This Backup came from a preview build',
  restoreProblemPreviewBody:
    'Preview builds write records the released app does not understand, so nothing was changed.',
  restoreProblemGeneric: "This file can't be restored",
  restoreProblemUnverified: "The restored Project couldn't be verified",
  restoreProblemUnverifiedBody:
    'The Backup was written, but reading it back did not match. Existing Projects are as they were.',
  restoreProblemBody: (check: string): string => `The ${check} check failed. Nothing was changed.`,
  /**
   * The two ways the write itself can refuse. #50 does not quote these — the prototype had no
   * rejection state at all — so they follow the shape of the sentences it does quote: state the
   * fact, then say nothing changed.
   */
  restoreProblemGuarded: 'That Project is held by another tab with unsaved changes. Nothing was changed.',
  restoreProblemStorage: 'This browser refused the write. Nothing was changed.',

  /**
   * The five shapes of `{since}` (#50 §2). One formatter produces them, driven by the clock
   * port, so a card and a Recovery Point row can never disagree about what "yesterday" means.
   */
  sinceJustNow: 'just now',
  sinceMinutes: (n: number): string => `${n} min ago`,
  sinceToday: (time: string): string => `Today, ${time}`,
  sinceYesterday: (time: string): string => `Yesterday, ${time}`,
  sinceDays: (n: number): string => `${n} days ago`,

  /* ------------------------------------------------------------------ #51: Recovery Points */

  eyebrowRecoveryPoints: 'Recovery Points',
  recoveryHeading: (name: string): string => `Return ${name} to an earlier state`,
  recoveryBody:
    'Restoring creates a new current revision. Your current state is preserved first, so this action is reversible.',
  recoveryRestore: 'Restore selected point',
  recoveryEmpty:
    'No Recovery Points yet. BuildBox creates them while you work and when you close a Project.',
  /**
   * The six checkpoint triggers #26 lists, in the words the row shows.
   *
   * Deviation 15: the prototype invented `Before importing plan image` and `Daily checkpoint`,
   * and neither is a kind a real Recovery Point has. These six are the kinds `persistence`
   * stores, so a row always names something BuildBox actually did.
   */
  recoveryReason: {
    idle: 'Automatic checkpoint',
    close: 'When the Project was closed',
    'pre-restore': 'Before restoring an older version',
    'pre-import-replace': 'Before replacing it from a Backup',
    'pre-migration': 'Before updating to a newer BuildBox',
    'pre-discard': 'Before discarding unsaved changes',
  } as Record<RecoveryPointKind, string>,
  /** The row's shape line, in the archive's lower case: `2 floors · 3 options · 14 items`. */
  recoverySummary: (floors: number, options: number, items: number): string =>
    `${plural(floors, 'floor', 'floors')} · ${plural(options, 'option', 'options')} · ${plural(items, 'item', 'items')}`,
  /** Deviation 13: #26 fixes this sentence; the prototype's wording is superseded. */
  toastRecoveryRestored: 'Recovery Point restored. Previous state saved as Recovery Point.',

  /* ---------------------------------------------------------------- #51: Save failed */

  eyebrowSaveFailed: 'Save failed',
  saveFailedHeading: 'Your latest changes are not stored',
  /**
   * The last-success sentence, in three pieces, because #14 sets the time in bold and a stored
   * string cannot be split at the time without breaking on a Project called `10:42`.
   */
  saveFailedBody: (time: string): { before: string; strong: string; after: string } => ({
    before: 'BuildBox kept the last successful local version from ',
    strong: time,
    after: '. Do not close this tab or switch Projects until you choose an action.',
  }),
  saveFailedNothingStored:
    'BuildBox has no stored local version of this Project yet. Do not close this tab or switch Projects until you choose an action.',
  saveFailedHeld: 'Current unsaved changes are still held in memory.',
  /** The four reasons #14 names. `revision-conflict` has its own dialog (#51 §5). */
  saveFailureReason: {
    quota: 'Browser storage is full',
    aborted: 'The browser stopped the save',
    serialization: "This Project couldn't be prepared for saving",
    unavailable: "Browser storage isn't available",
  } as Record<Exclude<SaveFailureReason, 'revision-conflict'>, string>,
  retrySave: 'Retry save',
  downloadEmergencyBackup: 'Download emergency backup',
  discardUnsaved: 'Discard unsaved changes',
  /** #14: the download is what lifts the guard, and BuildBox cannot see where the file went. */
  toastEmergencyStarted: 'Emergency backup download started. BuildBox cannot verify where the file is kept.',
  toastDiscarded: 'Unsaved changes discarded. Previous state saved as Recovery Point.',
  /** The same sentence when the `pre-discard` Point could not be stored — usually the same quota. */
  toastDiscardedNoPoint: 'Unsaved changes discarded.',

  /* ------------------------------------------------------- #51: Permanent deletion */

  eyebrowPermanentDeletion: 'Permanent deletion',
  permanentDeleteHeading: 'Delete this Project permanently?',
  permanentDeleteBody:
    'This removes the Project, its Plan Images, and local Recovery Points. This cannot be undone.',
  /** Deviation 14: the summary names the Project being deleted, not whatever card was selected. */
  permanentDeleteSummary: (floors: number, options: number, points: number): string =>
    `${plural(floors, 'floor', 'floors')} · ${plural(options, 'option', 'options')} · ${plural(points, 'Recovery Point', 'Recovery Points')}`,
  backupBeforeDelete: 'Download Backup before deleting',
  deletePermanently: 'Delete permanently',
  toastPurged: (name: string): string => `${name} was deleted permanently.`,

  /* ---------------------------------------------------------------- #51: Trash */

  eyebrowLocalTrash: 'Local trash',
  trashHeading: 'Deleted Projects',
  trashLede: 'Projects remain recoverable for 30 days. Clearing browser data can remove trash immediately.',
  trashEmpty: 'Trash is empty.',
  restore: 'Restore',
  /** `Deleted 12 days ago · 18 days remaining`, the archive's row. */
  trashDeleted: (since: string, remaining: string): string => `Deleted ${since} · ${remaining}`,
  /** #14: the Trash lasts 30 days, and the row counts them down. */
  daysRemaining: (n: number): string =>
    n >= 2 ? `${n} days remaining` : n === 1 ? '1 day remaining' : 'Less than a day remaining',
  returnToProjects: '← Return to Projects',
  toastRestored: (name: string): string => `Restored ${name}.`,

  /* ---------------------------------------------------------- #51: multi-tab safety */

  /** Deviation 17: no prototype surface has this strip; it reuses the chosen-row tokens. */
  readOnlyStrip:
    'This Project is open for editing in another tab. This tab is read-only and shows the latest saved state.',
  toastNowEditable: (name: string): string => `This tab can now edit ${name}.`,
  /** The one refusal every locked Library action answers with. */
  toastOpenElsewhere: (name: string): string => `${name} is open in another tab. Close it there first.`,

  eyebrowChangedInAnotherTab: 'Changed in another tab',
  conflictHeading: 'This Project changed in another tab',
  conflictBody: (name: string): string =>
    `Another tab saved a newer version of ${name}. Your latest changes in this tab are not stored.`,
  conflictReload: 'Reload the latest version',
  conflictImportCopy: 'Import my changes as a copy',

  /* ------------------------------------------------- #51: IndexedDB unavailable */

  /** Deviation 17 again: the notice is new, and it is the failure palette, not a new colour. */
  storageUnavailableNotice:
    "Browser storage isn't available. Projects here last only until this tab closes. Download a Backup to keep your work.",

  /* ------------------------------------------------ #52: Legacy data migration */

  migrationEyebrow: 'Legacy data migration',
  migrationHeading: 'Review where your existing work belongs',
  /**
   * The lede names what was found, because the whole page is a decision about those particular
   * things. A source with no floor plan has nothing to choose, so it gets its own sentence.
   */
  migrationLede: (designs: number, plans: number): string =>
    plans > 0
      ? `BuildBox found ${plural(designs, 'cabinet design', 'cabinet designs')}${
          plans === 1 ? ' and one standalone floor plan' : ` and ${plans} standalone floor plans`
        }. Cabinet designs will become separate Projects. Choose where the floor plan belongs—we will not guess.`
      : `BuildBox found ${plural(designs, 'cabinet design', 'cabinet designs')}. Each one will become a separate Project.`,
  migrationProjectsToCreate: 'Projects to create',
  /** `1 cabinet Item Design · no Plan Image`, the archive's row. */
  migrationRowSecondary: (designs: number, hasPlanImage: boolean): string =>
    `${plural(designs, 'cabinet Item Design', 'cabinet Item Designs')} · ${
      hasPlanImage ? 'has a Plan Image' : 'no Plan Image'
    }`,
  migrationTagNewProject: 'New Project',
  migrationTagNotMigrated: 'Not migrated',
  migrationTagReplaced: 'Replaces an existing Project',
  migrationTagCopy: 'Kept as a separate Project',
  /** The hatched box's own line; the dimensions under it say whether there is a real image. */
  migrationFloorPlanImage: 'Floor plan image',
  migrationStandaloneFloorPlan: 'Standalone floor plan',
  /** `2400 × 1800 px · 6 placed items`. */
  migrationPreview: (widthPx: number, heightPx: number, items: number): string =>
    `${widthPx} × ${heightPx} px · ${plural(items, 'placed item', 'placed items')}`,
  migrationNoImage: 'No Plan Image',
  migrationAttachItTo: 'Attach it to',
  migrationSeparateProject: 'Create a separate Project',
  migrationSkip: 'Skip — the floor plan is empty',
  migrationUntouchedHelper: 'The source data stays untouched until all new records verify successfully.',
  migrationDoThisLater: 'Do this later',
  migrationContinue: 'Continue to review',
  migrationBack: 'Back',
  migrationMigrateAndVerify: 'Migrate and verify',
  /** The empty floor plan is the one thing the review may decide for itself, and it says so. */
  migrationFloorPlanEmpty: 'The floor plan is empty, so there is nothing to copy.',
  /** Sketch types with no domain equivalent. The original keeps them; BuildBox does not. */
  migrationSketches: (wallHacks: number, tileZones: number): string =>
    `${plural(wallHacks, 'wall sketch', 'wall sketches')} and ${plural(
      tileZones,
      'tile zone',
      'tile zones',
    )} can't be migrated and will not be copied. Your original data keeps them.`,
  /** §4.4: a name that is taken is not a collision, and the row says what happens instead. */
  migrationNameTaken: 'Name already used; this stays a separate Project',
  /** §4.4: an id that is taken is a collision, and only the reader decides. */
  migrationCollision: (name: string): string =>
    `A Project with this BuildBox ID already exists: ${name}. Replace it, or keep both?`,
  migrationReplace: 'Replace it',
  migrationKeepBoth: 'Keep both',

  /** The six steps, in the order the pipeline runs them. */
  migrationStages: {
    read: 'Reading old data',
    convert: 'Converting',
    validate: 'Checking',
    images: 'Saving images',
    write: 'Writing Projects',
    'read-back': 'Reading back',
  } as Record<MigrationStage, string>,
  migrationVerifying: 'BuildBox is copying your work now.',
  /** §4.5: the sentence names the step, and says plainly that nothing moved. */
  migrationFailure: (stage: string): string =>
    `Migration stopped while ${stage.toLowerCase()}. Nothing was changed: your old data is untouched and no Projects were created.`,
  /** The store's own reasons, which are the only ones a failure may quote. */
  migrationFailureStorage: {
    quota: 'Browser storage is full.',
    aborted: 'The browser stopped the write.',
    unavailable: "Browser storage isn't available.",
    serialization: 'This data could not be prepared for saving.',
    'revision-conflict': 'One of these Projects changed while the review was open.',
    'not-found': 'One of these Projects is no longer here.',
  } as Record<PersistenceError['kind'], string>,
  migrationTryAgain: 'Try again',
  migrationDownloadOldData: 'Download old data as Backup',

  migrationVerifiedEyebrow: 'Migration verified',
  migrationVerifiedHeading: 'Your legacy work is ready',
  /** Deviation (c): the promise the prototype omits, because the old copy is still there. */
  migrationVerifiedLede:
    'Every new record was read back and matched. Your old data is untouched and stays in this browser until you choose Remove old copy.',
  migrationResultRow: (from: string, to: string): string => `${from} → ${to}`,
  migrationBecameNewProject: 'New Project',
  migrationBecameAttached: (name: string): string => `Attached to ${name}`,
  migrationBecameSeparate: 'Separate Project',
  migrationNotMigratedRow: (name: string): string => `${name} — not migrated`,
  migrationDownloadBackup: 'Download Backup',
  migrationDownloadBackupFor: (name: string): string => `Download Backup of ${name}`,
  migrationRemoveOldCopy: 'Remove old copy',
  migrationDownloadOriginal: 'Download original data',
  migrationReturn: 'Return to Projects',
  /** §4.7: the confirm names exactly what is about to go, and what is not. */
  migrationRemoveConfirm:
    'This deletes the old BuildBox data from this browser. The new Projects and your downloaded copies stay.',
  migrationRemoved: 'Old copy removed.',
  migrationNothingFound: 'BuildBox found no old data in this browser.',
  /** §6: migration needs somewhere to write, and this browser is refusing. */
  migrationPaused:
    "This browser isn't letting BuildBox store Projects right now, so migration is paused.",
  migrationStep: (step: number, total: number): string => `Step ${step} of ${total}`,
  migrationStepFound: 'Found',
  migrationStepReview: 'Review',
  migrationStepVerify: 'Verify',
  migrationStepBackUp: 'Back up',
  toastMigrationDone: (count: number): string =>
    `${plural(count, 'Project was', 'Projects were')} created from your old data.`,
  /** Criterion 17: a legacy file picked from `Restore Backup` goes to the review instead. */
  migrationFileDetected: 'That file is old BuildBox data. Review it instead?',
  migrationReviewTheFile: 'Review this file',

  /* ---------------------------------------------------------- #61: Export… */

  /** The ellipsis is the contract: the action opens a dialog, it does not download. */
  exportAction: 'Export…',
  exportEyebrow: 'Export',
  exportHeading: 'Export drawings?',
  /** `Drawing` is the only live tab; the other two name what is coming so the row is final. */
  exportTabDrawing: 'Drawing',
  exportTabLists: 'Lists',
  exportTabHandoff: 'Handoff pack',
  exportTabComingSoon: 'Coming soon',
  exportGroupViews: 'Views',
  exportGroupSheet: 'Sheet',
  exportGroupFiles: 'Files',
  exportFormat: 'Format',
  exportPageSize: 'Page size',
  exportOrientation: 'Orientation',
  exportOrientationAuto: 'Auto',
  exportOrientationPortrait: 'Portrait',
  exportOrientationLandscape: 'Landscape',
  exportScale: 'Scale',
  exportFitToPage: 'Fit to page',
  exportScaleRatio: (denominator: number): string => `1:${denominator}`,
  exportPngSize: 'PNG size',
  exportPngLongEdge: (pixels: number): string => `${pixels} px long edge`,
  exportTitleBlock: 'Title block',
  exportGrid: 'Grid',
  /** The read-only line: the drawing's unit is the Project's, never a choice here. */
  exportDimensionsIn: (unit: string): string => `Dimensions in ${unit}`,
  /** The privacy line, verbatim from the export contract §11. */
  exportPrivacy: 'Files include the Project name and any label text you typed.',
  /** Save failed: export still runs, from the in-memory snapshot, and says so. */
  exportUnsavedNotice: 'Exported from unsaved changes. Download a Backup to keep them.',
  /** Reads 0 until the warnings engine lands; the count is `derive`'s, not the dialog's. */
  exportWarningCount: (count: number): string => `${count} unacknowledged warnings in this scope`,
  /** Criterion 11: the export completes, and names the labels the font cannot draw. */
  exportMissingGlyphNotice: (labels: string): string =>
    `The PDF font can't render some characters in ${labels}. They are drawn as a box.`,
  /** An empty view is not an error; it exports with its title block and says so. */
  exportEmptyViewNotice: 'A view with nothing in it still exports, with its title block.',
  /** The Backup is the thing that keeps the work; the dialog points at it and stops. */
  exportBackupLink: 'To keep everything, including images and comments, use Download Backup in the Project Library.',
  /** The Lists tab (#62). `Item List` and `Cut List` are the contract's own table names. */
  exportListsGroupTables: 'Tables',
  exportListsGroupScope: 'Scope',
  exportListItems: 'Item List',
  exportListCutList: 'Cut List',
  /** The Cut List checkbox is absent rather disabled when nothing in scope has parts to cut. */
  exportListsNoCabinets: 'No cabinet designs in this scope',
  exportListsFloors: 'Floors',
  exportListsDesignOption: 'Design Option',
  exportListsExistingOnly: 'Existing only',
  exportListsStates: 'Renovation States',
  exportListsAllLayers: 'All layers incl. Unlayered',
  /** Beside each table: the rows it holds. `0 rows` is criterion 5's notice, in the same words. */
  exportListsRows: (count: number): string => `${count} ${count === 1 ? 'row' : 'rows'}`,
  /** A bare CSV has nowhere to put the Project, the revision or the recipe (export contract §9). */
  exportListsSingleNotice:
    'A single CSV file carries no provenance information. Choose two or more tables to get a ZIP with a manifest.',
  exportListsNeedTables: 'Choose at least one table to export.',
  exportRun: 'Export',
  exportRunning: 'Exporting…',
  /** Blocking explanations: Export stays disabled and says why in one line. */
  exportNeedViews: 'Choose at least one view to export.',
  exportPdfSingleView: 'PDF exports one view at a time.',
  exportScaleNoFit: (denominator: number): string =>
    `At 1:${denominator} the drawing is bigger than the page.`,
  exportScaleNoFitFixes: 'One-click fixes:',
  exportFixScale: (denominator: number): string => `Use 1:${denominator}`,
  exportFixFit: 'Use Fit to page',
  exportFixPage: (pageSize: string, orientation: string): string => `Use ${pageSize}, ${orientation}`,
  /** Criterion 15: a failure names the output and the reason, and nothing else. */
  exportFailedHeading: 'Nothing was downloaded.',
  exportFailedRow: (output: string, reason: string): string => `${output}: ${reason}`,
  // One sentence per reason `export` can answer with. The machine key never reaches the screen: a
  // person reading `raster-failed` learns nothing they can act on.
  exportFailedReason: (reason: ExportFailureReason): string =>
    ({
      'out-of-paper': 'It does not fit the page at that scale.',
      'empty-drawing': 'There was nothing in it to draw.',
      'unknown-view': 'That view is no longer in the Project.',
      'empty-tables': 'No table was chosen.',
      'no-font': 'The drawing font was missing.',
      'font-refused': 'The drawing font could not be read.',
      'no-rasterizer': 'This browser cannot make a PNG image.',
      'raster-failed': 'The image could not be made.',
      'image-format': 'A Plan Image is in a format that cannot be placed.',
    })[reason],
  exportFailedRetry: 'Untick that view and try again.',
  // The Warning strip (#66 §11–§12). `Seen ✓` is a status, never a button: the action that
  // produces it is `Acknowledge`, and the note that goes with it is always offered.
  warningShow: 'Show',
  warningHide: 'Hide',
  /** `2 open · 1 seen`; the count of what the strip is holding, collapsed. */
  warningCount: (open: number, seen: number): string => `${open} open · ${seen} seen`,
  warningLocate: 'Locate',
  warningAcknowledge: 'Acknowledge',
  warningNoteOptional: 'Note (optional)',
  warningNote: 'Note',
  warningSave: 'Save',
  warningSeen: 'Seen ✓',
  /** The note stays visible after a reopen: a note that vanishes was never read. */
  warningSeenNote: (note: string): string => `Seen ✓ · ${note}`,
  warningReopened: 'Reopened after change',
  /** Only reachable when a producer registers a `messageKey` this table has no row for. */
  warningCopyMissing: 'This warning has no wording yet.',
  // The sentences that came out of the components and into this table (#66 §17). Each one is
  // here because a component was saying it alone, where nobody reading the vocabulary would
  // notice and no scan would catch a word the export contract bans.
  floorLimitsOrder: 'The lower limit has to sit below the upper limit',
  /** The Wall draft's option row, which is a form and so reads as one. */
  wallThickness: 'Thickness',
  wallThicknessField: 'Thickness in millimetres',
  wallCustom: 'Custom…',
  wallJustification: 'Justification',
  wallClassification: 'Classification',
  wallClassificationNone: 'None',
  wallConstructionLabel: 'Construction label',
  wallUndoPoint: 'Undo point',
  wallFinish: 'Finish',
  wallCancelEsc: 'Cancel (Esc)',
  wallHeight: 'Height',
  /** The Wall inspector's three actions, and the sentence that explains the first. */
  wallOffsetBy: 'Offset wall by',
  wallOffsetSide: 'Which side to offset toward',
  wallOffsetToward: 'Toward this side',
  wallOffsetAway: 'Toward the other side',
  wallOffset: 'Offset',
  wallSplit: 'Split',
  /** The merge button says which Wall it would join, because that is the whole decision. */
  wallMergeNoTarget: 'No Wall to merge with here',
  wallMerge: 'Merge with…',
  wallMergeWith: (ref: string): string => `Merge with ${ref}`,
  /** Deleting a Wall takes its Openings with it, and the button says so rather than hiding it. */
  wallDeleteWithOpenings: (openings: number): string =>
    `Delete wall and ${plural(openings, 'opening', 'openings')}`,
  // The Door / window inspector and its draft (#65's components, #66 §17).
  openingLabel: 'Label',
  openingKind: 'Kind',
  openingHost: 'Host',
  openingWidth: 'Width',
  openingDistanceFrom: 'Distance from',
  openingFromStart: 'Start',
  openingFromEnd: 'End',
  /** The field says which end it measures from, because the two ends are not the same answer. */
  openingFromTheStart: 'From the start',
  openingFromTheEnd: 'From the end',
  openingSill: 'Sill',
  openingHead: 'Head',
  openingFlipHinge: 'Flip hinge',
  openingFlipSide: 'Flip opening side',
  openingDraftTitle: 'Door / window',
  openingDraftFixedSize: 'Fixed size',
  openingDraftDistance: 'Distance from the highlighted end',
  openingCancelEsc: 'Cancel (Esc)',
  // The Floors dialog (#64 §16, §17).
  floorNameRequired: 'Give this Floor a name',
  floorNameTaken: (name: string): string => `Another Floor is already called ${name}`,
  manageFloors: 'Manage Floors',
  floorName: 'Floor name',
  floorMoveUp: 'Move up',
  floorMoveDown: 'Move down',
  floorSettings: 'Floor settings',
  floorDuplicateEllipsis: 'Duplicate…',
  floorDeleteEllipsis: 'Delete…',
  floorLowerLimit: 'Lower limit',
  floorUpperLimit: 'Upper limit',
  /** A limit field left blank means "no limit", and the placeholder says so in the field. */
  floorNoLimit: 'none',
  floorDefaultWallHeight: 'Default wall height',
  floorProjectDefault: 'project default',
  floorUseThisHeight: 'Use this height',
  floorSaveLimits: 'Save limits',
  floorAdd: '+ Add Floor',
  // The Placed Item inspector (#38, #66 §17).
  originCentre: 'Centre',
  originTopLeft: 'Top-left',
  originTopRight: 'Top-right',
  originBottomRight: 'Bottom-right',
  originBottomLeft: 'Bottom-left',
  placedItem: 'Placed Item',
  name: 'Name',
  positionX: 'Position X',
  positionY: 'Position Y',
  rotation: 'Rotation',
  width: 'Width',
  depth: 'Depth',
  floorBounds: 'Floor bounds',
  /** The two Footprint rows are read-only, and the hint says where the number is really set. */
  setInItemDesign: 'Set in the Item Design below',
  itemDesignOf: (label: string): string => `Item Design: ${label}`,
  transferToFloor: 'Copy or Move to Floor…',
  forkDesign: 'Fork design…',
  designSharedBy: (name: string, count: number): string =>
    `Item Design · ${name} — shared by ${count} ${plural(count, 'placement', 'placements')}`,
  colour: 'Colour',
  colourSwatch: (colour: string): string => `Colour ${colour}`,
  itemOrigin: 'Item Origin',
  pickOnCanvas: 'Pick on canvas',
  affectsPlacements: (count: number): string => `Affects ${count} ${plural(count, 'placement', 'placements')}`,
  apply: 'Apply',
  // The New item and Fork design dialogs (#38, #66 §17).
  newItem: 'New item',
  widthMm: 'Width (mm)',
  depthMm: 'Depth (mm)',
  place: 'Place',
  forkDesignTitle: 'Fork design',
  /** The dialog says what a fork does before the person asks the model what a fork does. */
  forkDesignNote: 'Only this placement will use the new design.',
  fork: 'Fork',
  // The Plan View card (#44, #66 §17).
  planImageUncalibrated: 'Plan Image not calibrated',
  planImageScale: (perPx: string, unit: string): string => `Plan Image scale: 1 px = ${perPx} ${unit}`,
  planViewNameRequired: 'Give this Plan View a name',
  planViewNameTaken: (name: string): string =>
    `Another Plan View on this Floor is already called ${name}`,
  planView: 'Plan View',
  floor: 'Floor',
  manageFloorsEllipsis: 'Manage Floors…',
  planViewNameField: 'Plan View name',
  addPlanView: 'Add Plan View',
  showPlanImage: 'Show Plan Image',
  calibrateEllipsis: 'Calibrate…',
  fit: 'Fit',
  // The Duplicate Floor dialog (#64 §17).
  duplicateItemFallback: 'Item',
  floorCopyName: (name: string): string => `${name} copy`,
  duplicateFloor: 'Duplicate Floor',
  duplicateFloorAria: (name: string): string => `Duplicate Floor ${name}`,
  position: 'Position',
  placedItems: 'Placed Items',
  includePlanImage: 'Include Plan Image',
  /** The position a new Floor can take, named by the two Floors it would sit between. */
  positionAtTop: 'At the top',
  positionBetween: (before: string, after: string): string => `Between ${before} and ${after}`,
  positionAtEnd: 'At the end',
  // The Transfer and Delete Floor dialogs (#64 §17).
  transferNote: "Floors don't share coordinates; check the position on the destination Floor",
  destinationFloor: 'Destination Floor',
  axisX: 'X',
  axisY: 'Y',
  baseElevation: 'Base elevation',
  copyToFloor: 'Copy to Floor',
  moveToFloor: 'Move to Floor',
  deleteFloor: 'Delete Floor',
  deleteFloorAria: (name: string): string => `Delete Floor ${name}`,
  /** The dialog says what it will not do — delete nothing for you — before it says what it will. */
  deleteFloorBlocked: 'Delete what is on this Floor first. Nothing is deleted or moved for you.',
  deleteFloorEmpty: 'Nothing is left on this Floor. Deleting it also deletes its default Plan View.',
  show: 'Show',
  // The Shape tab's footprint fields (#46, #66 §17).
  customPath: 'Custom Path',
  orientation: 'Orientation',
  side: 'Side',
  diameter: 'Diameter',
  length: 'Length',
  endRadius: 'End radius',
  baseWidth: 'Base width',
  apexOffset: 'Apex offset',
  sides: 'Sides',
  sideLength: 'Side length',
  /** The two spans a regular polygon can be measured across, both read-only. */
  acrossCorners: 'Across corners',
  acrossFlats: 'Across flats',
  cornerRadius: 'Corner radius',
  perCornerRadii: 'Different radius per corner',
  // The Edges tab (#46, #66 §17).
  line: 'Line',
  arc: 'Arc',
  ellipticalArc: 'Elliptical arc',
  kind: 'Kind',
  radius: 'Radius',
  direction: 'Direction',
  /** The table's caption is the instruction, and it changes when the shape cannot be edited. */
  edgesCaptionEditable: 'Select an Edge to edit it, or a vertex to round its corner.',
  edgesCaptionReadOnly: 'Edges are read-only on a preset Item Footprint.',
  keepFixed: 'Keep fixed',
  sweep: 'Sweep',
  semiAxisA: 'Semi-axis A',
  semiAxisB: 'Semi-axis B',
  axisRotation: 'Axis rotation',
  roundAllCorners: 'Round all corners',
  // The Wall tool's vocabularies (#64 §12, §13, #66 §17).
  classificationExternal: 'External',
  classificationInternal: 'Internal',
  classificationPartition: 'Partition',
  /** The thickness picker names Walls, not millimetres, because that is how people ask for one. */
  thicknessInsideWall: 'Inside wall',
  thicknessKitchenWall: 'Kitchen wall',
  thicknessOutsideWall: 'Outside wall',
  thicknessEndWall: 'End wall of the block',
  justificationThisSide: 'Face on this side',
  justificationOtherSide: 'Face on the other side',
  arcFromLast: 'Arc from last',
  moreOptions: 'More options',
  shape: 'Shape',
  wallStraight: 'Straight',
  // The Floor workspace's toolbar and its menus (#57 §3, #66 §17).
  tools: 'Tools',
  addItem: 'Add item',
  inThisProject: 'In this Project',
  nothingHereYet: 'Nothing here yet',
  cabinet: 'Cabinet',
  catalog: 'Catalog',
  newItemEllipsis: 'New item…',
  planImage: 'Plan Image',
  uploadEllipsis: 'Upload…',
  replaceEllipsis: 'Replace…',
  remove: 'Remove',
  exportGroup: 'Export',
  viewAndSelection: 'View & selection',
  undo: 'Undo',
  redo: 'Redo',
  /** Both upload refusals say what went wrong and what to do instead. */
  imageInvalidFile: 'Please choose a valid image file.',
  imageTooLarge: 'A Plan Image can be at most 50 MB.',
  // The Shape editor's tabs and the Opening picker (#46, #47, #66 §17).
  tabEdges: 'Edges',
  tabMeasurements: 'Measurements',
  cabinetShapeNote: 'Size comes from the cabinet construction',
  shapes: 'Shapes',
  itemFootprint: 'Item Footprint',
  presetGroupDoors: 'Doors',
  presetGroupWindows: 'Windows',
  presetGroupOther: 'Other',
  /** The picker's `<optgroup>` label. The group value is an identifier; this is its copy. */
  presetGroupLabel(group: string): string {
    return group === 'Windows' ? STRINGS.presetGroupWindows : group === 'Other' ? STRINGS.presetGroupOther : STRINGS.presetGroupDoors
  },
  householdShelterDoor: 'Household shelter door',
  removedWallSection: 'Removed wall section',
  /** The path-drawing hints: the tool's name, then what the next click does. */
  draftFirstPoint(label: string): string {
    return `${label} · click to set the first point · Esc cancels`
  },
  draftBulge(label: string): string {
    return `${label} · click the bulge point · Esc cancels`
  },
  draftPlace(label: string): string {
    return `${label} · click to place · click start to close · Esc cancels`
  },
  /** The preset-placement hint carries the size a click will produce, in the display unit. */
  placingPreset(name: string, width: string, depth: string, unit: string): string {
    return `Placing ${name} — drag a box, or click for ${width} × ${depth} ${unit}`
  },
} as const

/**
 * The plain-words name of each staged-import check (#50 §4 step 1).
 *
 * `package` deliberately emits no user-facing text (#44): a code is a contract, and this is
 * the table that turns it into a sentence. The codes it names are the ones a user can reach
 * by picking a file; the four the dialog answers with a generic sentence are covered by the
 * sentence's own wording, so nothing here has to be kept in step with a new refusal.
 */
export const RESTORE_CHECK_NAMES = {
  'too-large': 'file size',
  'not-a-backup': 'file format',
  'export-not-backup': 'file format',
  'too-many-entries': 'archive contents',
  'entry-too-large': 'archive contents',
  'total-too-large': 'archive contents',
  'ratio-exceeded': 'archive contents',
  'bad-path': 'file name',
  'unexpected-entry': 'archive contents',
  'corrupt-archive': 'archive',
  'manifest-mismatch': 'manifest',
  'hash-mismatch': 'content hash',
  'missing-asset': 'asset',
  'unreferenced-asset': 'asset',
  'newer-package': 'package version',
  'preview-package': 'preview build',
  'newer-schema': 'record version',
  'migration-failed': 'migration',
  'invalid-project': 'Project record',
} as const

/**
 * The Openings' sentences (#65 §5, §10).
 *
 * `fitProblem` is re-exported rather than copied: the edit path already answers with it, and two
 * wordings of one rejection is how an app ends up with a screenshot of a sentence it no longer
 * says. The placement sentence beside it is the one case the domain cannot word, because a
 * placement has no label yet — the preset's own name is what the person is choosing between.
 *
 * Neither shows a coordinate. The words name the Opening and the Wall; the Plan View is what
 * shows the where.
 */
export { fitProblem, openingNoun } from '../../domain'

/** Millimetres in a sentence: whole when they are whole, one decimal when they are not. */
const mmWords = (mm: number): string => `${Math.round(mm * 10) / 10}`

/** Why this preset will not fit where the pointer is standing (#65 §10). */
export function placementFitMessage(
  presetName: string,
  kind: OpeningKind,
  width: number,
  hostRef: string,
  failure: FitFailure,
  refOf: (wallId: string) => string,
): string {
  if (failure.reason === 'no-room') {
    return `This wall is shorter than a ${mmWords(width)} mm ${openingNoun(kind)}.`
  }
  const cause = failure.cause
  if (cause !== null && cause.kind === 'junction') {
    return `${presetName} doesn't fit here: it would cross the join with ${refOf(cause.wallId)}.`
  }
  return `${presetName} doesn't fit here: it would run past the end of ${hostRef}.`
}

/**
 * The Warning strip's sentences (#66 §11–§12).
 *
 * The strip holds no copy of its own and no `if (type === 'wall_crossing')`: it renders
 * `warningSentence(warning)` for whatever the engine produced, and a later producer (#67,
 * #76–#79) adds one row here plus its `{type, produce}` and nothing else. A test fails if a
 * registered producer's `messageKey` has no row, so the fallback below is a sentence nobody
 * is meant to see rather than a silent gap.
 *
 * The numbers come from the engine as millimetres and are rounded here, in the one place a
 * measurement becomes a word — the same rule `placementFitMessage` follows.
 */
export const WARNING_COPY: Readonly<Record<string, (params: WarningParams) => string>> = {
  wall_crossing: (params) =>
    `${String(params.a)} crosses ${String(params.b)} without a join: ${mmWords(Number(params.mm))} mm overlap.`,
  wall_overlap: (params) =>
    `${String(params.a)} runs along ${String(params.b)} for ${mmWords(Number(params.mm))} mm without a join.`,
}

/** The sentence one warning says. */
export const warningSentence = (messageKey: string, params: WarningParams): string =>
  WARNING_COPY[messageKey]?.(params) ?? STRINGS.warningCopyMissing

