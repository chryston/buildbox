/**
 * The PNG baselines (#61 criterion 12): the pixels the app actually hands out, not the dialog that
 * offers them.
 *
 * Two views from the preview seed — the Floor's plan and the first Item Design's detail — exported
 * as one PNG recipe, which is a ZIP, so the test opens the archive and compares each image inside it
 * against its own baseline. That is the whole promise of the criterion: the rasteriser, the sheet,
 * the font and the encoder are all in the bytes being compared, and a change to any of them shows up
 * as a diff a reviewer can look at.
 *
 * The clock is frozen because the sheet's title block prints the day the export ran, and the fonts
 * are awaited because the sheet is text. The long edge is left at the dialog's default (2 048 px) so
 * the baseline is the one a person gets by default.
 */
import { expect, test } from '../support/fixtures'
import { readDownload } from '../support/libraryApp'
import { openPreviewApp, showFloorPlan } from '../support/previewApp'
import { waitForFonts } from '../support/stability'
import { unzipSync } from 'fflate'
import type { Page } from '@playwright/test'

const FIXED_NOW = '2026-01-01T09:00:00+08:00'

/** The dialog, set to PNG, with the Item Detail view added to the plan view it opens with. */
async function openPngRecipe(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await openPreviewApp(page)
  await showFloorPlan(page)
  await page.getByTestId('export-open').click()
  await expect(page.getByTestId('export-tab-drawing')).toBeVisible()
  await page.getByTestId('export-format').selectOption('png')
  await expect(page.getByTestId('export-png-size')).toBeVisible()
  // The picker lists the Floor's plan view first, then one row per Item Design; the second row is
  // the first Item Design, and it is a different drawing altogether.
  const boxes = page.getByTestId('export-views').locator('input[type="checkbox"]')
  await expect(boxes).toHaveCount(11)
  await boxes.nth(1).check()
  await expect(boxes.nth(1)).toBeChecked()
  await waitForFonts(page)
}

test('two PNGs, one for the Floor plan and one for an Item Design', async ({ page }) => {
  await openPngRecipe(page)
  const pending = page.waitForEvent('download')
  await page.getByTestId('export-run').click()
  const archive = await readDownload(await pending)
  expect(archive.name).toMatch(/_drawings_\d{8}\.zip$/)

  const entries = unzipSync(new Uint8Array(archive.buffer))
  const names = Object.keys(entries).filter((one) => one.endsWith('.png'))
  expect(names).toHaveLength(2)
  // The archive holds the views in the order the recipe listed them, which is the order the dialog
  // lists them in: the Floor's plan first, then the Item Design.
  expect(names[0]).toContain('Floor-1')
  const baseline = ['export-png-floor-plan.png', 'export-png-item-detail.png'] as const
  for (const [index, name] of names.entries()) {
    expect(Buffer.from(entries[name]!)).toMatchSnapshot({
      name: baseline[index]!,
      // Any real pixel change fails; `threshold` only absorbs antialiasing noise.
      maxDiffPixels: 0,
      threshold: 0.2,
    })
  }
})
