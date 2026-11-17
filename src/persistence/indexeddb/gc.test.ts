/**
 * Garbage collection (#46 criterion 4): what counts as live, and what a sweep is allowed to
 * forget. The rule is #20 §7 — an asset goes when nothing references it *and* it is older
 * than `ASSET_GC_GRACE_MS`, because an upload that is still in flight is not garbage yet.
 *
 * `collectLiveHashes` is asked twice over: through the adapter's own cursor walk, and
 * through the generic walk in `persistence`, which can only see the five ports. The two must
 * agree, or the browser would be sweeping by a different rule than the tests checked.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  FIRST_SAVED_AT,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  SECOND_SAVED_AT,
  assetBlob,
  projectFixture,
  recoveryPointFixture,
  seedProject,
  unwrap,
} from '../contract'
import { collectLiveHashes } from '../index'
import { openFakeAdapter } from './testing'

describe('assets.gc (#46 criterion 4)', () => {
  it('keeps what a trashed Project or a Recovery Point still references', async () => {
    const ports = await openFakeAdapter()
    const seeded = await seedProject(ports)

    // An asset referenced by nothing but a Recovery Point, whose Project was never saved.
    const pointHash = unwrap(await ports.assets.put(assetBlob(3), 'image/png', { widthPx: 4, heightPx: 4 }, FIRST_SAVED_AT))
    unwrap(
      await ports.recovery.create(
        recoveryPointFixture({
          id: 'point-1',
          projectId: OTHER_PROJECT_ID,
          createdAt: SECOND_SAVED_AT,
          project: projectFixture(pointHash, OTHER_PROJECT_ID),
        }),
      ),
    )
    // Trash is reversible, so a trashed Project holds its Plan Image exactly as a live one does.
    unwrap(await ports.projects.trash(PROJECT_ID, SECOND_SAVED_AT))

    const live = unwrap(await collectLiveHashes(ports))
    const removed = unwrap(await ports.assets.gc(live, SECOND_SAVED_AT))

    expect(removed.deleted).toEqual([seeded.spareHash])
    expect(unwrap(await ports.assets.has(seeded.planImageHash))).toBe(true)
    expect(unwrap(await ports.assets.has(pointHash))).toBe(true)
    expect(unwrap(await ports.assets.has(seeded.spareHash))).toBe(false)
  })

  it('deletes at exactly the grace period, and not one minute before it', async () => {
    const ports = await openFakeAdapter()
    const seeded = await seedProject(ports)
    const live = unwrap(await collectLiveHashes(ports))

    // The spare asset was stored at `FIRST_SAVED_AT`; 23h59m later it is still inside the grace.
    expect(unwrap(await ports.assets.gc(live, '2026-01-02T09:59:00.000Z')).deleted).toEqual([])
    expect(unwrap(await ports.assets.has(seeded.spareHash))).toBe(true)

    // `SECOND_SAVED_AT` is `FIRST_SAVED_AT` plus exactly `ASSET_GC_GRACE_MS`.
    expect(unwrap(await ports.assets.gc(live, SECOND_SAVED_AT)).deleted).toEqual([seeded.spareHash])
  })

  it("frees a purged Project's image, which purge itself never touches", async () => {
    const ports = await openFakeAdapter()
    const seeded = await seedProject(ports)
    unwrap(await ports.projects.purge(PROJECT_ID))

    const removed = unwrap(await ports.assets.gc(unwrap(await collectLiveHashes(ports)), SECOND_SAVED_AT))
    // Both were stored at the same instant, so the sweep reports them by hash, oldest key first.
    expect(removed.deleted).toEqual([seeded.planImageHash, seeded.spareHash].sort())
  })

  it('collects the same live hashes from its own cursors as the generic walk does', async () => {
    const ports = await openFakeAdapter()
    const seeded = await seedProject(ports)
    const pointHash = unwrap(await ports.assets.put(assetBlob(3), 'image/png', { widthPx: 4, heightPx: 4 }, FIRST_SAVED_AT))
    unwrap(
      await ports.recovery.create(
        recoveryPointFixture({
          id: 'point-1',
          projectId: PROJECT_ID,
          createdAt: SECOND_SAVED_AT,
          project: projectFixture(pointHash),
        }),
      ),
    )
    unwrap(await ports.projects.trash(PROJECT_ID, SECOND_SAVED_AT))

    expect(ports.collectLiveHashes).toBeTypeOf('function')
    const streamed = unwrap(await collectLiveHashes(ports))
    // The generic walk, with the adapter's own implementation taken away.
    const generic = unwrap(await collectLiveHashes({ ...ports, collectLiveHashes: undefined }))

    expect([...streamed].sort()).toEqual([...generic].sort())
    expect([...streamed].sort()).toEqual([seeded.planImageHash, pointHash].sort())
  })
})
