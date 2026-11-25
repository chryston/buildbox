/**
 * The dependency review photographed (#82 criterion 15).
 *
 * Four frames, one per shape the question takes, each reached by the gesture a person uses:
 *
 *   - a placement deleted with the note still undecided: the subject line, the note quoted, the three
 *     answers, and Apply disabled — the operation cannot go while a note is unanswered (§4, §6);
 *   - the same row answered by Reanchor to the other placement: the target named in the row, Apply
 *     enabled, which is the sentence a person needs to trust the move (§4.2);
 *   - a Floor deleted: the review arrives after the Floor's own dependency dialog, with the note preset
 *     to Delete, because the thing it speaks for is going with the Floor (§10).
 *
 * The Wall's review (§9) is the same component inside the Wall's own dialog, next to the Skirting rows
 * #78 gave it; it is pinned by the integration flow and the dialog's own tests, because at the fitted
 * zoom this Floor's W-2 stands along the edge of the plan pane, where a click lands on the Wall drawn
 * over it rather than on W-2 — a gesture problem, not a review problem.
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

  test('a Floor deleted: its note listed preset to Delete', async ({ page }) => {
    await openNotesPlan(page)
    await page.getByTestId('manage-floors').click()
    await expect(page.getByTestId('manage-floors-dialog')).toBeVisible()
    await page.getByTestId('floor-delete-seed-floor-002').click()
    await expect(page.getByTestId('delete-floor-dialog')).toBeVisible()
    await page.getByTestId('delete-floor-confirm').click()
    await expect(page.getByTestId('notes-review')).toBeVisible()
    await expect(page.getByTestId('notes-review-row').first()).toContainText('C-008')
    await waitForStablePaint(page.getByTestId('notes-review'))
    await expect(page).toHaveScreenshot('notes-review-floor-deletion.png')
  })
})
