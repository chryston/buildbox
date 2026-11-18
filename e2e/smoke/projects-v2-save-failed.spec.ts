import { expect } from '@playwright/test'
import { test } from '../support/fixtures'
import {
  addFloorPlanObject,
  FIRST_PROJECT,
  openPreviewApp,
  openProjectTab,
  placedObject,
  quotaOverride,
  showFloorPlan,
  toolbarStatus,
} from '../support/previewApp'
import {
  cardButton,
  canonical,
  dialogHeading,
  libraryHeading,
  previewSeed,
  readDownload,
  restoreFile,
  storedLibrary,
  storedProject,
  toast,
} from '../support/libraryApp'
import { projectRevision } from '../support/seedPreviewDb'

/**
 * The Save failed dialog under a full quota (#51 criterion 10).
 *
 * The quota is forced from underneath the app, on the IndexedDB write itself (`quotaOverride`),
 * rather than by writing the browser full: the failure has to land on the app's own commit, which
 * is the only place `quota` becomes a `Save failed` with three ways out.
 *
 * The dialog is the subject, so most of these tests are about what does *not* happen while it is
 * up. Note that it has no Cancel, no Escape and no backdrop close: the only ways out are the
 * three actions, which is why "the dialog reopens" is observed here as "the dialog is still up,
 * and so is the Project".
 */

const PROJECT_ID = previewSeed.projects[0].id
/** The other seeded Project, whose tab is the navigation the guard has to refuse. */
const OTHER = 'Bathroom Vanity'

test('a full browser stops the save and says what is kept', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await quotaOverride(page, true)

  await addFloorPlanObject(page, 'Sofa 2-seater')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCount(1)
  await expect(dialogHeading(page)).toHaveText('Your latest changes are not stored')
  await expect(dialog.locator('.failure-reason strong')).toHaveText('Browser storage is full')
  await expect(dialog.getByText('Current unsaved changes are still held in memory.')).toBeVisible()
  // The last successful save is named to the minute. The clock time is the browser's own zone,
  // so the shape is asserted rather than the digits.
  await expect(dialog.locator('p strong')).toHaveText(/\d{1,2}:\d{2} [AP]M/)
  await expect(dialog.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Download emergency backup', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Discard unsaved changes', exact: true })).toBeVisible()
  await expect(toolbarStatus(page)).toContainText('Save failed')
})

test('nothing in the app takes the person away from the failed save', async ({ page, context }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const stored = await storedProject(page, PROJECT_ID)
  await quotaOverride(page, true)
  const sofa = await addFloorPlanObject(page, 'Sofa 2-seater')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Leaving for the Project Library. The modal backdrop covers the editor's chrome, so the
  // click is dispatched on the control itself — which is the case the guard exists for: the
  // person means it, `close()` refuses (#14), and the dialog stays with the work behind it.
  await page.getByTestId('return-to-projects').dispatchEvent('click')
  await expect(dialog).toBeVisible()
  await expect(placedObject(page, sofa)).toBeVisible()

  // The Project name. The workspace header draws it as plain text, not a link — the
  // brand left the screen with the legacy page (#55) — so there is nowhere for the
  // click to go; it changes nothing about the Project or the dialog.
  await page.locator('.bb-workspace-project-name').dispatchEvent('click')
  await expect(dialog).toBeVisible()
  await expect(placedObject(page, sofa)).toBeVisible()

  // Escape and the backdrop are inert on this dialog.
  await page.keyboard.press('Escape')
  await page.mouse.click(8, 8)
  await expect(dialog).toBeVisible()

  // And the Project cannot be deleted from the Library while this tab is holding it. The one
  // route back to the Library is refused by the guard above, so the Library is opened in a
  // second page of the same profile, which is where the same rule bites: the Delete is refused
  // and the row stays put.
  const library = await context.newPage()
  await library.goto('./', { waitUntil: 'networkidle' })
  await expect(libraryHeading(library)).toBeVisible()
  await cardButton(library, FIRST_PROJECT, 'Delete').click()
  await expect(toast(library)).toContainText(`${FIRST_PROJECT} is open in another tab. Close it there first.`)
  const rows = await storedLibrary(library)
  expect(rows.find((row) => row.id === PROJECT_ID)?.trashedAt).toBeNull()

  // This tab is untouched by any of it: same dialog, same held work, nothing stored.
  await expect(dialog).toBeVisible()
  await expect(placedObject(page, sofa)).toBeVisible()
  expect(canonical(await storedProject(page, PROJECT_ID))).toBe(canonical(stored))
})

