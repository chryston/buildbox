/**
 * The composition root of the app (#49, #50, #53).
 *
 * This is the only module that knows the storage technology, the browser's clock and locks,
 * and the Intent catalogue as *values*: it binds them together and hands the result to the
 * surfaces through `LibraryHome` and `LegacyViewRoot`. Nothing under `ui` reaches any of
 * them, which is what keeps the app replaceable (#20 §2).
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import App from '../App'
import { intentIdCount, intentLabel, previewIntent } from '../edit'
import type { Intent, IntentType, PayloadOf } from '../edit'
import { collectLiveHashes, createMemoryAdapter } from '../persistence'
import type { Ports } from '../persistence'
import { openIndexedDbAdapter } from '../persistence/indexeddb/open'
import { referencedAssetHashes, remapIds } from '../domain'
import {
  NEW_PROJECT_REVISION,
  backupFileName,
  commitRestore,
  createLibraryStore,
  createSessionRegistry,
  downloadBackup,
  encodeEmergencyBackup,
  ok,
  openProject,
  stageRestore,
  type BackupDeps,
  type ClockPort,
  type DownloadPort,
  type GuardState,
  type IdSource,
  type LibraryStore,
  type LockPort,
  type ProjectSession,
  type Result,
  type RestoreDeps,
  type SaveState,
  type SessionError,
  type SessionRegistry,
  buildMigrationPlan,
  downloadOldBackups,
  downloadOriginalData,
  inspectMigration,
  isAlreadyMigrated,
  legacyFileKind,
  removeOldCopy,
  runMigration,
  sourceHash,
  type LegacySourcePort,
  type LibraryRecord,
  type MigrationAttachTarget,
  type MigrationChoices,
  type MigrationDeps,
  type MigrationSource,
} from '../session'
import {
  createBackupEncoder,
  createDownload,
  createImageDecoder,
  createLegacySource,
  createObjectUrlCache,
  createPlatformClock,
  createRandomIdSource,
  createWebLocksPort,
  readPlanImageFile,
} from '../platform'
import type { ObjectUrlCache } from '../platform'
import { ConflictDialog, LibraryHome, NowEditableToast, PLAN_IMAGE_ACCEPT, ReadOnlyStrip, SaveFailedDialog, WorkspaceProvider } from '../ui'
import type { LibraryServices, MigrationServices, PlanImageRead, SaveFailedReason, WorkspaceServices } from '../ui'
import { convertLegacy } from '../package'
import { requestPersistentStorage } from './persistentStorage'
import { DB_NAME, IS_PREVIEW } from './channel'
import { LegacyViewRoot } from '../ui/legacy/LegacyViewRoot'
import type { IntentBuilder } from '../ui/legacy/sessionBindings'
import { PLAN_CATALOGUE } from '../edit'
import { createViewportCache } from './viewportCache'
import { createExportPort } from './export'

/**
 * The channel one tab uses to tell the others that the Library changed (#50 §5). Named for
 * what it carries rather than for the store behind it, because a message means "the cards are
 * stale", not "one record was written".
 */
export const LIBRARY_CHANNEL = 'buildbox:library'

/** What one tab says when it has written a Project (#50 §5, #51 §5). */
interface LibraryChange {
  projectId: string
  revision: number
}

/**
 * The commit port with the Library announcement attached.
 *
 * Wrapped here rather than posted from `session`, which keeps a browser API out of the session
 * layer — and it means *every* writer announces: the Library, a restore, a session's autosave.
 * That last one is the reason #51 §5 needs it. A tab that lost its Web Lock has no other way to
 * learn the record has moved, because `navigator.locks` offers no subscription, and without this
 * a read-only tab would stay read-only until the person reloaded.
 */
function announceCommits(ports: Ports, channel: BroadcastChannel): Ports {
  return {
    ...ports,
    projects: {
      ...ports.projects,
      commit: async (input, expectedRevision) => {
        const committed = await ports.projects.commit(input, expectedRevision)
        if (committed.ok) {
          channel.postMessage({
            projectId: input.project.id,
            revision: committed.value.revision,
          } satisfies LibraryChange)
        }
        return committed
      },
      // A migration commits several Projects in one transaction, and the Library is a list built
      // before that transaction existed. Without this the reader presses `Return to Projects` and
      // sees the grid they left: the records are in the store, and nothing has told the screen.
      commitMany: async (entries) => {
        const committed = await ports.projects.commitMany(entries)
        if (committed.ok) {
          for (const record of committed.value) {
            channel.postMessage({ projectId: record.id, revision: record.revision } satisfies LibraryChange)
          }
        }
        return committed
      },
    },
  }
}

