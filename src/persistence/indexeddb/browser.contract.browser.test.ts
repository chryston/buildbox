/**
 * The contract suite of #45 against a real IndexedDB, in Chromium (#46 criterion 1).
 *
 * `fake-indexeddb` is a good imitation and still an imitation: quota, the structured clone of
 * a Blob, and the way an index treats a missing key are its own. This is the run that says the
 * adapter works — and the reason #45 made the suite a function of an adapter rather than a
 * pile of fixtures written over the in-memory one.
 *
 * The Pages origin is shared by every browser test file, so each database this file opens gets
 * its own number: no case inherits another's records, and none can block another's upgrade.
 */
import { describePersistenceContract } from '../contract'
import { withFaults } from '../index'
import { openIndexedDbAdapter } from './open'

let opened = 0

async function openBrowserAdapter() {
  const dbName: `buildbox${string}` = `buildbox-test-contract-${++opened}`
  const adapter = await openIndexedDbAdapter({ dbName })
  if (!adapter.ok) throw new Error(`The browser database did not open: ${JSON.stringify(adapter.error)}`)
  return adapter.value
}

describePersistenceContract('indexeddb/browser', openBrowserAdapter, { faults: true })

describePersistenceContract('indexeddb/browser+faults', async () => withFaults(await openBrowserAdapter(), []), { faults: true })
