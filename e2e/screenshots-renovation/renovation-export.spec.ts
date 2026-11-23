/**
 * The Export dialog with the dark feature on, and one PNG per Renovation Display (#73 criteria 1
 * and 13).
 *
 * Three frames of the dialog, because the renovation half of it has three shapes: the Drawing tab
 * as it opens on a Combined view, with the chips and the record of what the sheet will say it was
 * drawn from; the same tab after a layer has been unticked, where that record is the only place the
 * difference exists; and the Lists tab of a view that hides a layer, where the scope is spelled out
 * and the rows the view hides are counted rather than dropped. The dialog's own box is the target —
 * the canvas behind it has its own baselines in `renovation-displays.spec.ts`.
 *
 * Then the pixels themselves: one PNG per Renovation Display, exported through the dialog and
 * compared byte for byte against its own baseline. The four scenes are the four saved views of the
 * export scene, one per Display, so what is compared is the file a person would actually be handed —
 * rasteriser, sheet, title block, hatch and font included.
 *
 * The clock is frozen because the title block prints the day the export ran, and the fonts are
 * awaited because both the dialog and the sheet are text. Flag-on artifact only
 * (`npm run test:screenshots:renovation`): a flag-off build draws none of this.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '../support/fixtures'
import { readDownload } from '../support/libraryApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'
import type { Locator, Page } from '@playwright/test'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const exportSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-export.json'), 'utf8'),
) as PreviewSeed

/** A preview build never opens the database real work lives in (#53); the seed lands where it looks. */
const PREVIEW_DB_NAME = 'buildbox-preview'

// A frozen clock keeps the export date, and the persisted timestamp, out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const dialog = (page: Page): Locator => page.getByRole('dialog')
const canvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')
/** The record's `Included layers` row, and only that row: the order above it still names every layer. */
const includedLayers = (page: Page): Locator =>
  page.locator('[data-testid="export-composition"] dt', { hasText: 'Included layers' }).locator('+ dd')

const COMBINED = 'views-view-016'
const FURNITURE_HIDDEN = 'export-009'
const FURNITURE = 'export-001'

/** One saved view per Renovation Display, which is what the scene was built to hold. */
const BY_DISPLAY: ReadonlyArray<readonly [viewId: string, baseline: string]> = [
  ['seed-view-001', 'renovation-display-existing.png'],
  ['views-view-015', 'renovation-display-demolition.png'],
  ['views-view-014', 'renovation-display-proposed.png'],
  [COMBINED, 'renovation-display-combined.png'],
]

async function settle(page: Page): Promise<void> {
  await expect(canvas(page)).toBeVisible()
  await waitForFonts(page)
  // Auto-fit runs once on the first measured frame; the scene group settles with it.
  await waitForStablePaint(canvas(page).locator('g').first())
}

async function openExportPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, { ...exportSeed, dbName: PREVIEW_DB_NAME })
  await page.goto('./', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Open' }).first().click()
  await settle(page)
}

async function openView(page: Page, viewId: string): Promise<void> {
  await page.getByTestId('view-picker').selectOption(viewId)
  await expect(page.getByTestId('view-picker')).toHaveValue(viewId)
  await settle(page)
}

async function openDialog(page: Page, viewId: string): Promise<void> {
  await openExportPlan(page)
  await openView(page, viewId)
  await page.getByTestId('export-open').click()
  await expect(page.getByTestId('export-tab-drawing')).toBeVisible()
  await waitForFonts(page)
}

test('the Export dialog on a Combined view, with the composition it will record', async ({ page }) => {
  await openDialog(page, COMBINED)
  await expect(page.getByTestId('export-layer-chips')).toBeVisible()
  // The record is the frame's subject, and it starts folded away at the bottom of a scrolling body:
  // it is pulled into view so the frame shows the whole of it rather than its first four rows.
  await page.getByTestId('export-composition').locator('summary').click()
  await expect(includedLayers(page)).toContainText('Furniture')
  // The record sits at the bottom of a scrolling body: its own end is what the frame should end on,
  // so the last two rows are not left under the fold.
  await page.getByTestId('export-composition').evaluate((node) => node.scrollIntoView({ block: 'end' }))
  await expect(dialog(page)).toHaveScreenshot('export-dialog-drawing.png')
})

test('the same dialog with a layer unticked, where only the record changes', async ({ page }) => {
  await openDialog(page, COMBINED)
  await page.getByTestId(`export-layer-${FURNITURE}`).uncheck()
  await page.getByTestId('export-composition').locator('summary').click()
  // The layer is still in the order the sheet was painted in; it simply is not on this paper.
  await expect(includedLayers(page)).not.toContainText('Furniture')
  await page.getByTestId('export-composition').evaluate((node) => node.scrollIntoView({ block: 'end' }))
  await expect(dialog(page)).toHaveScreenshot('export-dialog-drawing-one-layer-off.png')
})

test('the Lists tab of a view that hides a layer', async ({ page }) => {
  await openDialog(page, FURNITURE_HIDDEN)
  await page.getByTestId('export-tab-lists').click()
  await expect(page.getByTestId('export-lists-tables')).toBeVisible()
  await expect(page.getByTestId('export-lists-notice-hidden')).toBeVisible()
  await page.getByTestId('export-lists-notice-hidden').scrollIntoViewIfNeeded()
  await expect(dialog(page)).toHaveScreenshot('export-dialog-lists.png')
})

test('one PNG per Renovation Display', async ({ page }) => {
  await openExportPlan(page)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-format').selectOption('png')
  await expect(page.getByTestId('export-png-size')).toBeVisible()

  for (const [viewId, baseline] of BY_DISPLAY) {
    await page.getByTestId('export-close').click()
    await openView(page, viewId)
    await page.getByTestId('export-open').click()
    await page.getByTestId('export-format').selectOption('png')
    await waitForFonts(page)

    const pending = page.waitForEvent('download')
    await page.getByTestId('export-run').click()
    const file = await readDownload(await pending)

    // One view is one file: a recipe that grows past one view arrives as a ZIP instead, and this
    // recipe never does.
    expect(file.name, 'a single PNG view is not a PNG').toMatch(/\.png$/)
    expect(Buffer.from(new Uint8Array(file.buffer))).toMatchSnapshot({
      name: baseline,
      // Any real pixel change fails; `threshold` only absorbs antialiasing noise.
      maxDiffPixels: 0,
      threshold: 0.2,
    })

    // The dialog closes itself once the file is handed over, so the next round starts from the view.
    await expect(page.getByTestId('export-open')).toBeVisible()
  }
})