/**
 * The services the legacy views cannot build for themselves.
 *
 * `readPlanImage` hands back bytes *and* a URL to show them by: the upload has to be
 * displayable before it has been stored anywhere, and the URL comes from the same cache the
 * stored images use, so one hash is one URL for the life of the tab.
 */
export function createSessionServices(
  clock: ClockPort,
  ids: IdSource,
  assetUrls: ObjectUrlCache,
) {
  return {
    intent: createIntentFactory(clock, ids),
    assetUrls,
    async readPlanImage(file: File): Promise<PlanImageRead> {
      const read = await readPlanImageFile(file)
      if (!read.ok) return { message: read.error }
      const { sha256, bytes, mediaType, widthPx, heightPx } = read.value
      assetUrls.put(sha256, bytes)
      const src = assetUrls.urlFor(sha256)
      if (src === null) return { message: 'Could not read that image file.' }
      return { image: { src, widthPx, heightPx, asset: { sha256, bytes, mediaType, widthPx, heightPx } } }
    },
  }
}

/**
 * The Intent factory: labels from the #47 table, ids from `crypto.randomUUID()`, the clock
 * from `platform`.
 *
 * The view says which Intent it wants and what happened; the label and the number of ids are
 * the catalogue's business, so they are derived here rather than spelled out at 35 call
 * sites that could each get one wrong.
 */
export function createIntentFactory(clock: ClockPort, ids: IdSource): IntentBuilder {
  return {
    build<T extends IntentType>(type: T, payload: PayloadOf<T>): Intent {
      return {
        type,
        payload,
        label: intentLabel(type),
        ids: ids(intentIdCount(type, payload)),
        now: clock.now(),
      } as Intent
    },
    preview: (project, intent) => ({ review: previewIntent(project, intent).review }),
  }
}

/**
 * Everything the flagged surfaces need, built once per tab before React renders anything.
 *
 * These are the browser's long-lived collaborators — one store, one clock, one lock port, one
 * registry of open sessions — as opposed to the per-render values a component derives from them.
 * Holding them in one object is what lets `FlaggedRoot` build its `LibraryServices` in a
 * `useMemo` that never invalidates.
 */
interface FlaggedDeps {
  ports: Ports
  clock: ClockPort
  ids: IdSource
  lock: LockPort
  registry: SessionRegistry
  library: LibraryStore
  backup: BackupDeps
  restore: RestoreDeps
  download: DownloadPort
  assetUrls: ObjectUrlCache
  channel: BroadcastChannel
  /**
   * The migration pipeline's dependencies, with the converter and this browser's legacy value
   * already bound (#52 §2).
   *
   * `source` is the only write this whole flow is allowed to make to `localStorage`, and it is
   * a delete of one key behind a button.
   */
  migration: MigrationDeps
  legacy: LegacySourcePort
  /**
   * True when the store behind `ports` keeps nothing past this tab (#51 §6).
   *
   * It arrives from `mountProjectsV2`, which is the one place that knows whether IndexedDB
   * opened, and it reaches the session as `volatile` — the flag that makes every save refuse
   * itself up front rather than failing on the first write.
   */
  volatile: boolean
}

function createFlaggedDeps(ports: Ports, volatile: boolean): FlaggedDeps {
  const clock = createPlatformClock()
  const ids = createRandomIdSource()
  const download = createDownload()
  const registry = createSessionRegistry()
  const channel = new BroadcastChannel(LIBRARY_CHANNEL)
  const announced = announceCommits(ports, channel)
  const legacy = createLegacySource()
  const migration: MigrationDeps = {
    ports: announced,
    clock,
    ids,
    registry,
    // #43's converter as a seam. It is passed by reference rather than wrapped so that the
    // function the review runs is the one the parity suite certified.
    convert: convertLegacy,
    source: legacy,
    download,
  }
  return {
    ports: announced,
    clock,
    ids,
    lock: createWebLocksPort(),
    registry,
    library: createLibraryStore({ ports: announced, clock, ids, registry }),
    // A preview build marks its Backup and is the only build allowed to read it back (#20 §11);
    // production writes unmarked Packages and refuses marked ones. `IS_PREVIEW` is the whole of
    // that decision, and `app/channel` says what makes a build a preview.
    backup: { clock, encoder: createBackupEncoder(), ids, buildboxVersion: __BUILDBOX_VERSION__, preview: IS_PREVIEW },
    restore: { ports: announced, clock, ids, registry, images: createImageDecoder(), acceptPreview: IS_PREVIEW },
    download,
    assetUrls: createObjectUrlCache(ports.assets.get),
    channel,
    migration,
    legacy,
    volatile,
  }
}

