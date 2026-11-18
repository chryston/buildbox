/**
 * The Library store (#48, #14): the list of Projects, the Trash, and the backup-due rule.
 *
 * It is a plain TypeScript store — `subscribe` and `getSnapshot`, no framework — holding
 * what `persistence` can answer without loading a Project: the Library records, split into
 * Projects and Trash, plus a `loading` flag the Library shows while the first `refresh` is
 * in flight. #49 binds it with `useSyncExternalStore`.
 *
 * Two rules make it more than a cache of `list`:
 *
 * - **A New Project is committed, not staged.** `createProject` builds the default Project
 *   with `edit.createProject` and writes it immediately, so the Library never holds a
 *   Project that a reload would lose.
 * - **#14's guard reaches here.** Trashing or purging a Project whose open session is
 *   holding unsaved changes is refused with `'guarded'` — the session owns that decision and
 *   the Library only asks the registry whether it is blocked.
 */
import { remapIds } from '../domain'
import { createProject as buildProject } from '../edit'
import type { LibraryRecord, PersistenceError, Ports, Result } from '../persistence'
import { copyNameFor } from './restore'
import type { ClockPort, IdSource } from './ports'
import { err, ok } from './result'
import type { LibrarySnapshot, LibraryStore, SessionError, SessionRegistry } from './types'

/**
 * The revision a New Project is written at.
 *
 * #48 asked for revision 0 so that an untouched New Project could be told from one with
 * changes. The ports require a first commit above zero (#45: `revision > expectedRevision`,
 * and `null` expected counts as zero), so a New Project starts at 1 and "pristine" means
 * `revision === NEW_PROJECT_REVISION`. The user-visible rule is unchanged: a New Project
 * nobody has edited is never due for a Project Backup.
 */
export const NEW_PROJECT_REVISION = 1

/** #14: a backup reminder fires once the last one started more than seven days ago. */
export const BACKUP_DUE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** #51 §4: how long a trashed Project stays recoverable, in whole days. */
export const TRASH_RETENTION_DAYS = 30

const DAY_MS = 86_400_000

/**
 * Whether a trashed Project has outlived its 30 days.
 *
 * Whole elapsed days, which is the same count the Trash row prints in `18 days remaining` — the
 * row and the sweeper read one rule, so a Project is never purged while its row still promises
 * time. A record that is not trashed is never expired.
 */
export function isTrashExpired(record: LibraryRecord, now: string): boolean {
  if (record.trashedAt === null) return false
  return Math.floor((Date.parse(now) - Date.parse(record.trashedAt)) / DAY_MS) >= TRASH_RETENTION_DAYS
}

/** What the Library store needs from outside: the ports, the clock and the tab's open sessions. */
export interface LibraryDeps {
  ports: Ports
  clock: ClockPort
  ids: IdSource
  registry: SessionRegistry
}

/**
 * Whether to offer a Project Backup (#14), as a pure function of the record and the clock
 * so the Library can ask it while it renders.
 *
 * Both halves have to hold: there is something new to back up — a revision past the last
 * one that was offered, and past a New Project's first write — and the last offer is either
 * nothing at all or more than seven days old. `now` is an ISO instant read by the caller.
 */
export function isBackupDue(record: LibraryRecord, now: string): boolean {
  if (record.revision <= NEW_PROJECT_REVISION) return false
  if (record.revision <= (record.lastBackupRevision ?? 0)) return false
  const last = record.lastBackupInitiatedAt
  if (last === null) return true
  return Date.parse(now) - Date.parse(last) > BACKUP_DUE_AFTER_MS
}

