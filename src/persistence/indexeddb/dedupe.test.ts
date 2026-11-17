/**
 * Two Projects, one image (#46 criterion 3): the same bytes offered by two Projects' commits
 * and then re-offered by a third must leave exactly one record in `assets` and one Blob, with
 * both Projects pointing at the same hash.
 *
 * The count is taken over a second connection of the factory's own, because the ports have no
 * "how many records are there" method — and the criterion is about the store, so the test
 * looks at the store.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { wrap } from 'idb'
import { describe, expect, it } from 'vitest'
import { FIRST_SAVED_AT, OTHER_PROJECT_ID, PROJECT_ID, SECOND_SAVED_AT, assetBytes, projectFixture, unwrap } from '../contract'
import { sha256Hex } from '../../lib'
import { openFakeAdapter } from './testing'
import { IDB_VERSION } from './schema'

const DB_NAME = 'buildbox-test-dedupe'
const THIRD_SAVED_AT = '2026-01-03T10:00:00.000Z'

async function countAssets(factory: IDBFactory): Promise<number> {
  const db = await wrap(factory.open(DB_NAME, IDB_VERSION))
  if (db === undefined) throw new Error('The probe connection did not open')
  try {
    return await db.transaction('assets', 'readonly').objectStore('assets').count()
  } finally {
    db.close()
  }
}

describe('assets deduplicated by hash (#46 criterion 3)', () => {
  it('keeps one record and one Blob for bytes two Projects share', async () => {
    const factory = new IDBFactory()
    const ports = await openFakeAdapter(factory, DB_NAME)
    const shared = assetBytes(5)
    const hash = await sha256Hex(shared)

    unwrap(
      await ports.projects.commit(
        {
          project: projectFixture(hash, PROJECT_ID),
          revision: 1,
          savedAt: FIRST_SAVED_AT,
          newAssets: [{ bytes: new Blob([shared]), mediaType: 'image/png', widthPx: 64, heightPx: 48 }],
        },
        null,
      ),
    )
    unwrap(
      await ports.projects.commit(
        {
          project: projectFixture(hash, OTHER_PROJECT_ID),
          revision: 1,
          savedAt: SECOND_SAVED_AT,
          newAssets: [{ bytes: new Blob([shared]), mediaType: 'image/jpeg', widthPx: 10, heightPx: 10 }],
        },
        null,
      ),
    )
    // A third commit re-offering the same bytes stores nothing and changes nothing.
    unwrap(await ports.projects.commit({ project: projectFixture(hash, PROJECT_ID), revision: 2, savedAt: THIRD_SAVED_AT }, 1))

    expect(await countAssets(factory)).toBe(1)

    const asset = unwrap(await ports.assets.get(hash))
    expect(asset.byteLength).toBe(shared.byteLength)
    expect(new Uint8Array(await asset.blob.arrayBuffer())).toEqual(shared)
    // The first write wins: the repeat never rewrote the metadata.
    expect(asset.mediaType).toBe('image/png')
    expect(asset.widthPx).toBe(64)
    expect(asset.storedAt).toBe(FIRST_SAVED_AT)

    // Both Projects point at the one hash.
    expect(unwrap(await ports.projects.load(PROJECT_ID)).data).toEqual(projectFixture(hash, PROJECT_ID))
    expect(unwrap(await ports.projects.load(OTHER_PROJECT_ID)).data).toEqual(projectFixture(hash, OTHER_PROJECT_ID))
  })
})
