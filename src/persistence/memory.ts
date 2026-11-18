/**
 * The in-memory adapter (#45): the reference implementation of the ports, and the one
 * every other implementation is measured against.
 *
 * It is used three ways — as the behaviour the contract suite defines, as the store behind
 * `session` tests (#48), and as the app's fallback when IndexedDB cannot be opened (#51).
 * Two properties make it trustworthy for all three:
 *
 * - **All-or-nothing writes.** Each write builds its result on a copy of the state and
 *   swaps that copy in only once every step has succeeded, so a refused or interrupted
 *   commit leaves the previous snapshot exactly as it was (#14).
 * - **Nothing leaks.** What a caller hands over is deep-copied and deep-frozen on the way
 *   in, and the records handed back are those frozen copies, so later mutation of the
 *   caller's object cannot rewrite stored data and a caller cannot edit a stored record.
 *
 * `Blob` is a standard global in Node 24 and Workers (#20 §2), not a DOM API, so storing
 * asset bytes here costs no DOM dependency.
 */
import { DOMAIN_SCHEMA_VERSION, referencedAssetHashes, summarizeProject, type Project } from '../domain'
import { canonicalJsonBytes, sha256Hex } from '../lib'
import {
  ASSET_GC_GRACE_MS,
  RECOVERY_KEEP_DAYS,
  RECOVERY_KEEP_RECENT,
  type AssetDims,
  type CommitEntry,
  type CommitInput,
  type LibraryRecord,
  type LiveHashes,
  type MetaMap,
  type NewAsset,
  type PersistenceError,
  type Ports,
  type PrefsMap,
  type ProjectRecord,
  type RecoveryPoint,
  type RecoveryPointMeta,
  type Result,
  type StoredAsset,
} from './ports'

const DAY_MS = 24 * 60 * 60 * 1000

interface MemoryState {
  projects: Map<string, ProjectRecord>
  library: Map<string, LibraryRecord>
  assets: Map<string, StoredAsset>
  recovery: Map<string, RecoveryPoint>
  prefs: Map<string, unknown>
  meta: Map<string, unknown>
}

const emptyState = (): MemoryState => ({
  projects: new Map(),
  library: new Map(),
  assets: new Map(),
  recovery: new Map(),
  prefs: new Map(),
  meta: new Map(),
})

/** The next state, on a copy: entries are shared until a write replaces one. */
const nextState = (state: MemoryState): MemoryState => ({
  projects: new Map(state.projects),
  library: new Map(state.library),
  assets: new Map(state.assets),
  recovery: new Map(state.recovery),
  prefs: new Map(state.prefs),
  meta: new Map(state.meta),
})

const ok = <T>(value: T): Result<T, PersistenceError> => ({ ok: true, value })
const fail = (error: PersistenceError): Result<never, PersistenceError> => ({ ok: false, error })

/** Newest `timeOf` first, `idOf` breaking a tie so the order never depends on insertion. */
function newestFirst<T>(timeOf: (item: T) => string, idOf: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const at = timeOf(a)
    const bt = timeOf(b)
    if (at !== bt) return at < bt ? 1 : -1
    const ai = idOf(a)
    const bi = idOf(b)
    return ai < bi ? -1 : ai > bi ? 1 : 0
  }
}

const bySavedAt = newestFirst((record: LibraryRecord) => record.savedAt, (record) => record.id)
const byCreatedAt = newestFirst((point: RecoveryPointMeta) => point.createdAt, (point) => point.id)

/** The metadata half of a Recovery Point, as a frozen copy so `list` leaks nothing. */
function metaOf(point: RecoveryPoint): RecoveryPointMeta {
  return immutable({
    id: point.id,
    projectId: point.projectId,
    createdAt: point.createdAt,
    kind: point.kind,
    revision: point.revision,
    schemaVersion: point.schemaVersion,
    summary: point.summary,
  })
}

/**
 * A private, deep-frozen copy of `value`. `Blob`s are immutable already and are kept as
 * they are; anything else that is not a plain object or array is stored by reference,
 * which the record types exclude.
 */
function immutable<T>(value: T): T {
  return copyFrozen(value) as T
}

function copyFrozen(value: unknown): unknown {
  if (value instanceof Blob) return value
  if (Array.isArray(value)) return Object.freeze(value.map(copyFrozen))
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const copy: Record<string, unknown> = {}
    for (const key of Object.keys(source)) copy[key] = copyFrozen(source[key])
    return Object.freeze(copy)
  }
  return value
}

/** Canonical-JSON bytes of the Project plus the bytes of each distinct asset it references. */
function sizeOf(project: Project, assets: ReadonlyMap<string, StoredAsset>): number {
  let bytes = canonicalJsonBytes(project).byteLength
  for (const hash of referencedAssetHashes(project)) bytes += assets.get(hash)?.byteLength ?? 0
  return bytes
}

