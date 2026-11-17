/**
 * The public face of the `session` module (#48, #20 §2, ADR 0003): the only way in from
 * outside this folder.
 *
 * `session` is the stateful core of local Projects and nothing else: it holds no React, no
 * state library, no DOM and no storage technology. It imports `edit`, `domain`, `lib` and
 * the *ports and types* of `persistence` — never an adapter — and everything
 * browser-specific (clock, timer, Web Lock, ID source) arrives through `./ports`. #49 wires
 * it to IndexedDB and `useSyncExternalStore`; #51 binds the ports in `platform` and builds
 * the dialogs that read `save` and `guard`.
 *
 * Two stores live here:
 *
 * - `createLibraryStore`: Project summaries, Trash, and `isBackupDue`.
 * - `openProject`: one Project's snapshot, its 200-step history, the single-flight writer,
 *   #14's guard as state, and the Recovery Point schedule.
 *
 * `src/session/testing.ts` is the second entry point, for test files only: the fake clock,
 * the fake lock and the gated adapter the suites are written against.
 */
export { HISTORY_LIMIT } from './history'
export {
  BACKUP_DUE_AFTER_MS,
  NEW_PROJECT_REVISION,
  createLibraryStore,
  isBackupDue,
  type LibraryDeps,
} from './library'
export { IDLE_RECOVERY_MS, openProject, type SessionDeps } from './projectSession'
export { createSessionRegistry } from './registry'
export type { ClockPort, IdSource, LockHandle, LockPort } from './ports'
export type {
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
export type { LibraryRecord, PersistenceError, Ports, Result } from '../persistence'
