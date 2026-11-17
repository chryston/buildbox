/**
 * The database layout (#46, #20 §5): the schema version, the six stores, the one naming
 * rule, and the `onupgradeneeded` that only ever creates.
 *
 * `onupgradeneeded` never transforms data. A v1 database opened again is left exactly as it
 * was, which is what makes a reopen safe (#46 criterion 8); migrating an old record is the
 * job of load time, and while `DOMAIN_SCHEMA_VERSION` is 1 there is nothing older to load.
 *
 * The database name carries the `buildbox` prefix because the Pages origin is shared with
 * other repositories (#20 §5): this adapter must never touch a database it did not name.
 */
import type { DBSchema, IDBPDatabase } from 'idb'
import type { LibraryRecord, ProjectRecord, RecoveryPoint, StoredAsset } from '../index'

/** The schema version of the BuildBox database (#20 §12). */
export const IDB_VERSION = 1

/** Every BuildBox database name starts with this: `buildbox`, `buildbox-preview`, tests (#20 §5, §11). */
export const DB_NAME_PREFIX = 'buildbox'

/** One stored asset: its metadata and its bytes in one record, so a read is one request. */
export type AssetEntry = StoredAsset

/** `prefs` and `meta` are both a keyed bag of plain JSON values. */
export interface KeyedEntry {
  key: string
  value: unknown
}

/** The `idb` view of the store table in #46: keys, values and indexes per store. */
export interface BuildboxSchema extends DBSchema {
  projects: { key: string; value: ProjectRecord }
  library: {
    key: string
    value: LibraryRecord
    indexes: { savedAt: string; trashedAt: string }
  }
  assets: { key: string; value: AssetEntry; indexes: { storedAt: string } }
  recoveryPoints: {
    key: string
    value: RecoveryPoint
    indexes: { projectId: string; projectCreatedAt: [string, string] }
  }
  meta: { key: string; value: KeyedEntry }
  prefs: { key: string; value: KeyedEntry }
}

/**
 * True when `name` is a database this adapter may open. Anything else belongs to another
 * project on the same origin (#46 criterion 6).
 */
export function isBuildboxDbName(name: string): boolean {
  return name.startsWith(DB_NAME_PREFIX)
}

/**
 * Create the v1 stores and indexes. Nothing here reads, rewrites or deletes a record: an
 * upgrade only ever adds the shape (#20 §5).
 */
export function createV1Stores(db: IDBPDatabase<BuildboxSchema>): void {
  db.createObjectStore('projects', { keyPath: 'id' })

  const library = db.createObjectStore('library', { keyPath: 'id' })
  library.createIndex('savedAt', 'savedAt')
  // Trash is a flag on the Library record, not a store of its own (#46).
  library.createIndex('trashedAt', 'trashedAt')

  const assets = db.createObjectStore('assets', { keyPath: 'sha256' })
  // The GC grace period is read off this index, oldest asset first.
  assets.createIndex('storedAt', 'storedAt')

  const recovery = db.createObjectStore('recoveryPoints', { keyPath: 'id' })
  recovery.createIndex('projectId', 'projectId')
  // `prune` walks one Project's points newest first without loading any of their data.
  recovery.createIndex('projectCreatedAt', ['projectId', 'createdAt'])

  db.createObjectStore('meta', { keyPath: 'key' })
  db.createObjectStore('prefs', { keyPath: 'key' })
}
