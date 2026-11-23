/**
 * The Export dialog in a renovation build (#73 criteria 1, 2 and 3 where only a browser can answer
 * them): a Combined drawing carries the Design Option and Renovation Display it was drawn from in
 * the file's own record, a layer toggled in the dialog changes that record and nothing else, and a
 * Placed Items CSV taken from a view that hides the `Furniture` layer still holds every one of those
 * Placed Items — with the dialog saying how many it included that the view hides.
 *
 * The scene is `fixtures/domain/v8/export.json`, the export tests' own kitchen, installed as
 * `fixtures/e2e/preview-seed/renovation-export.json` by `scripts/make-renovation-export-seed.ts`:
 * two Design Options, three Drawing Layers, four Placed Items filed on `Furniture`, and the view
 * `Ground Floor · Plan · Demolition`, which hides that layer. It runs only against a
 * `VITE_FF_RENOVATION` build (`npm run test:e2e:renovation`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { parseCsv } from '../../src/export/testing'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { readDownload } from '../support/libraryApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const exportSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-export.json'), 'utf8'),
) as PreviewSeed
const projectName = exportSeed.library.find((record) => record.id === exportSeed.projects[0]!.id)!.name

/** A preview build never opens the database real work lives in (#53); the seed has to land where it looks. */
const PREVIEW_DB_NAME = 'buildbox-preview'

const COMBINED = 'views-view-016'
const FURNITURE_HIDDEN = 'export-009'
const FURNITURE = 'export-001'
/** One of the four Placed Items filed on `Furniture`; the other three are its neighbours. */
const SOFA = 'export-004'

/** The provenance the sheet carries, of which only the composition is this spec's business. */
interface SheetMetadata {
  recipe: {
    composition: Array<{
      design_option_id: string | null
      renovation_display: string
      layer_order: Array<{ name: string }>
      included_layers: Array<{ name: string }>
    }>
  }
}

async function openExportPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, { ...exportSeed, dbName: PREVIEW_DB_NAME })
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

async function openView(page: Page, viewId: string): Promise<void> {
  await page.getByTestId('view-picker').selectOption(viewId)
  await expect(page.getByTestId('view-picker')).toHaveValue(viewId)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

test('a Combined drawing records its Option and Display, and the toggles are temporary', async ({ page }) => {
  await openExportPlan(page)
  await openView(page, COMBINED)
  await page.getByTestId('export-open').click()

  // The view says nothing about any layer, so every chip starts visible, and the composition block
  // already names what the sheet will say it was drawn from.
  await expect(page.getByTestId('export-layer-chips')).toBeVisible()
  await expect(page.getByTestId(`export-layer-${FURNITURE}`)).toBeChecked()
  const composition = page.getByTestId('export-composition')
  await expect(composition).toContainText('Option B · Widened opening')
  await expect(composition).toContainText('Combined')

  await page.getByTestId(`export-layer-${FURNITURE}`).uncheck()

  const pending = page.waitForEvent('download')
  await page.getByTestId('export-run').click()
  const file = await readDownload(await pending)
  expect(file.name).toMatch(/\.svg$/)

  const block = /<metadata>([\s\S]*?)<\/metadata>/.exec(file.buffer.toString('utf8'))
  expect(block, 'the SVG carries no <metadata>').not.toBeNull()
  const recorded = (JSON.parse(block![1]!) as SheetMetadata).recipe.composition[0]!
  expect(recorded.design_option_id).toBe('option-b')
  expect(recorded.renovation_display).toBe('combined')
  // The layer still exists in the order it was painted in; it just did not reach this paper.
  expect(recorded.layer_order.map((layer) => layer.name)).toContain('Furniture')
  expect(recorded.included_layers.map((layer) => layer.name)).not.toContain('Furniture')

  // Temporary means temporary: the dialog opens again from the saved view, and the canvas never
  // stopped drawing the Placed Items the file left out.
  await expect(page.getByTestId('export-open')).toBeVisible()
  await page.getByTestId('export-open').click()
  await expect(page.getByTestId(`export-layer-${FURNITURE}`)).toBeChecked()
  await page.getByTestId('export-close').click()
  await expect(page.getByTestId(`placed-object-${SOFA}`)).toBeVisible()
})

test('a Placed Items CSV from a view that hides a layer still holds those items', async ({ page }) => {
  await openExportPlan(page)
  await openView(page, FURNITURE_HIDDEN)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-tab-lists').click()
  await expect(page.getByTestId('export-lists-tables')).toBeVisible()

  // One table, so the file is a bare CSV and the notice below is the only provenance aside.
  await page.getByTestId('export-lists-table-items').uncheck()
  const cutList = page.getByTestId('export-lists-table-cut-list')
  if ((await cutList.count()) > 0) await cutList.uncheck()
  await page.getByTestId('export-lists-table-placed-items').check()

  // The view on the other side of the dialog hides the Furniture layer; the scope does not, and the
  // dialog says how many rows that difference is worth rather than quietly dropping them.
  const notice = page.getByTestId('export-lists-notice-hidden')
  await expect(notice).toContainText('4 items included that are hidden in this view')
  // The disclosure names them the way the table itself publishes them, so the notice and the file
  // cannot disagree about which rows they are talking about.
  const hidden = await notice.locator('li').allTextContents()
  expect(hidden).toHaveLength(4)

  const shown = Number(/(\d+)/.exec((await page.getByTestId('export-lists-rows-placed-items').textContent()) ?? '')?.[0])

  const pending = page.waitForEvent('download')
  await page.getByTestId('export-lists-run').click()
  const file = await readDownload(await pending)
  expect(file.name).toMatch(/_placed-items_\d{8}\.csv$/)

  const parsed = parseCsv(new Uint8Array(file.buffer))
  expect(parsed.bom, 'no UTF-8 BOM').toBe(true)
  const header = parsed.rows[0]!
  expect(header).toContain('label')
  expect(header).not.toContain('code')
  const rows = parsed.rows.slice(1)
  // The number beside the table is the number of lines in the file, hidden rows included.
  expect(rows).toHaveLength(shown)
  const labels = new Set(rows.map((row) => row[header.indexOf('label')]!))
  for (const ref of hidden) expect(labels.has(ref), `${ref} missing from the file`).toBe(true)
})
