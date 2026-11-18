/**
 * The public face of the `session` module (#48, #20 §2, ADR 0003): the only way in from
 * outside this folder.
 *
 * `session` is the stateful core of local Projects and nothing else: it holds no React, no
 * state library, no DOM and no storage technology. It imports `edit`, `domain`, `package`,
 * `lib` and the *ports and types* of `persistence` — never an adapter — and everything
 * browser-specific (clock, timer, Web Lock, ID source, the Backup codec, the download, the
 * image decoder) arrives through `./ports`. #49 wires it to IndexedDB and
 * `useSyncExternalStore`; #50 binds the Backup ports in `platform` and builds the Library that
 * reads `library` and `guard`.
 *
 * `package` is the one import here that is not a port or a pure type, and it is here because
 * a Project Backup is a *storage* concern with a *codec* in front of it: writing one means
 * reading stored assets and marking the Library record, and reading one means staging,
 * remapping IDs and committing atomically. Both are flows this module owns; `ui` may not import
 * `package` at all (#42 §2), so neither flow can live there.
 *
 * Three stores live here:
 *
 * - `createLibraryStore`: Project summaries, Trash, rename, duplicate, and `isBackupDue`.
 * - `openProject`: one Project's snapshot, its 200-step history, the single-flight writer,
 *   #14's guard as state, and the Recovery Point schedule.
 * - `./backup` and `./restore`: Download Backup and Restore Backup, including the collision
 *   decision and the read-back verification that rolls a bad import back.
 *
 * `src/session/testing.ts` is the second entry point, for test files only: the fake clock,
 * the fake lock and the gated adapter the suites are written against.
 */
export { HISTORY_LIMIT } from './history'
export { err, ok } from './result'
export {
  BACKUP_DUE_AFTER_MS,
  NEW_PROJECT_REVISION,
  TRASH_RETENTION_DAYS,
  createLibraryStore,
  isBackupDue,
  isTrashExpired,
  type LibraryDeps,
} from './library'
export { BACKUP_EXTENSION, backupFileName, downloadBackup, encodeBackup, encodeEmergencyBackup, type BackupDeps, type BackupWritten } from './backup'
export {
  commitRestore,
  copyNameFor,
  stageRestore,
  type RestoreApplied,
  type RestoreCollision,
  type RestoreCommitTarget,
  type RestoreDecision,
  type RestoreDeps,
  type RestoreProblem,
  type RestoreStaged,
} from './restore'
export { IDLE_RECOVERY_MS, openProject, type SessionDeps } from './projectSession'
export { createSessionRegistry } from './registry'
export type {
  BackupAsset,
  BackupEncoderPort,
  BackupMeta,
  ClockPort,
  DownloadPort,
  IdSource,
  ImageDecoderPort,
  LockHandle,
  LockPort,
} from './ports'
export type {
  BackupFailure,
  DispatchResult,
  EmergencySource,
  GuardState,
  HistoryEntry,
  HistoryInfo,
  LibrarySnapshot,
  LibraryStore,
  PatchList,
  PreBoundaryKind,
  ProjectSession,
  SaveFailureReason,
  SaveState,
  SessionAsset,
  SessionError,
  SessionNotice,
  SessionRejection,
  SessionRegistry,
  SessionSnapshot,
} from './types'
// The record shapes a caller of `session` meets in its results, named where they are owned.
// `RecoveryPointMeta` is here for the same reason `LibraryRecord` is: #51's Recovery Point
// picker reads it through `LibraryServices`, and `ui` may not import `persistence` (#42 §2).
export type {
  LibraryRecord,
  PersistenceError,
  Ports,
  RecoveryPointKind,
  RecoveryPointMeta,
  Result,
} from '../persistence'
