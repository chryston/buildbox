import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffAgainstPrototype } from '../support/prototypeCompare'
import { LIBRARY_28, migrationReview } from '../support/prototypes/library28'
import { previewSeed } from '../support/libraryApp'
import { seedLegacyStore } from '../support/legacyStore'
import { reseedPreviewDb, seedPreviewDb } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

/**
 * The Migration review as a baseline, and as a number against the prototype (#52 criterion 7).
 *
 * The same two jobs #50 established for the Library: `diffAgainstPrototype` asks whether the
 * approved design was built, `toHaveScreenshot` asks whether this commit changed anything. The
 * state is the one the issue names — the review opened on `fixtures/legacy/migration-review`,
 * before the reader has chosen a destination — because that is the screen where the whole
 * decision is visible at once: three rows, the floor-plan panel, the empty select, and the
 * disabled button that refuses to move without one.
 *
 * The clock is frozen and the zone pinned for the reason #50 gave: the cards behind the review
 * print relative times, and the archive prints fixed strings.
 */

const FIXED_NOW = '2026-10-07T02:44:00.000Z'

test.use({ timezoneId: 'UTC' })

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/legacy')
const REVIEW = readFileSync(join(fixturesRoot, 'migration-review/buildbox-store.json'), 'utf8')

const REVIEW_HEADING = 'Review where your existing work belongs'

/** The archive's chrome, hidden on the prototype side only (deviation (d)). */
const PROTOTYPE_CHROME = ['.prototype-notice', '.scenario-controls', '.variant-switcher', '.state-toggle', '.state-panel']

/* No masks: the archive's plan preview is a hatched box with the dimensions inside it, and
   production draws the same hatching rather than the fixture's PNG, because #28 approved the
   hatching. There is nothing on this screen the two sides cannot be asked to share. */

/** Old data in `localStorage` and a seeded store, so the review opens by itself. */
async function seed(page: Page): Promise<void> {
  await seedPreviewDb(page, previewSeed)
  await seedLegacyStore(page, REVIEW)
}

/**
 * Put the review on screen, on whatever page the comparison helper handed over.
 *
 * `captureProduction` renders on a fresh page of the same context, and `addInitScript` belongs to
 * a page rather than to a context — so the seed is registered here, on the page that will carry
 * it, and the reload is what makes it run. The database needs `reseedAndReload` for the reason
 * that helper documents: by the time a preparer is called the database already exists, and
 * seeding an existing one writes nothing.
 */
async function openReview(page: Page): Promise<void> {
  await seedLegacyStore(page, REVIEW)
  await reseedPreviewDb(page, previewSeed)
  // The nav tab is the route the issue names, and the review is already open — clicking it is
  // how the archive reaches the same view, and it costs nothing here.
  await expect(page.getByRole('heading', { level: 1, name: REVIEW_HEADING })).toBeVisible()
  await page.mouse.move(0, 999)
  await waitForFonts(page)
  await waitForStablePaint(page.locator('.migration-review'))
}

test('the Migration review matches #28 and is baselined', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await seed(page)

  await diffAgainstPrototype(page, testInfo, {
    name: 'migration-review-found',
    prototype: { kind: 'static-archive', ...LIBRARY_28, prepare: migrationReview },
    production: { route: './', prepare: openReview },
    masks: [],
    hideOnPrototype: PROTOTYPE_CHROME,
    // 0.03 rather than the 0.02 #50 settled on, for three differences that are not the design:
    // the app's own header carries live text the prototype's does not; the archive's one Migration
    // view is its step 2, so its stepper marks `Found` done where production marks it active; and
    // the lede counts the designs in digits, because the number is read from the data and #28's
    // word `three` could not be. Layout, colour, type, radii, borders, select, buttons and the
    // stepper's own geometry all line up — see the deviation note in the commit body.
    maxDiffRatio: 0.03,
  })

  await page.goto('./', { waitUntil: 'networkidle' })
  await openReview(page)

  // The three things criterion 3 says this screen must show, asserted rather than photographed:
  // no destination chosen, no way forward, and the sentence that says why.
  await expect(page.getByLabel('Attach it to')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Continue to review' })).toBeDisabled()
  await expect(page.getByText('we will not guess')).toBeVisible()
  await expect(page.locator('.migration-item')).toHaveCount(3)

  await expect(page).toHaveScreenshot('migration-review-found.png')
})
