import { expect, test } from '../support/fixtures'
import {
  card,
  canonical,
  downloadBackupOf,
  libraryHeading,
  migratedForComparison,
  openLibrary,
  previewSeed,
  restoreFile,
  storedAssetHashes,
  storedRecord,
  toast,
  withoutMintedViewIds,
} from '../support/libraryApp'

/**
 * Backup → Restore across two browser profiles (#50 criterion 17).
 *
 * The claim is the strongest one #20 §13.11 makes about the codec: a Project that leaves this
 * browser as bytes and comes back into an empty one is *the same Project*, canonically — not
 * "renders the same", not "has the same name". So the assertion compares the stored record
 * rather than anything the page drew, and it compares the asset hashes as well, because a
 * Project whose Plan Image came back as a different hash is a Project that lost its drawing
 * while keeping its paperwork.
 *
 * The second context is genuinely empty: no `seedPreviewDb`, no records, nothing. That is what
 * makes the restore take the no-collision path, and it is the only way to show that a Backup
 * carries everything a Project needs rather than leaning on the database it was written from.
 */

const PROJECT = 'Kitchen Wall'

test('a Backup restored into an empty profile is the same Project', async ({ page, browser }) => {
  await openLibrary(page, previewSeed)
  await expect(card(page, PROJECT)).toBeVisible()

  const record = await storedRecord(page, 'proj-kitchen-wall')
  if (record === null) throw new Error('the seed holds no Kitchen Wall record')
  const originalAssets = await storedAssetHashes(page)
  expect(originalAssets).toHaveLength(1)

  const backup = await downloadBackupOf(page, PROJECT)
  expect(backup.name).toBe('Kitchen Wall.buildbox')

  const fresh = await browser.newContext()
  try {
    const restored = await fresh.newPage()
    // The auto fixture guards only the test's own page, so this one needs the same rule or a
    // crash in the second profile would pass unnoticed.
    const problems: string[] = []
    restored.on('pageerror', (error) => problems.push(error.message))

    await restored.goto('./', { waitUntil: 'networkidle' })
    await expect(libraryHeading(restored)).toBeVisible()

    await restoreFile(restored, backup)
    await expect(toast(restored)).toContainText(`Restored ${PROJECT} from Backup.`)
    await expect(restored.locator('article.project-card').filter({ hasText: PROJECT })).toBeVisible()

    // #56: a Backup is written at the domain version the app writes, so a record from before
    // Floors comes back migrated — the same step opening the Project takes. #58 moved that
    // version to 3, where an Item Footprint is a shape rather than a pair of numbers, #64
    // to 4, where a Project carries Walls, Wall Junctions and a default Wall height, and #65
    // to 5, where it carries Openings too.
    // Everything the migration cannot invent is still compared byte for byte; the Plan View ids
    // it mints are compared as a shape, because opening an unmigrated record mints fresh ones
    // every time.
    const restoredRecord = await storedRecord(restored, 'proj-kitchen-wall')
    if (restoredRecord === null) throw new Error('the restore wrote no record')
    expect(restoredRecord.schemaVersion).toBe(5)
    expect(canonical(withoutMintedViewIds(restoredRecord.data)))
      .toBe(canonical(migratedForComparison(record.data, record.schemaVersion)))
    expect(await storedAssetHashes(restored)).toEqual(originalAssets)
    expect(problems).toEqual([])
  } finally {
    await fresh.close()
  }
})
