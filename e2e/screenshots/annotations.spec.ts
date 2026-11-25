/**
 * The Annotations tab and overlay photographed (#81 §12).
 *
 * Four frames of one scene, because an Annotation is a row in a panel, a mark on a drawing, and an
 * editor with a type-specific set of controls — three surfaces that all have to say the same sentence:
 *
 *   - the Plan View with the panel docked on the Annotations tab, the overlay off, and the pill in the
 *     corner counting the Annotations rather than drawing them (#81 §3.3a);
 *   - the overlay switched on: a mark per Annotation the view can see, each carrying its reference;
 *   - a row selected: the row marked, its editor open with the text and the layer/scope fields;
 *   - a Reference Marker selected: the editor with its target view and the button that follows it.
 *
 * The scene is the Annotations seed (`scripts/make-annotations-seed.ts`): the services Floor migrated
 * to v16 and given one Annotation of each type. The clock is frozen so the toolbar's save line cannot
 * move between two runs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'annotations-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

async function openAnnotationsPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, seed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
  await waitForFonts(page)
  await waitForStablePaint(floorPlanCanvas(page))
  // The panel starts closed so the canvas keeps the width #55 gave it; these frames are about the
  // Annotations tab, so the helper brings it out and switches to that tab.
  await page.getByTestId('notes-panel-toggle').click()
  await expect(page.getByTestId('notes-panel')).toBeVisible()
  await page.getByTestId('notes-tab-annotations').click()
}

test.describe('the Annotations tab', () => {
  test('the Plan View with the panel docked: the overlay off', async ({ page }) => {
    await openAnnotationsPlan(page)
    await expect(page.getByTestId('notes-overlay-button')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('[data-testid^="mark-"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="annotation-rows"] > li')).toHaveCount(5)
    await expect(page).toHaveScreenshot('annotations-plan-default.png')
  })

  test('the overlay draws a mark per Annotation', async ({ page }) => {
    await openAnnotationsPlan(page)
    await page.getByTestId('notes-overlay-button').click()
    await expect(page.getByTestId('notes-overlay-button')).toHaveAttribute('aria-pressed', 'true')
    expect(await page.locator('[data-testid^="mark-"]').count()).toBeGreaterThan(0)
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('annotations-overlay-on.png')
  })

  test('a selected row opens its editor', async ({ page }) => {
    await openAnnotationsPlan(page)
    await page.getByTestId('annotation-select-A-001').click()
    await expect(page.getByTestId('annotation-editor')).toBeVisible()
    await expect(page.getByTestId('annotation-row-A-001')).toHaveAttribute('data-selected', 'true')
    await expect(page).toHaveScreenshot('annotations-editor.png')
  })

  test('a Reference Marker shows its target and the button that follows it', async ({ page }) => {
    await openAnnotationsPlan(page)
    await page.getByTestId('annotation-select-A-005').click()
    await expect(page.getByTestId('annotation-editor-go')).toBeVisible()
    await expect(page.getByTestId('annotation-editor-target')).toBeVisible()
    await expect(page).toHaveScreenshot('annotations-marker-editor.png')
  })
})
