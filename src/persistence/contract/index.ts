/**
 * The one persistence contract suite (#45, #20 §9.2): `describePersistenceContract` takes
 * a name, a way to make a fresh adapter, and it registers the cases every adapter must
 * pass.
 *
 * It is the second entry point of `persistence` and a test-only one: `eslint.config.js`
 * rejects any import of it from a non-test file, because it pulls in Vitest and describes
 * behaviour rather than shipping any. #46 runs this same file against `fake-indexeddb`,
 * against the fault decorator and against real IndexedDB in a browser, unchanged — which is
 * why the cases below describe only what the ports promise and never how a store does it.
 *
 * ```ts
 * describePersistenceContract('memory', createMemoryAdapter, { faults: true })
 * ```
 */
import { beforeEach, describe } from 'vitest'
import type { Ports } from '../ports'
import { registerContractCases } from './cases'
import { registerFaultCases } from './faultCases'
import type { ContractContext } from './support'

export interface ContractOptions {
  /** Register case 9, the 8 methods × 3 faults matrix. Off by default. */
  faults?: boolean
}

/**
 * Register the suite. `makeAdapter` runs before every case, so each one starts from an
 * empty store; it may be synchronous, as the in-memory adapter is.
 */
export function describePersistenceContract(
  name: string,
  makeAdapter: () => Ports | Promise<Ports>,
  options: ContractOptions = {},
): void {
  describe(name, () => {
    let ports: Ports
    beforeEach(async () => {
      ports = await makeAdapter()
    })

    const ctx: ContractContext = {
      get ports() {
        return ports
      },
    }

    registerContractCases(ctx)
    if (options.faults === true) registerFaultCases(ctx)
  })
}

// The fixtures and assertions the suite is built from, re-exported for an adapter's own
// tests (#46's atomicity and GC cases), which need the same view of a store.
export {
  FIRST_SAVED_AT,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  SECOND_SAVED_AT,
  WRITE_CALLS,
  assetBlob,
  assetBytes,
  assetHash,
  dayKeyUtc,
  failure,
  projectFixture,
  recoveryPointFixture,
  seedProject,
  snapshotStores,
  unwrap,
  type ContractContext,
  type Seeded,
  type StoreProbe,
  type WriteCall,
} from './support'
