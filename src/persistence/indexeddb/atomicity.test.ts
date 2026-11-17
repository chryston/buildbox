/**
 * A commit that dies halfway (#46 criterion 2): the Project record has landed, the
 * transaction never completes, and the store must show that nothing at all happened.
 *
 * The abort is injected into the shim itself, on the `success` of the `projects` put — the
 * exact moment the adapter holds one of the three records it means to write. Anything less
 * precise, an abort issued before the put had run, would only prove that a transaction which
 * never wrote anything writes nothing.
 */
import 'fake-indexeddb/auto'
import { IDBObjectStore } from 'fake-indexeddb'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FIRST_SAVED_AT,
  PROJECT_ID,
  SECOND_SAVED_AT,
  assetBlob,
  assetHash,
  failure,
  projectFixture,
  seedProject,
  snapshotStores,
  unwrap,
} from '../contract'
import { openFakeAdapter } from './testing'

/** Abort every transaction the moment one of its `projects` puts has landed. */
function abortAfterProjectPut(): () => void {
  const original = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function put(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    const request = original.call(this, value, key)
    if (this.name === 'projects') {
      request.addEventListener('success', () => {
        try {
          this.transaction.abort()
        } catch {
          // The transaction had already finished: there was nothing left to interrupt.
        }
      })
    }
    return request
  }
  return () => {
    IDBObjectStore.prototype.put = original
  }
}

describe('an interrupted commit (#46 criterion 2)', () => {
  let restore: (() => void) | undefined

  afterEach(() => {
    restore?.()
    restore = undefined
  })

  it('resolves {kind:"aborted"} and leaves the last successful snapshot exactly as it was', async () => {
    const ports = await openFakeAdapter()
    const seeded = await seedProject(ports)
    const newHash = await assetHash(7)
    const before = await snapshotStores(ports, { assets: [seeded.planImageHash, seeded.spareHash] })

    restore = abortAfterProjectPut()
    const committed = await ports.projects.commit(
      {
        project: projectFixture(newHash),
        revision: 2,
        savedAt: SECOND_SAVED_AT,
        newAssets: [{ bytes: assetBlob(7), mediaType: 'image/png', widthPx: 32, heightPx: 24 }],
      },
      1,
    )
    restore()

    expect(failure(committed).kind).toBe('aborted')

    // The record that had already landed is gone again, revision and `savedAt` with it.
    const loaded = unwrap(await ports.projects.load(PROJECT_ID))
    expect(loaded.revision).toBe(1)
    expect(loaded.savedAt).toBe(FIRST_SAVED_AT)
    expect(loaded.data).toEqual(seeded.project)

    // So is the Library row the same transaction was about to write.
    expect(unwrap(await ports.projects.list({ includeTrashed: false })).map((record) => [record.id, record.revision, record.savedAt])).toEqual(
      [[PROJECT_ID, 1, FIRST_SAVED_AT]],
    )

    // The asset the aborted commit carried never arrived, and no byte of the store moved.
    expect(unwrap(await ports.assets.has(newHash))).toBe(false)
    expect(await snapshotStores(ports, { assets: [seeded.planImageHash, seeded.spareHash, newHash] })).toBe(before)
  })
})
