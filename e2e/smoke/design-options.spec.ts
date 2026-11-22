/**
 * Design Options in the browser (#69 criteria 13, 14, 15).
 *
 * Three things are only visible in a real browser, and all three are the point of the feature:
 *
 *   - that the Project settings list creates `Option A`, `Option B`, `Option C` in order, renames
 *     inline, and refuses a name another Option already answers to — in the field, in the words the
 *     write itself uses, without writing anything (criteria 14, 15);
 *   - that moving a surveyed Placed Item into an Option is reviewed as the correction of the
 *     Existing Model it is, and that a build with no correction open refuses it with the sentence
 *     that says why, leaving the Plan View alone (#69 §12–§13 — the trigger that opens a correction
 *     is #70, so this is as far as the browser can go here, and the write itself is driven through
 *     a correction in `src/integration/moveToOptionFlow.renovation.test.tsx`);
 *   - that deleting an Option is reviewed before it happens, that Cancel changes nothing, and that
 *     the delete itself leaves the Existing Model alone and can be undone (criterion 15).
 *
 * The scene arrives in the seed (`scripts/make-renovation-36-seed.ts`): Walls W-1…W-6, a Kitchen
 * and a Bedroom, ten Placed Items, and two Options standing empty. This spec runs only against a
 * `VITE_FF_RENOVATION` build — `npm run test:e2e:renovation` — because no other build carries the
 * section at all, and a flag-off build refuses the v8 seed the scene is stored in.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary, placedObject, undoButton } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const renovationSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as PreviewSeed
const projectName = renovationSeed.library.find((record) => record.id === renovationSeed.projects[0]!.id)!.name

/** The Sofa, surveyed into the Existing Model by the seed and the thing the move takes away. */
const SOFA = 'fp-sofa'

/**
 * The database this build opens, and not the one the other smoke specs seed.
 *
 * A build with any `VITE_FF_*` on is a preview build, and a preview build never opens the database
 * real work lives in (#53, architecture §11) — that is what keeps preview work out of it. The seed
 * therefore has to land in `buildbox-preview`, or the Library this build reads is the empty one and
 * the Project card the test is waiting for was never in it. `src/app/channel.ts` owns the name.
 */
const PREVIEW_DB_NAME = 'buildbox-preview'

const rows = (page: Page): Locator => page.locator('[data-testid^="design-option-row-"]')
const nameErrors = (page: Page): Locator => page.locator('[data-testid^="design-option-name-error-"]')

async function openRenovationPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, { ...renovationSeed, dbName: PREVIEW_DB_NAME })
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

async function openDesignOptions(page: Page): Promise<void> {
  await openRenovationPlan(page)
  await page.getByTestId('project-settings').click()
  await expect(page.getByTestId('design-options-section')).toBeVisible()
}

test('creates Options by letter, renames inline, and refuses a name twice taken', async ({ page }) => {
  await openDesignOptions(page)
  // The seed's two Options, in the order the Project stores them. The name lives in the row's
  // input, and an input's value is not its text content — `toContainText` would read the row's
  // only other text, the `Delete…` button.
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).nth(0).locator('input')).toHaveValue('Option A')
  await expect(rows(page).nth(1).locator('input')).toHaveValue('Option B')

  await page.getByTestId('design-option-add').click()
  await expect(rows(page)).toHaveCount(3)
  // The next unused letter, never a second Option A (#69 criterion 14).
  await expect(rows(page).nth(2).locator('input')).toHaveValue('Option C')

  const third = rows(page).nth(2).locator('input')
  await third.fill('option a')
  await third.press('Enter')
  // The refusal is the write's own sentence, in the row, and the field says so without saving
  // anything (#69 criterion 14): the name another Option already answers to is case- and
  // whitespace-insensitive, so `option a` is taken.
  await expect(nameErrors(page).first()).toHaveText('An option called "Option A" already exists.')
  await page.getByTestId('settings-cancel').click()
  await page.getByTestId('project-settings').click()
  await expect(rows(page).nth(2).locator('input')).toHaveValue('Option C')

  await rows(page).nth(2).locator('input').fill('Knock through the pantry')
  await rows(page).nth(2).locator('input').press('Enter')
  await expect(rows(page).nth(2).locator('input')).toHaveValue('Knock through the pantry')
  await expect(nameErrors(page)).toHaveCount(0)
})

test('reviews the move of a surveyed Item and refuses it outside a correction', async ({ page }) => {
  await openRenovationPlan(page)
  await placedObject(page, SOFA).click()

  const action = page.getByTestId('move-to-option-action')
  await expect(action).toBeVisible()
  await action.click()

  const dialog = page.getByTestId('move-to-option-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Move to a Design Option?')
  await expect(dialog.getByTestId(`move-item-${SOFA}`)).toContainText('Sofa')
  await expect(dialog.getByTestId('move-danger')).toContainText('This changes the survey baseline, not a Design Option.')

  await page.getByTestId('move-target-option').selectOption('option-a')
  await expect(page.getByTestId('move-to-option-confirm')).toHaveText('Move to Option A')
  await page.getByTestId('move-to-option-confirm').click()

  // Taking surveyed work out of the Existing Model is a correction of it (#69 §12–§13), and no
  // surface in this build opens one — that trigger is #70 — so the write answers with the sentence
  // that names the missing context instead of applying. The Item is still in the Plan View, and
  // Cancel leaves the Project exactly as it was; `src/integration/moveToOptionFlow.renovation.test.tsx`
  // is where the move itself, and its Undo, are driven through a correction.
  await expect(page.getByTestId('move-problem')).toHaveText('Moving work to a Design Option runs inside a correction.')
  await expect(dialog).toBeVisible()
  await page.getByTestId('move-to-option-cancel').click()
  await expect(dialog).toBeHidden()
  await expect(placedObject(page, SOFA)).toBeVisible()
})

test('asks twice before deleting an Option, changes nothing on Cancel, and can be undone', async ({ page }) => {
  const walls = page.locator('[data-testid^="wall-band-"]')
  await openDesignOptions(page)
  const wallsBefore = await walls.count()

  await page.getByTestId('design-option-delete-option-b').click()
  const dialog = page.getByTestId('delete-option-dialog')
  await expect(dialog).toContainText('Delete Option B?')
  await expect(dialog.getByTestId('delete-option-unchanged')).toContainText('Nothing in the Existing Model changes.')
  await page.getByTestId('delete-option-cancel').click()
  await expect(dialog).toBeHidden()
  await expect(rows(page)).toHaveCount(2)

  await page.getByTestId('design-option-delete-option-b').click()
  await page.getByTestId('delete-option-confirm').click()
  await expect(rows(page)).toHaveCount(1)

  await page.getByTestId('settings-cancel').click()
  await expect(walls).toHaveCount(wallsBefore)
  await undoButton(page).click()
  await page.getByTestId('project-settings').click()
  await expect(rows(page)).toHaveCount(2)
})
