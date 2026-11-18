import { expect, test } from '../support/fixtures'
import { sha256Hex } from '../../src/lib'
import { previewSeed, storedAssetHashes } from '../support/libraryApp'
import { seedPreviewDb, type PreviewSeedAsset } from '../support/seedPreviewDb'

/**
 * Garbage collection of an unreferenced Plan Image (#50 criterion 27).
 *
 * The claim is about a *load*, not about a button: BuildBox has no Delete-forever in this issue,
 * so the only moment an image can be dropped is when the app starts and works out which hashes
 * the Projects still name. That makes the observable the store rather than the screen — nothing
 * in the Library changes when an orphan goes away, which is exactly the point.
 *
 * The orphan is a second, well-formed asset record that no Floor points at, stored long enough
 * ago to be past the grace window a collection has to have: an image written moments ago can
 * belong to a Project whose save is still in flight, and collecting it would lose a user's
 * drawing. The referenced image is the fixture's own, and it surviving is half the test — a
 * collector that deleted everything would satisfy "the orphan is gone".
 */

/** A one-pixel PNG, small enough to inline and real enough to be a Plan Image. */
const ORPHAN_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
])

const ORPHAN_HASH = await sha256Hex(ORPHAN_BYTES)

const orphan: PreviewSeedAsset = {
  sha256: ORPHAN_HASH,
  mediaType: 'image/png',
  byteLength: ORPHAN_BYTES.byteLength,
  widthPx: 1,
  heightPx: 1,
  // Years old, so the grace window that protects an image still being saved cannot be what
  // keeps this one alive.
  storedAt: '2020-01-01T00:00:00.000Z',
  base64: Buffer.from(ORPHAN_BYTES).toString('base64'),
}

test('a Plan Image no Project references is gone after the next load', async ({ page }) => {
  const referenced = previewSeed.assets[0]!.sha256
  await seedPreviewDb(page, { ...previewSeed, assets: [...previewSeed.assets, orphan] })
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Pick up where you left off' })).toBeVisible()

  await expect.poll(() => storedAssetHashes(page), { message: 'the orphan was not collected' }).toEqual([referenced])
})
