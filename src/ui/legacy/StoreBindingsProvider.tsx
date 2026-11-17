/**
 * The flag-off half of the `LegacyBindings` seam (#49).
 *
 * Only the production entry point and the test renders import this: it is the one module
 * that puts `src/store` behind the seam, which is why no component may.
 */
import type { ReactNode } from 'react'
import { LegacyBindingsContext } from './bindings'
import { useStoreBindings } from './storeBindings'

export function StoreBindingsProvider({ children }: { children: ReactNode }) {
  const bindings = useStoreBindings()
  return <LegacyBindingsContext.Provider value={bindings}>{children}</LegacyBindingsContext.Provider>
}
