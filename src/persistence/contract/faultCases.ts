/**
 * Contract case 9: every write path, under every injectable failure (#45 criterion 3).
 *
 * Each case seeds a store, snapshots everything reachable through the ports as canonical
 * JSON, wraps the adapter in a one-rule fault plan, makes the call, and demands two things:
 * the typed failure came back, and the snapshot is byte-identical afterwards. `abort` is
 * the interesting one — it stands for a write that died after some records had landed, so
 * an adapter that is not atomic fails here rather than in front of a user (#14).
 */
import { describe, expect, it } from 'vitest'
import { FAULT_KINDS, FAULT_METHODS, withFaults, type FaultKind } from '../faults'
import type { PersistenceError } from '../ports'
import { WRITE_CALLS, assetHash, failure, seedProject, snapshotStores, unwrap, type ContractContext } from './support'

/** The port error each fault stands for. */
const ERROR_KIND: Record<FaultKind, PersistenceError['kind']> = {
  abort: 'aborted',
  quota: 'quota',
  serialization: 'serialization',
}

export function registerFaultCases(ctx: ContractContext): void {
  describe('faults', () => {
    for (const method of FAULT_METHODS) {
      for (const fault of FAULT_KINDS) {
        it(`${method} surfaces ${fault} and leaves every store untouched`, async () => {
          const seeded = await seedProject(ctx.ports)
          unwrap(await ctx.ports.meta.set('legacyMigration', { done: false }))
          const call = WRITE_CALLS[method]
          if (call.prepare !== undefined) await call.prepare(ctx.ports, seeded)

          const probe = {
            assets: [seeded.planImageHash, seeded.spareHash, await assetHash(3), await assetHash(4)],
            prefs: ['exportRecipes' as const],
            meta: ['legacyMigration' as const],
          }
          const before = await snapshotStores(ctx.ports, probe)

          const faulty = withFaults(ctx.ports, [{ method, fault }])
          expect(failure(await call.run(faulty, seeded)).kind).toBe(ERROR_KIND[fault])
          expect(await snapshotStores(faulty, probe)).toBe(before)
        })
      }
    }
  })
}
