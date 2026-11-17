/**
 * The vocabulary of the `session` module (#48, #20 §4, #26, #14): the shapes the Library
 * store and the Project session exchange with `app` and `ui`.
 *
 * This file imports nothing from inside `session` — it is the leaf every other file in the
 * module may read, which is what keeps `registry`, `history`, `library` and
 * `projectSession` free of cycles among themselves.
 *
 * The names here are the ones #26 and #14 settled on: Edit Transaction, Recovery Point,
 * Project Backup. Never "version" and never "snapshot" in a name that can reach the UI —
 * `SessionSnapshot` is the store's read shape, an internal term, and `revision` is the
 * storage counter #20 §5 defines.
 */
import type { Applied, Intent, Locator, Rejection } from '../edit'
import type { LibraryRecord, PersistenceError, RecoveryPointKind, Result } from '../persistence'
import type { Project } from '../domain'
import type { ValidationProblem } from '../lib'

/** The patches of one Edit Transaction, as `edit` produces them (#20 §4). */
export type PatchList = Applied['patches']

/**
 * One undo step (#26): what the Intent did, what undoes it, and where it happened. Asset
 * bytes are never here — a Plan Image is referenced by hash, and its bytes wait in the
 * session's held-asset map until a commit has taken them (#26).
 */
export interface HistoryEntry {
  /** The Intent's label, shown in the undo/redo tooltip (#66). */
  label: string
  patches: PatchList
  inversePatches: PatchList
  /** The Intent's `affected`: undo and redo navigate here, and that is not a history step. */
  locator: Locator
}

/** What the toolbar needs: whether each direction exists, what it is called, and how deep the stack is. */
export interface HistoryInfo {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  /** Entries on the past stack — the 200 cap (#20 §8) is what this counts. */
  size: number
}

/** Why a write failed, in the words #14 shows. `not-found` arrives as `unavailable`. */
export type SaveFailureReason = 'quota' | 'aborted' | 'serialization' | 'revision-conflict' | 'unavailable'

/** The truthful save state (#14): in flight, saved at a time, or failed since a known time. */
export type SaveState =
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'failed'; lastSavedAt: string | null; reason: SaveFailureReason }

/**
 * #14's guard, as state rather than as a dialog: while `blocked` nothing may close, switch,
 * reload, import-replace or delete this Project. `resolvedBy` records how the block was
 * lifted, which is only ever a promise that the user has the bytes — it never claims the
 * Project is saved.
 */
export interface GuardState {
  blocked: boolean
  resolvedBy: null | 'emergency-download'
}

/** A one-shot message the UI shows until the next change (#26's boundary notice). */
export type SessionNotice = { kind: 'previous-state-saved' }

/** Everything the UI renders for one open Project. */
export interface SessionSnapshot {
  project: Project
  /** The in-memory revision: increases per Edit Transaction and per undo/redo (#26). */
  revision: number
  /** The revision the last successful commit wrote. `revision === persistedRevision` means saved. */
  persistedRevision: number
  save: SaveState
  guard: GuardState
  history: HistoryInfo
  /** True while another tab holds the lock: reads only, and every write is refused. */
  readOnly: boolean
  notice: SessionNotice | null
}

/** An asset the session is holding for a commit that has not succeeded yet. */
export interface SessionAsset {
  /** Lowercase hex SHA-256 of `bytes` — the key it is stored and held under. */
  sha256: string
  bytes: Blob
  mediaType: string
  widthPx: number | null
  heightPx: number | null
}

/** What the emergency download needs and nothing else (#50 encodes this with the package codec). */
export interface EmergencySource {
  project: Project
  /** The assets the in-memory Project references that no successful commit has carried. */
  heldAssets: ReadonlyMap<string, SessionAsset>
}

/** The boundaries that always sit behind an automatic Recovery Point (#26). */
export type PreBoundaryKind = Extract<RecoveryPointKind, 'pre-restore' | 'pre-import-replace' | 'pre-migration' | 'pre-discard'>

