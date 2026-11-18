/**
 * The persistence ports (#45, #20 §5): the shapes every storage adapter stores and every
 * operation it offers. `persistence` imports nothing but `domain` and `lib`, and knows no
 * storage technology — the IndexedDB adapter (#46) implements these same ports, and
 * `session` (#48) is written against them alone.
 *
 * Two rules hold everywhere here:
 *
 * - **Results, not exceptions.** Every method resolves a `Result`; an expected failure —
 *   quota, abort, a stale revision, a missing record — is a value `session` can turn into
 *   a Save failed state without a `try` (#14). A thrown error stays a programmer bug.
 * - **Time and identity arrive as data.** Nothing in `persistence` reads the clock or
 *   mints an ID (#42 §3): `savedAt`, `storedAt`, `now`, `dayKey` and every record ID come
 *   in as arguments, which is also what makes the contract suite able to drive a clock.
 */
import type { Project, ProjectSummary } from '../domain'

/** A port's outcome: the value, or the typed reason it did not happen. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

/**
 * The one failure vocabulary of the ports. `aborted` is a write that did not complete —
 * interrupted by the user, a transaction abort or a lost tab; `serialization` names the
 * offending `path` when a value cannot be stored; `unavailable` means the store itself
 * cannot be opened, which is what puts the app in memory-only mode (#51).
 */
export type PersistenceError =
  | { kind: 'quota' }
  | { kind: 'aborted' }
  | { kind: 'serialization'; path?: string }
  | { kind: 'revision-conflict'; expected: number | null; actual: number | null }
  | { kind: 'not-found'; id: string }
  | { kind: 'unavailable'; reason: string }

/** An unreferenced asset survives garbage collection for this long (#45, #46). */
export const ASSET_GC_GRACE_MS = 24 * 60 * 60 * 1000

/** How many of a Project's newest Recovery Points always survive `prune` (#14). */
export const RECOVERY_KEEP_RECENT = 20

/** How many days back `prune` keeps one Recovery Point per day (#14). */
export const RECOVERY_KEEP_DAYS = 30

/** The whole portable record for one Project, as stored (#20 §5). */
export interface ProjectRecord {
  id: string
  /** Owned by the Project session: it increases per Edit Transaction and per forward redo (#26). */
  revision: number
  schemaVersion: number
  savedAt: string
  data: Project
}

/**
 * What the Library needs to list one Project without loading it (#45). `lastBackup*` and
 * `trashedAt` belong to the Library record and survive every commit; `summary` is derived
 * from `data` by `domain.summarizeProject` at commit time.
 */
export interface LibraryRecord {
  id: string
  name: string
  address: string | null
  revision: number
  savedAt: string
  schemaVersion: number
  /** Canonical-JSON bytes of `data` plus the bytes of every distinct asset it references. */
  sizeBytes: number
  lastBackupInitiatedAt: string | null
  lastBackupRevision: number | null
  /** Non-null means the Project is in Trash, which lasts 30 days (#14). */
  trashedAt: string | null
  summary: ProjectSummary
}

/** One content-addressed asset. The key is the SHA-256 of `blob` in lowercase hex. */
export interface AssetRecord {
  sha256: string
  mediaType: string
  byteLength: number
  widthPx: number | null
  heightPx: number | null
  storedAt: string
}

/** An `AssetRecord` together with its bytes. */
export interface StoredAsset extends AssetRecord {
  blob: Blob
}

/** Why a Recovery Point exists; `ui/strings` owns the display text (#51). */
export type RecoveryPointKind =
  | 'idle'
  | 'close'
  | 'pre-restore'
  | 'pre-import-replace'
  | 'pre-migration'
  | 'pre-discard'

/** A Recovery Point without its data, which is what `list` returns. */
export interface RecoveryPointMeta {
  id: string
  projectId: string
  createdAt: string
  kind: RecoveryPointKind
  revision: number
  schemaVersion: number
  summary: ProjectSummary
}

/** A Recovery Point as stored: its metadata plus the Project snapshot it can restore. */
export interface RecoveryPoint extends RecoveryPointMeta {
  data: Project
}