/** The Library record `project` derives to, keeping the fields commits must not touch. */
function libraryOf(
  project: Project,
  revision: number,
  savedAt: string,
  assets: ReadonlyMap<string, StoredAsset>,
  previous: LibraryRecord | undefined,
): LibraryRecord {
  return immutable({
    id: project.id,
    name: project.meta.name,
    address: project.meta.address ?? null,
    revision,
    savedAt,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    sizeBytes: sizeOf(project, assets),
    lastBackupInitiatedAt: previous?.lastBackupInitiatedAt ?? null,
    lastBackupRevision: previous?.lastBackupRevision ?? null,
    trashedAt: previous?.trashedAt ?? null,
    summary: summarizeProject(project),
  })
}

async function hashOf(bytes: Blob): Promise<string> {
  return sha256Hex(await bytes.arrayBuffer())
}

/**
 * `input` written into `next`, which the caller owns.
 *
 * The body of both `commit` and `commitMany`, and the reason the two agree on every rule: the
 * revision check, the asset deduplication and the derived Library record all run against the
 * state as it stands *including* whatever earlier entries of the same batch already wrote. A
 * refusal changes nothing, because `next` is discarded by the caller.
 */
async function writeCommit(
  next: MemoryState,
  { input, expectedRevision, recoveryPoint }: CommitEntry,
): Promise<Result<ProjectRecord, PersistenceError>> {
  const stored = next.projects.get(input.project.id)
  const actual = stored?.revision ?? null
  // A revision that does not increase is the same class of refusal as a stale
  // expected revision: the caller's view of the store is not the store's (#45).
  if (actual !== expectedRevision || !(input.revision > (expectedRevision ?? 0))) {
    return fail({ kind: 'revision-conflict', expected: expectedRevision, actual })
  }

  for (const asset of input.newAssets ?? []) {
    const sha256 = await hashOf(asset.bytes)
    // Deduplicated by hash against the store and against the rest of this commit.
    if (next.assets.has(sha256)) continue
    next.assets.set(sha256, immutable(storedAsset(sha256, asset, input.savedAt)))
  }
  const record: ProjectRecord = immutable({
    id: input.project.id,
    revision: input.revision,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    savedAt: input.savedAt,
    data: input.project,
  })
  const previous = next.library.get(record.id)
  next.projects.set(record.id, record)
  next.library.set(record.id, libraryOf(input.project, input.revision, input.savedAt, next.assets, previous))
  // The snapshot belongs to the same unit of work as the change it protects: it becomes
  // visible here or not at all (#52 §2 step 6).
  if (recoveryPoint !== undefined) next.recovery.set(recoveryPoint.id, immutable(recoveryPoint))
  return ok(record)
}

