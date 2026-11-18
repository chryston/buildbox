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
import type { ActiveViewState, ViewportCache } from '../ui'

export function createViewportCache(prefs: PrefsRepository, projectId: string): ViewportCache {
  const activeKey = `activeView:${projectId}` as const
  return {
    async read(viewKey) {
      const found = await prefs.get(`viewState:${projectId}:${viewKey}`)
      return found.ok ? found.value : undefined
    },
    write(viewKey, viewport) {
      void prefs.set(`viewState:${projectId}:${viewKey}`, viewport)
    },
    // #56 re-keyed viewports to `view:<viewId>`; the `plan:<floorId>` entries the old shell
    // wrote are never read again, which is the whole of "old entries are dropped".
    async readActive() {
      const found = await prefs.get(activeKey)
      return found.ok && found.value !== undefined
        ? { floorId: found.value.floorId, viewsByFloor: found.value.viewsByFloor }
        : null
    },
    writeActive(state: ActiveViewState) {
      void prefs.set(activeKey, state)
    },
  }
}