/** Every way a session operation can be refused. `'guarded'` is #14's block; `'read-only'` is another tab's lock. */
export type SessionError = PersistenceError | 'guarded' | 'read-only'

/** A dispatch refused because this tab may not write: another tab holds the lock, or this session is closed. */
export interface SessionRejection {
  ok: false
  code: 'read-only' | 'closed'
  problems: ValidationProblem[]
}

/** One `dispatch`: the step was taken, or the Intent was refused and nothing changed. */
export type DispatchResult = { ok: true } | Rejection | SessionRejection

/** The one open Project, as the UI sees it (#49 binds this with `useSyncExternalStore`). */
export interface ProjectSession {
  readonly id: string
  /** Snapshot changes: edits, save state, guard, history, read-only mode. */
  subscribe(listener: () => void): () => void
  /**
   * Navigation, which is not a state change: undo and redo tell the UI which Floor, view
   * and entities to show. A separate channel because the same Locator twice in a row is
   * still a navigation the UI has to act on (#26).
   */
  onNavigate(listener: (locator: Locator) => void): () => void
  getSnapshot(): SessionSnapshot
  /** Apply one Intent as one Edit Transaction, and schedule the write. */
  dispatch(intent: Intent, options?: { newAssets?: readonly SessionAsset[] }): DispatchResult
  /** Undo as a forward revision (#26). Works while save has failed. */
  undo(): Result<void, 'no-history'>
  /** Redo as a forward revision (#26). Works while save has failed. */
  redo(): Result<void, 'no-history'>
  /** The user's one explicit write: the current snapshot plus whatever is being held. */
  retry(): Promise<Result<void, SessionError>>
  /** The emergency download finished: the guard lifts, the save state does not change (#14). */
  markEmergencyBackupDownloaded(): void
  /** The in-memory Project — strictly validated — plus the bytes no commit has taken. */
  emergencySource(): EmergencySource
  /** Throw away the unsaved changes, behind a best-effort `pre-discard` Recovery Point. */
  discardUnsaved(): Promise<Result<void, SessionError>>
  /** A Recovery Point from the persisted state, then history is cleared (#26). */
  checkpoint(kind: PreBoundaryKind): Promise<Result<void, SessionError>>
  /** Recovery Point → its data as a new revision → history cleared (#26). */
  restoreRecoveryPoint(pointId: string): Promise<Result<void, SessionError>>
  /** Close Recovery Point, then release the lock. Refused while the guard is up. */
  close(): Promise<Result<void, SessionError>>
  /** Close this Project and open another. Refused while the guard is up. */
  switchTo(projectId: string): Promise<Result<ProjectSession, SessionError>>
}

/** What the Library lists without loading a Project (#14). */
export interface LibrarySnapshot {
  projects: LibraryRecord[]
  trash: LibraryRecord[]
  loading: boolean
}

/** The Library store: Project summaries, Trash, and the backup-due rule's inputs. */
export interface LibraryStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): LibrarySnapshot
  /** Re-read every Library record, trashed included. */
  refresh(): Promise<Result<void, PersistenceError>>
  /** A New Project at `NEW_PROJECT_REVISION`, committed with no expected revision. Returns its id. */
  createProject(name: string): Promise<Result<string, PersistenceError>>
  trash(id: string): Promise<Result<LibraryRecord, SessionError>>
  restore(id: string): Promise<Result<LibraryRecord, SessionError>>
  purge(id: string): Promise<Result<void, SessionError>>
  /** Record that a Project Backup was offered for the state the user was given. */
  markBackupInitiated(id: string): Promise<Result<LibraryRecord, SessionError>>
}

/**
 * The open sessions of this tab, so the Library can ask whether a Project's session is
 * blocked before trashing or purging it (#14). One registry per tab, shared by the Library
 * store and every `openProject` call.
 */
export interface SessionRegistry {
  register(session: ProjectSession): void
  unregister(projectId: string): void
  get(projectId: string): ProjectSession | null
  /** True when this Project's open session is holding unsaved changes the user has not resolved. */
  isGuarded(projectId: string): boolean
}
