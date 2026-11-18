import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import {
  card,
  cardProjectId,
  dialogHeading,
  downloadBackupOf,
  libraryHeading,
  openLibrary,
  previewSeed,
  restoreFile,
  storedLibrary,
  storedProject,
  storedRecoveryIds,
  toast,
} from '../support/libraryApp'

/**
 * Restoring a Backup of a Project that already lives here (#50 criterion 18).
 *
 * The collision is the one restore decision a user cannot make by accident: either the work in
 * this browser is overwritten, or a second Project appears. So each of the three answers gets
 * its own test, each in its own browser context — `seedPreviewDb` writes on the database's
 * creation, so a context is the smallest unit that can be handed a clean, identical starting
 * point, and "the stores are unchanged" only means something against a database nothing else
 * has touched.
 *
 * What is asserted is identity, not appearance. Replace keeps the id and adds a Recovery Point;
 * Copy mints a new id and mints new ids for everything inside, because two Projects in one
 * browser sharing a Floor id is a bug that shows up months later as an edit landing in the
 * wrong Project.
 */

const PROJECT = 'Kitchen Wall'

/** Every id a stored Project holds, so two Projects can be shown to share none of them. */
async function projectIds(page: Page, projectId: string): Promise<string[]> {
  const data = (await storedProject(page, projectId)) as {
    id: string
    floors: { id: string }[]
    itemDesigns: { id: string }[]
    existingModel: { placedItems: { id: string }[] }
  } | null
  if (data === null) throw new Error(`no Project ${projectId} is stored`)
  return [
    data.id,
    ...data.floors.map((row) => row.id),
    ...data.itemDesigns.map((row) => row.id),
    ...data.existingModel.placedItems.map((row) => row.id),
  ]
}

test('Cancel leaves the Project exactly as it was', async ({ page }) => {
  await openLibrary(page, previewSeed)
  const backup = await downloadBackupOf(page, PROJECT)
  const before = await storedProject(page, 'proj-kitchen-wall')
  const pointsBefore = await storedRecoveryIds(page)

  await restoreFile(page, backup)
  await expect(dialogHeading(page)).toHaveText('This Project already exists here')
  await page.getByRole('button', { name: 'Cancel—change nothing', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  expect(await storedProject(page, 'proj-kitchen-wall')).toEqual(before)
  expect(await storedRecoveryIds(page)).toEqual(pointsBefore)
  await expect(libraryHeading(page)).toBeVisible()
})

test('Replace keeps the id and saves the previous state as a Recovery Point', async ({ page }) => {
  await openLibrary(page, previewSeed)
  const backup = await downloadBackupOf(page, PROJECT)
  const pointsBefore = await storedRecoveryIds(page)

  await restoreFile(page, backup)
  await page.getByRole('button', { name: /Replace existing Project/ }).click()

  await expect(toast(page)).toContainText(`Backup restored over ${PROJECT}. Previous state saved as Recovery Point.`)
  const pointsAfter = await storedRecoveryIds(page)
  expect(pointsAfter).toHaveLength(pointsBefore.length + 1)
  // The Project is still the one this browser had: same row, same id, one more Point behind it.
  expect(await cardProjectId(page, PROJECT)).toBe('proj-kitchen-wall')
  expect(await storedLibrary(page)).toEqual(expect.arrayContaining([{ id: 'proj-kitchen-wall', trashedAt: null }]))
})

test('Import as a copy makes a second Project that shares no id with the first', async ({ page }) => {
  await openLibrary(page, previewSeed)
  const backup = await downloadBackupOf(page, PROJECT)
  const originalIds = await projectIds(page, 'proj-kitchen-wall')
  const libraryBefore = await storedLibrary(page)

  await restoreFile(page, backup)
  await page.getByRole('button', { name: /Import as a copy/ }).click()

  // The toast is the write landing: `commitRestore` resolves, and only then does the Library
  // re-read. Reading the stores before it would race the transaction — the same read passes a
  // moment later, which is exactly the flake a smoke spec must not carry.
  await expect(toast(page)).toContainText('with new IDs.')
  const rows = await storedLibrary(page)
  expect(rows).toHaveLength(libraryBefore.length + 1)
  const added = rows.find((row) => !libraryBefore.some((was) => was.id === row.id))
  if (added === undefined) throw new Error('no new Library row appeared')
  // The card is found by the id the database gave the copy, not by its name: the copy's name
  // contains the original's, so a text filter cannot tell the two cards apart.
  await expect(page.locator(`article.project-card[data-project="${added.id}"]`)).toBeVisible()

  const copyIds = await projectIds(page, added.id)
  expect(copyIds.filter((id) => originalIds.includes(id))).toEqual([])
  // The Project that was already here is untouched: still listed, still the same record.
  await expect(card(page, PROJECT)).toBeVisible()
})
