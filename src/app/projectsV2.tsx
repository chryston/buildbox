/**
 * The `VITE_FF_PROJECTS_V2` composition root (#49, #50).
 *
 * This is the only module in the app that knows the storage technology, the browser's clock
 * and locks, and the Intent catalogue as *values*: it binds them together and hands the
 * result to the surfaces through `LibraryHome` and `LegacyViewRoot`. Nothing under `ui`
 * reaches any of them, which is what keeps the flagged graph replaceable (#20 §2).
 *
 * The build-time flag means this module is either in the bundle or not at all — `main.tsx`
 * tests the flag once, in a condition the bundler folds away. `PROJECTS_V2_SENTINEL` is what
 * `scripts/check-flag-free.mjs` looks for in a flag-off build to prove it.
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import App from '../App'
import { INTENT_LABELS, PLAN_REMOVE_IMAGE_LABEL, PLAN_UPDATE_LABELS, intentIdCount } from '../edit'
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
  err,
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
} from '../session'
import {
  createBackupEncoder,
  createDownload,
  createImageDecoder,
  createObjectUrlCache,
  createPlatformClock,
  createRandomIdSource,
  createWebLocksPort,
  readPlanImageFile,
} from '../platform'
import type { ObjectUrlCache } from '../platform'
import { ConflictDialog, LibraryHome, ReadOnlyStrip, SaveFailedDialog } from '../ui'
import type { LibraryServices, SaveFailedReason } from '../ui'
import { requestPersistentStorage } from './persistentStorage'
import { LegacyViewRoot } from '../ui/legacy/LegacyViewRoot'
import type { IntentBuilder, SessionViewServices } from '../ui/legacy/sessionBindings'
import type { PlanImageRead } from '../ui/legacy/bindings'

/** Proves a bundle was built with the flag on; see `scripts/check-flag-free.mjs`. */
export const PROJECTS_V2_SENTINEL = '__PROJECTS_V2__'

/** The preview database: never the production `buildbox`, never `buildbox-store` (#49). */
export const PREVIEW_DB_NAME = 'buildbox-preview'

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
): SessionViewServices {
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
        label: labelOf(type, payload),
        ids: ids(intentIdCount(type)),
        now: clock.now(),
      } as Intent
    },
  }
}

