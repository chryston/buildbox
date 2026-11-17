/**
 * Reading a Project session from React (#49).
 *
 * `session` is framework-free: it publishes `subscribe` and `getSnapshot`, which is exactly
 * the shape `useSyncExternalStore` wants. Two rules make that safe here, and they are the
 * whole reason this file exists:
 *
 * 1. A snapshot is rebuilt only when the session changes, so it is a valid cache key.
 * 2. A derived value is recomputed when the selector changes but *reused while it is
 *    shallow-equal*, so `useProjectSelector(p => objects(p))` hands the floor plan the same
 *    array between commits. Without that, every keystroke would rebuild every
 *    `FloorPlanObject[]` and re-render every placed object — and the drag would fight the
 *    commit (#49 criterion 5).
 */
import { useCallback, useRef, useSyncExternalStore } from 'react'
import { shallow } from 'zustand/shallow'
import type { Project } from '../../domain'
import type { ProjectSession } from '../../session'
import { SessionContext, useRequired } from './contexts'

/** The session the view is editing; provided by `LegacyViewRoot`. */
export function useSession(): ProjectSession {
  return useRequired(SessionContext, 'The Project session')
}

/** The document, its revision, and whether this tab may write it. */
export interface ProjectView {
  readonly project: Project
  readonly revision: number
  readonly readOnly: boolean
}

/** The session's current document. The returned object is stable while nothing changes. */
export function useProject(): ProjectView {
  const session = useSession()
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session])
  const cache = useRef<{ at: unknown; view: ProjectView } | null>(null)
  const getSnapshot = useCallback((): ProjectView => {
    const snapshot = session.getSnapshot()
    if (cache.current !== null && cache.current.at === snapshot) return cache.current.view
    const view: ProjectView = {
      project: snapshot.project,
      revision: snapshot.revision,
      readOnly: snapshot.readOnly,
    }
    cache.current = { at: snapshot, view }
    return view
  }, [session])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * One derived read of the document, referentially stable while it is shallow-equal.
 *
 * `select` may be an inline arrow: it is part of the cache key, so a new selector always
 * recomputes, and the result only changes identity when the derived value really changed.
 */
export function useProjectSelector<T>(
  select: (project: Project) => T,
  isEqual: (a: T, b: T) => boolean = shallow,
): T {
  const session = useSession()
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session])
  const cache = useRef<{ at: unknown; select: (project: Project) => T; value: T } | null>(null)
  const getSnapshot = useCallback((): T => {
    const snapshot = session.getSnapshot()
    const previous = cache.current
    if (previous !== null && previous.at === snapshot && previous.select === select) return previous.value
    const next = select(snapshot.project)
    const value = previous !== null && isEqual(previous.value, next) ? previous.value : next
    cache.current = { at: snapshot, select, value }
    return value
  }, [session, select, isEqual])
  return useSyncExternalStore(subscribe, getSnapshot)
}
