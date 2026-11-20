import { expect, test } from '../support/fixtures'
import { openPreviewApp, showFloorPlan } from '../support/previewApp'
import { waitForFonts } from '../support/stability'
import type { Page } from '@playwright/test'

// The Export dialog's baselines (#61 criterion 12's sibling: what a person is shown before they
// press anything). Two frames, because the dialog has two shapes: the recipe for a file that has
// no paper, and the recipe for a PDF, which gains the whole Sheet group. Both are the dialog's own
// box rather than the page — the canvas behind it already has its own baselines in
// `plan-view.spec.ts`, and the notices are what this dialog is for.
//
// The clock is frozen so the export date the title block will carry cannot drift the frame, and
// the fonts are awaited because the dialog is all text.

const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const dialog = (page: Page) => page.getByRole('dialog')

async function openDialog(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await openPreviewApp(page)
  await showFloorPlan(page)
  await page.getByTestId('export-open').click()
  await expect(page.getByTestId('export-tab-drawing')).toBeVisible()
  await waitForFonts(page)
  // The view is measured after the first paint, and the read-only unit line is the last thing the
  // dialog renders from its own state; the frame is the last one once that is on screen.
  await expect(page.getByTestId('export-unit-line')).toBeVisible()
}

test('the Export dialog, drawing a file with no paper', async ({ page }) => {
  await openDialog(page)
  await expect(dialog(page)).toHaveScreenshot('export-dialog-svg.png')
})

test('the Export dialog, drawing a PDF, where the sheet appears', async ({ page }) => {
  await openDialog(page)
  await page.getByTestId('export-format').selectOption('pdf')
  await expect(page.getByTestId('export-scale')).toBeVisible()
  await expect(dialog(page)).toHaveScreenshot('export-dialog-pdf.png')
})
