import type { Page, TestInfo } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { diffAgainstPrototype } from '../support/prototypeCompare'
import { LIBRARY_28, permanentDelete, recoveryPoint, saveFailure } from '../support/prototypes/library28'
import {
  cardButton,
  dialogHeading,
  openLibrary,
  paritySeed,
  parityRecoverySeed,
  reseedAndReload,
} from '../support/libraryApp'
import { addFloorPlanObject, cabinetCanvas, quotaOverride, showFloorPlan } from '../support/previewApp'
import { waitForFonts, waitForStablePaint } from '../support/stability'

/**
 * The three dialogs #51 draws, as numbers against #28 Variant A and as baselines (#51 criteria
 * 6–9; #21's screenshot comparison for the save-failure, Recovery Point and permanent-delete
 * states).
 *
 * The same two jobs as `library.spec.ts`, for the same reason: `diffAgainstPrototype` asks "is
 * this what was approved", `toHaveScreenshot` asks "did it change". The archive renders each
 * state from a scenario button; production has no such button, so every state here is reached the
 * way a person reaches it — a full browser, a click on `Recover`, a trip through Trash.
 *
 * The clock and zone are the Library spec's, and for its reason: the dialogs print `10:42 AM` and
 * `Today, 9:15 AM`, and those are only the archive's words in the zone the fixture was written in.
 * 02:44Z is 10:44 in Singapore, the instant #51 names.
 */

const FIXED_NOW = '2026-10-07T02:44:00.000Z'

test.use({ timezoneId: 'UTC' })

/** The archive's own chrome, hidden on the prototype side only (#50 deviation 1). */
const PROTOTYPE_CHROME = ['.prototype-notice', '.scenario-controls', '.variant-switcher', '.state-toggle', '.state-panel']

const requireFlag = (testInfo: TestInfo): void => {
  test.skip(testInfo.project.name !== 'projects-v2', 'the dialogs exist only behind VITE_FF_PROJECTS_V2')
}

type Load = (page: Page, seed: typeof paritySeed) => Promise<void>

/**
 * Save failed, reached the long way: open the Project last saved at 10:42, make the browser
 * refuse writes, and edit.
 *
 * The refusal is installed on the write itself (`quotaOverride`): the dialog is the app's answer
 * to its own commit failing with `quota`, and that is the only road to it.
 */
async function reachSaveFailed(page: Page, load: Load = openLibrary): Promise<void> {
  await load(page, paritySeed)
  await cardButton(page, 'Tiong Bahru Home', 'Open').click()
  await expect(cabinetCanvas(page)).toBeVisible()
  await showFloorPlan(page)
  await quotaOverride(page, true)
  await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect(dialogHeading(page)).toHaveText('Your latest changes are not stored')
  await page.mouse.move(0, 999)
  await waitForFonts(page)
  await waitForStablePaint(page.locator('.modal'))
}

/** The Recovery Point picker, over the variant of the fixture that has the four points. */
async function reachRecovery(page: Page, load: Load = openLibrary): Promise<void> {
  await load(page, parityRecoverySeed)
  await cardButton(page, 'Tiong Bahru Home', 'Recover').click()
  await expect(dialogHeading(page)).toHaveText('Return Tiong Bahru Home to an earlier state')
  // The default-selection rule (#51 §1): the newest point is the `pre-restore` one, so the
  // preselected row is the one under it — the archive preselects the same row.
  const rows = page.locator('.recovery-list label')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0)).toContainText('Before restoring an older version')
  await expect(page.locator('.recovery-list label.selected')).toContainText('Today, 9:15 AM')
  await expect(page.locator('.recovery-list input:checked')).toHaveCount(1)
  await page.mouse.move(0, 999)
  await waitForFonts(page)
  await waitForStablePaint(page.locator('.modal'))
}

