import { expect, test } from '../support/fixtures'
import {
  type BackupFile,
  canonical,
  card,
  downloadBackupOf,
  libraryHeading,
  restoreFile,
  storedProject,
  previewSeed,
  toast,
} from '../support/libraryApp'
import { FIRST_PROJECT, cabinetCanvas, toolbarStatus } from '../support/previewApp'
import { openPreviewApp } from '../support/previewApp'

/**
 * A browser with no IndexedDB (#51 criterion 14; #20 §11).
 *
 * Private windows in some browsers, and locked-down profiles, refuse `indexedDB.open`. The app
 * keeps working from memory and says so: the notice on the Library, `Save failed` from the first
 * moment, a Backup that still works, and nothing smuggled into `localStorage` as a substitute.
 */

const NOTICE = "Browser storage isn't available. Projects here last only until this tab closes. Download a Backup to keep your work."

test('the Library says storage is missing, Backup still works from memory, and nothing reaches localStorage', async ({
  page,
  browser,
}) => {
  // The Backup the memory-only tab will be given, made in a profile that has storage.
  const source = await browser.newContext()
  let backup: BackupFile
  let original: unknown
  try {
    const sourcePage = await source.newPage()
    await openPreviewApp(sourcePage)
    await sourcePage.goto('./', { waitUntil: 'networkidle' })
    backup = await downloadBackupOf(sourcePage, FIRST_PROJECT)
    original = await storedProject(sourcePage, previewSeed.projects[0].id)
  } finally {
    await source.close()
  }

  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('The user denied permission to access the database.', 'SecurityError')
    }
  })
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()
  await expect(page.locator('.storage-notice')).toHaveText(NOTICE)

  // The Library is empty, so a Project has to come from somewhere: the Backup is restored into
  // memory, and then Backup is taken back out of it.
  await restoreFile(page, backup)
  await expect(toast(page)).toContainText(`Restored ${FIRST_PROJECT} from Backup.`)
  await expect(card(page, FIRST_PROJECT)).toBeVisible()
  const again = await downloadBackupOf(page, FIRST_PROJECT)
  expect(again.name).toBe(`${FIRST_PROJECT}.buildbox`)
  // A `.buildbox` is a zip.
  expect(again.buffer.subarray(0, 2).toString('latin1')).toBe('PK')

  // And that file is a real Backup: it restores, in a profile with storage, to the original.
  const fresh = await browser.newContext()
  try {
    const restored = await fresh.newPage()
    await restored.goto('./', { waitUntil: 'networkidle' })
    await restoreFile(restored, again)
    await expect(toast(restored)).toContainText(`Restored ${FIRST_PROJECT} from Backup.`)
    expect(canonical(await storedProject(restored, previewSeed.projects[0].id))).toBe(canonical(original))
  } finally {
    await fresh.close()
  }

  expect(await page.evaluate(() => localStorage.length)).toBe(0)

  // A new Project starts out failed: there is nowhere for it to be saved.
  await page.getByRole('button', { name: 'New Project', exact: true }).first().click()
  await expect(cabinetCanvas(page)).toBeVisible()
  await expect(toolbarStatus(page)).toContainText('Save failed')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
})
