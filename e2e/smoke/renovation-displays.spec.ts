/**
 * The four Renovation Displays in a real browser (#70 criteria 7, 20, 21, 22, 23, and the overlap
 * cycle of §5).
 *
 * What jsdom cannot answer is the drawing itself: that a Display shows exactly the records it owes,
 * stamped with the entity each one stands for, and that a dialog the integration tests drive through
 * a store actually opens from a keystroke a person makes. So this spec asserts the Plan View through
 * the `data-ref` / `data-ref-role` stamps the display list carries, and drives the dialogs through
 * the toolbar, the rail and the inspector.
 *
 * The scene is the `renovation-views` seed: Walls W-1…W-6, `Option A · Open kitchen` demolishing W-2
 * and Base 600 #1 and proposing Base 600 #1′ plus an Island, `Option B · Widened opening` replacing
 * W-2 with W-2′ on the same footprint. It runs only against a `VITE_FF_RENOVATION` build
 * (`npm run test:e2e:renovation`), which is also the only build that opens the database it is seeded
 * into.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary, undoButton } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const renovationSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-views.json'), 'utf8'),
) as PreviewSeed
const projectName = renovationSeed.library.find((record) => record.id === renovationSeed.projects[0]!.id)!.name

/** A preview build never opens the database real work lives in (#53); the seed has to land where it looks. */
const PREVIEW_DB_NAME = 'buildbox-preview'

const W_1 = 'seed-wall-002'
const W_2 = 'seed-wall-003'
const W_6 = 'seed-wall-013'
/** Base 600 #1, demolished by Option A, and its successor plus the Island it is replaced by. */
const BASE = 'seed-item-028'
const BASE_PRIME = 'views-successor-001'
const ISLAND = 'views-island-013'

/** One entity's stamps: a Wall is painted as several items, all carrying the same reference. */
const stamped = (page: Page, ref: string): Locator => page.locator(`[data-ref="${ref}"]`).first()

/** Every Wall the Plan View is drawing, by the entity each stamp stands for. */
async function wallRefs(page: Page): Promise<string[]> {
  return page.locator('[data-ref-role="wall"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ref') ?? ''))
}

async function openRenovationPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, { ...renovationSeed, dbName: PREVIEW_DB_NAME })
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

/** The rail's two settings, each its own undoable transaction (#70 criterion 2). */
async function showDisplay(page: Page, optionId: string, display: string): Promise<void> {
  await page.getByTestId('design-option-picker').selectOption(optionId)
  await page.getByTestId(`display-${display}`).click()
  await expect(page.getByTestId('floor-plan-canvas')).toBeVisible()
}

test('each Renovation Display of Option A draws the records it owes', async ({ page }) => {
  await openRenovationPlan(page)
  await showDisplay(page, 'option-a', 'existing')

  // Existing: the record as surveyed — the two records Option A will demolish are still standing,
  // and nothing that only the Option proposes is drawn.
  await expect(page.getByTestId('renovation-mode-bar')).toContainText('Existing')
  await expect(stamped(page, W_2)).toBeVisible()
  await expect(stamped(page, BASE)).toBeVisible()
  await expect(stamped(page, BASE_PRIME)).toHaveCount(0)
  await expect(stamped(page, ISLAND)).toHaveCount(0)

  // Demolition: the same records, wearing the demolition overlay; still no proposed work.
  await page.getByTestId('display-demolition').click()
  await expect(page.getByTestId('renovation-mode-bar')).toContainText('Demolition')
  await expect(stamped(page, W_2)).toBeVisible()
  await expect(stamped(page, BASE)).toBeVisible()
  await expect(stamped(page, BASE_PRIME)).toHaveCount(0)

  // Proposed: the record is hidden and the Option's work is drawn in its place.
  await page.getByTestId('display-proposed').click()
  await expect(page.getByTestId('renovation-mode-bar')).toContainText('Proposed')
  await expect(stamped(page, W_2)).toHaveCount(0)
  await expect(stamped(page, BASE)).toHaveCount(0)
  await expect(stamped(page, BASE_PRIME)).toBeVisible()
  await expect(stamped(page, ISLAND)).toBeVisible()

  // Combined: all of them at once.
  await page.getByTestId('display-combined').click()
  await expect(page.getByTestId('renovation-mode-bar')).toContainText('Combined')
  await expect(stamped(page, W_2)).toBeVisible()
  await expect(stamped(page, BASE)).toBeVisible()
  await expect(stamped(page, BASE_PRIME)).toBeVisible()
  await expect(stamped(page, ISLAND)).toBeVisible()
})

