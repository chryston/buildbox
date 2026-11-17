/**
 * The IndexedDB adapter (#46): the ports of #45 over the store layout of #20 §5, and the
 * only code in `persistence` that names a storage technology.
 *
 * Three rules shape everything below.
 *
 * - **One transaction is one unit of work.** A commit writes assets, the Project record and
 *   the derived Library record inside a single `readwrite` transaction, and resolves only
 *   once that transaction has reached `done` — so a quota or an interrupted write leaves the
 *   last successful snapshot exactly as it was (#14, #46 criterion 2).
 * - **No waiting on anything but IndexedDB inside a transaction.** A transaction commits
 *   itself the moment the event loop goes idle, so hashing and `blob.arrayBuffer()` happen
 *   before one is opened, never during.
 * - **Results, never exceptions.** Every `DOMException` is translated by `./errors`; a
 *   non-`DOMException` is a programmer bug and stays thrown.
 */
import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb'
import { DOMAIN_SCHEMA_VERSION, referencedAssetHashes, summarizeProject } from '../../domain'
import { canonicalJsonBytes, sha256Hex } from '../../lib'
import {
  ASSET_GC_GRACE_MS,
  RECOVERY_KEEP_DAYS,
  RECOVERY_KEEP_RECENT,
  type AssetDims,
  type CommitInput,
  type LibraryRecord,
  type MetaMap,
  type PersistenceError,
  type Ports,
  type PrefsMap,
  type ProjectRecord,
  type RecoveryPoint,
  type RecoveryPointMeta,
  type Result,
  // The ports are `persistence`'s published contract, so the adapter reads them through the
  // module's entry point like any other importer would (#20 §1, §2).
} from '../index'
import { mapIndexedDbError, mapWriteError } from './errors'
import { frozen } from './frozen'
import type { AssetEntry, BuildboxSchema } from './schema'

type Database = IDBPDatabase<BuildboxSchema>
type StoreName = StoreNames<BuildboxSchema>
type WriteTx<Stores extends StoreName[]> = IDBPTransaction<BuildboxSchema, Stores, 'readwrite'>
type ReadTx<Stores extends StoreName[]> = IDBPTransaction<BuildboxSchema, Stores, 'readonly'>

const DAY_MS = 24 * 60 * 60 * 1000

const ok = <T>(value: T): Result<T, PersistenceError> => ({ ok: true, value })
const fail = (error: PersistenceError): Result<never, PersistenceError> => ({ ok: false, error })

/** Newest `timeOf` first, `idOf` breaking a tie: the same order the in-memory adapter gives. */
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

