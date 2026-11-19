/**
 * The workspace's seam with `app` (#55).
 *
 * The workspace speaks only structural ports, the same shapes `ui/legacy` agreed with
 * `app` in #49 — an `IntentBuilder` that turns (type, payload) into a fully-formed
 * Intent, an `AssetUrlSource` for the Plan Image's object URL, a `ViewportCache` for
 * device-local view state. Re-declaring them here rather than importing `ui/legacy`
 * keeps the eslint boundary honest: `ui/workspace` may not reach the legacy surface,
 * and the objects `app` passes satisfy both declarations because they are the same
 * shapes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { Project } from '../../domain'
import type { Intent, IntentType, PayloadOf } from '../../edit'
import type { ProjectSession, SaveState, SessionAsset } from '../../session'
import type { PlanImageMediaType } from '../../domain'
import { workspaceStore } from './workspaceStore'
import type { ViewportCache } from './viewport'

/** An Intent, fully formed; `app` builds it from `edit`'s label table and id order. */
export interface WorkspaceIntentBuilder {
  build<T extends IntentType>(type: T, payload: PayloadOf<T>): Intent
}

/** The object-URL cache behind a Plan Image: `urlFor` is `null` until the bytes arrive. */
export interface WorkspaceAssetUrls {
  subscribe(listener: () => void): () => void
  urlFor(sha256: string): string | null
  load(sha256: string): void
  put(sha256: string, bytes: Blob): void
}

/** The bytes an Asset Store would keep, from one upload. */
export interface PreparedPlanImageAsset {
  readonly bytes: Blob
  readonly sha256: string
  readonly mediaType: PlanImageMediaType
  readonly widthPx: number
  readonly heightPx: number
}

/** A decoded, measured, hashed upload, ready to become a Plan Image. */
export interface PreparedPlanImage {
  readonly src: string
  readonly widthPx: number
  readonly heightPx: number
  /** `null` only for the legacy reader, which has no Asset Store; the session's never is. */
  readonly asset: PreparedPlanImageAsset | null
}

/** An upload that could not be used, in the words the floor plan has always used. */
export type PlanImageRead =
  | { readonly image: PreparedPlanImage }
  | { readonly message: string }

/** One entry of `Add item ▾`: a catalog key and the label the person reads. */
export interface PlanCatalogueOption {
  readonly key: string
  readonly label: string
}

/** Everything the workspace cannot build for itself; `app` wires it once per session. */
export interface WorkspaceServices {
  readonly intent: WorkspaceIntentBuilder
  readonly assetUrls: WorkspaceAssetUrls
  readPlanImage(file: File): Promise<PlanImageRead>
  /** What the file input accepts (#49 deviation 4: PNG, JPEG, WebP). */
  readonly planImageAccept: string
  /** The catalog `Add item ▾` lists; `app` reads it from `edit`. */
  readonly planCatalogue: readonly PlanCatalogueOption[]
  readonly viewportCache: ViewportCache
}

/** What only the root above the workspace can do: leave, and open the dialog above it. */
export interface WorkspaceHost {
  returnToProjects(): void
  showSaveFailure(): void
}

interface WorkspaceRootValue {
  readonly session: ProjectSession
  readonly services: WorkspaceServices
  readonly host: WorkspaceHost
}

const WorkspaceContext = createContext<WorkspaceRootValue | null>(null)

/** The session the workspace store was last opened for, so a second Project starts clean. */
let openedForSession: string | null = null

export function WorkspaceProvider(props: {
  session: ProjectSession
  services: WorkspaceServices
  onReturnToProjects: () => void
  onShowSaveFailure: () => void
  children: ReactNode
}): ReactNode {
  const { session, services, onReturnToProjects, onShowSaveFailure, children } = props
  // Which Floor and view are open, what is selected and whose Item Detail is on screen belong
  // to one Project. The store is a module singleton, so opening another Project in the same tab
  // has to start from nothing — before its first render, or the previous Project's Item Detail
  // is painted for a Design this Project does not have (#57).
  useState(() => {
    if (openedForSession === session.id) return null
    openedForSession = session.id
    workspaceStore.getState().reset()
    return null
  })
  const value = useMemo<WorkspaceRootValue>(
    () => ({
      session,
      services,
      host: { returnToProjects: onReturnToProjects, showSaveFailure: onShowSaveFailure },
    }),
    [session, services, onReturnToProjects, onShowSaveFailure],
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaceRoot(): WorkspaceRootValue {
  const value = useContext(WorkspaceContext)
  if (value === null) throw new Error('FloorWorkspace must render inside WorkspaceProvider')
  return value
}

/** The live Project, subscribed on its own store. */
export function useWorkspaceProject(session: ProjectSession): Project {
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session])
  const getSnapshot = useCallback(() => session.getSnapshot().project, [session])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** The object URL of the Floor's Plan Image, `null` until the cache has read the bytes. */
export function usePlanImageSrc(assetUrls: WorkspaceAssetUrls, sha256: string | null): string | null {
  const subscribe = useCallback((listener: () => void) => assetUrls.subscribe(listener), [assetUrls])
  const getSnapshot = useCallback(
    () => (sha256 === null ? null : assetUrls.urlFor(sha256)),
    [assetUrls, sha256],
  )
  useEffect(() => {
    if (sha256 !== null) assetUrls.load(sha256)
  }, [assetUrls, sha256])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Dispatch, with the legacy view's rule: every number the workspace sends is clamped
 * before it gets here, so a refusal means the view and the handlers disagree — say so
 * rather than drop it silently.
 */
export function useWorkspaceDispatch(): (intent: Intent, newAssets?: readonly SessionAsset[]) => void {
  const { session } = useWorkspaceRoot()
  return useCallback(
    (intent: Intent, newAssets?: readonly SessionAsset[]) => {
      const result = newAssets === undefined
        ? session.dispatch(intent)
        : session.dispatch(intent, { newAssets })
      if (!result.ok) console.warn(`BuildBox refused "${intent.label}": ${result.code}`)
    },
    [session],
  )
}

/** The words under the undo button, as the header shows them (#49 deviation 3). */
export interface SaveStatusText {
  readonly text: string
  readonly failed: boolean
}

function saveStatusOf(save: SaveState | null): SaveStatusText | null {
  if (save === null) return null
  if (save.kind === 'saving') return { text: 'Saving…', failed: false }
  if (save.kind === 'failed') return { text: 'Save failed', failed: true }
  return { text: `Saved locally ${new Date(save.at).toLocaleTimeString()}`, failed: false }
}

export function useSaveStatus(session: ProjectSession): SaveStatusText | null {
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session])
  const cache = useRef<{ key: string; value: SaveStatusText | null } | null>(null)
  const getSnapshot = useCallback(() => {
    const save = session.getSnapshot().save
    const key = save === null ? 'none' : save.kind === 'saved' ? `saved:${save.at}` : save.kind
    if (cache.current !== null && cache.current.key === key) return cache.current.value
    const value = saveStatusOf(save)
    cache.current = { key, value }
    return value
  }, [session])
  return useSyncExternalStore(subscribe, getSnapshot)
}
