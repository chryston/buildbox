/**
 * The Beam photographed (#77 criteria 7, 12, 13, 18).
 *
 * Three frames of one scene, because a Beam is a rectangle on a plan, a row in a Section and a line
 * in a table, and each of those is a different promise:
 *
 *   - the Plan View with both Beams drawn: each one a filled body whose width is the record's width,
 *     with its own label beside it, and neither of them hiding the Wall it crosses (#77 criterion 7);
 *   - the Section with one Beam selected: the band the record occupies between its Underside and its
 *     Top, its body handle on it, and the inspector holding the four numbers the drag writes
 *     (criteria 12, 13, 18);
 *   - the Beams table as the export writes it, which is where a Beam that documents existing work
 *     has to appear for a builder to read it (criterion 13).
 *
 * The scene is the #77 fixture (`scripts/make-beams-seed.ts`): the #76 Floor with two Beams across
 * it and the `Kitchen section` stood on a line at y = −400 looking at the first. The clock is frozen
 * so the toolbar's save line cannot move between two runs.
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
const beamsSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'beams.json'), 'utf8'),
) as PreviewSeed
const projectName = beamsSeed.library.find((record) => record.id === beamsSeed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const scene0 = beamsSeed.projects[0]!.data as unknown as Project
const section = scene0.elevationViews!.find((view) => view.name === 'Kitchen section')!
const BEAM_1 = scene0.existingModel.beams!.find((beam) => beam.label === 'Beam B-1')!.id

async function openBeamsPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, beamsSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

async function openSection(page: Page): Promise<void> {
  await openBeamsPlan(page)
  await page.getByTestId('elevation-view-picker').selectOption(section.id)
  await expect(page.getByTestId('elevation-pane')).toBeVisible()
}

test.describe('the Beam', () => {
  test('the Plan View draws both Beams with their labels over the walls they cross', async ({ page }) => {
    await openBeamsPlan(page)
    // Both records are on the surface, and each carries its own name.
    await expect(page.getByTestId(`beam-${BEAM_1}`).first()).toBeVisible()
    const labels = page.locator('[data-testid="floor-plan-canvas"] text', { hasText: 'Beam B-' })
    await expect(labels).toHaveCount(2)
    await waitForFonts(page)
    await waitForStablePaint(floorPlanCanvas(page))
    await expect(page).toHaveScreenshot('beams-plan.png')
  })

  test('the Section shows the band the Beam occupies, selected and editable', async ({ page }) => {
    await openSection(page)
    const face = await page.locator(`[data-testid="elevation-canvas"] [data-ref="${BEAM_1}"]`).first().boundingBox()
    await page.mouse.click(face!.x + face!.width / 2, face!.y + face!.height / 2)
    // The four numbers the record is made of, and the handle that moves the lower one.
    await expect(page.getByTestId('beam-field-underside')).toHaveValue('2300')
    await expect(page.getByTestId('beam-field-top')).toContainText('2,600')
    await expect(page.getByTestId('elevation-handle-bottom')).toBeVisible()
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('elevation-pane'))
    await expect(page).toHaveScreenshot('beams-section-selected.png')
  })

  test('the Beams table offers both records, with the rows it will write', async ({ page }) => {
    await openBeamsPlan(page)
    await page.getByTestId('export-open').click()
    await page.getByTestId('export-tab-lists').click()
    await page.getByTestId('export-lists-table-beams').check()
    // Two records, two rows: the table is the Builder's copy of what the Plan View drew.
    await expect(page.getByTestId('export-lists-rows-beams')).toContainText('2')
    await waitForFonts(page)
    await expect(page).toHaveScreenshot('beams-table.png')
  })
})

