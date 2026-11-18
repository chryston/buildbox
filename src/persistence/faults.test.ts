/**
 * The fault decorator on its own (#45 criterion 3): the 9 write methods × 3 faults matrix
 * against the in-memory adapter, plus the rules the matrix cannot show on its own — that a
 * faulted call never reaches the wrapped adapter, that `nth` counts calls, that each rule
 * fires once, and that reads and unmatched writes are untouched.
 */
import { describe, expect, it } from 'vitest'
import { FAULT_METHODS, createMemoryAdapter, withFaults, type Ports } from './index'
import {
  MIGRATION_META,
  PROJECT_ID,
  SECOND_SAVED_AT,
  WRITE_CALLS,
  assetHash,
  failure,
  projectFixture,
  recoveryPointFixture,
  seedProject,
  snapshotStores,
  unwrap,
} from './contract'

const ERROR_KIND = { abort: 'aborted', quota: 'quota', serialization: 'serialization' } as const

/** What every snapshot reads: both seeded assets, the ones a faulted write would add, and both key-value stores. */
async function probeFor(planImageHash: string, spareHash: string) {
  return {
    assets: [planImageHash, spareHash, await assetHash(3), await assetHash(4)],
    prefs: ['exportRecipes' as const],
    meta: ['legacyMigration' as const],
  }
}