test('a reload asks before throwing the work away', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const stored = await storedProject(page, PROJECT_ID)
  await quotaOverride(page, true)
  const sofa = await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect(page.getByRole('dialog')).toBeVisible()

  // The reload is asked for from inside the page, on a timer, so that the call returns before the
  // browser's prompt does: `page.reload()` would wait on a navigation the dismissal cancels.
  const prompted = page.waitForEvent('dialog')
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0)
  })
  const native = await prompted
  expect(native.type()).toBe('beforeunload')
  await native.dismiss()

  // Dismissing the browser's prompt keeps the document, the dialog and the unsaved sofa.
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(placedObject(page, sofa)).toBeVisible()
  expect(canonical(await storedProject(page, PROJECT_ID))).toBe(canonical(stored))
})

test('Retry save stores the held state and lets the person move on', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const revisionBefore = await projectRevision(page, PROJECT_ID)
  await quotaOverride(page, true)
  const sofa = await addFloorPlanObject(page, 'Sofa 2-seater')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Retry with the quota still full: the failure stands and the dialog stays.
  await dialog.getByRole('button', { name: 'Retry save', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(toolbarStatus(page)).toContainText('Save failed')

  await quotaOverride(page, false)
  await dialog.getByRole('button', { name: 'Retry save', exact: true }).click()

  await expect(dialog).toHaveCount(0)
  await expect(toolbarStatus(page)).toContainText('Saved locally')
  await expect.poll(() => projectRevision(page, PROJECT_ID)).toBe(revisionBefore + 1)

  // Switching works now: the other Project opens, and this Project's sofa is not in it.
  await openProjectTab(page, OTHER)
  await expect(placedObject(page, sofa)).toHaveCount(0)
})

test('the emergency backup holds exactly the state the tab could not store', async ({ page, browser }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await quotaOverride(page, true)
  await addFloorPlanObject(page, 'Sofa 2-seater')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download emergency backup', exact: true }).click()
  const backup = await readDownload(await pending)
  expect(backup.name).toBe(`${FIRST_PROJECT}.buildbox`)

  // The oracle for "the in-memory state" is the app's own write: once the quota is back, the
  // retry stores the very object the dialog was holding.
  await quotaOverride(page, false)
  await dialog.getByRole('button', { name: 'Retry save', exact: true }).click()
  await expect(toolbarStatus(page)).toContainText('Saved locally')
  const held = await storedProject(page, PROJECT_ID)
  expect(held).not.toBeNull()

  // And the file restores, in a profile that has never seen this Project, to that same state.
  const fresh = await browser.newContext()
  try {
    const restored = await fresh.newPage()
    const problems: string[] = []
    restored.on('pageerror', (error) => problems.push(error.message))

    await restored.goto('./', { waitUntil: 'networkidle' })
    await restoreFile(restored, backup)
    await expect(toast(restored)).toContainText(`Restored ${FIRST_PROJECT} from Backup.`)
    expect(canonical(await storedProject(restored, PROJECT_ID))).toBe(canonical(held))
    expect(problems).toEqual([])
  } finally {
    await fresh.close()
  }
})

test('Discard unsaved changes returns to the stored state', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const stored = await storedProject(page, PROJECT_ID)
  await quotaOverride(page, true)
  const sofa = await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect(page.getByRole('dialog')).toBeVisible()

  await page.getByRole('dialog').getByRole('button', { name: 'Discard unsaved changes', exact: true }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(placedObject(page, sofa)).toHaveCount(0)
  await expect(toolbarStatus(page)).toContainText('Saved locally')
  // Back to the stored state, which is the state it was in before the edit: same revision, same
  // document. The unsaved work is gone and nothing was written in its place.
  expect(canonical(await storedProject(page, PROJECT_ID))).toBe(canonical(stored))
})

test('the red status is the way back to the dialog', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await quotaOverride(page, true)
  await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect(page.getByRole('dialog')).toBeVisible()

  // The words in the toolbar are a button, because the dialog is the answer to them. The dialog
  // cannot be dismissed, so this is the affordance for a failure the person has already read:
  // the status stays red for as long as the work is unstored, and clicking it says so again.
  const status = toolbarStatus(page).getByRole('button', { name: 'Save failed', exact: true })
  await expect(status).toBeVisible()
  await status.dispatchEvent('click')
  await expect(page.getByRole('dialog')).toBeVisible()
})
