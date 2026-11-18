import type { Page, TestInfo } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { diffAgainstPrototype } from '../support/prototypeCompare'
import { LIBRARY_28, importCollision, library } from '../support/prototypes/library28'
import {
  card,
  dialogHeading,
  downloadBackupOf,
  openLibrary,
  paritySeed,
  reseedAndReload,
  restoreFile,
} from '../support/libraryApp'
import { waitForFonts, waitForStablePaint } from '../support/stability'

/**
 * The Project Library as a baseline, and as a number against the prototype it came from
 * (#50 criteria 23–25).
 *
 * Two different jobs, deliberately in one file. `diffAgainstPrototype` answers "did we build
 * what was approved" — it compares against the published archive at 8787ba4 and tolerates the
 * masks the two sides cannot share. `toHaveScreenshot` answers "did this change" — it compares
 * against the last commit and tolerates nothing. A baseline that was never compared to the
 * prototype would freeze a mistake, and a prototype comparison is not a regression net, so
 * neither one is enough alone.
 *
 * The clock is frozen at the instant the fixture's timestamps were written for, and the
 * timezone is pinned to UTC rather than the suite's `Asia/Singapore`: the cards print relative
 * times, and "Yesterday, 8:42 PM" is only yesterday in one zone. The archive renders its own
 * fixed strings, so this is the only way the two sides can be showing the same sentence.
 */

const FIXED_NOW = '2026-10-07T02:44:00.000Z'

// The suite's `Asia/Singapore` is right for the legacy baselines and wrong here: the cards
// render relative times, and the fixture's timestamps were written so that one zone prints
// "Yesterday, 8:42 PM" while the other prints "Today, 4:42 AM". The archive prints a fixed
// string, so the zone is the difference between a match and a 100 % diff.
test.use({ timezoneId: 'UTC' })

/**
 * The archive's chrome, hidden on the prototype side only.
 *
 * Deviation 1 of the named list: production ships none of it, and everything below sits 26 px
 * higher as a result. Hiding it is what makes the comparison about the Library rather than about
 * a strip of review UI that will never exist outside a prototype.
 */
const PROTOTYPE_CHROME = ['.prototype-notice', '.scenario-controls', '.variant-switcher', '.state-toggle', '.state-panel']

/**
 * What both sides paint differently for reasons of their own.
 *
 * The plan preview: the archive draws a schematic, production draws the real outline or the real
 * image, and #28 approved the card's shape rather than its thumbnail. The Design Option count:
 * deviation 9 makes production print 0 where the archive printed a made-up number, because
 * Design Options do not ship until #69.
 */
const LIBRARY_MASKS = ['.plan-preview > svg, .plan-preview > img', '[data-stat="design-options"]']

/**
 * The Library exists only in a flag-on build, so the flag-free artifact has nothing to capture.
 * Skipping is honest; a baseline of the legacy app filed under this name would be a lie.
 */
const requireFlag = (testInfo: TestInfo): void => {
  test.skip(testInfo.project.name !== 'projects-v2', 'the Project Library exists only behind VITE_FF_PROJECTS_V2')
}

test('the Library matches #28 Variant A and is baselined', async ({ page }, testInfo) => {
  requireFlag(testInfo)
  await page.clock.setFixedTime(FIXED_NOW)
  await diffAgainstPrototype(page, testInfo, {
    name: 'library-28-library',
    prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: library },
    production: {
      route: './',
      prepare: async (production) => {
        // The comparison helper navigates before it calls a preparer, so the database already
        // exists by the time this runs and seeding it would be a no-op.
        await reseedAndReload(production, paritySeed)
        // The card the archive's screenshot has selected, and the pointer parked off every
        // card so no hover state is caught mid-paint on either side.
        await card(production, 'Tiong Bahru Home').click()
        await production.mouse.move(0, 999)
        await waitForFonts(production)
        await waitForStablePaint(production.locator('main.page'))
      },
    },
    masks: LIBRARY_MASKS,
    hideOnPrototype: PROTOTYPE_CHROME,
    maxDiffRatio: 0.01,
  })

  await openLibrary(page, paritySeed)
  await card(page, 'Tiong Bahru Home').click()
  await page.mouse.move(0, 999)
  await waitForFonts(page)
  await waitForStablePaint(page.locator('main.page'))
  await expect(page).toHaveScreenshot('library-default.png')
})

test('the import collision matches #28 Variant A and is baselined', async ({ page }, testInfo) => {
  requireFlag(testInfo)
  await page.clock.setFixedTime(FIXED_NOW)
  await diffAgainstPrototype(page, testInfo, {
    name: 'library-28-import-collision',
    prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: importCollision },
    production: { route: './', prepare: (production) => openCollision(production, reseedAndReload) },
    clip: '.modal',
    masks: LIBRARY_MASKS,
    hideOnPrototype: PROTOTYPE_CHROME,
    maxDiffRatio: 0.01,
  })

  await openCollision(page)
  await expect(dialogHeading(page)).toHaveText('This Project already exists here')
  // The archive dims the Library behind the dialog with a translucent wash and a blur, and the
  // clip hides that from the pixel comparison — so the two properties are asserted directly,
  // or the dialog could be floating over a fully legible page and nothing would notice.
  const backdrop = page.locator('.modal-backdrop')
  await expect(backdrop).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.733)')
  await expect(backdrop).toHaveCSS('backdrop-filter', 'blur(4px)')
  await expect(page).toHaveScreenshot('library-import-collision.png')
})

/**
 * The collision, reached the way a user reaches it: download a Backup, then restore it over the
 * Project it came from.
 *
 * There is no scenario button to press — deviation 1 removed the prototype's controls from
 * production, so the state has to be caused rather than declared. Restoring a Project's own
 * Backup onto itself is the shortest real cause, and it is the one the smoke spec proves.
 */
async function openCollision(page: Page, load: (page: Page, seed: typeof paritySeed) => Promise<void> = openLibrary): Promise<void> {
  await load(page, paritySeed)
  const backup = await downloadBackupOf(page, 'Tiong Bahru Home')
  await restoreFile(page, backup)
  await expect(dialogHeading(page)).toBeVisible()
  await waitForFonts(page)
}
