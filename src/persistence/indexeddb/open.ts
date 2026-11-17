/**
 * Opening the database (#46): the naming rule, the version, the one upgrade, and what the
 * caller gets back — the five ports plus the two things a connection owns.
 *
 * `openDB` from `idb` reads the global `indexedDB`, and the tests hand in their own factory
 * so each one gets a database nobody else can reach; so this opens the request itself and
 * hands it to `wrap`, which is the same promise `openDB` would have returned.
 */
import { wrap, type IDBPDatabase } from 'idb'
import type { PersistenceError, Ports, Result } from '../index'
import { createIndexedDbPorts } from './adapter'
import { describeError } from './errors'
import { createV1Stores, DB_NAME_PREFIX, IDB_VERSION, isBuildboxDbName, type BuildboxSchema } from './schema'

/** The ports, plus the two things only the connection can answer for. */
export interface IndexedDbAdapter extends Ports {
  /** Release the connection, so a later version of the schema can be opened. */
  close(): void
  /**
   * Hear about a version change coming. The connection closes itself either way — holding
   * it would block every other tab forever — so a subscriber is told to stop using the
   * adapter and to reopen, not asked to decide anything (#46 criterion 8).
   */
  onVersionChange(callback: () => void): () => void
}

export interface IndexedDbOptions {
  /** `buildbox` in production, `buildbox-preview` on a preview build, `buildbox-test-…` in tests. */
  dbName: `buildbox${string}`
  /** The factory to open against; `globalThis.indexedDB` when it is not given. */
  factory?: IDBFactory
}

/**
 * Open (and create if needed) the BuildBox database. A browser without IndexedDB, a name
 * outside the prefix, an open that throws and an open another tab will not allow all give
 * `{ kind: 'unavailable' }` — which is the app's cue to run memory-only (#14, #20 §11).
 */
export async function openIndexedDbAdapter({
  dbName,
  factory,
}: IndexedDbOptions): Promise<Result<IndexedDbAdapter, PersistenceError>> {
  // The Pages origin is shared with other repositories, so a name without the prefix is a
  // database this adapter has no business opening — or deleting (#20 §5, #46 criterion 6).
  if (!isBuildboxDbName(dbName)) {
    return {
      ok: false,
      error: {
        kind: 'unavailable',
        reason: `Only a "${DB_NAME_PREFIX}"-prefixed database may be opened, not "${dbName}"`,
      },
    }
  }
  const idb = factory ?? globalThis.indexedDB
  if (idb === undefined) return { ok: false, error: { kind: 'unavailable', reason: 'IndexedDB is not available here' } }

  let request: IDBOpenDBRequest
  try {
    request = idb.open(dbName, IDB_VERSION)
  } catch (error) {
    return { ok: false, error: { kind: 'unavailable', reason: describeError(error) } }
  }

  request.addEventListener('upgradeneeded', (event) => {
    // Only ever creates stores and indexes: a v1 database opened again is left record for
    // record as it was, which is what makes a reopen safe (#46 criterion 8).
    if (event.oldVersion < 1) createV1Stores(wrap(request.result) as IDBPDatabase<BuildboxSchema>)
  })

  const opening = wrap(request) as unknown as Promise<IDBPDatabase<BuildboxSchema>>
  // A connection that turns up after this open gave up belongs to nobody. Close it, or it
  // holds the database against the next version change for as long as the tab lives.
  let abandoned = false
  opening.then((late) => {
    if (abandoned) late.close()
  }, () => undefined)

  // `blocked` means another tab holds an older version and will not let go. Waiting there
  // would hang the first paint, so this gives up: memory-only is the answer (#46 criterion 7).
  const blocked = new Promise<never>((_resolve, reject) => {
    request.addEventListener('blocked', () => reject(new Error(`Opening "${dbName}" was blocked by another tab`)))
  })

  let db: IDBPDatabase<BuildboxSchema>
  try {
    db = await Promise.race([opening, blocked])
  } catch (error) {
    abandoned = true
    return { ok: false, error: { kind: 'unavailable', reason: describeError(error) } }
  }

  const versionListeners = new Set<() => void>()
  db.addEventListener('versionchange', () => {
    for (const listener of [...versionListeners]) listener()
    // Not optional: a connection left open at an old version blocks every other tab.
    db.close()
  })

  return {
    ok: true,
    value: {
      ...createIndexedDbPorts(db),
      close: () => db.close(),
      onVersionChange(callback) {
        versionListeners.add(callback)
        return () => {
          versionListeners.delete(callback)
        }
      },
    },
  }
}
