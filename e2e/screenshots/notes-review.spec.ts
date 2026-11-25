/**
 * The dependency review photographed (#82 criterion 15).
 *
 * Two frames of one scene, both of the question a person cannot skip:
 *
 *   - a placement deleted with the note still undecided: the subject line, the note quoted, the three
 *     answers, and Apply disabled — the operation cannot go while a note is unanswered (§4, §6);
 *   - the same row answered by Reanchor to `Base 600 #1`: the target named in the row, Apply enabled,
 *     which is the sentence a person needs to trust the move (§4.2).
 *
 * The Floor and Wall deletions ask the same component the same question with rows preset to Delete, and
 * the Wall's arrives inside the Wall's own dialog; both are covered by the integration flows and the
 * dialog's own tests rather than here, because reaching a Wall or a Floor with a real click needs the
 * selection gesture the smoke specs already own.
 *
 * The scene is the Notes seed (`scripts/make-notes-review-seed.ts`). The clock is frozen so the toolbar's
 * save line cannot move between two runs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary, placedObject } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'notes-review-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

async function openNotesPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, seed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
  await waitForFonts(page)
  await waitForStablePaint(floorPlanCanvas(page))
}

test.describe('the dependency review', () => {
  test('a placement deleted with the note undecided: Apply is disabled', async ({ page }) => {
    await openNotesPlan(page)
    await placedObject(page, 'seed-item-029').click()
    await page.getByTestId('delete-object').click()
    await expect(page.getByTestId('notes-review')).toBeVisible()
    await expect(page.getByTestId('notes-review-confirm')).toBeDisabled()
    await waitForStablePaint(page.getByTestId('notes-review'))
    await expect(page).toHaveScreenshot('notes-review-entity-deletion.png')
  })

  test('the same note answered by Reanchor: the target named, Apply enabled', async ({ page }) => {
    await openNotesPlan(page)
    await placedObject(page, 'seed-item-029').click()
    await page.getByTestId('delete-object').click()
    await page.getByTestId('notes-review-choice-reanchor').click()
    await page.getByTestId('notes-review-target').selectOption({ value: '{"kind":"entity","entityId":"seed-item-028"}' })
    await expect(page.getByTestId('notes-review-confirm')).toBeEnabled()
    await waitForStablePaint(page.getByTestId('notes-review'))
    await expect(page).toHaveScreenshot('notes-review-reanchor-target.png')
  })
})
