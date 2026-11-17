/**
 * Opening, and everything that can stop it (#46 criteria 6, 7, 8): the naming rule, the ways
 * an open gives up, and what a reopen does to records that are already there.
 *
 * `unavailable` is the answer all three failures share, because the app treats them the same
 * way: no store to write to, so the session runs memory-only and says so (#14, #20 §11).
 */
import 'fake-indexeddb/auto'
import { IDBFactory, IDBVersionChangeEvent } from 'fake-indexeddb'
import { wrap } from 'idb'
import { describe, expect, it, vi } from 'vitest'
import { PROJECT_ID, failure, seedProject, snapshotStores, unwrap } from '../contract'
import { openIndexedDbAdapter } from './open'
import { FAKE_DB_NAME, openFakeAdapter } from './testing'
import { IDB_VERSION } from './schema'

describe('the naming rule (#46 criterion 6)', () => {
  it('opens buildbox, buildbox-preview and a test database', async () => {
    const factory = new IDBFactory()
    for (const dbName of ['buildbox', 'buildbox-preview', 'buildbox-test'] as const) {
      const opened = await openIndexedDbAdapter({ dbName, factory })
      expect(opened.ok, dbName).toBe(true)
      if (opened.ok) opened.value.close()
    }
    expect((await factory.databases()).map((database) => database.name).sort()).toEqual(['buildbox', 'buildbox-preview', 'buildbox-test'])
  })

  it('refuses a database that belongs to another project on the same origin', async () => {
    const factory = new IDBFactory()
    // The type already forbids this name; the runtime check is what stands between a typo and
    // someone else's data, so the test goes around the type on purpose (#20 §5).
    const opened = await openIndexedDbAdapter({ dbName: 'chryston-github-io' as unknown as `buildbox${string}`, factory })
    expect(failure(opened).kind).toBe('unavailable')
    expect(failure(opened)).toEqual({ kind: 'unavailable', reason: expect.stringContaining('buildbox') })
    // It did not even create an empty database, let alone read or delete one.
    expect(await factory.databases()).toEqual([])
  })
})

describe('an open that gives up (#46 criterion 7)', () => {
  it('reports unavailable when the browser has no IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const opened = await openIndexedDbAdapter({ dbName: FAKE_DB_NAME })
    vi.unstubAllGlobals()
    expect(failure(opened)).toEqual({ kind: 'unavailable', reason: expect.any(String) })
  })

  it('reports unavailable when opening throws', async () => {
    const hostile = {
      open: (): never => {
        throw new Error('the disk is on fire')
      },
    } as unknown as IDBFactory
    expect(failure(await openIndexedDbAdapter({ dbName: FAKE_DB_NAME, factory: hostile }))).toEqual({
      kind: 'unavailable',
      reason: expect.stringContaining('on fire'),
    })
  })

  it('reports unavailable when another tab will not let the version change through', async () => {
    // A real request, so `idb` still recognises it, told to report `blocked` once the adapter
    // has finished listening. A tab holding an old version is the one failure the app cannot
    // wait out, so this open gives up rather than hang.
    const request = new IDBFactory().open(FAKE_DB_NAME, IDB_VERSION)
    const hostile = {
      open: () => {
        queueMicrotask(() => request.dispatchEvent(new IDBVersionChangeEvent('blocked')))
        return request
      },
    } as unknown as IDBFactory
    expect(failure(await openIndexedDbAdapter({ dbName: FAKE_DB_NAME, factory: hostile }))).toEqual({
      kind: 'unavailable',
      reason: expect.stringContaining('blocked'),
    })
  })
})

describe('reopening an existing database (#46 criterion 8)', () => {
  const DB_NAME = 'buildbox-test-reopen'

  it('leaves every record exactly as it was', async () => {
    const factory = new IDBFactory()
    const first = await openFakeAdapter(factory, DB_NAME)
    const seeded = await seedProject(first)
    const probe = { assets: [seeded.planImageHash, seeded.spareHash] }
    const before = await snapshotStores(first, probe)
    first.close()

    const again = await openFakeAdapter(factory, DB_NAME)
    expect(await snapshotStores(again, probe)).toBe(before)
    expect(unwrap(await again.projects.load(PROJECT_ID)).revision).toBe(1)
    again.close()

    // Still version 1: a reopen created nothing, rewrote nothing and migrated nothing.
    const raw = await wrap(factory.open(DB_NAME))
    expect(raw?.version).toBe(IDB_VERSION)
    raw?.close()
  })

  it('closes and tells its subscribers when another version is coming', async () => {
    const factory = new IDBFactory()
    const adapter = await openFakeAdapter(factory, 'buildbox-test-versionchange')
    const notices: string[] = []
    adapter.onVersionChange(() => {
      notices.push('versionchange')
    })
    await seedProject(adapter)

    // Another tab asking for a higher version is exactly what an upgrade looks like from here.
    const upgrading = factory.open('buildbox-test-versionchange', IDB_VERSION + 1)
    const upgraded = await wrap(upgrading)
    expect(notices).toEqual(['versionchange'])
    expect(upgraded?.version).toBe(IDB_VERSION + 1)
    upgraded?.close()

    // The connection is gone, and every port says so as a result rather than an exception.
    expect(failure(await adapter.projects.list({ includeTrashed: false })).kind).toBe('unavailable')
    expect(failure(await adapter.assets.get('anything')).kind).toBe('unavailable')
  })

  it('reports unavailable once the connection has been closed', async () => {
    const adapter = await openFakeAdapter()
    adapter.close()
    expect(failure(await adapter.projects.list({ includeTrashed: false })).kind).toBe('unavailable')
  })
})
