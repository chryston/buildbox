/**
 * The Project session (#48, #20 §4–§5, #26, #14): the single owner of one open Project's
 * state, history, save status and Recovery Point schedule.
 *
 * `openProject` loads the record, takes the Project's lock, and hands back a store the UI
 * can bind with `useSyncExternalStore`. Everything the user does runs through it:
 *
 * - **One commit path.** `dispatch` applies an Intent, moves the revision forward, records
 *   the step, and schedules a write. Nothing else writes, so nothing can overtake it.
 * - **A single-flight writer** (#20 §5). At most one `commit` is in flight; when it settles
 *   and a newer snapshot exists, only the newest one is written next, against
 *   `persistedRevision`. Intermediate snapshots are dropped and the revisions skip — which
 *   is exactly why the ports allow a skip (#45).
 * - **A truthful save state** (#14). `Saving…`, `Saved locally` with the last successful
 *   time, or `Save failed` with that time and the reason. On failure the writer stops:
 *   #14 forbids retrying silently forever, so the next write is the user's `retry()`.
 * - **The guard as state.** Entering `failed` blocks close, switch, trash and purge until
 *   a retry succeeds, the emergency download is taken, or the changes are discarded.
 * - **Recovery Points** (#26): idle after two minutes of quiet, on close or switch, and
 *   automatically before every boundary that clears history.
 *
 * It is DOM-free and adapter-free: the clock, the timer, the lock and the IDs arrive as
 * ports, and storage only through `persistence`'s `Ports`. That is what lets the whole
 * thing — quota failures, revision conflicts, the two-minute idle point — be tested against
 * the in-memory adapter and a fake clock in `src/session/projectSession.test.ts`.
 */
import { DOMAIN_SCHEMA_VERSION, summarizeProject, validateProject } from '../domain'
import type { Project } from '../domain'
import { applyIntent, applyPatches } from '../edit'
import type { Intent } from '../edit'
import { problem } from '../lib'
import type {
  CommitInput,
  PersistenceError,
  Ports,
  ProjectRecord,
  RecoveryPoint,
  RecoveryPointKind,
  Result,
} from '../persistence'
import { createHistory } from './history'
import type { BackupDeps } from './backup'
import { encodeEmergencyBackup } from './backup'
import type { ClockPort, IdSource, LockHandle, LockPort } from './ports'
import { err, ok } from './result'
import type {
  DispatchResult,
  EmergencySource,
  GuardState,
  PreBoundaryKind,
  ProjectSession,
  SaveFailureReason,
  SaveState,
  SessionAsset,
  SessionError,
  SessionNotice,
  SessionRejection,
  SessionSnapshot,
  SessionRegistry,
} from './types'
import type { Locator } from '../edit'

/** #26: an idle Recovery Point follows the last dispatch by about two minutes. */
export const IDLE_RECOVERY_MS = 120_000

/** Everything a session needs from outside, all of it a port (#20 §2). */
export interface SessionDeps {
  ports: Ports
  clock: ClockPort
  lock: LockPort
  ids: IdSource
  /** The tab's open sessions, so the Library can ask whether this Project is blocked. */
  registry: SessionRegistry
  /**
   * What the emergency download needs (#50): the encoder, the clock and the build's word.
   *
   * It is one group rather than three fields because it belongs to one capability — writing a
   * Project Backup out of a session whose storage has stopped — and a session with half of it
   * would offer a dialog that cannot finish.
   */
  backup: BackupDeps
  /**
   * True when the adapter behind `ports` keeps nothing past this tab (#51 §6).
   *
   * IndexedDB was unavailable, so `app` fell back to `createMemoryAdapter()`. The writes will
   * succeed — against RAM — which is exactly why the session has to be told: #14 forbids
   * claiming durability it does not have, so the session opens already failed and every later
   * "Saved locally" is refused.
   */
  volatile?: boolean
}

/**
 * Load one Project and open it.
 *
 * A lock held elsewhere is not a failure: the session opens read-only, refuses every write,
 * and waits for the holder to release (#20 §5's one writer per Project, across tabs).
 */
export async function openProject(
  projectId: string,
  deps: SessionDeps,
): Promise<Result<ProjectSession, PersistenceError>> {
  const loaded = await deps.ports.projects.load(projectId)
  if (!loaded.ok) return loaded
  const handle = await deps.lock.acquire(projectId)
  const session = createSession(loaded.value, deps, handle)
  deps.registry.register(session)
  return ok(session)
}