/** The in-memory adapter over a fresh, empty store. */
export function createMemoryAdapter(): Ports {
  let state = emptyState()

  return {
    projects: {
      async list({ includeTrashed }) {
        const records = [...state.library.values()].filter(
          (record) => includeTrashed || record.trashedAt === null,
        )
        return ok(records.sort(bySavedAt))
      },

      async load(id) {
        const record = state.projects.get(id)
        return record === undefined ? fail({ kind: 'not-found', id }) : ok(record)
      },

      async commit(input: CommitInput, expectedRevision) {
        const next = nextState(state)
        const written = await writeCommit(next, { input, expectedRevision })
        if (!written.ok) return written
        state = next
        return written
      },

      async commitMany(entries) {
        // One copy for the whole batch: an entry refused part-way leaves `state` untouched,
        // because the swap below is the only thing that makes any of it visible (#52 §2 step 6).
        const next = nextState(state)
        const records: ProjectRecord[] = []
        for (const entry of entries) {
          const written = await writeCommit(next, entry)
          if (!written.ok) return written
          records.push(written.value)
        }
        state = next
        return ok(records)
      },

      async markBackupInitiated(id, { at, revision }) {
        const previous = state.library.get(id)
        if (previous === undefined) return fail({ kind: 'not-found', id })
        const record: LibraryRecord = immutable({ ...previous, lastBackupInitiatedAt: at, lastBackupRevision: revision })
        const next = nextState(state)
        next.library.set(id, record)
        state = next
        return ok(record)
      },

      async trash(id, at) {
        return setTrashed(id, at)
      },

      async restore(id) {
        return setTrashed(id, null)
      },

      async purge(id) {
        if (!state.projects.has(id) && !state.library.has(id)) return fail({ kind: 'not-found', id })
        const next = nextState(state)
        next.projects.delete(id)
        next.library.delete(id)
        for (const [pointId, point] of next.recovery) {
          if (point.projectId === id) next.recovery.delete(pointId)
        }
        state = next
        return ok(undefined)
      },
    },

    assets: {
      async put(bytes, mediaType, dims: AssetDims, storedAt) {
        const sha256 = await hashOf(bytes)
        // Idempotent: the first write wins, so the original `storedAt` survives a repeat.
        if (state.assets.has(sha256)) return ok(sha256)
        const next = nextState(state)
        next.assets.set(sha256, immutable(storedAsset(sha256, { bytes, mediaType, ...dims }, storedAt)))
        state = next
        return ok(sha256)
      },

      async get(sha256) {
        const asset = state.assets.get(sha256)
        return asset === undefined ? fail({ kind: 'not-found', id: sha256 }) : ok(asset)
      },

      async has(sha256) {
        return ok(state.assets.has(sha256))
      },

      async gc(liveHashes: LiveHashes, now) {
        const nowMs = Date.parse(now)
        const doomed = [...state.assets.values()]
          .filter((asset) => !liveHashes.has(asset.sha256) && nowMs - Date.parse(asset.storedAt) >= ASSET_GC_GRACE_MS)
          .sort((a, b) => (a.storedAt === b.storedAt ? a.sha256.localeCompare(b.sha256) : a.storedAt < b.storedAt ? -1 : 1))
        if (doomed.length === 0) return ok({ deleted: [] })
        const next = nextState(state)
        for (const asset of doomed) next.assets.delete(asset.sha256)
        state = next
        return ok({ deleted: doomed.map((asset) => asset.sha256) })
      },
    },

    recovery: {
      async create(point) {
        const stored = immutable(point)
        const next = nextState(state)
        next.recovery.set(stored.id, stored)
        state = next
        return ok(stored.id)
      },

      async list(projectId) {
        const metas = [...state.recovery.values()].filter((point) => point.projectId === projectId).map(metaOf)
        return ok(metas.sort(byCreatedAt))
      },

      async load(id) {
        const point = state.recovery.get(id)
        return point === undefined ? fail({ kind: 'not-found', id }) : ok(point)
      },

      async prune(projectId, { now, dayKey }) {
        const points = [...state.recovery.values()]
          .filter((point) => point.projectId === projectId)
          .sort(byCreatedAt)
        const keep = new Set<string>(points.slice(0, RECOVERY_KEEP_RECENT).map((point) => point.id))
        const cutoff = Date.parse(now) - RECOVERY_KEEP_DAYS * DAY_MS
        const newestOfDay = new Set<string>()
        for (const point of points) {
          // `points` is newest first, so the first point seen for a day is that day's newest.
          if (Date.parse(point.createdAt) < cutoff) continue
          const day = dayKey(point.createdAt)
          if (newestOfDay.has(day)) continue
          newestOfDay.add(day)
          keep.add(point.id)
        }
        const removed = points.filter((point) => !keep.has(point.id)).map((point) => point.id)
        if (removed.length === 0) return ok({ deleted: [] })
        const next = nextState(state)
        for (const id of removed) next.recovery.delete(id)
        state = next
        return ok({ deleted: removed.reverse() })
      },
    },

    prefs: {
      async get<K extends keyof PrefsMap>(key: K) {
        return ok(state.prefs.get(String(key)) as PrefsMap[K] | undefined)
      },
      async set<K extends keyof PrefsMap>(key: K, value: PrefsMap[K]) {
        const next = nextState(state)
        next.prefs.set(String(key), immutable(value))
        state = next
        return ok(undefined)
      },
    },

    meta: {
      async get<K extends keyof MetaMap>(key: K) {
        return ok(state.meta.get(String(key)) as MetaMap[K] | undefined)
      },
      async set<K extends keyof MetaMap>(key: K, value: MetaMap[K]) {
        const next = nextState(state)
        next.meta.set(String(key), immutable(value))
        state = next
        return ok(undefined)
      },
    },
  }

  function setTrashed(id: string, trashedAt: string | null): Result<LibraryRecord, PersistenceError> {
    const previous = state.library.get(id)
    if (previous === undefined) return fail({ kind: 'not-found', id })
    if (previous.trashedAt === trashedAt) return ok(previous)
    const record: LibraryRecord = immutable({ ...previous, trashedAt })
    const next = nextState(state)
    next.library.set(id, record)
    state = next
    return ok(record)
  }
}

/** The stored form of one asset carried by a `put` or a commit. */
function storedAsset(sha256: string, asset: NewAsset, storedAt: string): StoredAsset {
  return {
    sha256,
    mediaType: asset.mediaType,
    byteLength: asset.bytes.size,
    widthPx: asset.widthPx,
    heightPx: asset.heightPx,
    storedAt,
    blob: asset.bytes,
  }
}