/**
 * The Library's first act, before anything is drawn (#50 §5).
 *
 * Reclamation runs here rather than in an effect so that the Library's first paint already shows
 * the space it won back, and so that it can never overlap a write: nothing in this tab has a
 * session open yet, and the Library itself writes nothing. A store that will not answer is not a
 * reason to refuse to show the Library — the Projects are still there — so its failure is
 * dropped rather than propagated.
 */
async function reclaimStorage(ports: Ports, clock: ClockPort): Promise<void> {
  const live = await collectLiveHashes(ports)
  if (!live.ok) return
  await ports.assets.gc(live.value, clock.now())
}

/**
 * Where the flagged app is showing (#50's Navigation note: the routes live in the UI session,
 * there is no URL router, and a reload therefore lands on `library`).
 *
 * `trash` and `migration` are the third and fourth of the four named routes. They are absent
 * because their nav tabs are `aria-disabled` until #51 and #52 give them screens, and a route
 * with no screen behind it is a link that lies.
 */
type Route = 'library' | 'project'

/** The `failed` save state minus the reason the other dialog owns. */
type SaveFailedState = { kind: 'failed'; lastSavedAt: string | null; reason: SaveFailedReason }

/**
 * The failure the Save failed dialog speaks.
 *
 * `revision-conflict` is §5's: another tab wrote, and the answer is `Reload the latest version`
 * rather than a retry that would overwrite them. Routing it away here is where the two dialogs are
 * shown not to overlap, which is what criterion 1's last line asks for.
 */
function isSaveFailure(save: SaveState | null): save is SaveFailedState {
  return save !== null && save.kind === 'failed' && save.reason !== 'revision-conflict'
}

/**
 * The flagged app: the Library, and the legacy editor for whichever Project it opened.
 */
