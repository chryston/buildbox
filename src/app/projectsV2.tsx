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
import { referencedAssetHashes } from '../domain'
import {
  commitRestore,
  createLibraryStore,
  createSessionRegistry,
  downloadBackup,
  openProject,
  stageRestore,
  type BackupDeps,
  type ClockPort,
  type DownloadPort,
  type IdSource,
  type LibraryStore,
  type LockPort,
  type ProjectSession,
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
import { LibraryHome } from '../ui'
import type { LibraryServices } from '../ui'
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
}

function createFlaggedDeps(ports: Ports): FlaggedDeps {
  const clock = createPlatformClock()
  const ids = createRandomIdSource()
  const registry = createSessionRegistry()
  return {
    ports,
    clock,
    ids,
    lock: createWebLocksPort(),
    registry,
    library: createLibraryStore({ ports, clock, ids, registry }),
    // `preview: true` because this whole build is the preview (#20 §11, #50 criterion 28): a
    // `.buildbox` written here is marked, and production refuses it rather than importing preview
    // work into a real database.
    backup: { clock, encoder: createBackupEncoder(), buildboxVersion: __BUILDBOX_VERSION__, preview: true },
    // `acceptPreview: true` for the same reason in the other direction: this build wrote the
    // Backup, so it is the only build allowed to read it back.
    restore: { ports, clock, ids, registry, images: createImageDecoder(), acceptPreview: true },
    download: createDownload(),
    assetUrls: createObjectUrlCache(ports.assets.get),
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

/**
 * The flagged app: the Library, and the legacy editor for whichever Project it opened.
 */
function FlaggedRoot({ deps }: { deps: FlaggedDeps }): ReactNode {
  const { ports, clock, ids, lock, registry, backup, restore, download, assetUrls, library } = deps
  const [route, setRoute] = useState<Route>('library')
  const [session, setSession] = useState<ProjectSession | null>(null)
  const [saveState, setSaveState] = useState<SaveState | null>(null)
  // The session as the event handler sees it, which is not the same moment as the render that
  // will follow it: `Open` has to close the session it is being clicked away from, and reading
  // state for that would close the one from the last render.
  const held = useRef<ProjectSession | null>(null)
  // A thumbnail arrives after the render that asked for it, and the object-URL cache is not the
  // Library store, so the tree needs its own reason to look again.
  const [, thumbnailsChanged] = useState(0)

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
      return
    }
    const read = (): void => setSaveState(session.getSnapshot().save)
    read()
    return session.subscribe(read)
  }, [session])

  const open = useCallback(
    async (projectId: string): Promise<void> => {
      // `Open` closes any open session first (#50 criterion 11's card action), because the Web
      // Lock is what stops one Project being edited in two places. A session that refuses to
      // close is holding unsaved changes behind #14's guard, and taking the user away from it is
      // exactly what that guard exists to prevent — so the Library stays where it is.
      if (held.current !== null) {
        const closed = await held.current.close()
        if (!closed.ok) return
        held.current = null
      }
      const opened = await openProject(projectId, { ports, clock, lock, ids, registry, backup })
      // No dialog for a Project that will not open: it is either locked in another tab or
      // trashed since the card was drawn, and both answer to `Restore Backup`'s refresh.
      if (!opened.ok) return
      held.current = opened.value
      setSession(opened.value)
      setRoute('project')
    },
    [ports, clock, lock, ids, registry, backup],
  )

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
      openProject: (projectId) => {
        void open(projectId)
      },
    }),
    [deps, ports, clock, library, assetUrls, download, restore, open],
  )

  const sessionServices = useMemo(() => createSessionServices(clock, ids, assetUrls), [clock, ids, assetUrls])

  if (route === 'library') {
    // The session survives a stay on the Library only when it refused to close, which is #14's
    // guard holding unsaved work. Its card is then the one that reads `Saving…` or
    // `Save failed · changes not stored` rather than the record's `Saved locally {since}`.
    return <LibraryHome services={services} saveState={saveState} saveStateFor={session?.id ?? null} />
  }
  if (session === null) return null
  return (
    <LegacyViewRoot library={library} session={session} services={sessionServices}>
      <App />
    </LegacyViewRoot>
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
  const deps = createFlaggedDeps(ports)

  // The Library is the home of a flag-on build (#50): whatever the last visit left open, a
  // reload starts at the grid, and an empty database shows the New Project card rather than
  // inventing a Project to fill it.
  const [refreshed] = await Promise.all([deps.library.refresh(), reclaimStorage(ports, deps.clock)])
  if (!refreshed.ok) return renderFailure(root, refreshed.error)

  // Another tab committed; the cards on this one are stale (#50 §5).
  const channel = new BroadcastChannel(LIBRARY_CHANNEL)
  channel.addEventListener('message', () => {
    void deps.library.refresh()
  })
  globalThis.addEventListener('pagehide', () => {
    channel.close()
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