export function createLibraryStore(deps: LibraryDeps): LibraryStore {
  const { ports, clock, ids, registry } = deps
  const listeners = new Set<() => void>()
  let snapshot: LibrarySnapshot = { projects: [], trash: [], loading: false }

  function set(next: LibrarySnapshot): void {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  async function refresh(): Promise<Result<void, PersistenceError>> {
    set({ ...snapshot, loading: true })
    const listed = await ports.projects.list({ includeTrashed: true })
    if (!listed.ok) {
      set({ ...snapshot, loading: false })
      return listed
    }
    const projects: LibraryRecord[] = []
    const trash: LibraryRecord[] = []
    for (const record of listed.value) {
      if (record.trashedAt === null) projects.push(record)
      else trash.push(record)
    }
    set({ projects, trash, loading: false })
    return ok(undefined)
  }

  /** The revision the user was offered a Backup for: the session's own when it is open. */
  function backupRevision(id: string): number | undefined {
    const open = registry.get(id)
    if (open !== null) return open.getSnapshot().revision
    return [...snapshot.projects, ...snapshot.trash].find((record) => record.id === id)?.revision
  }

  const store: LibraryStore = {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    refresh,

    async createProject(name: string): Promise<Result<string, PersistenceError>> {
      const project = buildProject({ ids: ids(5), now: clock.now(), name })
      const committed = await ports.projects.commit(
        { project, revision: NEW_PROJECT_REVISION, savedAt: clock.now() },
        null,
      )
      if (!committed.ok) return committed
      // The Library record is derived from the Project inside the commit (#45), so the new
      // row appears with its real Summary rather than a placeholder.
      await refresh()
      return ok(project.id)
    },

    async rename(id: string, name: string): Promise<Result<LibraryRecord, SessionError>> {
      if (registry.isGuarded(id)) return err('guarded')
      const loaded = await ports.projects.load(id)
      if (!loaded.ok) return loaded
      const current = loaded.value.data
      const trimmed = name.trim()
      // An empty or unchanged name writes nothing: the dialog's Save is disabled for the first,
      // and a second commit of the same name would make the Project look due for a Backup for a
      // change that did not happen.
      if (trimmed !== '' && trimmed !== current.meta.name) {
        const project = { ...current, meta: { ...current.meta, name: trimmed } }
        const committed = await ports.projects.commit(
          { project, revision: loaded.value.revision + 1, savedAt: clock.now() },
          loaded.value.revision,
        )
        if (!committed.ok) return committed
      }
      const refreshed = await refresh()
      if (!refreshed.ok) return refreshed
      const record = [...snapshot.projects, ...snapshot.trash].find((each) => each.id === id)
      return record === undefined ? err({ kind: 'not-found', id }) : ok(record)
    },

    async duplicate(id: string): Promise<Result<string, SessionError>> {
      const loaded = await ports.projects.load(id)
      if (!loaded.ok) return loaded
      const source = loaded.value.data
      const copyName = copyNameFor(
        source.meta.name,
        [...snapshot.projects, ...snapshot.trash].map((record) => record.name),
      )
      // The same content under a wholly new identity (#50): a Duplicate that shared an ID with
      // its source would collide the moment either one was restored from a Backup.
      const remapped = remapIds(source, ids(1)[0], (count) => ids(count))
      const project = { ...remapped, meta: { ...remapped.meta, name: copyName } }
      const committed = await ports.projects.commit(
        { project, revision: NEW_PROJECT_REVISION, savedAt: clock.now() },
        null,
      )
      if (!committed.ok) return committed
      await refresh()
      return ok(project.id)
    },

    async trash(id: string): Promise<Result<LibraryRecord, SessionError>> {
      if (registry.isGuarded(id)) return err('guarded')
      const trashed = await ports.projects.trash(id, clock.now())
      if (!trashed.ok) return trashed
      await refresh()
      return ok(trashed.value)
    },

    async restore(id: string): Promise<Result<LibraryRecord, SessionError>> {
      if (registry.isGuarded(id)) return err('guarded')
      const restored = await ports.projects.restore(id)
      if (!restored.ok) return restored
      await refresh()
      return ok(restored.value)
    },

    async purge(id: string): Promise<Result<void, SessionError>> {
      if (registry.isGuarded(id)) return err('guarded')
      const purged = await ports.projects.purge(id)
      if (!purged.ok) return purged
      await refresh()
      return ok(undefined)
    },

    async purgeExpired(): Promise<Result<number, SessionError>> {
      // #51 §4: thirty days is a promise, and a promise nobody keeps needs a sweeper. It runs
      // over the list already in memory rather than re-reading, because `refresh` is what put
      // the Trash there in the first place and the Library opens by refreshing first.
      //
      // A Project whose session this tab holds with unsaved changes is skipped, not failed: the
      // guard outranks the calendar, and the next Library open will find it unblocked.
      const expired = snapshot.trash.filter((record) => isTrashExpired(record, clock.now()))
      for (const record of expired) {
        if (registry.isGuarded(record.id)) continue
        const purged = await ports.projects.purge(record.id)
        if (!purged.ok) return err(purged.error)
      }
      if (expired.length > 0) await refresh()
      return ok(expired.length)
    },

    async markBackupInitiated(id: string): Promise<Result<LibraryRecord, SessionError>> {
      if (registry.isGuarded(id)) return err('guarded')
      const revision = backupRevision(id)
      if (revision === undefined) return err({ kind: 'not-found', id })
      const marked = await ports.projects.markBackupInitiated(id, { at: clock.now(), revision })
      if (!marked.ok) return marked
      await refresh()
      return ok(marked.value)
    },
  }

  return store
}
