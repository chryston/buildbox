/**
 * Annotations through the real browser (#81 §12).
 *
 * The gestures a person makes, in order: the five seeded Annotations are listed on the Annotations
 * tab; the overlay is switched on and the marks appear; a mark is clicked and its row and editor take
 * the focus; the editor writes a new text. Then the two paths that need a real drawing: the Text tool
 * drops a new Annotation where it was clicked, and Escape mid-placement leaves nothing behind. Finally
 * the Reference Marker's `Go to view` moves the canvas to the view it points at.
 *
 * The scene is the Annotations seed (`scripts/make-annotations-seed.ts`): the services Floor migrated
 * to v16 and given one Annotation of each type, plus a second Plan View for the marker to target.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'annotations-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name

const rows = (page: Page) => page.locator('[data-testid="annotation-rows"] > li')

async function openScene(page: Page): Promise<void> {
  await seedPreviewDb(page, seed)
  await page.goto('/')
  await waitForFonts(page)
  await openProjectFromLibrary(page, projectName)
  await floorPlanCanvas(page).waitFor()
  // The panel starts closed so the canvas keeps the width #55 gave it; every case here is about the
  // Annotations tab, so the helper brings the panel out and switches to that tab.
  await page.getByTestId('notes-panel-toggle').click()
  await expect(page.getByTestId('notes-panel')).toBeVisible()
  await page.getByTestId('notes-tab-annotations').click()
  await expect(rows(page)).toHaveCount(5)
}

test.describe('Annotations (#81)', () => {
  test('lists the five types, reveals the marks with the overlay, and opens one from its mark', async ({ page }) => {
    await openScene(page)

    // The five seeded Annotations are listed, each by its reference and type.
    await expect(page.getByTestId('annotation-row-A-001')).toContainText('Text')
    await expect(page.getByTestId('annotation-row-A-005')).toContainText('Reference Marker')

    // The overlay is off by default, so no marks are drawn; the pill turns them on (#81 §3.3a).
    await expect(page.locator('[data-testid^="mark-"]')).toHaveCount(0)
    const pill = page.getByTestId('notes-overlay-button')
    await expect(pill).toHaveAttribute('aria-pressed', 'false')
    await pill.click()
    await expect(pill).toHaveAttribute('aria-pressed', 'true')
    expect(await page.locator('[data-testid^="mark-"]').count()).toBeGreaterThan(0)

    // Clicking a mark opens the editor for that Annotation with its row selected (#81 §7).
    await page.getByTestId('mark-annotation-A-001').click({ force: true })
    await expect(page.getByTestId('annotation-editor')).toBeVisible()
    await expect(page.getByTestId('annotation-row-A-001')).toHaveAttribute('data-selected', 'true')
  })

  test('the editor writes a new text on Enter (#81 §7)', async ({ page }) => {
    await openScene(page)
    await page.getByTestId('annotation-select-A-001').click()
    const box = page.getByTestId('annotation-editor-text')
    await box.fill('Clear height confirmed with the engineer')
    await box.press('Enter')
    await expect(page.getByTestId('annotation-row-A-001')).toContainText('Clear height confirmed with the engineer')
  })

  test('the Text tool drops a new Annotation where it was clicked, and Escape leaves nothing', async ({ page }) => {
    await openScene(page)
    // Marks draw only with the overlay on, and the tool needs the overlay to place against (#81 §3.3a).
    const pill = page.getByTestId('notes-overlay-button')
    if ((await pill.getAttribute('aria-pressed')) !== 'true') await pill.click()

    await page.getByTestId('renovation-tool-annotationText').click()
    await expect(page.getByTestId('annotation-tool-hint')).toBeVisible()

    // Escape mid-placement leaves the count unchanged (#81 §3.3a).
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('annotation-tool-hint')).toHaveCount(0)
    await expect(rows(page)).toHaveCount(5)

    // A click places one Annotation and the tool is spent: one press, one mark (#81 §3.3a). The
    // click lands on a placed Item, which the armed Text tool places on rather than selecting.
    await page.getByTestId('renovation-tool-annotationText').click()
    await floorPlanCanvas(page).locator('[data-ref-role="placed-item"]').first().click()
    await expect(rows(page)).toHaveCount(6)
    await expect(page.getByTestId('annotation-tool-hint')).toHaveCount(0)
  })

  test('the Reference Marker moves the canvas to the view it points at (#81 §7)', async ({ page }) => {
    await openScene(page)
    await page.getByTestId('annotation-select-A-005').click()
    const go = page.getByTestId('annotation-editor-go')
    await expect(go).toBeVisible()
    // Following the marker leaves the owning view, so with Current context on its row is no longer
    // listed — the canvas has moved to the target view.
    await go.click()
    await expect(page.getByTestId('annotation-row-A-005')).toHaveCount(0)
  })
})
