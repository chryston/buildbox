/**
 * The cross-Project paste as baselines (#72).
 *
 * The mapping review is a form whose whole job is to be read before anything is written, and a DOM
 * assertion cannot say whether it reads. Four frames of it: unanswered, with the name match offered
 * and the primary shut because nobody has answered yet; answered, with the suggestion taken and the
 * primary open; the row that has no name match, where the only honest answer creates the layer; and
 * the Existing display, where the sentence under the primary is the one that tells a person the paste
 * will join the shared Existing Model and be seen by every Design Option. The fifth frame is the
 * result — the pasted record standing on the drawing, selected, its Layer row reading `Furniture`.
 *
 * The scene is the paste pair (`fixtures/e2e/preview-seed/paste-pair.json`, `scripts/make-paste-seed.ts`):
 * `Unit 4 Fitout`, where the copy is made, and `14 Elm St`, where it is answered.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { openProjectFromLibrary, placedObject, returnToProjects } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const pairSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'paste-pair.json'), 'utf8'),
) as PreviewSeed
const nameOf = (id: string): string => pairSeed.library.find((record) => record.id === id)!.name
const FITOUT = nameOf('proj-paste-fitout')
const ELM = nameOf('proj-paste-elm')

// A frozen clock keeps the persisted timestamp out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const FLOOR_1 = 'seed-view-001'
/** `Option A · Combined` of 14 Elm St. */
const COMBINED = 'views-view-014'
const FURNITURE = 'layers-001'
const SERVICES = 'layers-002'
const TALL_PANTRY = 'seed-003'
const GPO = 'seed-item-028'

const canvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')
const dialog = (page: Page): Locator => page.getByTestId('paste-dialog')

/** The two surfaces whose pixels follow the clock or the pointer rather than the scene. */
const masks = (page: Page): Locator[] => [page.getByTestId('save-status'), page.getByTestId('pick-filter')]

async function settle(page: Page): Promise<void> {
  await expect(canvas(page)).toBeVisible()
  await waitForFonts(page)
  // Auto-fit runs once on the first measured frame; the scene group settles with it.
  await waitForStablePaint(canvas(page).locator('g').first())
}

async function openPair(page: Page, projectName: string): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, { ...pairSeed})
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await settle(page)
}

/** Copy one record in `Unit 4 Fitout` and stand in `14 Elm St`, where the review will be answered. */
async function copyAndCross(page: Page, itemId: string): Promise<void> {
  await openPair(page, FITOUT)
  await placedObject(page, itemId).click()
  await page.keyboard.press('Control+c')
  await returnToProjects(page)
  await openProjectFromLibrary(page, ELM)
  await settle(page)
}

async function openReview(page: Page, viewId: string): Promise<Locator> {
  await page.getByTestId('view-picker').selectOption(viewId)
  await settle(page)
  await page.getByTestId('renovation-paste-button').click()
  await expect(dialog(page)).toBeVisible()
  return dialog(page)
}

test('the mapping review, unanswered, with the name match offered', async ({ page }) => {
  await copyAndCross(page, TALL_PANTRY)
  const review = await openReview(page, COMBINED)
  // One row for the one layer the copy brings; its destination still says `— choose —`, and the
  // primary is shut because a name that matches is not an answer a person gave (#72 criteria 2, 3).
  await expect(review).toHaveScreenshot('paste-map-unanswered.png')
})

test('the same review with the suggestion taken', async ({ page }) => {
  await copyAndCross(page, TALL_PANTRY)
  const review = await openReview(page, COMBINED)
  await page.getByTestId(`paste-row-use-${FURNITURE}`).click()
  // The row reads `Furniture`, the one-click affordance is gone, and the primary is open (#72 criterion 3).
  await expect(review).toHaveScreenshot('paste-map-answered.png')
})

test('the row whose layer does not exist here yet', async ({ page }) => {
  await copyAndCross(page, GPO)
  const review = await openReview(page, COMBINED)
  await expect(page.getByTestId(`paste-row-target-${SERVICES}`)).toBeVisible()
  // `Services` is in the source and not here: no name match, and the choice that creates it (#72 criterion 3).
  await expect(review).toHaveScreenshot('paste-map-create-layer.png')
})

test('the Existing display, where the paste joins the shared model', async ({ page }) => {
  await copyAndCross(page, TALL_PANTRY)
  // `Floor 1` shows the Existing Model and this Project has Design Options, so the paste is a
  // baseline correction and says so under the primary (#72 criterion 9).
  const review = await openReview(page, FLOOR_1)
  await expect(review).toHaveScreenshot('paste-existing-danger.png')
})

test('the pasted record, standing on the drawing and selected', async ({ page }) => {
  await copyAndCross(page, TALL_PANTRY)
  await openReview(page, COMBINED)
  await page.getByTestId(`paste-row-use-${FURNITURE}`).click()
  await page.getByTestId('paste-dialog-confirm').click()
  await expect(dialog(page)).toHaveCount(0)
  await settle(page)
  // The whole viewport: the record among the Furniture it joined, its selection ring, and the rail
  // whose Layer row reads the layer it landed on (#72 criteria 1, 5).
  await expect(page).toHaveScreenshot('paste-landed.png', { mask: masks(page) })
})
