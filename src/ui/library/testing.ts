/**
 * The Library's test doubles (#50).
 *
 * `ui` is tested against the interfaces it is handed, never against IndexedDB: the adapters have
 * their own suites in `persistence`, and a `ui` test that reached through to a real store would
 * be testing the wrong module at ten times the cost. What this file builds is a `LibraryStore`
 * that answers from an array and records what it was asked, plus a `LibraryServices` whose four
 * flows are spies a test can read back.
 *
 * The records are the ones the parity fixture uses, so a card that reads correctly here reads
 * correctly in `e2e/screenshots/library.spec.ts`.
 */
import type { LibraryServices } from './LibraryHome'
import type {
  BackupFailure,
  BackupWritten,
  LibraryRecord,
  LibrarySnapshot,
  LibraryStore,
  RecoveryPointMeta,
  RestoreApplied,
  RestoreCommitTarget,
  RestoreProblem,
  RestoreStaged,
  Result,
  SessionError,
} from '../../session'
import type { ProjectSummary } from '../../domain'

export const NOW = '2026-10-07T02:44:00.000Z'

export const SUMMARY: ProjectSummary = {
  floorCount: 2,
  designOptionCount: 0,
  itemCount: 14,
  previewAssetHash: null,
  previewOutline: { bounds: [0, 0, 6000, 3000], rects: [[1000, 1000, 2000, 1000, 0]] },
}

/** A Library record with every field filled in, changed only where a test cares. */
export function record(overrides: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: 'p1',
    name: 'Tiong Bahru Home',
    address: '18 Yong Siak Street',
    revision: 4,
    savedAt: '2026-10-07T02:42:00.000Z',
    schemaVersion: 1,
    sizeBytes: 4_200_000,
    lastBackupInitiatedAt: null,
    lastBackupRevision: null,
    trashedAt: null,
    summary: SUMMARY,
    ...overrides,
  }
}

export interface LibraryCalls {
  download: string[]
  stage: Uint8Array[]
  commit: RestoreCommitTarget[]
  opened: string[]
  renamed: [string, string][]
  duplicated: string[]
  trashed: string[]
  created: string[]
  /** The Projects whose Recovery Points were read, which is the picker having opened. */
  recovered: string[]
  /** The Projects the Permanent deletion dialog was asked about. */
  deleted: string[]
  /** `[projectId, pointId]` for each Recovery Point the person chose. */
  restoredPoints: Array<[string, string]>
  /** The three Save failed answers, counted rather than listed — they take no arguments. */
  retried: number
  emergencyBackups: number
  discarded: number
}

export interface TestLibrary {
  services: LibraryServices
  calls: LibraryCalls
  /** Replace the snapshot and notify, which is what a `refresh()` would have done. */
  setRecords(records: LibraryRecord[]): void
  /** Make the next `downloadBackup` refuse. */
  failDownload: (failure: BackupFailure | null) => void
  /** Make the next `stageRestore` or `commitRestore` refuse. */
  failRestore: (problem: RestoreProblem | null) => void
  /** Replace the answer `stageRestore` gives, which is the only route into the collision dialog. */
  stageAnswer: (staged: RestoreStaged) => void
  /** The Recovery Points `recoveryPoints` answers with, newest first. */
  setRecoveryPoints: (points: RecoveryPointMeta[]) => void
  /** The Projects `lockedElsewhere` says another tab is holding (#51 §5). */
  setLocked: (ids: readonly string[]) => void
  /** The Projects the fake store refuses with `'guarded'`, standing in for the session registry. */
  setGuarded: (ids: readonly string[]) => void
  /** Make the next `openProject` refuse, which is how a guarded `Open` is drawn. */
  failOpen: (error: SessionError | null) => void
}

const ok = <T,>(value: T): Result<T, never> => ({ ok: true, value })

/** The shape `LibraryStore.getSnapshot` answers with: everything, split by Trash. */
const build = (records: LibraryRecord[]): LibrarySnapshot => ({
  projects: records,
  trash: records.filter((entry) => entry.trashedAt !== null),
  loading: false,
})

/**
 * A `LibraryStore` over an array, and the `LibraryServices` built on it.
 *
 * Every flow resolves successfully unless `failWith` has been set, because the point of these
 * tests is which sentence the surface shows for which answer, not whether `session` computes the
 * answer correctly — that is `session`'s own suite.
 */
