/**
 * The React contexts the flagged app is built on (#49).
 *
 * `LegacyViewRoot` provides them once; everything below it reads the Project session, the
 * Library and the view bindings from context instead of reaching for a global store. They
 * live here rather than in `ui/legacy` because the two hooks that read them — `useProject`
 * and `useLibrary` — are about the session layer, not about the legacy view.
 */
import { createContext, useContext } from 'react'
import type { LibraryStore, ProjectSession } from '../../session'

export const SessionContext = createContext<ProjectSession | null>(null)
export const LibraryContext = createContext<LibraryStore | null>(null)

/**
 * Read a context that the composition root always provides.
 *
 * A `null` here is a wiring bug — a hook used above the root — so it throws with the name of
 * the missing provider rather than failing later on a `undefined.project`.
 */
export function useRequired<T>(context: React.Context<T | null>, name: string): T {
  const value = useContext(context)
  if (value === null) throw new Error(`${name} is missing: render this inside <LegacyViewRoot>`)
  return value
}
