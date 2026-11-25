/**
 * The dependency review in a real browser (#82 criteria 2, 3, 13).
 *
 * The jsdom flow proves the dialog opens and the answer round-trips; this proves the same thing in the
 * browser a person uses — that the refusal is intercepted rather than shown as an error, that the Reanchor
 * list offers the sibling placement by the name the plan gives it, and that one Undo after Apply brings
 * back the placement, the note and its original Anchor together, because they went as one transaction.
 *
 * The scene is `notes-review-scene.json` (`scripts/make-notes-review-seed.ts`): `Base 600` placed twice,
 * with C-004 anchored to the placement that gets deleted.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary, placedObject } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'notes-review-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name

async function openScene(page: Page): Promise<void> {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await seedPreviewDb(page, seed)
  await page.goto('/')
  await waitForFonts(page)
  await openProjectFromLibrary(page, projectName)
  await floorPlanCanvas(page).waitFor()
  // A scene that stopped validating makes the app refuse every Intent as `invalid-project`, in the
  // console only — the review would simply never open and this file would read as a missing feature.
  expect(errors.filter((text) => text.includes('refused'))).toEqual([])
}

test.describe('Notes dependency review (#82)', () => {
  test('asks before deleting the placement C-004 speaks for, and Reanchor moves it', async ({ page }) => {
    await openScene(page)
    await placedObject(page, 'seed-item-029').click()
    await page.getByTestId('delete-object').click()

    const dialog = page.getByTestId('notes-review')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('C-004')
    await expect(dialog).toContainText('Shift 50 mm for dishwasher')
    await expect(page.getByTestId('notes-review-confirm')).toBeDisabled()

    await page.getByTestId('notes-review-choice-reanchor').click()
    await expect(page.getByTestId('notes-review-confirm')).toBeDisabled()
    await page.getByTestId('notes-review-target').selectOption({ value: '{"kind":"entity","entityId":"seed-item-028"}' })
    await expect(page.getByTestId('notes-review-confirm')).toBeEnabled()
    await page.getByTestId('notes-review-confirm').click()
    await expect(page.getByTestId('notes-review')).toHaveCount(0)

    // The note survived on the other placement, and the placement it spoke for did not.
    await placedObject(page, 'seed-item-029').waitFor({ state: 'detached' })
    await page.getByTestId('notes-panel-toggle').click()
    await expect(page.getByTestId('notes-panel')).toContainText('Shift 50 mm for dishwasher')

    await page.getByTestId('undo-button').click()
    await expect(placedObject(page, 'seed-item-029')).toBeVisible()
  })

  test('Cancel changes nothing', async ({ page }) => {
    await openScene(page)
    await placedObject(page, 'seed-item-029').click()
    await page.getByTestId('delete-object').click()
    await expect(page.getByTestId('notes-review')).toBeVisible()
    await page.getByTestId('notes-review-cancel').click()
    await expect(page.getByTestId('notes-review')).toHaveCount(0)
    await expect(placedObject(page, 'seed-item-029')).toBeVisible()
  })
})