/** The undo tooltip's verb phrase: the table, narrowed by what the payload actually changed. */
function labelOf<T extends IntentType>(type: T, payload: PayloadOf<T>): string {
  if (type === 'plan.updateObject') {
    const patch = (payload as PayloadOf<'plan.updateObject'>).patch
    if ('rotation' in patch) return PLAN_UPDATE_LABELS.rotate
    if ('w' in patch || 'h' in patch) return PLAN_UPDATE_LABELS.resize
    if ('x' in patch || 'y' in patch) return PLAN_UPDATE_LABELS.move
  }
  if (type === 'plan.setImage' && (payload as PayloadOf<'plan.setImage'>).image === null) {
    return PLAN_REMOVE_IMAGE_LABEL
  }
  return INTENT_LABELS[type]
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
  const registry = createSessionRegistry()
  const channel = new BroadcastChannel(LIBRARY_CHANNEL)
  const announced = announceCommits(ports, channel)
  return {
    ports: announced,
    clock,
    ids,
    lock: createWebLocksPort(),
    registry,
    library: createLibraryStore({ ports: announced, clock, ids, registry }),
    // `preview: true` because this whole build is the preview (#20 §11, #50 criterion 28): a
    // `.buildbox` written here is marked, and production refuses it rather than importing preview
    // work into a real database.
    backup: { clock, encoder: createBackupEncoder(), buildboxVersion: __BUILDBOX_VERSION__, preview: true },
    // `acceptPreview: true` for the same reason in the other direction: this build wrote the
    // Backup, so it is the only build allowed to read it back.
    restore: { ports: announced, clock, ids, registry, images: createImageDecoder(), acceptPreview: true },
    download: createDownload(),
    assetUrls: createObjectUrlCache(ports.assets.get),
    channel,
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
function FlaggedRoot({ deps }: { deps: FlaggedDeps }): ReactNode {
  const { ports, clock, ids, lock, registry, backup, restore, download, assetUrls, library, channel, volatile } = deps
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

  // The editor's tab bar moves the view to another session *inside* `LegacyViewRoot`, and the
  // surfaces above it — the read-only strip, both dialogs, the retry — are about whichever Project
  // this tab is showing now. Following the switch is what keeps them pointed at the live session
  // rather than the one this route was opened with.
  const followSwitch = useCallback((next: ProjectSession): void => {
    held.current = next
    setSession(next)
  }, [])

  // #51 §6: the first time a Project is actually on disk, ask the browser to keep it there.
  // Before that there is nothing worth persisting, and a request made too early is refused on the
  // merits without anyone being told why.
  useEffect(() => {
    if (persistedRevision === 0 || askedToPersist.current) return
    askedToPersist.current = true
    void requestPersistentStorage({ prefs: ports.prefs, clock })
  }, [persistedRevision, ports.prefs, clock])

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
        // Restoring means editing, and editing means a session: open the Project if this tab is
        // not already in it, and let the session's own guard refuse if it is holding work.
        if (held.current?.id !== projectId) {
          const opened = await open(projectId)
          if (!opened.ok) return opened
        }
        const current = held.current
        if (current === null || current.id !== projectId) {
          return err({ kind: 'unavailable', reason: 'this tab has no open session for that Project' })
        }
        return current.restoreRecoveryPoint(pointId)
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

  const sessionServices = useMemo(() => createSessionServices(clock, ids, assetUrls), [clock, ids, assetUrls])

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
      />
    )
  }
  if (session === null) return null
  const conflict = saveState !== null && saveState.kind === 'failed' && saveState.reason === 'revision-conflict'
  const failure = isSaveFailure(saveState) ? saveState : null
  return (
    <>
      <LegacyViewRoot
        library={library}
        session={session}
        services={sessionServices}
        banner={readOnly ? <ReadOnlyStrip /> : undefined}
        onSaveFailure={() => setFailureOpen(true)}
        onSessionChange={followSwitch}
      >
        <App />
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
            void session.reload()
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
 * Open the preview database and render the app against it.
 *
 * A browser that will not open IndexedDB runs memory-only, which is #20 §11's documented
 * answer and the reason a preview build can be opened in private mode at all: the work is
 * real while the tab is open, and the session says so rather than pretending otherwise.
 */
export async function mountProjectsV2(root: Root): Promise<void> {
  const opened = await openIndexedDbAdapter({ dbName: PREVIEW_DB_NAME })
  const ports: Ports = opened.ok ? opened.value : createMemoryAdapter()
  // `!opened.ok` is the whole of #51 §6's knowledge: this is the only expression in the app that
  // finds out whether the browser has a durable store, and everything downstream is told.
  const deps = createFlaggedDeps(ports, !opened.ok)

  // The Library is the home of a flag-on build (#50): whatever the last visit left open, a
  // reload starts at the grid, and an empty database shows the New Project card rather than
  // inventing a Project to fill it.
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

  // Which build this is, from the outside: the smoke specs assert it, and it is the sentinel
  // the flag-free build scan looks for.
  document.documentElement.dataset.projectsV2 = PROJECTS_V2_SENTINEL

  root.render(
    <StrictMode>
      <FlaggedRoot deps={deps} />
    </StrictMode>,
  )
}

/**
 * The one thing the flagged app can say when it has no document to show. Kept to the shell's
 * own classes: this is not a screen a user is meant to stay on.
 */
function renderFailure(root: Root, error: SessionError): void {
  const reason = typeof error === 'string' ? error : error.kind
  root.render(
    <div className="min-h-screen bg-surface px-4 py-6 text-text-primary">
      <h1 className="text-lg font-semibold">BuildBox could not open this Project</h1>
      <p className="mt-2 text-sm text-text-muted">The preview build stores work in this browser only. ({reason})</p>
    </div>,
  )
}
