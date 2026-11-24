/**
 * The Skirting photographed (#78 criteria 4, 5, 8, 9, 13, 16).
 *
 * Four frames of one scene, because a Skirting is a thin band on a plan, a face named in words while
 * the tool is in hand, a row in a Section and a line in a table, and each of those is a different
 * promise:
 *
 *   - the Plan View with both strips drawn: each one a band `thickness` off the face of the Wall it is
 *     skirted to, with its own label beside it, and neither of them hiding the Wall (#78 criterion 8);
 *   - the tool in hand over a bare face: the face acquired under the pointer and named by the Room it
 *     borders, or by its own stable number where no Room claims it — never `L`, `R` or `left`
 *     (criteria 4, 5);
 *   - the Section with one strip selected: the band between its Bottom and its Top, and the inspector
 *     holding the numbers the record is made of (criterion 9);
 *   - the Skirting table as the export writes it, which is where a strip that documents existing work
 *     has to appear for a builder to read it (criterion 13).
 *
 * The scene is the #78 fixture (`scripts/make-skirting-seed.ts`): the Floor with `Skirting SK-1` at
 * the foot of `W-1`, `Skirting SK-3` on `W-4`, and the `Kitchen section` stood on a line at y = −400
 * looking at `W-1`. The clock is frozen so the toolbar's save line cannot move between two runs.
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
const skirtingSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'skirting.json'), 'utf8'),
) as PreviewSeed
const projectName = skirtingSeed.library.find((record) => record.id === skirtingSeed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const scene0 = skirtingSeed.projects[0]!.data as unknown as Project
const section = scene0.elevationViews!.find((view) => view.name === 'Kitchen section')!
const SKIRTING_1 = scene0.existingModel.skirting!.find((each) => each.label === 'Skirting SK-1')!.id
/** `W-2`, the right-hand Wall of the Flat, which the fixture leaves bare on both faces. */

async function openSkirtingPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, skirtingSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

test.describe('the Skirting', () => {
  test('the Plan View draws both strips with their labels beside the walls they hug', async ({ page }) => {
    await openSkirtingPlan(page)
    // Both records are on the surface, and each carries its own name.
    await expect(page.locator('[data-testid="floor-plan-canvas"] [data-ref-role="skirting"]')).not.toHaveCount(0)
    const labels = page.locator('[data-testid="floor-plan-canvas"] text', { hasText: 'Skirting SK-' })
    await expect(labels).toHaveCount(2)
    await waitForFonts(page)
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('skirting-plan.png')
  })

  test('the tool names the face under the pointer in words a person would use', async ({ page }) => {
    await openSkirtingPlan(page)
    await page.getByTestId('tool-skirting').click()
    const pane = (await floorPlanCanvas(page).boundingBox())!
    // A face target runs its Wall's whole length, and a Wall can stand wholly outside the part of the
    // plan the pane shows. The pointer goes to a face the plan actually offers on screen, which is the
    // only one a person could hover.
    const offered = await page.$$eval('[data-testid^="skirting-face-hit-"]', (nodes) =>
      nodes.map((node) => ({
        testId: node.getAttribute('data-testid') ?? '',
        box: node.getBoundingClientRect(),
      })),
    )
    const onScreen = offered.find(
      (each) =>
        each.box.left >= pane.x &&
        each.box.right <= pane.x + pane.width &&
        each.box.top >= pane.y &&
        each.box.bottom <= pane.y + pane.height &&
        each.box.width + each.box.height > 40,
    )
    expect(onScreen).toBeDefined()
    await page.mouse.move(onScreen!.box.x + onScreen!.box.width / 2, onScreen!.box.y + onScreen!.box.height / 2, {
      steps: 4,
    })
    // The acquired face, its length and the Height the bar is holding — and no `left` or `right` in it.
    const label = page.getByTestId('skirting-face-label')
    await expect(label).toBeVisible()
    await expect(label).not.toContainText(/\bleft\b|\bright\b/)
    await waitForFonts(page)
    await expect(page).toHaveScreenshot('skirting-tool-face.png')
  })

  test('the Section shows the band the strip occupies, selected and editable', async ({ page }) => {
    await openSkirtingPlan(page)
    await page.getByTestId('elevation-view-picker').selectOption(section.id)
    await expect(page.getByTestId('elevation-pane')).toBeVisible()
    const row = page.locator(`[data-testid="elevation-canvas"] [data-ref="${SKIRTING_1}"]`).first()
    const box = (await row.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    // The two numbers the record is made of, and the Top that is their sum.
    await expect(page.getByTestId('skirting-field-bottom')).toHaveValue('0')
    await expect(page.getByTestId('skirting-field-height')).toHaveValue('100')
    await expect(page.getByTestId('skirting-field-top')).toContainText('100')
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('elevation-pane'))
    await expect(page).toHaveScreenshot('skirting-section-selected.png')
  })

  test('the Skirting table offers both records, with the rows it will write', async ({ page }) => {
    await openSkirtingPlan(page)
    await page.getByTestId('export-open').click()
    await page.getByTestId('export-tab-lists').click()
    await page.getByTestId('export-lists-table-skirting').check()
    // Two records, two rows: the table is the Builder's copy of what the Plan View drew.
    await expect(page.getByTestId('export-lists-rows-skirting')).toContainText('2')
    await waitForFonts(page)
    await expect(page).toHaveScreenshot('skirting-table.png')
  })
})
