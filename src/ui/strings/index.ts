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

import type { RecoveryPointKind, SaveFailureReason } from '../../session'

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