/** Trash, with the fixture's one trashed Project, and the permanent-deletion dialog over it. */
async function reachTrash(page: Page, load: Load = openLibrary): Promise<void> {
  await load(page, paritySeed)
  await page.locator('header').getByRole('button', { name: 'Trash', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Deleted Projects' })).toBeVisible()
  await page.mouse.move(0, 999)
  await waitForFonts(page)
}

async function openPermanentDelete(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).first().click()
  await expect(dialogHeading(page)).toHaveText('Delete this Project permanently?')
  await page.mouse.move(0, 999)
  await waitForFonts(page)
  await waitForStablePaint(page.locator('.modal'))
}

test('Save failed matches #28 Variant A and is baselined', async ({ page }, testInfo) => {
  requireFlag(testInfo)
  await page.clock.setFixedTime(FIXED_NOW)
  await diffAgainstPrototype(page, testInfo, {
    name: 'recovery-28-save-failed',
    prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: saveFailure },
    production: { route: './', prepare: (production) => reachSaveFailed(production, reseedAndReload) },
    clip: '.modal',
    masks: [],
    hideOnPrototype: PROTOTYPE_CHROME,
    maxDiffRatio: 0.01,
  })

  await reachSaveFailed(page)
  // Both sides read the same two facts the clip is blind to: when, and why.
  await expect(page.locator('.modal p strong')).toHaveText('10:42 AM')
  await expect(page.locator('.failure-reason strong')).toHaveText('Browser storage is full')
  const backdrop = page.locator('.modal-backdrop')
  await expect(backdrop).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.733)')
  await expect(backdrop).toHaveCSS('backdrop-filter', 'blur(4px)')
  await expect(page).toHaveScreenshot('save-failed.png')
})

test('the Recovery Point picker matches #28 Variant A and is baselined', async ({ page }, testInfo) => {
  requireFlag(testInfo)
  await page.clock.setFixedTime(FIXED_NOW)
  await diffAgainstPrototype(page, testInfo, {
    name: 'recovery-28-recovery-point',
    prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: recoveryPoint },
    production: { route: './', prepare: (production) => reachRecovery(production, reseedAndReload) },
    clip: '.modal',
    // Deviation 15: the archive's reasons and details are invented ("Before importing plan image"),
    // production's come from the real kinds and the real summaries.
    masks: ['.recovery-list small'],
    hideOnPrototype: PROTOTYPE_CHROME,
    maxDiffRatio: 0.01,
  })

  await reachRecovery(page)
  await expect(page).toHaveScreenshot('recovery-points.png')
})

test('permanent deletion matches #28 Variant A, over its Trash, and is baselined', async ({ page }, testInfo) => {
  requireFlag(testInfo)
  await page.clock.setFixedTime(FIXED_NOW)
  const prepare = async (production: Page): Promise<void> => {
    await reachTrash(production, reseedAndReload)
    await openPermanentDelete(production)
  }
  // The page behind the dialog: the Trash surface, dimmed. The dialog itself is the next
  // comparison's job, so it is masked out of this one.
  await diffAgainstPrototype(page, testInfo, {
    name: 'recovery-28-permanent-delete-page',
    prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: permanentDelete },
    production: { route: './', prepare },
    masks: ['.modal'],
    hideOnPrototype: PROTOTYPE_CHROME,
    maxDiffRatio: 0.01,
  })
  await diffAgainstPrototype(page, testInfo, {
    name: 'recovery-28-permanent-delete',
    prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: permanentDelete },
    production: { route: './', prepare },
    clip: '.modal',
    // Deviation 14: the archive summarised the selected Library Project; production summarises the
    // one being deleted.
    masks: ['.summary-box'],
    hideOnPrototype: PROTOTYPE_CHROME,
    maxDiffRatio: 0.01,
  })

  await reachTrash(page)
  await waitForStablePaint(page.locator('main'))
  await expect(page).toHaveScreenshot('trash.png')
  await openPermanentDelete(page)
  await expect(page).toHaveScreenshot('permanent-delete.png')
})