/** The pixel dimensions of an image asset, when they are known. */
export interface AssetDims {
  widthPx: number | null
  heightPx: number | null
}

/** An asset carried by a commit, deduplicated by hash against the store and each other. */
export interface NewAsset extends AssetDims {
  bytes: Blob
  mediaType: string
}

/** Everything one atomic commit writes: the Project, its derived Library record, new assets. */
export interface CommitInput {
  project: Project
  revision: number
  savedAt: string
  newAssets?: NewAsset[]
}

/**
 * One Project's share of a multi-Project commit (#52 §2 step 6).
 *
 * A migration writes several Projects and, at most, one attach to a Project that already
 * exists. Each part keeps its own `expectedRevision`, so the whole batch is checked against
 * the state the caller read and not against whatever the first write left behind.
 */
export interface CommitEntry {
  input: CommitInput
  expectedRevision: number | null
  /**
   * A Recovery Point written in the same unit of work as this Project (#52 §2 step 6).
   *
   * A migration that changes a Project it did not create owes that Project a snapshot of its
   * pre-change state, and a snapshot that survives the abort of the change it was protecting is
   * a record of something that never happened. At most one entry in a batch carries one.
   */
  recoveryPoint?: RecoveryPoint
}

/** The hashes garbage collection must keep: every Project (trashed included) and every Recovery Point. */
export type LiveHashes = ReadonlySet<string>

/** A hash list, oldest first, of what an operation removed. */
export interface RemovedResult {
  deleted: string[]
}

/** The last viewport of one saved view. Device-local: never Project data, never a Backup. */
export interface ViewportState {
  zoom: number
  panX: number
  panY: number
}

/**
 * The device-local preferences (#45). Values are plain JSON, keyed by a stable string;
 * `exportRecipes` is opaque here because the recipe shape belongs to `export`.
 */
export interface PrefsMap {
  /** The last viewport of one saved view, keyed `viewState:<projectId>:<viewKey>`. */
  [key: `viewState:${string}:${string}`]: ViewportState
  exportRecipes: unknown[]
  /**
   * #51 §6: whether the browser was asked to keep this origin's storage, and what it said.
   *
   * `askedAt` is when the question was put, which for a refusal is also the moment to start
   * counting the 30 days before it may be put again.
   */
  storagePersistence: { askedAt: string; granted: boolean }
}

/**
 * The record one completed legacy migration leaves behind (#52 §2 step 7).
 *
 * `sourceHash` is the SHA-256 of the raw value or file bytes the review was built from, which
 * is what makes "already migrated" a fact about the data rather than about the app: a
 * `buildbox-store` that later holds different bytes is a different source and is offered again.
 * `removedAt` is written only when the user confirmed `Remove old copy`.
 */
export interface LegacyMigrationRecord {
  status: 'complete'
  sourceHash: string
  completedAt: string
  /** Every Project this migration wrote, in the order the review listed them. */
  projectIds: string[]
  /** Each `Design` that was refused, in the plain words the review showed. */
  notMigrated: Array<{ designName: string; problem: string }>
  /** The discarded `wall-hack` and `tile-zone` count, kept so `Remove old copy` can say what goes with the source. */
  discardedSketches: number
  removedAt: string | null
}

/** What `meta` holds. #52 gave `legacyMigration` its shape; later records add a key here. */
export interface MetaMap {
  legacyMigration: LegacyMigrationRecord
}

