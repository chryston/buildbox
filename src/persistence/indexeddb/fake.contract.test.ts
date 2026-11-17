/**
 * The one contract suite of #45, run against the IndexedDB adapter in Node (#46 criterion 1).
 *
 * `fake-indexeddb` is a good imitation and still an imitation, so this is the fast half of
 * the answer: it runs on every commit and on every platform. The other half is
 * `browser.contract.test.ts`, which runs the same cases against a real store.
 *
 * The suite is registered twice on purpose — once against the adapter, once against the
 * adapter behind `withFaults` with an empty plan. The decorator must not change behaviour
 * when it has nothing to inject, and the second registration is what proves it over a real
 * transaction rather than over the in-memory store.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describePersistenceContract } from '../contract'
import { withFaults } from '../index'
import { openFakeAdapter } from './testing'

describePersistenceContract('indexeddb/fake', () => openFakeAdapter(new IDBFactory()), { faults: true })

describePersistenceContract('indexeddb/fake+faults', async () => withFaults(await openFakeAdapter(new IDBFactory()), []), {
  faults: true,
})
