/**
 * The device-local view-state cache over the `PrefsRepository` port (#55 criterion 4).
 *
 * The viewport is UI-session state: it lives under `viewState:<projectId>:<viewKey>` in
 * the device's preferences, never in the Project document, never in a Backup, never in
 * history (#20 §4, conflict 15.7). That is why this adapter is `app`'s: it is the only
 * place the workspace's session-scoped key meets the persistence port, and the workspace
 * itself sees nothing but the structural `ViewportCache`.
 *
 * Writes are fire-and-forget. A refused write (private mode, quota) costs the next reload
 * a `Fit`, which is the whole of the damage a disposable cache can do.
 */
import type { PrefsRepository } from '../persistence'
import type { ViewportCache } from '../ui'

export function createViewportCache(prefs: PrefsRepository, projectId: string): ViewportCache {
  return {
    async read(viewKey) {
      const found = await prefs.get(`viewState:${projectId}:${viewKey}`)
      return found.ok ? found.value : undefined
    },
    write(viewKey, viewport) {
      void prefs.set(`viewState:${projectId}:${viewKey}`, viewport)
    },
  }
}
