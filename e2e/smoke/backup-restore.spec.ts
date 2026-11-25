import { readFileSync } from 'node:fs'
import { expect, test } from '../support/fixtures'
import { roomsFixtureProject } from '../../src/package/testing'
import type { Project } from '../../src/domain'
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
  withoutMintedIds,
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
    // to 4, where a Project carries Walls, Wall Junctions and a default Wall height, #65
    // to 5, where it carries Openings too, and #69/#71 to 8, where it carries Design Options
    // and Drawing Layers — which is also the first step that mints layer ids, so those are set
    // aside beside the Plan View ids.
    // Everything the migration cannot invent is still compared byte for byte.
    const restoredRecord = await storedRecord(restored, 'proj-kitchen-wall')
    if (restoredRecord === null) throw new Error('the restore wrote no record')
    expect(restoredRecord.schemaVersion).toBe(15)
    expect(canonical(withoutMintedIds(restoredRecord.data)))
      .toBe(canonical(migratedForComparison(record.data, record.schemaVersion)))
    expect(await storedAssetHashes(restored)).toEqual(originalAssets)
    expect(problems).toEqual([])
  } finally {
    await fresh.close()
  }
})

/**
 * The strict importer and a v7 Backup that carries Rooms (#67 criterion 12, in the browser).
 *
 * `src/package/fixtures.test.ts` proves the golden file stages against the strict validator in
 * Node. What only a browser answers is that the app's own import path — picker, staging, the
 * write to IndexedDB — takes those same bytes and stores that same Project, Rooms and all:
 * nothing along the way drops `existingModel.rooms` or rewrites an Edge reference.
 *
 * The profile is empty on purpose. A restore into a Library that already held the Project would
 * take the collision path, and the claim here is the plain one: v7 bytes in, the same Project out
 * — at the version this build writes, with the eighth step's layers added and nothing else moved.
 */
const ROOMS_FIXTURE = new URL('../../fixtures/package/v7/rooms.buildbox', import.meta.url)
const ROOMS_PROJECT = 'Maple Street Kitchen'

test('a v7 Backup carrying Rooms is stored as the Project it holds', async ({ browser }) => {
  const fresh = await browser.newContext()
  try {
    const page = await fresh.newPage()
    const problems: string[] = []
    page.on('pageerror', (error) => problems.push(error.message))
    await page.goto('./', { waitUntil: 'networkidle' })
    await expect(libraryHeading(page)).toBeVisible()

    await restoreFile(page, { name: `${ROOMS_PROJECT}.buildbox`, buffer: readFileSync(ROOMS_FIXTURE) })
    await expect(toast(page)).toContainText(`Restored ${ROOMS_PROJECT} from Backup.`)

    const record = await storedRecord(page, 'project-0')
    if (record === null) throw new Error('the restore wrote no record')
    // v7 is one step behind this build, so every step since ran on the way in: what is stored is the
    // Project at this build's schema, carrying the three starting Drawing Layers. Everything #67
    // added is compared below, with only the ids that step minted set aside.
    expect(record.schemaVersion).toBe(15)
    expect(canonical(withoutMintedIds(record.data))).toBe(canonical(migratedForComparison(roomsFixtureProject(), 7)))

    // The Rooms themselves, because they are what #67 added and what a careless importer loses:
    // a preset Rectangle and a Custom Path, each holding one Edge to a face of the same Wall.
    // The stored payload is the Project the importer wrote.
    const stored = JSON.parse(canonical(record.data)) as Project
    expect(stored.existingModel.rooms.map((room) => room.name)).toEqual(['Living', 'Study'])
    expect(stored.existingModel.rooms.map((room) => room.outline.kind)).toEqual(['preset', 'path'])
    expect(stored.existingModel.rooms.map((room) => room.wallFaceRefs)).toEqual([
      [{ segmentId: 'edge-living-3', wallId: 'wall-1', side: 'left' }],
      [{ segmentId: 'edge-study-1', wallId: 'wall-1', side: 'right' }],
    ])
    expect(problems).toEqual([])
  } finally {
    await fresh.close()
  }
})
