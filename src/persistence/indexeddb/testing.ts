/**
 * Test-only helpers for the IndexedDB adapter (#46). Like every `src/<module>/testing.ts`
 * this file is reachable from a `*.test.ts` file and from nowhere else (#42 §7), and it is
 * the only place the test shim is named.
 *
 * `fake-indexeddb/auto` is imported for its globals: `idb` recognises what it wraps with
 * `instanceof IDBRequest`, so the shim has to stand in for the browser's own classes before
 * the first adapter call. Each test still gets its own `IDBFactory`, because a factory is
 * what scopes a database — sharing one would let one case read another's records.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openIndexedDbAdapter, type IndexedDbAdapter } from './open'

/** A database only tests open; the prefix is the one the adapter accepts (#46 criterion 6). */
export const FAKE_DB_NAME = 'buildbox-test'

/** The adapter over a fresh in-memory imitation of IndexedDB. */
export async function openFakeAdapter(
  factory: IDBFactory = new IDBFactory(),
  dbName: `buildbox${string}` = FAKE_DB_NAME,
): Promise<IndexedDbAdapter> {
  const opened = await openIndexedDbAdapter({ dbName, factory })
  if (!opened.ok) throw new Error(`The test database did not open: ${JSON.stringify(opened.error)}`)
  return opened.value
}
