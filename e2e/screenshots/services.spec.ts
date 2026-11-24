/**
 * The Services photographed (#79 criteria 1–3, 7–9).
 *
 * Four frames of one scene, because a Service is a hairline on a plan, a bar in a Section, a row in a
 * table, and a form holding one stored centreline — and each of those is a different promise:
 *
 *   - the Plan View with every Service drawn: each Run a band of its own width along its centreline,
 *     each Riser a circle, and every one labelled by its Kind code and its size — `W Ø50`, `AC 80×60`
 *     — never by an invented `Service S-1` (#79 §Naming);
 *   - the tool in hand with a Run already anchored: the rubber line with its live length, the bar
 *     saying in words which of the two shapes it is waiting for, and the placeholders captioned
 *     `measure yours` because there is no size table (#79 criteria 1–3);
 *   - the Section with one Service selected: the bar between its Bottom and its Top, and the inspector
 *     holding the numbers the record is made of (#79 criteria 7–8);
 *   - the Services table as the export writes it, which is where a Run that documents coordination has
 *     to appear for a builder to read it (#79 criterion 9).
 *
 * The scene is the #79 fixture (`scripts/make-service-seed.ts`): the Floor with two Runs, a Riser, an
 * underfloor trunking Run, one Proposed Run in `option-a`, and the `Service section` stood on a line
 * through the Riser. The clock is frozen so the toolbar's save line cannot move between two runs.
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
const servicesSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'services.json'), 'utf8'),
) as PreviewSeed
const projectName = servicesSeed.library.find((record) => record.id === servicesSeed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const scene0 = servicesSeed.projects[0]!.data as unknown as Project
const section = scene0.elevationViews!.find((view) => view.name === 'Service section')!
/** The underfloor trunking Run, whose Bottom is negative — the Section's most legible bar. */
const TRUNKING = scene0.existingModel.services!.find((each) => each.label === 'Underfloor trunking')!.id

async function openServicesPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, servicesSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

test.describe('the Services', () => {
  test('the Plan View draws every Run and Riser with its Kind and size beside it', async ({ page }) => {
    await openServicesPlan(page)
    // Both shapes are on the surface, and each carries its own Kind-and-size name.
    await expect(page.locator('[data-testid="floor-plan-canvas"] [data-ref-role="service"]')).not.toHaveCount(0)
    await expect(page.locator('[data-testid="floor-plan-canvas"] text', { hasText: 'W Ø50' })).not.toHaveCount(0)
    await expect(page.locator('[data-testid="floor-plan-canvas"] text', { hasText: 'D Ø100' })).not.toHaveCount(0)
    // No invented schedule number ever reaches the surface.
    await expect(page.locator('[data-testid="floor-plan-canvas"] text', { hasText: 'S-1' })).toHaveCount(0)
    await waitForFonts(page)
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('services-plan.png')
  })

  test('the tool holds a Run mid-draw, with the rubber line and the placeholders', async ({ page }) => {
    await openServicesPlan(page)
    await page.getByTestId('tool-service').click()
    await expect(page.getByTestId('service-tool-layer')).toBeVisible()
    const pane = (await floorPlanCanvas(page).boundingBox())!
    await page.mouse.click(pane.x + 140, pane.y + 300)
    await page.mouse.move(pane.x + 340, pane.y + 300)
    // The line, its length, and the words that say a second click finishes the Run.
    await expect(page.getByTestId('service-rubber')).toBeVisible()
    await expect(page.getByTestId('service-rubber-length')).not.toHaveText('')
    await expect(page.getByTestId('service-tool-hint')).toContainText('other end')
    // The size is a placeholder, and it says so: there is no size table to pick from.
    await expect(page.getByTestId('service-draft-outsideDiameter-caption')).toContainText('measure yours')
    await waitForFonts(page)
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('services-tool-run.png')
  })

  test('the tool switches to a Riser and asks for one click', async ({ page }) => {
    await openServicesPlan(page)
    await page.getByTestId('tool-service').click()
    await page.getByTestId('service-shape-riser').click()
    // A Riser is round: the bar offers a Diameter and no Section at all.
    await expect(page.getByTestId('service-draft-section')).toHaveCount(0)
    await expect(page.getByTestId('service-draft-outsideDiameter')).toBeVisible()
    await expect(page.getByTestId('service-tool-hint')).toContainText('Click where the Riser stands')
    const pane = (await floorPlanCanvas(page).boundingBox())!
    await page.mouse.move(pane.x + 260, pane.y + 380)
    await waitForFonts(page)
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('services-tool-riser.png')
  })

  test('the Section shows the bar the Service occupies, selected and editable', async ({ page }) => {
    await openServicesPlan(page)
    await page.getByTestId('elevation-view-picker').selectOption(section.id)
    await expect(page.getByTestId('elevation-pane')).toBeVisible()
    const row = page.locator(`[data-testid="elevation-canvas"] [data-ref="${TRUNKING}"]`).first()
    await row.waitFor()
    const box = (await row.boundingBox())!
    // The Service lies behind the Wall it passes, so the cycle behind the click walks to it (#70 §18).
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      if (await page.getByTestId('service-inspector').isVisible()) break
    }
    await expect(page.getByTestId('service-inspector')).toBeVisible()
    // The trunking Run stores a centreline of -100 and a Ø100, so its Bottom is -150 and its Top -50
    // — the extent the drawing and the Services table both publish. The boxes are disabled here: the
    // Project carries an Option, so this baseline record is locked until `Correct Existing Model`
    // (#70 §7c), which is itself worth the frame.
    await expect(page.getByTestId('inspector-service-bottom')).toHaveValue('-150')
    await expect(page.getByTestId('inspector-service-diameter')).toHaveValue('100')
    await expect(page.getByTestId('inspector-service-extent')).toContainText('-150 – -50 mm')
    // The inspector lives in a scrolling sidebar; a frame that photographs the Section but not the
    // numbers it is supposed to prove has photographed nothing.
    await page.getByTestId('service-inspector').scrollIntoViewIfNeeded()
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('elevation-pane'))
    await expect(page).toHaveScreenshot('services-section-selected.png')
  })

  test('the Services table offers every record, with the rows it will write', async ({ page }) => {
    await openServicesPlan(page)
    await page.getByTestId('export-open').click()
    await page.getByTestId('export-tab-lists').click()
    await page.getByTestId('export-lists-table-services').check()
    // Four surveyed records, four rows. The Proposed Run in `option-a` is not in the list: the Lists
    // panel publishes the Existing Model, which is the Builder's copy of what was surveyed (#79 §8).
    await expect(page.getByTestId('export-lists-rows-services')).toContainText('4')
    await waitForFonts(page)
    await expect(page).toHaveScreenshot('services-table.png')
  })
})
