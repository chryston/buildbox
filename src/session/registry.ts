/**
 * The open sessions of this tab (#48, #14).
 *
 * The Library must refuse to trash or purge a Project whose session is holding unsaved
 * changes, and the Library is not allowed to reach into a session's private state — so the
 * two meet here. `openProject` registers the session it opens and removes it again on
 * `close`; `createLibraryStore` only ever asks `isGuarded`.
 *
 * One registry per tab, created by `app` (#49) and passed to both.
 */
import type { ProjectSession, SessionRegistry } from './types'

export function createSessionRegistry(): SessionRegistry {
  const open = new Map<string, ProjectSession>()

  return {
    register(session) {
      open.set(session.id, session)
    },
    unregister(projectId) {
      open.delete(projectId)
    },
    get(projectId) {
      return open.get(projectId) ?? null
    },
    isGuarded(projectId) {
      return open.get(projectId)?.getSnapshot().guard.blocked ?? false
    },
  }
}