function FlaggedRoot({ deps, legacyPending = false }: { deps: FlaggedDeps; legacyPending?: boolean }): ReactNode {
  const {
    ports,
    clock,
    ids,
    lock,
    registry,
    backup,
    restore,
    download,
    assetUrls,
    library,
    channel,
    migration,
    legacy,
    volatile,
  } = deps
  const [route, setRoute] = useState<Route>('library')
  const [session, setSession] = useState<ProjectSession | null>(null)
  const [saveState, setSaveState] = useState<SaveState | null>(null)
  const [guard, setGuard] = useState<GuardState | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  // #51 §2: the Save failed dialog over the editor, where the archive shows it and where the
  // unsaved work actually is. It opens itself when the session *enters* the failed state, and
  // comes back for two reasons afterwards: the red status was clicked, or the guard refused an
  // attempt to leave. `Discard` is the one action that closes it by hand, because a discard that
  // cannot store either is the same failure the person has just chosen to accept.
  const [failureOpen, setFailureOpen] = useState(false)
  // #51 §5: the tab that held the lock let go. The strip disappearing is the state changing; this
  // is the event, which is what a tab that has been refusing edits has been waiting to hear. It is
  // keyed on the session, because switching Project also ends a read-only state and has nothing to
  // announce.
  const [nowEditable, setNowEditable] = useState<string | null>(null)
  const wasReadOnly = useRef<ProjectSession | null>(null)
  const [persistedRevision, setPersistedRevision] = useState(0)
  // The session as the event handler sees it, which is not the same moment as the render that
  // will follow it: `Open` has to close the session it is being clicked away from, and reading
  // state for that would close the one from the last render.
  const held = useRef<ProjectSession | null>(null)
  // A thumbnail arrives after the render that asked for it, and the object-URL cache is not the
  // Library store, so the tree needs its own reason to look again.
  const [, thumbnailsChanged] = useState(0)
  // One persistent-storage request per page load, however many writes follow.
  const askedToPersist = useRef(false)

  useEffect(() => assetUrls.subscribe(() => thumbnailsChanged((n) => n + 1)), [assetUrls])

  // Ask for every card's Plan Image once the Library's contents change. `load` is idempotent, so
  // a re-render over the same Projects costs nothing.
  useEffect(() => {
    for (const record of library.getSnapshot().projects) {
      const hash = record.summary.previewAssetHash
      if (hash !== null) assetUrls.load(hash)
    }
  })

  useEffect(() => {
    if (session === null) {
      setSaveState(null)
      setGuard(null)
      setReadOnly(false)
      setPersistedRevision(0)
      return
    }
    const read = (): void => {
      const snapshot = session.getSnapshot()
      setSaveState(snapshot.save)
      setGuard(snapshot.guard)
      setReadOnly(snapshot.readOnly)
      setPersistedRevision(snapshot.persistedRevision)
    }
    read()
    return session.subscribe(read)
  }, [session])

  useEffect(() => {
    if (session === null) {
      wasReadOnly.current = null
      setNowEditable(null)
      return
    }
    if (wasReadOnly.current === session && !readOnly) setNowEditable(session.getSnapshot().project.meta.name)
    wasReadOnly.current = readOnly ? session : null
  }, [readOnly, session])

  // The failure this dialog speaks. `revision-conflict` is §5's — another tab wrote, and the
  // answer is `Reload the latest version`, not a retry that would overwrite them — so `app` routes
  // that one to the other dialog and this one never sees it.
  const failing = saveState !== null && saveState.kind === 'failed' && saveState.reason !== 'revision-conflict'
  const wasFailing = useRef(failing)
  useEffect(() => {
    if (failing && !wasFailing.current) setFailureOpen(true)
    if (!failing) setFailureOpen(false)
    wasFailing.current = failing
  }, [failing])

  // The Library is where another Project is chosen (#53): the editor has no Project switcher of
  // its own, so leaving means closing this session, which is what releases its Web Lock and lets
  // a card open any Project. A session holding unsaved work refuses to close — #14's guard — and
  // the refusal is answered by the dialog that names the three ways out, with the editor still
  // behind it so the work that will not store stays on screen.
  const returnToProjects = useCallback((): void => {
    const current = held.current
    if (current === null) {
      setRoute('library')
      return
    }
    void current.close().then((closed) => {
      if (!closed.ok) {
        setFailureOpen(true)
        return
      }
      held.current = null
      setSession(null)
      setRoute('library')
    })
  }, [])

  // #51 §7: the first time this tab's work lands on disk, ask the browser to keep it there. Opening
  // a Project is not work: the revision it opened at is the baseline, and only a commit past it
  // counts. A request made earlier is refused on the merits without anyone being told why.
  const persistBaseline = useRef<{ session: ProjectSession; revision: number } | null>(null)
  useEffect(() => {
    if (session === null || askedToPersist.current) return
    const stored = session.getSnapshot().persistedRevision
    if (persistBaseline.current?.session !== session) {
      persistBaseline.current = { session, revision: stored }
      return
    }
    if (stored <= persistBaseline.current.revision) return
    askedToPersist.current = true
    void requestPersistentStorage({ prefs: ports.prefs, clock })
  }, [session, persistedRevision, ports.prefs, clock])

  // #51 §5: another tab has written the Project this tab is holding. A tab that is read-only
  // because it lost the lock has no other way to find out the lock is free — `navigator.locks`
  // answers queries, it does not announce them — so this is what re-reads the record and takes
  // the Project back. A tab that still holds its lock ignores the message, because the commit
  // that follows will fail on the revision and say so properly.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const change = event.data as LibraryChange | null
      if (change === null || typeof change !== 'object' || change.projectId !== session?.id) return
      if (session.getSnapshot().readOnly) void session.reload()
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
    }
  }, [channel, session])

  // #14's guard at the one boundary no dialog can reach: the tab itself closing. The Save failed
  // dialog has no answer for "the browser is going away", so this asks the browser to ask.
  useEffect(() => {
    if (guard?.blocked !== true) return
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    globalThis.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      globalThis.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [guard?.blocked])

  const open = useCallback(
    async (projectId: string): Promise<Result<void, SessionError>> => {
      // `Open` closes any open session first (#50 criterion 11's card action), because the Web
      // Lock is what stops one Project being edited in two places. A session that refuses to
      // close is holding unsaved changes behind #14's guard, and taking the user away from it is
      // exactly what that guard exists to prevent — so the Library stays where it is, and #51 §2
      // is what shows the person why.
      if (held.current !== null) {
        const closed = await held.current.close()
        if (!closed.ok) return closed
        held.current = null
      }
      const opened = await openProject(projectId, { ports, clock, lock, ids, registry, backup, volatile })
      // No dialog for a Project that will not open: it is either locked in another tab or
      // trashed since the card was drawn, and both answer to `Restore Backup`'s refresh.
      if (!opened.ok) return opened
      held.current = opened.value
      setSession(opened.value)
      setRoute('project')
      return ok(undefined)
    },
    [ports, clock, lock, ids, registry, backup, volatile],
  )

  /**
   * Take the work out of the browser (#51 §2's second answer).
   *
   * This is the only download in the app that does not read the store: the whole reason it exists
   * is that the store does not have the newest state. `emergencySource` is the session's own
   * account of what it holds, held assets included, and the guard is released only once the bytes
   * have actually left the tab — which is `markEmergencyBackupDownloaded`'s job, not this one's.
   */
  const downloadEmergency = useCallback(async (): Promise<void> => {
    const current = held.current
    if (current === null) return
    const encoded = await encodeEmergencyBackup({ ...backup, ports }, current.emergencySource())
    if (!encoded.ok) return
    download.start(backupFileName(current.getSnapshot().project.meta.name), encoded.value)
    current.markEmergencyBackupDownloaded()
  }, [backup, ports, download])

  const services = useMemo<LibraryServices>(
    () => ({
      library,
      clock,
      async recoveryCounts() {
        const listed = await ports.projects.list({ includeTrashed: true })
        const counts = new Map<string, number>()
        if (!listed.ok) return counts
        for (const record of listed.value) {
          const points = await ports.recovery.list(record.id)
          counts.set(record.id, points.ok ? points.value.length : 0)
        }
        return counts
      },
      planImageUrl: (sha256) => (sha256 === null ? null : assetUrls.urlFor(sha256)),
      async backupEstimate(projectId) {
        const loaded = await ports.projects.load(projectId)
        if (!loaded.ok) return 0
        let bytes = 0
        for (const sha256 of referencedAssetHashes(loaded.value.data)) {
          const asset = await ports.assets.get(sha256)
          if (asset.ok) bytes += asset.value.byteLength
        }
        return bytes
      },
      downloadBackup: (projectId) => downloadBackup({ ...backup, ports, download, library }, projectId),
      readBackupFile: async (file) => new Uint8Array(await file.arrayBuffer()),
      stageRestore: (bytes) => stageRestore(restore, bytes),
      commitRestore: (target) => commitRestore(restore, target),
      openProject: (projectId) => open(projectId),
      async recoveryPoints(id) {
        const listed = await ports.recovery.list(id)
        return listed.ok ? listed.value : []
      },
      async lockedElsewhere(id) {
        // This tab's own session is not "elsewhere", whether it still holds the lock or has lost
        // it — that case is #51 §5's read-only tab, and its answer is the strip, not a toast.
        if (registry.get(id) !== null) return false
        // `acquire` is `ifAvailable`: it hands back a handle when the Project was free and `null`
        // when another tab holds it. Releasing straight away means asking costs the other tab
        // nothing, which is the only reason a Library card is allowed to ask at all.
        const handle = await lock.acquire(id)
        if (handle === null) return true
        handle.release()
        return false
      },
      restoreRecoveryPoint: async (projectId, pointId) => {
        // Restoring means editing, and editing means a session — but not a route: the person is
        // on the Library and stays there. A session this tab already holds for the Project is
        // used as it is, its guard included; otherwise one is opened for the length of the
        // restore, which is what holds the Project's lock (#51 §1 steps 1 and 3).
        const own = held.current?.id === projectId ? held.current : null
        if (own !== null) return own.restoreRecoveryPoint(pointId)
        if (held.current !== null) {
          const closed = await held.current.close()
          if (!closed.ok) return closed
          held.current = null
          setSession(null)
        }
        const opened = await openProject(projectId, { ports, clock, lock, ids, registry, backup, volatile })
        if (!opened.ok) return opened
        const restored = await opened.value.restoreRecoveryPoint(pointId)
        // A restore that failed in the store leaves the session guarded, and a guarded session
        // cannot close: it stays, as the tab's session, so #14's dialog has something to answer.
        const closed = await opened.value.close()
        if (!closed.ok) {
          held.current = opened.value
          setSession(opened.value)
        }
        return restored
      },
      // The three Save failed answers, aimed at whatever session this tab holds. They report
      // nothing: the snapshot is the only honest account of whether the retry worked, and the
      // dialog reads that.
      retrySave: () => {
        void held.current?.retry()
      },
      downloadEmergencyBackup: () => {
        void downloadEmergency()
      },
      discardUnsaved: () => {
        void held.current?.discardUnsaved()
      },
    }),
    [deps, ports, clock, library, assetUrls, download, restore, open, lock, registry, downloadEmergency],
  )

  /**
   * The Migration review's whole outside world (#52 §2).
   *
   * Four things live in this closure and nowhere else. `adopted` is the file a reader picked from
   * `Restore Backup` that turned out to be old data — once adopted it is what `inspect` reads, and
   * the browser's own copy is left alone. `current` is the source the last `inspect` looked at, so
   * `Download original data` and `Remove old copy` act on the bytes that were reviewed rather
   * than on whatever is in `localStorage` now.
   *
   * The attach target is read here rather than in `ui` because it needs the Project's current
   * revision, and a revision is a store fact. Handing the plan a stale one would make the write
   * refuse, which is safe but useless; reading it at the moment of the click is what makes the
   * optimistic check mean something.
   */
  const migrationServices = useMemo<MigrationServices>(() => {
    let adopted: Uint8Array | null = null
    let current: MigrationSource | null = null

    async function sourceOf(): Promise<MigrationSource | null> {
      const raw = adopted !== null ? new TextDecoder().decode(adopted) : legacy.read()
      if (raw === null) return null
      // The kind of an adopted file is read from its shape, never from its extension: a workspace
      // export and a floor-plan export differ, and the reader treats them differently.
      const kind = adopted === null ? 'local-store' : (legacyFileKind(raw) ?? 'workspace-file')
      return { kind, raw, hash: await sourceHash(raw) }
    }

    const existing = async (): Promise<LibraryRecord[]> => {
      const listed = await ports.projects.list({ includeTrashed: true })
      return listed.ok ? listed.value : []
    }

    /**
     * The existing Project a floor plan is being attached to, read at the moment of the click.
     *
     * `load` answers with the record and the Project in one read, which is what keeps the revision
     * the plan names and the record the plan compares against the same instant's two facts.
     */
    async function attachTargetFor(choices: MigrationChoices): Promise<MigrationAttachTarget | null> {
      const destination = choices.floorPlan
      if (destination === null || destination.kind !== 'existing') return null
      const [loaded, records] = await Promise.all([ports.projects.load(destination.projectId), existing()])
      const record = records.find((candidate) => candidate.id === destination.projectId)
      if (!loaded.ok || record === undefined) return null
      return {
        id: destination.projectId,
        record,
        project: loaded.value.data,
        revision: loaded.value.revision,
      }
    }

    const services: MigrationServices = {
      adopt: (bytes) => {
        adopted = bytes
      },
      inspect: async () => {
        const source = await sourceOf()
        if (source === null) return { ok: true, value: null }
        current = source
        return inspectMigration(migration, source, await existing())
      },
      run: async (inspected, choices) => {
        // Nothing was inspected, so nothing was reviewed, and a plan built from an inspection this
        // closure never made is a plan for a source nobody looked at.
        if (current === null) return { ok: false, error: { stage: 'read', problems: [] } }
        const target = await attachTargetFor(choices)
        const plan = buildMigrationPlan(migration, inspected, await existing(), choices, target)
        if (!plan.ok) return plan
        const result = await runMigration(migration, inspected, plan.value)
        // The migration writes through the ports rather than through the Library store, because
        // one transaction is the point. Every other writer here goes through the store, which
        // refreshes itself; this one cannot, so the app — the only thing that knows a migration
        // just happened — re-reads the records. Otherwise `Return to Projects` shows the grid the
        // reader left, with the new Projects sitting unread in the store.
        if (result.ok) await library.refresh()
        return result
      },
      downloadBackups: async (inspected, choices) => {
        const target = await attachTargetFor(choices)
        return downloadOldBackups({ ...migration, download, backup }, inspected, await existing(), choices, target)
      },
      downloadOriginal: () => {
        const source = current
        if (source !== null) downloadOriginalData({ ...migration, download }, source)
      },
      removeOldCopy: async () => {
        const source = current
        if (source === null) return { ok: false, error: { stage: 'read', problems: [] } }
        return removeOldCopy({ ...migration, source: legacy }, source)
      },
    }
    return services
  }, [backup, deps, download, legacy, library, migration, ports])

  const sessionServices = useMemo(() => createSessionServices(clock, ids, assetUrls), [clock, ids, assetUrls])

  /** The same session services the legacy view gets, plus what only the workspace needs (#55). */
  const workspaceServices = useMemo<WorkspaceServices>(() => ({
    intent: sessionServices.intent,
    assetUrls: sessionServices.assetUrls,
    readPlanImage: sessionServices.readPlanImage,
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: Object.entries(PLAN_CATALOGUE)
      .filter(([key]) => key !== 'custom')
      .map(([key, entry]) => ({ key, label: entry.label })),
    viewportCache: createViewportCache(ports.prefs, session?.id ?? ''),
    exportDrawings: createExportPort({
      session: () => {
        if (held.current === null) throw new Error('Export needs an open Project')
        return held.current
      },
      prefs: ports.prefs,
      readAsset: async (sha256) => {
        const found = await ports.assets.get(sha256)
        if (!found.ok || found.value === undefined) return null
        return {
          bytes: new Uint8Array(await found.value.blob.arrayBuffer()),
          mediaType: found.value.mediaType,
        }
      },
      clock: { now: () => clock.now(), localDate: () => clock.dayKey(clock.now()) },
      buildboxVersion: __BUILDBOX_VERSION__,
    }),
  }), [sessionServices, ports.prefs, session?.id])

  /**
   * Keep this tab's unsaved work by committing it under a new identity (#51 §5).
   *
   * The other tab has the record; this one has the newer state and no lock. A copy is the only
   * answer that loses neither, and `remapIds` is what makes two Projects in one store safe — the
   * same function a restore-as-copy uses, for the same reason. The assets this tab was about to
   * write go in with it, or the copy would open with a Plan Image missing.
   */
  const importChangesAsCopy = useCallback(async (): Promise<void> => {
    const current = held.current
    if (current === null) return
    const source = current.emergencySource()
    const copyId = ids(1)[0]
    if (copyId === undefined) return
    const remapped = remapIds(source.project, copyId, ids)
    const copy = {
      ...remapped,
      meta: { ...remapped.meta, name: `${source.project.meta.name} — Copy`, revision: NEW_PROJECT_REVISION },
    }
    const committed = await ports.projects.commit(
      { project: copy, revision: NEW_PROJECT_REVISION, savedAt: clock.now(), newAssets: [...source.heldAssets.values()] },
      null,
    )
    if (!committed.ok) return
    await library.refresh()
    // The unsaved state now lives in the copy, so this session has nothing left to guard: reading
    // the newer stored record back is what lifts #14's block, and `open` can close the session.
    await current.discardUnsaved()
    void open(copyId)
  }, [ids, ports.projects, clock, library, open])

  if (route === 'library') {
    // The session survives a stay on the Library only when it refused to close, which is #14's
    // guard holding unsaved work. Its card is then the one that reads `Saving…` or
    // `Save failed · changes not stored` rather than the record's `Saved locally {since}`.
    return (
      <LibraryHome
        services={services}
        saveState={saveState}
        saveStateFor={session?.id ?? null}
        guard={guard}
        storageUnavailable={volatile}
        migration={migrationServices}
        openMigration={legacyPending}
      />
    )
  }
  if (session === null) return null
  const conflict = saveState !== null && saveState.kind === 'failed' && saveState.reason === 'revision-conflict'
  const failure = isSaveFailure(saveState) ? saveState : null
  return (
    <>
      <LegacyViewRoot
        session={session}
        services={sessionServices}
        banner={
          readOnly ? (
            <ReadOnlyStrip />
          ) : nowEditable !== null ? (
            <NowEditableToast name={nowEditable} onDismiss={() => setNowEditable(null)} />
          ) : undefined
        }
        onSaveFailure={() => setFailureOpen(true)}
        onReturnToProjects={returnToProjects}
      >
        <WorkspaceProvider
          session={session}
          services={workspaceServices}
          onReturnToProjects={returnToProjects}
          onShowSaveFailure={() => setFailureOpen(true)}
        >
          <App />
        </WorkspaceProvider>
      </LegacyViewRoot>
      {failureOpen && failure !== null && (
        <SaveFailedDialog
          reason={failure.reason}
          lastSavedAt={failure.lastSavedAt}
          now={clock.now()}
          onRetry={() => {
            services.retrySave()
          }}
          onEmergencyBackup={() => {
            services.downloadEmergencyBackup()
          }}
          onDiscard={() => {
            // Closed by hand rather than by the snapshot: the state may well stay failed, because
            // writing the `pre-discard` Recovery Point needs the storage that just refused.
            setFailureOpen(false)
            services.discardUnsaved()
          }}
        />
      )}
      {conflict && saveState !== null && saveState.kind === 'failed' && (
        <ConflictDialog
          name={session.getSnapshot().project.meta.name}
          onReload={() => {
            void session.discardUnsaved()
          }}
          onImportCopy={() => {
            void importChangesAsCopy()
          }}
          onEmergencyBackup={() => {
            void downloadEmergency()
          }}
        />
      )}
    </>
  )
}