/** The metadata half of a Recovery Point: `list` never carries Project data. */
function metaOf(point: RecoveryPoint): RecoveryPointMeta {
  return frozen({
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
 * `run` inside one `readwrite` transaction, resolved only when that transaction is done.
 *
 * A refused write aborts the transaction rather than leaving whatever it had already put
 * behind; a write that reached the end still has to survive `done`, because that is where a
 * quota usually surfaces — on the abort, with `tx.error` naming it, not on the request.
 */
async function write<T, Stores extends StoreName[]>(
  db: Database,
  stores: Stores,
  run: (tx: WriteTx<Stores>) => Promise<Result<T, PersistenceError>>,
): Promise<Result<T, PersistenceError>> {
  // Even opening the transaction is inside the `try`: on a connection another version has
  // closed, `db.transaction` throws, and that is `unavailable` rather than an exception.
  let tx: WriteTx<Stores> | undefined
  try {
    tx = db.transaction(stores, 'readwrite')
    // Every path below settles the transaction, so an abort is never an unhandled rejection.
    const settled = tx.done.catch((error: unknown) => error)
    const result = await run(tx)
    if (!result.ok) {
      abort(tx)
      await settled
      return result
    }
    const error = await settled
    return error === undefined ? result : fail(mapIndexedDbError(error))
  } catch (error) {
    if (tx !== undefined) abort(tx)
    return fail(mapWriteError(error, tx?.error))
  }
}

/** `run` inside one `readonly` transaction. Nothing to abort, everything to translate. */
async function read<T, Stores extends StoreName[]>(
  db: Database,
  stores: Stores,
  run: (tx: ReadTx<Stores>) => Promise<Result<T, PersistenceError>>,
): Promise<Result<T, PersistenceError>> {
  try {
    const tx = db.transaction(stores, 'readonly')
    const settled = tx.done.catch((error: unknown) => error)
    const result = await run(tx)
    const error = await settled
    return error === undefined ? result : fail(mapIndexedDbError(error))
  } catch (error) {
    return fail(mapIndexedDbError(error))
  }
}

function abort(tx: { abort(): void }): void {
  try {
    tx.abort()
  } catch {
    // Already finished: there is nothing left to undo.
  }
}

/** The stored form of one asset, whether it arrives through `put` or through a commit. */
function assetEntry(sha256: string, bytes: Blob, mediaType: string, dims: AssetDims, storedAt: string): AssetEntry {
  return {
    sha256,
    mediaType,
    byteLength: bytes.size,
    widthPx: dims.widthPx,
    heightPx: dims.heightPx,
    storedAt,
    blob: bytes,
  }
}

/**
 * The five ports over an open connection. `close` and `onVersionChange` belong to the
 * connection, not to the ports, so `./open` adds them around this.
 */
export function createIndexedDbPorts(db: Database): Ports {
  return {
    projects: {
      async list({ includeTrashed }) {
        return read(db, ['library'], async (tx) => {
          const records = await tx.objectStore('library').getAll()
          const visible = includeTrashed ? records : records.filter((record) => record.trashedAt === null)
          return ok(visible.map(frozen).sort(bySavedAt))
        })
      },

      async load(id) {
        return read(db, ['projects'], async (tx) => {
          const record = await tx.objectStore('projects').get(id)
          return record === undefined ? fail({ kind: 'not-found', id }) : ok(frozen(record))
        })
      },

      async commit(input: CommitInput, expectedRevision) {
        // The store's copy and the record this call returns both have to outlive the object
        // the caller handed over: it is the caller's to mutate the moment `commit` resolves
        // (#45 case 8), and the deep freeze on the way out would freeze it in place.
        const project = structuredClone(input.project)
        // Hash first: an IndexedDB transaction commits itself when the event loop goes
        // idle, so no `arrayBuffer()` and no digest may happen inside one (#46 notes).
        const entries: AssetEntry[] = []
        for (const asset of input.newAssets ?? []) {
          const sha256 = await sha256Hex(await asset.bytes.arrayBuffer())
          entries.push(assetEntry(sha256, asset.bytes, asset.mediaType, asset, input.savedAt))
        }

        return write(db, ['projects', 'library', 'assets'], async (tx) => {
          const projects = tx.objectStore('projects')
          const stored = await projects.get(project.id)
          const actual = stored?.revision ?? null
          // A stale expected revision and a revision that does not increase are the same
          // refusal: the caller's view of the store is not the store's (#45).
          if (actual !== expectedRevision || !(input.revision > (expectedRevision ?? 0))) {
            return fail({ kind: 'revision-conflict', expected: expectedRevision, actual })
          }

          const assets = tx.objectStore('assets')
          const byteLengths = new Map<string, number>()
          for (const entry of entries) {
            // Deduplicated by hash against the store and against the rest of this commit:
            // the first write wins, so a repeat keeps the original `storedAt`.
            if ((await assets.count(entry.sha256)) === 0) await assets.put(entry)
            byteLengths.set(entry.sha256, entry.byteLength)
          }

          const record: ProjectRecord = {
            id: project.id,
            revision: input.revision,
            schemaVersion: DOMAIN_SCHEMA_VERSION,
            savedAt: input.savedAt,
            data: project,
          }
          await projects.put(record)

          // `sizeBytes` is read inside the transaction, off the asset records this commit
          // wrote and the ones the store already had.
          let sizeBytes = canonicalJsonBytes(project).byteLength
          for (const hash of referencedAssetHashes(project)) {
            const byteLength = byteLengths.get(hash) ?? (await assets.get(hash))?.byteLength
            if (byteLength !== undefined) sizeBytes += byteLength
          }

          const library = tx.objectStore('library')
          const previous = await library.get(project.id)
          const summary: LibraryRecord = {
            id: record.id,
            name: project.meta.name,
            address: project.meta.address ?? null,
            revision: record.revision,
            savedAt: record.savedAt,
            schemaVersion: DOMAIN_SCHEMA_VERSION,
            sizeBytes,
            // A commit derives the row; it never invents a backup or a trash flag (#45).
            lastBackupInitiatedAt: previous?.lastBackupInitiatedAt ?? null,
            lastBackupRevision: previous?.lastBackupRevision ?? null,
            trashedAt: previous?.trashedAt ?? null,
            summary: summarizeProject(project),
          }
          await library.put(summary)
          return ok(frozen(record))
        })
      },

      async markBackupInitiated(id, { at, revision }) {
        return updateLibrary(db, id, (previous) => ({
          ...previous,
          lastBackupInitiatedAt: at,
          lastBackupRevision: revision,
        }))
      },

      async trash(id, at) {
        return updateLibrary(db, id, (previous) => ({ ...previous, trashedAt: at }))
      },

      async restore(id) {
        return updateLibrary(db, id, (previous) => ({ ...previous, trashedAt: null }))
      },

      async purge(id) {
        return write(db, ['projects', 'library', 'recoveryPoints'], async (tx) => {
          const [project, libraryRecord] = await Promise.all([
            tx.objectStore('projects').get(id),
            tx.objectStore('library').get(id),
          ])
          if (project === undefined && libraryRecord === undefined) return fail({ kind: 'not-found', id })
          await tx.objectStore('projects').delete(id)
          await tx.objectStore('library').delete(id)
          // Every Recovery Point of this Project goes with it, through the `projectId`
          // index, so no other Project's history is even read.
          const points = tx.objectStore('recoveryPoints').index('projectId')
          for await (const cursor of points.iterate(IDBKeyRange.only(id))) {
            await cursor.delete()
          }
          return ok(undefined)
        })
      },
    },

    assets: {
      async put(bytes, mediaType, dims, storedAt) {
        const sha256 = await sha256Hex(await bytes.arrayBuffer())
        const entry = assetEntry(sha256, bytes, mediaType, dims, storedAt)
        return write(db, ['assets'], async (tx) => {
          const assets = tx.objectStore('assets')
          // Content-addressed and idempotent: the key is the hash, so a repeat of identical
          // bytes stores nothing and keeps the original `storedAt`.
          if ((await assets.count(sha256)) === 0) await assets.put(entry)
          return ok(sha256)
        })
      },

      async get(sha256) {
        return read(db, ['assets'], async (tx) => {
          const asset = await tx.objectStore('assets').get(sha256)
          return asset === undefined ? fail({ kind: 'not-found', id: sha256 }) : ok(frozen(asset))
        })
      },

      async has(sha256) {
        return read(db, ['assets'], async (tx) => ok((await tx.objectStore('assets').count(sha256)) > 0))
      },

      async gc(liveHashes, now) {
        const nowMs = Date.parse(now)
        return write(db, ['assets'], async (tx) => {
          const deleted: string[] = []
          // The `storedAt` index walks oldest asset first, which is the order `deleted`
          // reports, and an asset inside the grace period is left for the next sweep.
          for await (const cursor of tx.objectStore('assets').index('storedAt').iterate()) {
            const { sha256, storedAt } = cursor.value
            if (liveHashes.has(sha256)) continue
            if (nowMs - Date.parse(storedAt) < ASSET_GC_GRACE_MS) continue
            await cursor.delete()
            deleted.push(sha256)
          }
          return ok({ deleted })
        })
      },
    },
    recovery: {
      async create(point) {
        return write(db, ['recoveryPoints'], async (tx) => {
          await tx.objectStore('recoveryPoints').put(point)
          return ok(point.id)
        })
      },

      async list(projectId) {
        return read(db, ['recoveryPoints'], async (tx) => {
          const points = await tx.objectStore('recoveryPoints').index('projectId').getAll(IDBKeyRange.only(projectId))
          return ok(points.map(metaOf).sort(byCreatedAt))
        })
      },

      async load(id) {
        return read(db, ['recoveryPoints'], async (tx) => {
          const point = await tx.objectStore('recoveryPoints').get(id)
          return point === undefined ? fail({ kind: 'not-found', id }) : ok(frozen(point))
        })
      },

      async prune(projectId, { now, dayKey }) {
        return write(db, ['recoveryPoints'], async (tx) => {
          const points = tx.objectStore('recoveryPoints')
          // The composite index answers "this Project's points, newest first" and the walk
          // takes only the two keys off each cursor: no Project data is read at all, which
          // is the whole reason `prune` is a store operation and not a list-then-filter.
          // `[projectId]` sorts below every key that starts with it and `[projectId, []]`
          // above, because an array sorts above a string.
          const range = IDBKeyRange.bound([projectId], [projectId, []], false, true)
          const seen: { id: string; createdAt: string }[] = []
          for await (const cursor of points.index('projectCreatedAt').iterate(range, 'prev')) {
            seen.push({ id: cursor.primaryKey, createdAt: cursor.key[1] })
          }

          // The same rule the in-memory adapter applies: the newest 20, plus the newest
          // point of every day still inside the 30-day window.
          seen.sort(newestFirst((point) => point.createdAt, (point) => point.id))
          const keep = new Set(seen.slice(0, RECOVERY_KEEP_RECENT).map((point) => point.id))
          const cutoff = Date.parse(now) - RECOVERY_KEEP_DAYS * DAY_MS
          const newestOfDay = new Set<string>()
          for (const point of seen) {
            if (Date.parse(point.createdAt) < cutoff) continue
            const day = dayKey(point.createdAt)
            if (newestOfDay.has(day)) continue
            newestOfDay.add(day)
            keep.add(point.id)
          }

          const removed = seen.filter((point) => !keep.has(point.id)).map((point) => point.id)
          for (const id of removed) await points.delete(id)
          return ok({ deleted: removed.reverse() })
        })
      },
    },

    prefs: {
      async get(key) {
        return read(db, ['prefs'], async (tx) =>
          ok((await tx.objectStore('prefs').get(String(key)))?.value as PrefsMap[typeof key] | undefined),
        )
      },
      async set(key, value) {
        return write(db, ['prefs'], async (tx) => {
          await tx.objectStore('prefs').put({ key: String(key), value })
          return ok(undefined)
        })
      },
    },

    meta: {
      async get(key) {
        return read(db, ['meta'], async (tx) =>
          ok((await tx.objectStore('meta').get(key))?.value as MetaMap[typeof key] | undefined),
        )
      },
      async set(key, value) {
        return write(db, ['meta'], async (tx) => {
          await tx.objectStore('meta').put({ key, value })
          return ok(undefined)
        })
      },
    },

    // The streaming half of #46: the same set `collectLiveHashes` in `../liveHashes` builds
    // by walking the ports, from cursors instead, one record in memory at a time.
    async collectLiveHashes() {
      return read(db, ['projects', 'recoveryPoints'], async (tx) => {
        const hashes = new Set<string>()
        for await (const cursor of tx.objectStore('projects').iterate()) {
          for (const hash of referencedAssetHashes(cursor.value.data)) hashes.add(hash)
        }
        // A Recovery Point keeps its assets alive even after the Project is gone for good.
        for await (const cursor of tx.objectStore('recoveryPoints').iterate()) {
          for (const hash of referencedAssetHashes(cursor.value.data)) hashes.add(hash)
        }
        return ok(hashes)
      })
    },
  }
}

/** Replace one Library record with `change` of it, in a transaction that touches nothing else. */
function updateLibrary(
  db: Database,
  id: string,
  change: (previous: LibraryRecord) => LibraryRecord,
): Promise<Result<LibraryRecord, PersistenceError>> {
  return write(db, ['library'], async (tx) => {
    const library = tx.objectStore('library')
    const previous = await library.get(id)
    if (previous === undefined) return fail({ kind: 'not-found', id })
    const record = change(previous)
    await library.put(record)
    return ok(frozen(record))
  })
}