test("a baseline edit in a Design Option's display asks the forced choice, replaces, and undoes both", async ({ page }) => {
  await openRenovationPlan(page)
  await showDisplay(page, 'option-a', 'proposed')

  const before = await wallRefs(page)
  await page.locator(`[data-ref-role="wall"][data-ref="${W_1}"]`).last().click()
  await page.getByTestId('wall-length').fill('3000')
  await page.getByTestId('wall-length').press('Enter')

  // Nothing was written; the question is asked first (#70 criterion 20).
  const dialog = page.getByTestId('forced-choice-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('forced-choice-title')).toContainText('W-1')
  expect(await wallRefs(page)).toEqual(before)

  // `Replace in Option A` is one transaction: a demolition record and a successor carrying the
  // moved geometry (#70 criterion 21). W-1 leaves the Proposed display as its successor arrives.
  await page.getByTestId('forced-choice-replace').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator(`[data-ref="${W_1}"]`)).toHaveCount(0)
  const replaced = await wallRefs(page)
  expect(replaced).not.toContain(W_1)
  expect(replaced.length).toBe(before.length)

  // One undo removes both: the record is back and the successor is gone.
  await undoButton(page).click()
  await expect(page.locator(`[data-ref-role="wall"][data-ref="${W_1}"]`)).toBeVisible()
  expect(await wallRefs(page)).toEqual(before)
})

test('the Existing display locks the record, asks the danger question, and can be undone', async ({ page }) => {
  await openRenovationPlan(page)
  await showDisplay(page, 'option-a', 'existing')

  await page.locator(`[data-ref-role="wall"][data-ref="${W_6}"]`).last().click()
  const length = page.getByTestId('wall-length')
  // A baseline record in Existing display is shown without its offers (#70 criterion 23).
  await expect(length).toBeDisabled()
  await expect(page.locator('[data-testid^="wall-handle-"]')).toHaveCount(0)

  await page.getByTestId('renovation-inspector-action-correct').click()
  await expect(length).toBeEnabled()
  await length.fill('3000')
  await length.press('Enter')

  // The refusal is where the danger dialog asks what every Design Option will see (#70 criterion 22).
  const dialog = page.getByTestId('correct-existing-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Every Design Option')
  await expect(dialog).toContainText('Option A · Open kitchen')
  await expect(dialog).toContainText('Option B · Widened opening')
  await expect(length).toHaveValue('2500')

  await page.getByTestId('correct-existing-confirm').click()
  await expect(dialog).toHaveCount(0)
  await expect(length).toHaveValue('3000')

  await undoButton(page).click()
  await expect(length).toHaveValue('2500')
})

test('the overlap cycle in Option B · Combined counts its clicks and clears on Esc', async ({ page }) => {
  await openRenovationPlan(page)
  await showDisplay(page, 'option-b', 'combined')

  // W-2 and its successor W-2′ stand on one footprint, so a click there cannot choose between them.
  // The pointer answers to the point, not to one painted path, so the gesture is the canvas's own.
  const box = await page.locator('[data-ref="views-successor-005"]').first().boundingBox()
  if (box === null) throw new Error('the successor Wall was never painted')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.click(x, y)
  await expect(page.getByTestId('overlap-header')).toHaveText('Overlap 1/2 · click again to cycle')
  await page.mouse.click(x, y)
  await expect(page.getByTestId('overlap-header')).toHaveText('Overlap 2/2 · click again to cycle')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('overlap-cycle')).toHaveCount(0)
})
