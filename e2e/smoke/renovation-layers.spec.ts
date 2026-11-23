/**
 * Drawing Layers in a real browser (#71 criteria 9, 11, and the deletion review of §6).
 *
 * The integration tests answer what a click and a checkbox do to the record. What they cannot answer
 * is the drawing: that hiding a layer takes its content off the canvas and leaves the warning behind
 * with the words that explain the gap, that a deleted layer leaves its members standing and drawn
 * with nothing under them, and that a read-only layer really does hand out no handles. So this spec
 * drives the same scene through the rail and the canvas in Chromium and Firefox.
 *
 * The scene is the layers twin of the renovation-views kitchen (`fixtures/e2e/preview-seed/
 * renovation-layers.json`, from `scripts/make-renovation-layers-seed.ts`): `Structure` under the
 * Walls, Opening and Rooms, `Furniture` under every Placed Item, `Services` empty, and four saved
 * views — `Floor 1` says nothing about any layer, `Option B · Combined` has made Structure read-only.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary, undoButton } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const layersSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-layers.json'), 'utf8'),
) as PreviewSeed
const projectName = layersSeed.library.find((record) => record.id === layersSeed.projects[0]!.id)!.name

/** A preview build never opens the database real work lives in (#53); the seed has to land where it looks. */
const PREVIEW_DB_NAME = 'buildbox-preview'

const FLOOR_1 = 'seed-view-001'
const COMBINED = 'views-view-016'
const FURNITURE = 'layers-001'
const SERVICES = 'layers-002'
const STRUCTURE = 'layers-003'
/** The wardrobe is the one entity this scene earns a warning about, and it stands on Furniture. */
const WARDROBE = 'fp-wardrobe'
const WALL = 'seed-wall-002'

async function openLayersPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, { ...layersSeed, dbName: PREVIEW_DB_NAME })
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

async function openView(page: Page, viewId: string): Promise<void> {
  await page.getByTestId('view-picker').selectOption(viewId)
  await expect(page.getByTestId('view-picker')).toHaveValue(viewId)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

/** The row's `Project:` section, where `Delete…` lives, is drawn only while the row is open. */
async function expandRow(page: Page, layerKey: string): Promise<void> {
  const toggle = page.getByTestId(`layer-toggle-${layerKey}`)
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

test('a hidden layer stops being drawn and its warning says why', async ({ page }) => {
  await openLayersPlan(page)
  await openView(page, FLOOR_1)

  await expect(page.getByTestId(`placed-object-${WARDROBE}`)).toBeVisible()
  await page.getByTestId(`layer-visible-${FURNITURE}`).uncheck()
  await expect(page.getByTestId(`placed-object-${WARDROBE}`)).toHaveCount(0)
  // An empty layer hides too, and nothing else about the drawing changes.
  await page.getByTestId(`layer-visible-${SERVICES}`).uncheck()
  await expect(page.getByTestId(`layer-visible-${SERVICES}`)).not.toBeChecked()

  // The Warnings List goes on counting what this canvas stopped drawing (#71 §7), and the row says
  // why its subject is nowhere on screen.
  await page.getByTestId('warning-toggle').click()
  const sentence = page.locator('[data-testid^="warning-sentence-"]')
    .filter({ hasText: '· Furniture hidden in this view — warning still applies' })
  await expect(sentence).toBeVisible()

  // Locate finds the thing it warns about without putting it back on screen.
  const key = (await sentence.getAttribute('data-testid'))!.replace('warning-sentence-', '')
  await page.getByTestId(`warning-locate-${key}`).click()
  await expect(page.getByTestId(`placed-object-${WARDROBE}`)).toHaveCount(0)
  await expect(page.getByTestId('selection-inspector')).toBeVisible()
})

test('deleting a layer leaves its content standing, and undo gives the layer back', async ({ page }) => {
  await openLayersPlan(page)
  await openView(page, FLOOR_1)

  await expandRow(page, STRUCTURE)
  await page.getByTestId(`layer-delete-${STRUCTURE}`).click()
  await expect(page.getByTestId('delete-layer-dialog')).toBeVisible()
  await expect(page.getByTestId('delete-layer-confirm')).toBeVisible()
  await page.getByTestId('delete-layer-confirm').click()

  // The layer is gone from the list; the Walls it held are still drawn, because deletion is about
  // filing, not about the building (#71 §6).
  await expect(page.getByTestId(`layer-item-${STRUCTURE}`)).toHaveCount(0)
  await expect(page.getByTestId(`wall-band-${WALL}`)).toBeVisible()

  // And the content really is Unlayered now, which is what the inspector's Layer row reads.
  await openView(page, COMBINED)
  await page.getByTestId(`wall-band-${WALL}`).click()
  await expect(page.getByTestId('renovation-inspector-layer')).toHaveValue('')

  await undoButton(page).click()
  await expect(page.getByTestId(`layer-item-${STRUCTURE}`)).toBeVisible()
  await page.getByTestId(`wall-band-${WALL}`).click()
  await expect(page.getByTestId('renovation-inspector-layer')).toHaveValue(STRUCTURE)
})

test('a read-only layer is inspected and never edited', async ({ page }) => {
  await openLayersPlan(page)
  // `Option B · Combined` has made Structure read-only.
  await openView(page, COMBINED)
  await expect(page.getByTestId(`layer-mark-readonly-${STRUCTURE}`)).toBeVisible()

  await page.getByTestId(`wall-band-${WALL}`).click()

  // Selected, numbers on show, and the words that say why nothing can be typed.
  await expect(page.getByTestId('wall-inspector')).toBeVisible()
  await expect(page.getByTestId('renovation-inspector-readonly')).toHaveText(
    '[RO] Read-only in this view: inspect only.',
  )
  // No handles, and the Layer row is shut too.
  await expect(page.getByTestId(/^wall-handle-/)).toHaveCount(0)
  await expect(page.getByTestId('renovation-inspector-layer')).toBeDisabled()
  await expect(page.getByTestId('renovation-inspector-layer')).toHaveValue(STRUCTURE)
})
