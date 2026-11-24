/**
 * A Beam through the real browser (#77 criteria 1, 2, 5, 6, 12, 13, 16, 17, 19).
 *
 * One Beam drawn from nothing, then lived with: the tool's two clicks and the bar's numbers, the
 * record answering a click on the Plan View, the same record standing in the Section at the height
 * the inspector says it is, the Underside moved by its handle with the Top held where it was, the
 * half-drawn line put down with Escape and nothing written, the record deleted and returned by one
 * Undo, and the Beams table offering its rows to the export.
 *
 * The scene is the #77 fixture without its Design Options (`scripts/make-beams-seed.ts`): the Floor
 * with `Beam B-1` lying on the section line at y = −400 and `Beam B-2` across the room at y = 1 200.
 * No Option means nothing shares these records, so each gesture commits as it always did — the
 * locked-baseline half of #70 §7c is `existingDisplay`'s to test, for every kind at once. The new
 * Beam is drawn clear of both, so its label is the third and its geometry cannot be confused with a
 * record the fixture already carried.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts } from '../support/stability'
import type { Project } from '../../src/domain'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'beams-plain.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name

const scene0 = seed.projects[0]!.data as unknown as Project
const section = scene0.elevationViews!.find((view) => view.name === 'Kitchen section')!
const BEAM_1 = scene0.existingModel.beams!.find((beam) => beam.label === 'Beam B-1')!.id

/** The Plan View's Beam bodies, which is the record count read off the surface. */
const beamBodies = (page: Page): Locator =>
  page.locator('[data-testid="floor-plan-canvas"] [data-ref-role="beam"]')

/** One click of the Beam tool's two. The draft layer owns the canvas while the tool is in hand. */
async function clickDraft(page: Page, x: number, y: number): Promise<void> {
  const layer = page.getByTestId('beam-draft-overlay')
  await layer.click({ position: { x, y }, force: true })
}

/**
 * The Beam under the pointer, reached the way a person reaches it: where a Wall is painted over the
 * Beam the first click takes the Wall and the cycle moves on (#70 §18), so the same point is
 * clicked until the record that answers is the Beam.
 */
async function pickBeam(page: Page, body: Locator): Promise<void> {
  const box = (await body.boundingBox())!
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    if (await page.getByTestId('beam-inspector').isVisible()) return
  }
  throw new Error('the Beam never answered the pointer at its own middle')
}

async function openPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, seed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

test.describe('a Beam', () => {
  test('is drawn by the tool, named for the next free label, and answers a click', async ({ page }) => {
    await openPlan(page)
    const before = await beamBodies(page).count()

    await page.getByTestId('tool-beam').click()
    await expect(page.getByTestId('beam-draft-overlay')).toBeVisible()
    await clickDraft(page, 260, 300)
    await clickDraft(page, 520, 300)
    await expect(page.getByTestId('beam-draft-done')).toBeEnabled()
    // The bar's own numbers, changed before the press that commits them.
    await page.getByTestId('beam-draft-width').fill('150')
    await page.getByTestId('beam-draft-underside').fill('2100')
    await page.getByTestId('beam-draft-done').click()

    // A third record, and the third label: the names are the Project's, not the tool's guess.
    await expect(beamBodies(page)).toHaveCount(before + 1)
    await expect(page.locator('[data-testid="floor-plan-canvas"] text', { hasText: 'Beam B-3' })).toBeVisible()

    // It answers the pointer where it lies.
    await pickBeam(page, beamBodies(page).last())
    await expect(page.getByTestId('beam-field-label')).toHaveValue('Beam B-3')
    await expect(page.getByTestId('beam-field-width')).toHaveValue('150')
    await expect(page.getByTestId('beam-field-underside')).toHaveValue('2100')
    // Depth 300 on an Underside of 2 100: the printed Top is the sum, never a box of its own.
    await expect(page.getByTestId('beam-field-top')).toContainText('2,400')
  })

  test('puts a half-drawn line down on Escape with nothing written', async ({ page }) => {
    await openPlan(page)
    const before = await beamBodies(page).count()
    await page.getByTestId('tool-beam').click()
    await clickDraft(page, 260, 300)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('beam-draft-overlay')).toHaveCount(0)
    await expect(page.getByTestId('tool-beam')).not.toHaveAttribute('aria-pressed', 'true')
    await expect(beamBodies(page)).toHaveCount(before)
  })

  test('stands in the Section, moves its Underside by a handle, and keeps its Top', async ({ page }) => {
    await openPlan(page)
    await page.getByTestId('elevation-view-picker').selectOption(section.id)
    await expect(page.getByTestId('elevation-pane')).toBeVisible()

    // The same record, picked from the Section rather than the Plan View.
    const row = page.locator(`[data-testid="elevation-canvas"] [data-ref="${BEAM_1}"]`).first()
    const rowBox = (await row.boundingBox())!
    await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
    await expect(page.getByTestId('beam-inspector')).toBeVisible()
    await expect(page.getByTestId('beam-field-underside')).toHaveValue('2300')
    await expect(page.getByTestId('beam-field-top')).toContainText('2,600')

    // The lower handle, dragged down: the Top stays and the Depth is what changes.
    const handle = page.getByTestId('elevation-handle-bottom')
    const handleBox = (await handle.boundingBox())!
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 120, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByTestId('beam-field-underside')).not.toHaveValue('2300')
    await expect(page.getByTestId('beam-field-top')).toContainText('2,600')

    // One selection, seen in both panes at once.
    await expect(page.locator(`[data-testid="elevation-drag-layer"]`)).toHaveAttribute('data-row', BEAM_1)
  })

  test('is deleted and returned by one Undo, and offered to the export', async ({ page }) => {
    await openPlan(page)
    await page.getByTestId('export-open').click()
    await page.getByTestId('export-tab-lists').click()
    await expect(page.getByTestId('export-lists-rows-beams')).toContainText('2')
    await page.getByTestId('export-lists-close').click()

    // The Section reaches the record the Plan View paints under the run of cabinets. Picked after
    // the export closed, because closing the dialog takes the selection back with it.
    await page.getByTestId('elevation-view-picker').selectOption(section.id)
    const rowBox = (
      await page.locator(`[data-testid="elevation-canvas"] [data-ref="${BEAM_1}"]`).first().boundingBox()
    )!
    await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
    await expect(page.getByTestId('beam-inspector')).toBeVisible()

    await page.getByTestId('beam-delete').click()
    await expect(page.getByTestId('beam-inspector')).toHaveCount(0)
    await expect(beamBodies(page)).toHaveCount(1)

    await page.getByTestId('undo-button').click()
    await expect(beamBodies(page)).toHaveCount(2)
    await waitForFonts(page)
  })
})