/**
 * Open this build's database and render the app against it.
 *
 * A browser that will not open IndexedDB runs memory-only, which is #20 §11's documented
 * answer and the reason the app can be opened in private mode at all: the work is real while
 * the tab is open, and the session says so rather than pretending otherwise.
 */
export async function mountProjectsV2(root: Root): Promise<void> {
  const opened = await openIndexedDbAdapter({ dbName: DB_NAME })
  const ports: Ports = opened.ok ? opened.value : createMemoryAdapter()
  // `!opened.ok` is the whole of #51 §6's knowledge: this is the only expression in the app that
  // finds out whether the browser has a durable store, and everything downstream is told.
  const deps = createFlaggedDeps(ports, !opened.ok)
  // Criterion 1: the review is where a reader who still has old data should land, and the only
  // honest way to know is to look. This reads `buildbox-store`, hashes it and asks the store for
  // the completion record — three reads and no write. A hash that matches the record means this
  // exact data was already migrated and verified, and the reader goes back to their Projects.
  const legacyPending = await legacyMigrationPending(deps)

  // The Library is the home of this app (#50): whatever the last visit left open, a reload
  // starts at the grid, and an empty database shows the New Project card rather than inventing
  // a Project to fill it.
  const refreshed = await deps.library.refresh()
  if (!refreshed.ok) return renderFailure(root, refreshed.error)

  // #51 §4: the Trash keeps a Project for 30 days and then it does not, whether anybody looks or
  // not. Sweeping before reclamation is what makes the space come back in the same visit, and
  // before the first paint is what means the Library never shows a Project that has expired.
  await deps.library.purgeExpired()
  await reclaimStorage(ports, deps.clock)

  // Another tab committed; the cards on this one are stale (#50 §5).
  deps.channel.addEventListener('message', () => {
    void deps.library.refresh()
  })
  globalThis.addEventListener('pagehide', () => {
    deps.channel.close()
    deps.assetUrls.revokeAll()
  })

  root.render(
    <StrictMode>
      <FlaggedRoot deps={deps} legacyPending={legacyPending} />
    </StrictMode>,
  )
}

/**
 * Whether this browser holds old data that has not been migrated into a verified Project (#52
 * criterion 1).
 *
 * A failure to read the completion record counts as "not migrated": the review is a surface that
 * writes nothing until the reader presses one button, and refusing to show it because a `meta`
 * read failed would hide the only way out of the old data.
 */
async function legacyMigrationPending(deps: FlaggedDeps): Promise<boolean> {
  const raw = deps.legacy.read()
  if (raw === null) return false
  const hash = await sourceHash(raw)
  const stored = await deps.ports.meta.get('legacyMigration')
  if (!stored.ok) return true
  return !isAlreadyMigrated(stored.value, hash)
}

/**
 * The one thing the app can say when it has no document to show. Kept to the shell's own
 * classes: this is not a screen a user is meant to stay on.
 */
function renderFailure(root: Root, error: SessionError): void {
  const reason = typeof error === 'string' ? error : error.kind
  root.render(
    <div className="min-h-screen bg-surface px-4 py-6 text-text-primary">
      <h1 className="text-lg font-semibold">BuildBox could not open this Project</h1>
      <p className="mt-2 text-sm text-text-muted">BuildBox stores Projects in this browser only. ({reason})</p>
    </div>,
  )
}
