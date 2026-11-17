/**
 * Reading the Library from React (#49).
 *
 * Same shape as `useProject`: `LibraryStore` publishes `subscribe`/`getSnapshot`, the
 * snapshot object is replaced only when the Library changed, and a derived read keeps its
 * identity while it is shallow-equal — so the project list does not re-render because some
 * other Project finished saving.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react'
import { shallow } from 'zustand/shallow'
import type { LibrarySnapshot, LibraryStore } from '../../session'
import { LibraryContext, useRequired } from './contexts'

/** The Library the tab bar reads from; provided by `LegacyViewRoot`. */
export function useLibrary(): LibraryStore {
  return useRequired(LibraryContext, 'The Library')
}

/** One derived read of the Library, referentially stable while it is shallow-equal. */
export function useLibrarySelector<T>(
  select: (snapshot: LibrarySnapshot) => T,
  isEqual: (a: T, b: T) => boolean = shallow,
): T {
  const library = useLibrary()
  const subscribe = useCallback((listener: () => void) => library.subscribe(listener), [library])
  const cache = useRef<{ at: unknown; select: (snapshot: LibrarySnapshot) => T; value: T } | null>(null)
  const getSnapshot = useCallback((): T => {
    const snapshot = library.getSnapshot()
    const previous = cache.current
    if (previous !== null && previous.at === snapshot && previous.select === select) return previous.value
    const next = select(snapshot)
    const value = previous !== null && isEqual(previous.value, next) ? previous.value : next
    cache.current = { at: snapshot, select, value }
    return value
  }, [library, select, isEqual])
  return useSyncExternalStore(subscribe, getSnapshot)
}