export function createTestLibrary(records: LibraryRecord[] = []): TestLibrary {
  let current = records
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  // `useSyncExternalStore` compares snapshots by identity, so a store that built a new object on
  // every read would re-render forever. The snapshot is rebuilt only when the records move.
  let snapshot: LibrarySnapshot = build(records)
  const set = (next: LibraryRecord[]): void => {
    current = next
    snapshot = build(next)
    notify()
  }
  let downloadFailure: BackupFailure | null = null
  let restoreFailure: RestoreProblem | null = null
  let stagedAnswer: RestoreStaged = { staged: STAGED, collision: null }

  const calls: LibraryCalls = {
    download: [],
    stage: [],
    commit: [],
    opened: [],
    renamed: [],
    duplicated: [],
    trashed: [],
    created: [],
    recovered: [],
    deleted: [],
    restoredPoints: [],
    retried: 0,
    emergencyBackups: 0,
    discarded: 0,
  }
  let points: RecoveryPointMeta[] = []
  let locked = new Set<string>()
  let guarded = new Set<string>()
  let openFailure: SessionError | null = null

  const library: LibraryStore = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    refresh: async () => {
      notify()
      return ok(undefined)
    },
    createProject: async (name) => {
      calls.created.push(name)
      const id = `p${current.length + 1}`
      set([...current, record({ id, name, revision: 1 })])
      return ok(id)
    },
    rename: async (id, name) => {
      calls.renamed.push([id, name])
      const found = current.find((entry) => entry.id === id)
      if (found === undefined) throw new Error(`no record ${id}`)
      set(current.map((entry) => (entry.id === id ? { ...entry, name, revision: entry.revision + 1 } : entry)))
      return ok({ ...found, name, revision: found.revision + 1 })
    },
    duplicate: async (id) => {
      calls.duplicated.push(id)
      const found = current.find((entry) => entry.id === id)
      if (found === undefined) throw new Error(`no record ${id}`)
      const id2 = `p${current.length + 1}`
      set([...current, record({ id: id2, name: `${found.name} — Copy` })])
      return ok(id2)
    },
    trash: async (id) => {
      calls.trashed.push(id)
      if (guarded.has(id)) return { ok: false, error: 'guarded' }
      const found = current.find((entry) => entry.id === id)
      if (found === undefined) throw new Error(`no record ${id}`)
      set(current.map((entry) => (entry.id === id ? { ...entry, trashedAt: NOW } : entry)))
      return ok({ ...found, trashedAt: NOW })
    },
    restore: async (id) => {
      if (guarded.has(id)) return { ok: false, error: 'guarded' }
      const found = current.find((entry) => entry.id === id)
      if (found === undefined) throw new Error(`no record ${id}`)
      set(current.map((entry) => (entry.id === id ? { ...entry, trashedAt: null } : entry)))
      return ok({ ...found, trashedAt: null })
    },
    purge: async (id) => {
      if (guarded.has(id)) return { ok: false, error: 'guarded' }
      set(current.filter((entry) => entry.id !== id))
      return ok(undefined)
    },
    purgeExpired: async () => ok(0),
    markBackupInitiated: async (id) => {
      const found = current.find((entry) => entry.id === id)
      if (found === undefined) throw new Error(`no record ${id}`)
      const updated = { ...found, lastBackupInitiatedAt: NOW, lastBackupRevision: found.revision }
      set(current.map((entry) => (entry.id === id ? updated : entry)))
      return ok(updated)
    },
  }

  const services: LibraryServices = {
    library,
    // A frozen clock, written out rather than imported from `session/testing`: #42 §7 lets only a
    // `*.test.ts(x)` file reach a module's `testing.ts`, and this file is not one.
    clock: { now: () => NOW, dayKey: (iso: string) => iso.slice(0, 10), setTimer: () => () => {} },
    recoveryCounts: async () => new Map(current.map((entry) => [entry.id, 8])),
    planImageUrl: () => null,
    backupEstimate: async (id) => current.find((entry) => entry.id === id)?.sizeBytes ?? 0,
    downloadBackup: async (id) => {
      calls.download.push(id)
      if (downloadFailure !== null) return { ok: false, error: downloadFailure }
      return ok({
        fileName: 'Tiong Bahru Home.buildbox',
        byteLength: 4_200_000,
        record: record(),
      } satisfies BackupWritten)
    },
    readBackupFile: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    stageRestore: async (bytes) => {
      calls.stage.push(bytes)
      if (restoreFailure !== null) return { ok: false, error: restoreFailure }
      return ok(stagedAnswer)
    },
    commitRestore: async (target) => {
      calls.commit.push(target)
      if (restoreFailure !== null) return { ok: false, error: restoreFailure }
      const kind: RestoreApplied['kind'] =
        'decision' in target ? (target.decision === 'replace' ? 'replace' : 'copy') : 'new'
      return ok({ kind, id: 'p9', name: 'Restored Flat', migratedFrom: null } satisfies RestoreApplied)
    },
    openProject: async (id) => {
      calls.opened.push(id)
      if (openFailure !== null) return { ok: false, error: openFailure }
      return ok(undefined)
    },
    recoveryPoints: async (id) => {
      calls.recovered.push(id)
      return points
    },
    lockedElsewhere: async (id) => locked.has(id),
    restoreRecoveryPoint: async (projectId, pointId) => {
      calls.restoredPoints.push([projectId, pointId])
      if (openFailure !== null) return { ok: false, error: openFailure }
      return ok(undefined)
    },
    retrySave: () => {
      calls.retried += 1
    },
    downloadEmergencyBackup: () => {
      calls.emergencyBackups += 1
    },
    discardUnsaved: () => {
      calls.discarded += 1
    },
  }

  return {
    services,
    calls,
    setRecords: (next) => {
      set(next)
    },
    failDownload: (next) => {
      downloadFailure = next
    },
    failRestore: (next) => {
      restoreFailure = next
    },
    stageAnswer: (next) => {
      stagedAnswer = next
    },
    setRecoveryPoints: (next) => {
      points = next
    },
    setLocked: (next) => {
      locked = new Set(next)
    },
    setGuarded: (next) => {
      guarded = new Set(next)
    },
    failOpen: (next) => {
      openFailure = next
    },
  }
}

/**
 * A staged Backup, held as an opaque value.
 *
 * `ui` never constructs or inspects a `StagedPackage` — it passes the value straight back to
 * `commitRestore` — so a test only needs one that is not `null`. The cast is the honest shape of
 * the boundary: `package`'s type is unreachable from here by design (#42 §2).
 */
export const STAGED = { manifest: {}, project: { meta: { name: 'Restored Flat' } } } as unknown as RestoreStaged['staged']