/** The last state a commit took to the store — what a `close` or `idle` Recovery Point holds. */
interface Persisted {
  project: Project
  revision: number
}

function createSession(record: ProjectRecord, deps: SessionDeps, firstHandle: LockHandle | null): ProjectSession {
  const { ports, clock, ids, lock, registry, volatile } = deps
  const history = createHistory()
  const listeners = new Set<() => void>()
  const navigateListeners = new Set<(locator: Locator) => void>()
  /** Asset bytes no successful commit has carried yet, keyed by hash (#26: history holds the hash only). */
  const heldAssets = new Map<string, SessionAsset>()

  let project = record.data
  let revision = record.revision
  let persistedRevision = record.revision
  let persisted: Persisted = { project: record.data, revision: record.revision }
  let lastSavedAt: string | null = volatile === true ? null : record.savedAt
  let save: SaveState =
    volatile === true
      ? { kind: 'failed', lastSavedAt: null, reason: 'unavailable' }
      : { kind: 'saved', at: record.savedAt }
  let guard: GuardState = { blocked: false, resolvedBy: null }
  let notice: SessionNotice | null = null
  let lastError: PersistenceError | null = null
  let readOnly = firstHandle === null
  let handle: LockHandle | null = firstHandle
  let closed = false
  let writing = false
  /** Set while a commit is in flight, so a boundary can wait for it instead of racing it. */
  let writerIdle: Promise<void> | null = null
  let writerIdleDone: (() => void) | null = null
  /** The revision the newest Recovery Point holds. `close` only writes a point when this has moved. */
  let lastRecoveryRevision = record.revision
  let cancelIdle: (() => void) | null = null

  function build(): SessionSnapshot {
    return {
      project,
      revision,
      persistedRevision,
      save,
      guard: { ...guard },
      history: history.describe(),
      readOnly,
      notice,
    }
  }

  let snapshot = build()

  function notify(): void {
    snapshot = build()
    for (const listener of [...listeners]) listener()
  }

  function refuse(code: SessionRejection['code'], message: string): SessionRejection {
    return { ok: false, code, problems: [problem('', code, message)] }
  }

  // ---------------------------------------------------------------- the writer

  /** `not-found` is the one port failure #14's list does not name: a record that has gone is the store being unavailable. */
  function saveReason(error: PersistenceError): SaveFailureReason {
    return error.kind === 'not-found' ? 'unavailable' : error.kind
  }

  /**
   * What `save` says after an operation that wrote successfully.
   *
   * In-memory mode is the exception (#51 §6): the write landed in this tab's RAM, and
   * `Saved locally` would be the claim #14 exists to stop. The failure stands, with the same
   * reason it opened with.
   */
  function afterWrite(at: string): SaveState {
    return volatile === true
      ? { kind: 'failed', lastSavedAt: null, reason: 'unavailable' }
      : { kind: 'saved', at }
  }

  function enterFailed(error: PersistenceError): void {
    lastError = error
    save = { kind: 'failed', lastSavedAt, reason: saveReason(error) }
    // #14: the newer state is now only in memory, so nothing may close, switch, reload,
    // import-replace or delete this Project until the user resolves it.
    guard = { blocked: true, resolvedBy: null }
  }

  /**
   * Write until the store has caught up, then stop.
   *
   * One at a time, newest only: `writing` is the single flight, and the loop re-reads
   * `project`, `revision` and `heldAssets` on every pass, so a dispatch that landed while a
   * commit was in flight is written next rather than queued behind a stale snapshot.
   * A failure leaves the loop for good — the next write is the user's.
   */
  async function drain(): Promise<void> {
    if (writing) return
    // In-memory mode has nothing to write to (#51 §6). A retry that "succeeded" against RAM
    // would hand the user a `Saved locally` they cannot come back to, so the failure stands.
    if (volatile === true) {
      enterFailed({ kind: 'unavailable', reason: 'this tab keeps nothing past itself' })
      notify()
      return
    }
    writing = true
    writerIdle = new Promise<void>((resolve) => {
      writerIdleDone = resolve
    })
    try {
      while (!closed && revision !== persistedRevision) {
        const carried = [...heldAssets.values()]
        const input: CommitInput = { project, revision, savedAt: clock.now() }
        if (carried.length > 0) input.newAssets = carried
        const expected = persistedRevision
        const committed = await ports.projects.commit(input, expected)
        if (!committed.ok) {
          enterFailed(committed.error)
          return
        }
        // `input.project` is the snapshot the store accepted, not whatever the user has
        // typed since — the two differ whenever a dispatch landed during the await.
        persisted = { project: input.project, revision: committed.value.revision }
        persistedRevision = committed.value.revision
        lastSavedAt = committed.value.savedAt
        for (const asset of carried) heldAssets.delete(asset.sha256)
      }
    } finally {
      writing = false
      const settled = writerIdleDone
      writerIdle = null
      writerIdleDone = null
      settled?.()
      if (save.kind === 'saving' && revision === persistedRevision) {
        save = afterWrite(lastSavedAt ?? clock.now())
        guard = { blocked: false, resolvedBy: null }
        lastError = null
      }
      notify()
    }
  }

  /**
   * Wait for a commit in flight. Every boundary reads the persisted state — the close point,
   * the discard, the revision a restore commits against — and reading it while a write is
   * still moving it would store, or replace, the state that write is about to land (#14).
   */
  async function settleWriter(): Promise<void> {
    if (writerIdle !== null) await writerIdle
  }

  // ------------------------------------------------------- Recovery Points

  /**
   * Store one Recovery Point and prune the list.
   *
   * The point holds a whole Project and its Summary, because #14's list shows a name and a
   * shape without loading anything. A failed `prune` is ignored: an over-long list is a
   * capacity nuisance, while refusing the point would lose the state itself.
   */
  async function createPoint(
    kind: RecoveryPointKind,
    source: Project,
    at: number,
  ): Promise<Result<string, PersistenceError>> {
    const point: RecoveryPoint = {
      id: ids(1)[0],
      projectId: record.id,
      createdAt: clock.now(),
      kind,
      revision: at,
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      summary: summarizeProject(source),
      data: source,
    }
    const created = await ports.recovery.create(point)
    if (!created.ok) return created
    await ports.recovery.prune(record.id, { now: clock.now(), dayKey: clock.dayKey })
    return created
  }

  /** Two minutes of quiet after a change, and only once the change is actually stored (#26). */
  function armIdle(): void {
    cancelIdle?.()
    cancelIdle = clock.setTimer(IDLE_RECOVERY_MS, () => {
      void idlePoint()
    })
  }

  function disarmIdle(): void {
    cancelIdle?.()
    cancelIdle = null
  }

  async function idlePoint(): Promise<void> {
    cancelIdle = null
    if (closed || readOnly) return
    // Nothing to point at while the store is refusing writes, and nothing to point at
    // until the change has been persisted: an idle point is a recovery of stored state.
    if (save.kind === 'failed') return
    if (persisted.revision === lastRecoveryRevision) return
    const created = await createPoint('idle', persisted.project, persisted.revision)
    if (!created.ok) return
    lastRecoveryRevision = persisted.revision
  }

  // ------------------------------------------------------------------ edits

  function dispatch(intent: Intent, options?: { newAssets?: readonly SessionAsset[] }): DispatchResult {
    if (closed) return refuse('closed', 'This Project is closed, so nothing more can be written to it.')
    if (readOnly) {
      return refuse('read-only', 'Another tab has this Project open, so this tab can only read it.')
    }
    const applied = applyIntent(project, intent)
    // A Rejection changes nothing at all: no revision, no history entry, no write (#20 §13.8).
    if (!applied.ok) return applied

    project = applied.project
    revision += 1
    history.push({
      label: intent.label,
      patches: applied.patches,
      inversePatches: applied.inversePatches,
      locator: applied.affected,
    })
    for (const asset of options?.newAssets ?? []) heldAssets.set(asset.sha256, asset)
    notice = null
    // The emergency download only promised the user a file; this edit is not in it (#14).
    if (guard.resolvedBy === 'emergency-download') guard = { blocked: true, resolvedBy: null }
    // An edit made while storage has failed is unsaved by definition, so the guard arms on it
    // even when the failure predates this session — which is how memory mode gets §6's rule
    // (`beforeunload` once a Project has edits) without a dialog the moment it opens.
    if (save.kind === 'failed' && !guard.blocked) guard = { blocked: true, resolvedBy: null }
    // While save has failed the writer stays stopped: the edit is kept in memory, marked
    // unsaved, and waits for the user's retry rather than a silent loop (#14).
    if (save.kind !== 'failed') {
      save = { kind: 'saving' }
      void drain()
    }
    armIdle()
    notify()
    return { ok: true }
  }

  /**
   * Undo and redo, both of them forward (#26): the patches are applied to the current
   * Project, the result is a new revision, and it is persisted like any other edit. The
   * step moves between the stacks; the navigation it emits is not a step and takes no
   * revision of its own.
   */
  function step(direction: 'undo' | 'redo'): Result<void, 'no-history'> {
    if (closed) return err('no-history')
    const entry = direction === 'undo' ? history.takeUndo() : history.takeRedo()
    if (entry === null) return err('no-history')
    project = applyPatches(project, direction === 'undo' ? entry.inversePatches : entry.patches)
    if (direction === 'undo') history.commitUndo(entry)
    else history.commitRedo(entry)
    revision += 1
    notice = null
    if (save.kind !== 'failed') {
      save = { kind: 'saving' }
      void drain()
    }
    armIdle()
    notify()
    for (const listener of [...navigateListeners]) listener(entry.locator)
    return ok(undefined)
  }

  // ------------------------------------------------------- resolving a failure

  async function retry(): Promise<Result<void, SessionError>> {
    if (readOnly || closed) return err('read-only')
    save = { kind: 'saving' }
    lastError = null
    notify()
    await drain()
    // Read the settled state off the snapshot: `drain` has been rebuilding it throughout.
    if (snapshot.save.kind === 'failed') {
      return err(lastError ?? { kind: 'unavailable', reason: 'the write was refused' })
    }
    return ok(undefined)
  }

  /**
   * The emergency download is on its way. The guard lifts because #14's block exists to
   * stop the user losing bytes they never got; the save state does not change, because an
   * emergency download proves nothing about the store and cannot be verified.
   */
  function markEmergencyBackupDownloaded(): void {
    if (save.kind !== 'failed') return
    guard = { blocked: false, resolvedBy: 'emergency-download' }
    notify()
  }

  function emergencySource(): EmergencySource {
    // Strictly validated (#42 §5): the one artefact the user keeps when storage has failed
    // has to be re-importable, so an in-memory Project that would not validate is a bug in
    // `edit` and is named as one rather than encoded into a file nobody can open.
    const checked = validateProject(project)
    if (!checked.ok) {
      const first = checked.problems[0]
      throw new Error(`the in-memory Project failed strict validation: ${first.path} ${first.message}`)
    }
    return { project, heldAssets: new Map(heldAssets) }
  }

  async function discardUnsaved(): Promise<Result<void, SessionError>> {
    if (readOnly || closed) return err('read-only')
    await settleWriter()
    // Best effort, and from the in-memory state — the whole point is to keep what is about
    // to be thrown away. Under a full quota this fails, and that never blocks a discard
    // the user asked for explicitly (#14).
    const point = await createPoint('pre-discard', project, revision)
    const reloaded = await ports.projects.load(record.id)
    if (!reloaded.ok) return err(reloaded.error)

    project = reloaded.value.data
    revision = reloaded.value.revision
    persistedRevision = reloaded.value.revision
    persisted = { project: reloaded.value.data, revision: reloaded.value.revision }
    lastSavedAt = reloaded.value.savedAt
    heldAssets.clear()
    history.clear()
    disarmIdle()
    save = afterWrite(reloaded.value.savedAt)
    guard = { blocked: false, resolvedBy: null }
    lastError = null
    if (point.ok) {
      lastRecoveryRevision = revision
      notice = { kind: 'previous-state-saved' }
    }
    notify()
    return ok(undefined)
  }

  /**
   * Take a freshly-read stored record as this session's own state.
   *
   * History goes with it (#26): the steps that led to the old snapshot no longer describe a
   * continuous session over the one that arrived.
   */
  function adopt(reloaded: ProjectRecord): void {
    project = reloaded.data
    revision = reloaded.revision
    persistedRevision = reloaded.revision
    persisted = { project: reloaded.data, revision: reloaded.revision }
    lastSavedAt = reloaded.savedAt
    save = afterWrite(reloaded.savedAt)
    lastRecoveryRevision = reloaded.revision
    history.clear()
    notify()
  }

  /**
   * Re-read the stored record into a read-only session (#51 §5).
   *
   * A read-only tab is not the writer, so it has nothing of its own to lose: the editing tab
   * announces its commit on `buildbox:library` and this tab shows the new state a frame later.
   * An editable session is refused rather than quietly thrown away — discarding unsaved work
   * is `discardUnsaved`'s decision, made by a person, not by a message arriving.
   */
  async function reload(): Promise<Result<void, SessionError>> {
    if (!readOnly || closed) return err('read-only')
    const reloaded = await ports.projects.load(record.id)
    if (!reloaded.ok) return err(reloaded.error)
    adopt(reloaded.value)
    return ok(undefined)
  }

  // ------------------------------------------------------------- boundaries

  /**
   * A Recovery Point from the persisted state, then history is gone (#26): the state before
   * the boundary is recoverable, but the steps that led to it are not, because they no
   * longer describe a continuous edit session.
   */
  async function checkpoint(kind: PreBoundaryKind): Promise<Result<void, SessionError>> {
    if (readOnly || closed) return err('read-only')
    await settleWriter()
    const created = await createPoint(kind, persisted.project, persisted.revision)
    if (!created.ok) return created
    lastRecoveryRevision = persisted.revision
    history.clear()
    notice = { kind: 'previous-state-saved' }
    notify()
    return ok(undefined)
  }

  async function restoreRecoveryPoint(pointId: string): Promise<Result<void, SessionError>> {
    if (readOnly || closed) return err('read-only')
    // Restore is reversible because the state it replaces is kept first (#26).
    const marked = await checkpoint('pre-restore')
    if (!marked.ok) return marked
    const point = await ports.recovery.load(pointId)
    if (!point.ok) return point

    const committed = await ports.projects.commit(
      { project: point.value.data, revision: revision + 1, savedAt: clock.now() },
      persistedRevision,
    )
    if (!committed.ok) {
      enterFailed(committed.error)
      notify()
      return committed
    }
    project = committed.value.data
    revision = committed.value.revision
    persistedRevision = committed.value.revision
    persisted = { project: committed.value.data, revision: committed.value.revision }
    lastSavedAt = committed.value.savedAt
    save = afterWrite(committed.value.savedAt)
    guard = { blocked: false, resolvedBy: null }
    lastError = null
    history.clear()
    disarmIdle()
    notice = { kind: 'previous-state-saved' }
    notify()
    return ok(undefined)
  }

  function finishClose(): void {
    closed = true
    disarmIdle()
    handle?.release()
    handle = null
    registry.unregister(record.id)
    // History is gone with the session (#26): reopening starts an empty one.
    history.clear()
    listeners.clear()
    navigateListeners.clear()
  }

  async function close(): Promise<Result<void, SessionError>> {
    if (closed) return ok(undefined)
    if (guard.blocked) return err('guarded')
    // A commit still in flight is about to move the state the close point would hold, and if
    // it fails the Project is guarded again — both are decided before anything is written.
    await settleWriter()
    if (guard.blocked) return err('guarded')
    if (persisted.revision !== lastRecoveryRevision) {
      const created = await createPoint('close', persisted.project, persisted.revision)
      // A Recovery Point that could not be stored is a reason to stay open, not a licence
      // to lose the state quietly: the caller surfaces the failure and can close again.
      if (!created.ok) return created
      lastRecoveryRevision = persisted.revision
    }
    finishClose()
    return ok(undefined)
  }

  async function switchTo(projectId: string): Promise<Result<ProjectSession, SessionError>> {
    const closedNow = await close()
    if (!closedNow.ok) return closedNow
    return openProject(projectId, deps)
  }

  const session: ProjectSession = {
    id: record.id,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onNavigate(listener) {
      navigateListeners.add(listener)
      return () => {
        navigateListeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    dispatch,
    undo: () => step('undo'),
    redo: () => step('redo'),
    retry,
    markEmergencyBackupDownloaded,
    emergencySource,
    encodeEmergencyBackup: () => encodeEmergencyBackup({ ...deps.backup, ports }, emergencySource()),
    discardUnsaved,
    reload,
    checkpoint,
    restoreRecoveryPoint,
    close,
    switchTo,
  }

  // A read-only session takes over the moment the holder lets go: the other tab's saved
  // state becomes this tab's editable state, with the history that belonged to the old
  // view dropped because it no longer describes a continuous session (#26).
  if (firstHandle === null) {
    void lock.waitFor(record.id).then((acquired) => {
      if (closed) {
        acquired.release()
        return
      }
      handle = acquired
      void ports.projects.load(record.id).then((reloaded) => {
        if (closed) return
        if (!reloaded.ok) {
          handle = null
          return
        }
        readOnly = false
        adopt(reloaded.value)
      })
    })
  }

  return session
}
