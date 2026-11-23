import { expect, test } from '../support/fixtures'
import {
  addFloorPlanObject,
  FIRST_PROJECT,
  openProjectFromLibrary,
  showFloorPlan,
  undoButton,
} from '../support/previewApp'
import {
  canonical,
  cardButton,
  dialogHeading,
  libraryHeading,
  migratedForComparison,
  previewSeed,
  storedProject,
  withoutMintedIds,
  storedRecoveryIds,
  toast,
} from '../support/libraryApp'
import { projectRevision, seedPreviewDb } from '../support/seedPreviewDb'

/**
 * Restoring a Recovery Point, and restoring the restore (#51 criterion 13; #14, #26).
 *
 * The Project is edited once so that it differs from its seeded Recovery Points, then the Library
 * restores one of them. What a restore must do is observable from outside in three ways: exactly
 * one new point appears (the `pre-restore` copy of what was replaced), the restored Project is the
 * point's content, and restoring that new point brings the pre-restore content back.
 */

const PROJECT_ID = previewSeed.projects[0].id
const POINTS = 2

const recoveryRows = (page: import('@playwright/test').Page) => page.locator('.recovery-list label')

test('a restore adds exactly one Recovery Point, opens with no Undo, and can itself be restored', async ({ page }) => {
  await seedPreviewDb(page, { ...previewSeed, recovery: [{ projectId: PROJECT_ID, count: POINTS }] })
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, FIRST_PROJECT)
  const seeded = await storedProject(page, PROJECT_ID)

  // Make the Project differ from every point it has.
  await showFloorPlan(page)
  await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect.poll(() => projectRevision(page, PROJECT_ID)).toBe(2)
  const edited = await storedProject(page, PROJECT_ID)
  expect(canonical(edited)).not.toBe(canonical(seeded))

  // A reload lands on the Library with this tab's lock released.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()
  const before = (await storedRecoveryIds(page)).length

  // Restore the newest Recovery Point: the one the dialog preselects.
  await cardButton(page, FIRST_PROJECT, 'Recover').click()
  await expect(dialogHeading(page)).toHaveText(`Return ${FIRST_PROJECT} to an earlier state`)
  await expect(recoveryRows(page)).toHaveCount(before)
  await page.getByRole('button', { name: 'Restore selected point', exact: true }).click()
  await expect(toast(page)).toContainText('Recovery Point restored. Previous state saved as Recovery Point.')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  expect((await storedRecoveryIds(page)).length).toBe(before + 1)
  // The point was written by a v1 build, so restoring it runs the same migration opening the
  // Project does (#57 made this visible: the Plan View a Project now opens on reads `views`).
  // What lands is the seed migrated — the same comparison #56 makes of a restored Backup.
  expect(canonical(withoutMintedIds(await storedProject(page, PROJECT_ID))))
    .toBe(canonical(migratedForComparison(seeded, previewSeed.projects[0]!.schemaVersion)))
  expect(await projectRevision(page, PROJECT_ID)).toBe(3)

  // The history that led up to the restore is gone: opening the Project gives an empty Undo.
  await openProjectFromLibrary(page, FIRST_PROJECT)
  await expect(undoButton(page)).toBeDisabled()
  await page.reload({ waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()

  // The restore is reversible: its own `pre-restore` point holds what it replaced.
  await cardButton(page, FIRST_PROJECT, 'Recover').click()
  await expect(recoveryRows(page)).toHaveCount(before + 1)
  const preRestore = recoveryRows(page).filter({ hasText: 'Before restoring an older version' })
  await expect(preRestore).toHaveCount(1)
  await preRestore.click()
  await page.getByRole('button', { name: 'Restore selected point', exact: true }).click()
  await expect(toast(page)).toContainText('Recovery Point restored. Previous state saved as Recovery Point.')

  expect((await storedRecoveryIds(page)).length).toBe(before + 2)
  expect(canonical(await storedProject(page, PROJECT_ID))).toBe(canonical(edited))
})
