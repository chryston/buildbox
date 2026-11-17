/**
 * The `VITE_FF_PROJECTS_V2` composition root (#49).
 *
 * This is the only module in the app that knows the storage technology, the browser's clock
 * and locks, and the Intent catalogue as *values*: it binds them together and hands the
 * result to the legacy views through `LegacyViewRoot`. Nothing under `ui` reaches any of
 * them, which is what keeps the flagged graph replaceable (#20 §2).
 *
 * The build-time flag means this module is either in the bundle or not at all — `main.tsx`
 * tests the flag once, in a condition the bundler folds away. `PROJECTS_V2_SENTINEL` is what
 * `scripts/check-flag-free.mjs` looks for in a flag-off build to prove it.
 */
import { StrictMode } from 'react'
import type { Root } from 'react-dom/client'
import App from '../App'
import { INTENT_LABELS, PLAN_REMOVE_IMAGE_LABEL, PLAN_UPDATE_LABELS, intentIdCount } from '../edit'
import type { Intent, IntentType, PayloadOf } from '../edit'
import { createMemoryAdapter } from '../persistence'
import type { Ports } from '../persistence'
import { openIndexedDbAdapter } from '../persistence/indexeddb/open'
import {
  createLibraryStore,
  createSessionRegistry,
  openProject,
  type ClockPort,
  type IdSource,
  type SessionError,
} from '../session'
import {
  createObjectUrlCache,
  createPlatformClock,
  createRandomIdSource,
  createWebLocksPort,
  readPlanImageFile,
} from '../platform'
import type { ObjectUrlCache } from '../platform'
import { LegacyViewRoot } from '../ui/legacy/LegacyViewRoot'
import type { IntentBuilder, SessionViewServices } from '../ui/legacy/sessionBindings'
import type { PlanImageRead } from '../ui/legacy/bindings'

/** Proves a bundle was built with the flag on; see `scripts/check-flag-free.mjs`. */
export const PROJECTS_V2_SENTINEL = '__PROJECTS_V2__'

/** The preview database: never the production `buildbox`, never `buildbox-store` (#49). */
export const PREVIEW_DB_NAME = 'buildbox-preview'

/** The Project a first launch makes, named the way the legacy tab bar names one. */
const FIRST_PROJECT_NAME = 'Cabinet 1'

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
 * Open the preview database and render the app against it.
 *
 * A browser that will not open IndexedDB runs memory-only, which is #20 §11's documented
 * answer and the reason a preview build can be opened in private mode at all: the work is
 * real while the tab is open, and the session says so rather than pretending otherwise.
 */
export async function mountProjectsV2(root: Root): Promise<void> {
  const opened = await openIndexedDbAdapter({ dbName: PREVIEW_DB_NAME })
  const ports: Ports = opened.ok ? opened.value : createMemoryAdapter()

  const clock = createPlatformClock()
  const ids = createRandomIdSource()
  const lock = createWebLocksPort()
  const registry = createSessionRegistry()
  const library = createLibraryStore({ ports, clock, ids, registry })

  const refreshed = await library.refresh()
  if (!refreshed.ok) return renderFailure(root, refreshed.error)

  let projectId = library.getSnapshot().projects[0]?.id
  if (projectId === undefined) {
    const created = await library.createProject(FIRST_PROJECT_NAME)
    if (!created.ok) return renderFailure(root, created.error)
    projectId = created.value
  }

  const session = await openProject(projectId, { ports, clock, lock, ids, registry })
  if (!session.ok) return renderFailure(root, session.error)

  const assetUrls = createObjectUrlCache(ports.assets.get)
  globalThis.addEventListener('pagehide', () => {
    assetUrls.revokeAll()
  })

  const services = createSessionServices(clock, ids, assetUrls)

  // Which build this is, from the outside: the smoke specs assert it, and it is the sentinel
  // the flag-free build scan looks for.
  document.documentElement.dataset.projectsV2 = PROJECTS_V2_SENTINEL

  root.render(
    <StrictMode>
      <LegacyViewRoot library={library} session={session.value} services={services}>
        <App />
      </LegacyViewRoot>
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
