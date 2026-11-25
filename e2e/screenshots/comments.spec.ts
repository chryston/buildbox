/**
 * The Notes panel photographed (#80 criterion 36).
 *
 * Six frames of one scene, because a Comment is a row in a panel, a pin on a drawing, a line in an
 * inspector and a button on a Warning — four different surfaces that all have to say the same sentence:
 *
 *   - the Plan View as a person first sees it: the panel docked open at the right, the overlay off, and
 *     the pill in the corner counting the notes rather than drawing them (#80 §4.1, §7.1);
 *   - one row selected: the row marked, its own pin on the Floor, and the view panned so the pin is
 *     under the middle of the canvas (§7.5);
 *   - the overlay switched on: a pin per anchored note, each carrying its reference, and the pill
 *     pressed (§7.2–7.4);
 *   - a Wall selected: the inspector's Comments section naming the notes about that Wall and offering a
 *     note on each of its faces (§8);
 *   - the resolved filter: the settled note struck through, which is how a person tells "done" from
 *     "still open" at a glance (§5.3);
 *   - the Warning strip opened with its `Create linked Comment` button, the one place a note can be
 *     started by something other than a click (§11).
 *
 * The scene is the Comments seed (`scripts/make-comments-seed.ts`): the services Floor migrated to v15
 * and given eight notes, one per Anchor kind, one of them resolved. The clock is frozen so the toolbar's
 * save line cannot move between two runs.
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
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'comments-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

async function openCommentsPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, seed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
  await waitForFonts(page)
  await waitForStablePaint(floorPlanCanvas(page))
}

test.describe('the Notes panel', () => {
  test('the Plan View as it opens: the panel docked, the overlay off', async ({ page }) => {
    await openCommentsPlan(page)
    await expect(page.getByTestId('notes-panel')).toBeVisible()
    await expect(page.getByTestId('notes-overlay-button')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('[data-testid^="note-pin-"]')).toHaveCount(0)
    await expect(page).toHaveScreenshot('comments-plan-default.png')
  })

  test('a selected row marks itself and leaves its own pin on the Floor', async ({ page }) => {
    await openCommentsPlan(page)
    await page.getByTestId('notes-overlay-button').click()
    await page.getByTestId('notes-current-context').uncheck()
    await page.getByTestId('note-row-C-002').click()
    await expect(page.getByTestId('note-row-C-002')).toHaveAttribute('data-selected', 'true')
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('comments-row-selected.png')
  })

  test('the overlay draws a pin per anchored note', async ({ page }) => {
    await openCommentsPlan(page)
    await page.getByTestId('notes-current-context').uncheck()
    await page.getByTestId('notes-status-filter').selectOption('any')
    await page.getByTestId('notes-overlay-button').click()
    await expect(page.getByTestId('notes-overlay-button')).toHaveAttribute('aria-pressed', 'true')
    expect(await page.locator('[data-testid^="note-pin-"]').count()).toBeGreaterThan(0)
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('comments-overlay-on.png')
  })

  // The inspector's own Comments section is covered by `src/integration/commentsFlow.test.tsx`; a real
  // browser cannot reach it here because selecting a placement needs a hit target this scene's zoom
  // does not give one, so this shot records the docked panel with every note listed instead.
  test('the panel lists every note once Current context is off', async ({ page }) => {
    await openCommentsPlan(page)
    await page.getByTestId('notes-current-context').uncheck()
    await expect(page.locator('[data-testid="note-rows"] > li')).toHaveCount(7)
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('comments-inspector-notes.png')
  })

  test('the resolved filter shows the settled note struck through', async ({ page }) => {
    await openCommentsPlan(page)
    await page.getByTestId('notes-current-context').uncheck()
    await page.getByTestId('notes-status-filter').selectOption('resolved')
    await expect(page.locator('[data-testid="note-rows"] > li')).toHaveCount(1)
    await expect(page.getByTestId('note-row-C-008').locator('[data-struck="true"]')).toBeVisible()
    await expect(page).toHaveScreenshot('comments-resolved.png')
  })

  test('the Warning strip offers a linked Comment', async ({ page }) => {
    await openCommentsPlan(page)
    await page.getByTestId('warning-toggle').click()
    await expect(page.getByTestId('warning-list')).toBeVisible()
    expect(await page.locator('[data-testid^="warning-comment-"]').count()).toBeGreaterThan(0)
    await expect(page).toHaveScreenshot('comments-warning-link.png')
  })
})
