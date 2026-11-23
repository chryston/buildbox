/**
 * The Elevation View photographed (#75 criteria 8, 10, 11, 14, 16).
 *
 * Two frames of one scene, because an Elevation View is a picture before it is a number:
 *
 *   - the split workspace itself: the Plan View and the Elevation View side by side, the pane
 *     drawing the room standing on its Floor Datum — the run of cabinets below their Base heights,
 *     the `Sump box` sunk under the Datum line, the ruler reading up to `Upper limit 2600`
 *     (criteria 8, 14, 16);
 *   - the same pane with one thing selected: the Sump box's own row highlighted, its body handle on
 *     it, and the inspector holding the Vertical Extent rows the drag writes (criteria 10, 11).
 *
 * The scene is the #75 fixture (`scripts/make-elevation-seed.ts`): the same 4 m × 3 m shell the Plan
 * View Range was photographed in, with the `Kitchen elevation` stood on a line across the room at
 * y = 1 400 and looking at the run of cabinets. The clock is frozen so the toolbar's save line
 * cannot move between two runs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'
import type { Project } from '../../src/domain'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const elevationSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'elevation.json'), 'utf8'),
) as PreviewSeed
const projectName = elevationSeed.library.find((record) => record.id === elevationSeed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const scene0 = elevationSeed.projects[0]!.data as unknown as Project
const kitchen = scene0.elevationViews!.find((view) => view.name === 'Kitchen elevation')!
const SUMP = scene0.existingModel.placedItems
  .find((item) => scene0.itemDesigns.find((design) => design.id === item.itemDesignId)?.name === 'Sump box')!
  .id

async function openElevationPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, elevationSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
  await page.getByTestId('elevation-view-picker').selectOption(kitchen.id)
  await expect(page.getByTestId('elevation-pane')).toBeVisible()
}

test.describe('the Elevation View', () => {
  test('the split workspace holds the Plan View and the room stood in front of it', async ({ page }) => {
    await openElevationPlan(page)
    // The room stands on its Datum rather than hanging from it: the words that name the upper limit
    // are above the words that name the Datum.
    const datumY = (await page.locator('[data-testid="elevation-canvas"] text', { hasText: 'Floor Datum' })
      .first().boundingBox())!.y
    const limitY = (await page.locator('[data-testid="elevation-canvas"] text', { hasText: 'Upper limit' })
      .first().boundingBox())!.y
    expect(limitY).toBeLessThan(datumY)
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('elevation-pane'))
    await expect(page).toHaveScreenshot('elevation-split-workspace.png')
  })

  test('one row selected: its own face, its handle, and the rows the drag writes', async ({ page }) => {
    await openElevationPlan(page)
    const face = await page.locator(`[data-testid="elevation-canvas"] [data-ref="${SUMP}"]`).first().boundingBox()
    await page.mouse.click(face!.x + face!.width / 2, face!.y + face!.height / 2)
    // The Sump box is sunk below the Plan View Range, so this is a selection the Plan View could not
    // have been clicked for — and it reaches the inspector all the same.
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('-150')
    await expect(page.getByTestId('elevation-handle-body')).toBeVisible()
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('elevation-pane'))
    await expect(page).toHaveScreenshot('elevation-selected-sump.png')
  })
})