describe('withFaults (#45 criterion 3)', () => {
  for (const method of FAULT_METHODS) {
    for (const fault of ['abort', 'quota', 'serialization'] as const) {
      it(`${method} under ${fault} returns the typed failure and leaves prior state byte-identical`, async () => {
        const ports = createMemoryAdapter()
        const seeded = await seedProject(ports)
        unwrap(await ports.meta.set('legacyMigration', MIGRATION_META))
        const call = WRITE_CALLS[method]
        if (call.prepare !== undefined) await call.prepare(ports, seeded)
        const probe = await probeFor(seeded.planImageHash, seeded.spareHash)
        const before = await snapshotStores(ports, probe)

        const faulty = withFaults(ports, [{ method, fault }])
        const result = await call.run(faulty, seeded)

        expect(failure(result)).toEqual(
          fault === 'serialization' ? { kind: 'serialization', path: '$.data' } : { kind: ERROR_KIND[fault] },
        )
        expect(await snapshotStores(faulty, probe)).toBe(before)
      })
    }
  }

  it('never reaches the wrapped adapter', async () => {
    const reached: string[] = []
    const faulty = withFaults(writesThrow(reached), [
      ...FAULT_METHODS.map((method) => ({ method, fault: 'quota' as const })),
      // `set` names both key-value stores, so the plan needs a rule for each call.
      { method: 'set', nth: 2, fault: 'quota' as const },
    ])

    await faulty.projects.commit({ project: projectFixture(null), revision: 1, savedAt: SECOND_SAVED_AT }, null)
    await faulty.assets.put(new Blob([new Uint8Array([1])]), 'image/png', { widthPx: 1, heightPx: 1 }, SECOND_SAVED_AT)
    await faulty.recovery.create(
      recoveryPointFixture({ id: 'point-1', projectId: PROJECT_ID, createdAt: SECOND_SAVED_AT }),
    )
    await faulty.projects.trash(PROJECT_ID, SECOND_SAVED_AT)
    await faulty.projects.restore(PROJECT_ID)
    await faulty.projects.purge(PROJECT_ID)
    await faulty.projects.markBackupInitiated(PROJECT_ID, { at: SECOND_SAVED_AT, revision: 1 })
    await faulty.prefs.set('exportRecipes', [])
    await faulty.meta.set('legacyMigration', MIGRATION_META)

    expect(reached).toEqual([])
  })

  it('fails the nth call of a method and only that one', async () => {
    const ports = createMemoryAdapter()
    const seeded = await seedProject(ports)
    const faulty = withFaults(ports, [{ method: 'commit', nth: 2, fault: 'quota' }])

    expect((await faulty.projects.commit({ project: seeded.project, revision: 2, savedAt: SECOND_SAVED_AT }, 1)).ok).toBe(true)
    expect(
      failure(await faulty.projects.commit({ project: seeded.project, revision: 3, savedAt: SECOND_SAVED_AT }, 2)).kind,
    ).toBe('quota')
    expect((await faulty.projects.commit({ project: seeded.project, revision: 3, savedAt: SECOND_SAVED_AT }, 2)).ok).toBe(true)
    expect(unwrap(await ports.projects.load(PROJECT_ID)).revision).toBe(3)
  })

  it('fires each rule once, at its own nth call', async () => {
    const ports = createMemoryAdapter()
    const seeded = await seedProject(ports)
    const faulty = withFaults(ports, [
      { method: 'trash', fault: 'abort' },
      { method: 'trash', nth: 2, fault: 'quota' },
    ])

    expect(failure(await faulty.projects.trash(seeded.project.id, SECOND_SAVED_AT)).kind).toBe('aborted')
    expect(failure(await faulty.projects.trash(seeded.project.id, SECOND_SAVED_AT)).kind).toBe('quota')
    // Both rules have fired: the plan is spent and the adapter is back in charge.
    expect(unwrap(await faulty.projects.trash(seeded.project.id, SECOND_SAVED_AT)).trashedAt).toBe(SECOND_SAVED_AT)
  })

  it('leaves reads and unmatched writes alone', async () => {
    const ports = createMemoryAdapter()
    const seeded = await seedProject(ports)
    const faulty = withFaults(ports, [{ method: 'purge', fault: 'quota' }])

    expect(unwrap(await faulty.projects.load(PROJECT_ID)).revision).toBe(1)
    expect(unwrap(await faulty.projects.list({ includeTrashed: true }))).toHaveLength(1)
    expect(unwrap(await faulty.assets.has(seeded.planImageHash))).toBe(true)
    expect(unwrap(await faulty.assets.get(seeded.spareHash)).byteLength).toBe(32)
    expect(unwrap(await faulty.recovery.list(PROJECT_ID))).toEqual([])
    expect((await faulty.projects.commit({ project: seeded.project, revision: 2, savedAt: SECOND_SAVED_AT }, 1)).ok).toBe(true)
    // A rule matches a method, not its arguments: the first purge faults whatever it names.
    expect(failure(await faulty.projects.purge('nothing-here')).kind).toBe('quota')
    expect(failure(await faulty.projects.purge('nothing-here')).kind).toBe('not-found')
    expect(unwrap(await faulty.projects.load(PROJECT_ID)).revision).toBe(2)
  })

  it('counts prefs.set and meta.set as the one method a plan names', async () => {
    const ports = createMemoryAdapter()
    await seedProject(ports)
    const faulty = withFaults(ports, [
      { method: 'set', fault: 'abort' },
      { method: 'set', nth: 2, fault: 'quota' },
    ])

    expect(failure(await faulty.prefs.set('exportRecipes', [])).kind).toBe('aborted')
    expect(failure(await faulty.meta.set('legacyMigration', MIGRATION_META)).kind).toBe('quota')
    expect((await faulty.prefs.set('exportRecipes', [{ name: 'Cut list' }])).ok).toBe(true)
    expect(unwrap(await ports.prefs.get('exportRecipes'))).toEqual([{ name: 'Cut list' }])
    expect(await ports.meta.get('legacyMigration')).toEqual({ ok: true, value: undefined })
  })

  it('keeps a faulted multi-record commit atomic', async () => {
    const ports = createMemoryAdapter()
    const seeded = await seedProject(ports)
    const probe = await probeFor(seeded.planImageHash, seeded.spareHash)
    const before = await snapshotStores(ports, probe)
    const faulty = withFaults(ports, [{ method: 'commit', fault: 'abort' }])

    expect(failure(await WRITE_CALLS.commit.run(faulty, seeded)).kind).toBe('aborted')
    // Half a commit is not a state: an abort part-way through stays invisible through the ports.
    expect(await snapshotStores(faulty, probe)).toBe(before)
  })
})

/** An adapter whose every method records that it was reached, and then throws. */
function writesThrow(reached: string[]): Ports {
  const trip = (name: string): never => {
    reached.push(name)
    throw new Error(`${name} reached the wrapped adapter`)
  }
  return {
    projects: {
      list: () => trip('projects.list'),
      load: () => trip('projects.load'),
      commit: () => trip('commit'),
      commitMany: () => trip('commitMany'),
      markBackupInitiated: () => trip('markBackupInitiated'),
      trash: () => trip('trash'),
      restore: () => trip('restore'),
      purge: () => trip('purge'),
    },
    assets: {
      put: () => trip('put'),
      get: () => trip('assets.get'),
      has: () => trip('assets.has'),
      gc: () => trip('assets.gc'),
    },
    recovery: {
      create: () => trip('create'),
      list: () => trip('recovery.list'),
      load: () => trip('recovery.load'),
      prune: () => trip('recovery.prune'),
    },
    prefs: { get: () => trip('prefs.get'), set: () => trip('prefs.set') },
    meta: { get: () => trip('meta.get'), set: () => trip('meta.set') },
  }
}
