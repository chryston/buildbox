/**
 * The Plan View Range photographed (#74 criteria 3, 4, 6–10, 13, 16).
 *
 * Four frames of one scene, because a range is a thing you see:
 *
 *   - the saved-view card holding the range the view carries — the two fields, the gauge with its
 *     two stops at `Lower 0` and `Upper 1200`, the legend — beside a Plan View where `Base cabinet`
 *     is in range in the normal graphics, `Wall cabinet` above it is dashed, and the sunk
 *     `Sump box` below it is the same ink faded (criteria 3, 4, 6, 7, 8);
 *   - the candidate list after the second click inside the two cabinets that share a footprint,
 *     standing at `2 of 2` with the row saying `Above range` (criteria 9, 10);
 *   - the Placed Item inspector's Vertical Extent rows, where the height line names the Item
 *     Design the height is shared with (criteria 13, 16);
 *
 * The scene is the #74 fixture (`scripts/make-plan-range-seed.ts`): a 4 m × 3 m shell, a Window at
 * 900–2 100, `Base cabinet` twice at Base 0, `Wall cabinet` at Base 1 500 standing over the first,
 * and a `Sump box` sunk 150 below the Floor Datum. The clock is frozen so the toolbar's save line
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
const planRangeSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'plan-range.json'), 'utf8'),
) as PreviewSeed
const projectName = planRangeSeed.library.find((record) => record.id === planRangeSeed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const scene0 = planRangeSeed.projects[0]!.data as unknown as Project
const designId = (name: string): string =>
  scene0.itemDesigns.find((design) => design.name === name)!.id
const placedId = (name: string): string =>
  scene0.existingModel.placedItems.find((item) => item.itemDesignId === designId(name))!.id
const BASE = placedId('Base cabinet')
const WALL_CAB = placedId('Wall cabinet')
const SUMP = placedId('Sump box')


type Pt = { x: number, y: number }

/** One click at a Floor point, through the Plan View's own transform. */
async function clickMm(page: Page, mm: Pt, offset: Pt = { x: 0, y: 0 }): Promise<void> {
  const canvas = floorPlanCanvas(page)
  const box = await canvas.boundingBox()
  const matrix = /matrix\(([^,]+),0,0,[^,]+,([^,]+),([^)]+)\)/
    .exec(await canvas.locator('g').first().getAttribute('transform') ?? '')
  if (box === null || matrix === null) throw new Error('the Plan View has no scene to click in')
  const zoom = Number(matrix[1])
  await page.mouse.click(box.x + mm.x * zoom + Number(matrix[2]) + offset.x, box.y + mm.y * zoom + Number(matrix[3]) + offset.y)
}

/** Both cabinets stand on the same 600 × 500 footprint centred on this point. */
const STACK: Pt = { x: 600, y: 600 }

async function openRangePlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, planRangeSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

test.describe('the Plan View Range', () => {
  test('the card holds the range and the Plan View classes the scene by it', async ({ page }) => {
    await openRangePlan(page)
    await expect(page.getByTestId('range-stop-upper-label')).toHaveText('Upper 1200')
    // In range is the normal graphics; Above range carries a dash; Below range is the same ink
    // faded. None of the three is hidden, and all three are still on the canvas.
    await expect(page.locator(`[data-testid="placed-object-${BASE}"] path`).first()).toHaveCSS('stroke-dasharray', 'none')
    await expect(page.locator(`[data-testid="placed-object-${WALL_CAB}"] path`).first()).not.toHaveCSS('stroke-dasharray', 'none')
    await expect(page.locator(`[data-testid="placed-object-${SUMP}"] path`).first()).toHaveCSS('opacity', '0.28')
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('plan-view-range-section'))
    await expect(page).toHaveScreenshot('plan-range-card-and-canvas.png')
  })

  test('the second click inside a shared footprint stands at 2 of 2', async ({ page }) => {
    await openRangePlan(page)
    await clickMm(page, STACK)
    await clickMm(page, STACK, { x: 4, y: 4 })
    await expect(page.getByTestId('overlap-header')).toContainText('2/2')
    await expect(page.locator(`[data-testid="overlap-row-${WALL_CAB}"]`)).toContainText('Above range')
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('overlap-cycle'))
    await expect(page).toHaveScreenshot('plan-range-cycle.png')
  })

  test('the Placed Item inspector reads its extent, with the height it shares', async ({ page }) => {
    await openRangePlan(page)
    await clickMm(page, STACK)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('placed-extent')).toBeVisible()
    await expect(page.getByTestId('placed-extent-height-line')).toContainText('from Item Design Base cabinet')
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('placed-extent'))
    await expect(page).toHaveScreenshot('plan-range-placed-extent.png')
  })
})