/** Projects and the Library record derived from each of them. */
export interface ProjectRepository {
  /** Every Library record, newest `savedAt` first; trashed Projects only when asked. */
  list(options: { includeTrashed: boolean }): Promise<Result<LibraryRecord[], PersistenceError>>
  load(id: string): Promise<Result<ProjectRecord, PersistenceError>>
  /**
   * Write project, library and new assets as one atomic unit. `expectedRevision` is the
   * revision the caller read, or `null` to create. A stored revision that has moved on, or
   * a `revision` that does not increase, is refused with `revision-conflict` and changes
   * nothing.
   */
  commit(input: CommitInput, expectedRevision: number | null): Promise<Result<ProjectRecord, PersistenceError>>
  /**
   * Every `entries` write as one atomic unit (#52 §2 step 6, #20 §6 step 9).
   *
   * The same rules as `commit`, per entry, and one more across them: if any entry is refused
   * — a stale `expectedRevision`, a quota, a serialisation fault — then none of them landed and
   * the store is exactly as it was. The returned records are in `entries` order.
   */
  commitMany(entries: readonly CommitEntry[]): Promise<Result<ProjectRecord[], PersistenceError>>
  /** Record that a Project Backup was offered for this revision; touches no other field. */
  markBackupInitiated(
    id: string,
    change: { at: string; revision: number },
  ): Promise<Result<LibraryRecord, PersistenceError>>
  trash(id: string, at: string): Promise<Result<LibraryRecord, PersistenceError>>
  restore(id: string): Promise<Result<LibraryRecord, PersistenceError>>
  /** Project, Library record and every Recovery Point of that Project; assets are left for `gc`. */
  purge(id: string): Promise<Result<void, PersistenceError>>
}

/** Content-addressed image bytes, deduplicated and garbage-collected over live hashes. */
export interface AssetRepository {
  /** Store `bytes` under its own SHA-256. Idempotent: a repeat stores nothing and keeps the original `storedAt`. */
  put(bytes: Blob, mediaType: string, dims: AssetDims, storedAt: string): Promise<Result<string, PersistenceError>>
  get(sha256: string): Promise<Result<StoredAsset, PersistenceError>>
  has(sha256: string): Promise<Result<boolean, PersistenceError>>
  /** Delete assets that are in neither `liveHashes` nor stored within `ASSET_GC_GRACE_MS` of `now`. */
  gc(liveHashes: LiveHashes, now: string): Promise<Result<RemovedResult, PersistenceError>>
}

/** The bounded local recovery history (#14). */
export interface RecoveryRepository {
  create(point: RecoveryPoint): Promise<Result<string, PersistenceError>>
  /** Metadata only, newest `createdAt` first. */
  list(projectId: string): Promise<Result<RecoveryPointMeta[], PersistenceError>>
  load(id: string): Promise<Result<RecoveryPoint, PersistenceError>>
  /**
   * Keep the newest `RECOVERY_KEEP_RECENT` points, plus the newest point of each
   * `dayKey` day within `RECOVERY_KEEP_DAYS` days before `now`, and delete the rest.
   * `dayKey` is injected so a test can pin the time zone.
   */
  prune(
    projectId: string,
    clock: { now: string; dayKey: (createdAt: string) => string },
  ): Promise<Result<RemovedResult, PersistenceError>>
}

/** Device-local preferences, keyed by a stable string. */
export interface PrefsRepository {
  get<K extends keyof PrefsMap>(key: K): Promise<Result<PrefsMap[K] | undefined, PersistenceError>>
  set<K extends keyof PrefsMap>(key: K, value: PrefsMap[K]): Promise<Result<void, PersistenceError>>
}

/** App-level records that belong to no Project. */
export interface MetaRepository {
  get<K extends keyof MetaMap>(key: K): Promise<Result<MetaMap[K] | undefined, PersistenceError>>
  set<K extends keyof MetaMap>(key: K, value: MetaMap[K]): Promise<Result<void, PersistenceError>>
}

/** The five ports one adapter offers. */
export interface Ports {
  projects: ProjectRepository
  assets: AssetRepository
  recovery: RecoveryRepository
  prefs: PrefsRepository
  meta: MetaRepository
  /**
   * Every asset hash still referenced by a saved Project or Recovery Point — the input
   * `assets.gc` takes. `collectLiveHashes` in `./liveHashes` builds it by walking the five
   * ports, which an adapter may replace with a cheaper one of its own: the IndexedDB
   * adapter reads the same set off cursors, one record at a time (#46).
   */
  collectLiveHashes?(): Promise<Result<LiveHashes, PersistenceError>>
}
