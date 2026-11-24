/**
 * A Skirting through the real browser (#78 criteria 3, 4, 5, 6, 7, 9, 11, 13, 15, 17).
 *
 * One strip drawn on a face nobody had skirted, then lived with: the tool's one click and the bar's
 * three numbers, the record answering a click on the Plan View with the two names the issue asks for,
 * the same record standing in the Section at the Bottom and Top the inspector prints, the face flipped
 * and the other face filled by a second record, the strip deleted and returned by one Undo, and the
 * Skirting table offering its rows to the export.
 *
 * The scene is the #78 fixture without its Design Options (`scripts/make-skirting-seed.ts`): the Floor
 * with `Skirting SK-1` at the foot of `W-1`, `Skirting SK-3` on `W-4`, and the Kitchen section looking
 * at `W-1`. No Option means nothing shares these records, so each gesture commits as it always did —
 * the locked-baseline half of #70 §7c is `existingDisplay`'s to test, for every kind at once. The new
 * strip goes on `W-2`, which the fixture leaves bare, so its label is the second and its geometry
 * cannot be confused with a record the fixture already carried.
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
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'skirting-plain.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name

const scene0 = seed.projects[0]!.data as unknown as Project
const section = scene0.elevationViews!.find((view) => view.name === 'Kitchen section')!
const SKIRTING_1 = scene0.existingModel.skirting!.find((each) => each.label === 'Skirting SK-1')!.id
/** `W-2`, the right-hand Wall of the Flat, which the fixture leaves bare on both faces. */
const BARE = scene0.existingModel.walls.find((wall) => wall.ref === 'W-2')!.id

/** The Plan View's Skirting bodies, which is the record count read off the surface. */
const skirtingBodies = (page: Page): Locator =>
  page.locator('[data-testid="floor-plan-canvas"] [data-ref-role="skirting"]')

/**
 * The strip under the pointer, reached the way a person reaches it: a 15 mm strip lies under the run
 * of a 200 mm Wall, so where they overlap the first click takes the Wall and the cycle moves on
 * (#70 §18). The same point is clicked until the record that answers is the Skirting.
 */
async function pickSkirting(page: Page, body: Locator): Promise<void> {
  // A 15 mm strip is a pixel and a half wide on the screen, so the click goes to the record's own
  // hit path — the wide invisible twin the Plan View puts under every strip for exactly this.
  const id = (await body.getAttribute('data-ref'))!
  const hit = page.locator(`[data-testid="floor-plan-canvas"] [data-ref-role="skirting-hit"][data-ref="${id}"]`).first()
  const box = (await hit.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const points: readonly [number, number][] = [[cx, cy], [cx, box.y + 2], [cx, box.y + box.height - 2], [box.x + 4, cy], [box.x + box.width - 4, cy]]
  for (const [x, y] of points) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.mouse.click(x, y)
      if (await page.getByTestId('skirting-inspector').isVisible()) return
    }
  }
  throw new Error('the Skirting never answered the pointer on its own body')
}

async function openPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, seed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
  // The Flat is 9 m across and the pane is not, so the opening zoom leaves the far half of `W-1` —
  // and the strip at its foot — outside the pane, under the split divider. Wheeling out is what a
  // person does first, and it is what makes the strip's own body clickable.
  const box = (await floorPlanCanvas(page).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let step = 0; step < 3; step += 1) await page.mouse.wheel(0, 400)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

test.describe('a Skirting', () => {
  test('skirts the whole face it was clicked on, and answers a click', async ({ page }) => {
    await openPlan(page)
    const before = await skirtingBodies(page).count()

    await page.getByTestId('tool-skirting').click()
    await expect(page.getByTestId('skirting-tool-layer')).toBeVisible()
    // The bar arrives with the two numbers the issue pre-fills, each captioned `measure yours`.
    await expect(page.getByTestId('skirting-draft-height')).toHaveValue('100')
    await expect(page.getByTestId('skirting-draft-thickness')).toHaveValue('15')
    await expect(page.getByTestId('skirting-draft-height-caption')).toHaveText('measure yours')
    await page.getByTestId('skirting-draft-height').fill('120')
    await page.getByTestId('skirting-draft-thickness').fill('20')

    // One click on the face, and the whole face is skirted — no second click to place an end.
    const face = page.getByTestId(`skirting-face-hit-${BARE}|left`)
    await expect(face).toBeVisible()
    await face.click({ force: true })
    await expect(page.getByTestId('skirting-tool-layer')).toHaveCount(0)

    await expect(skirtingBodies(page)).toHaveCount(before + 1)
    await expect(page.locator('[data-testid="floor-plan-canvas"] text', { hasText: 'Skirting SK-2' })).toBeVisible()

    await pickSkirting(page, skirtingBodies(page).last())
    await expect(page.getByTestId('skirting-field-label')).toHaveValue('Skirting SK-2')
    // The host and the face are named, never `L`/`R`: a Wall reference and the Room the face borders,
    // or the face's own stable number where no Room claims it.
    await expect(page.getByTestId('skirting-field-wall')).toContainText('W-2')
    await expect(page.getByTestId('skirting-field-side')).toContainText('W-2 ·')
    // The range is the whole tidied face, so it starts at 0 and stops where the Wall does.
    await expect(page.getByTestId('skirting-field-start')).toHaveValue('0')
    await expect(page.getByTestId('skirting-field-end')).toHaveValue('6000')
    await expect(page.getByTestId('skirting-field-height')).toHaveValue('120')
    await expect(page.getByTestId('skirting-field-thickness')).toHaveValue('20')
    // The Top is the sum of Bottom and Height, printed and never a box of its own.
    await expect(page.getByTestId('skirting-field-top')).toContainText('120')
    // Gross and Net are both printed: the body minus whatever the derivation took out of it.
    await expect(page.getByTestId('skirting-field-gross')).not.toContainText('—')
    await expect(page.getByTestId('skirting-field-net')).not.toContainText('—')
  })

  test('puts the tool down on Escape with nothing written', async ({ page }) => {
    await openPlan(page)
    const before = await skirtingBodies(page).count()
    await page.getByTestId('tool-skirting').click()
    await expect(page.getByTestId('skirting-tool-layer')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('skirting-tool-layer')).toHaveCount(0)
    await expect(page.getByTestId('tool-skirting')).not.toHaveAttribute('aria-pressed', 'true')
    await expect(skirtingBodies(page)).toHaveCount(before)
  })

  test('flips to the other face, and fills the other face with a second record', async ({ page }) => {
    await openPlan(page)
    const before = await skirtingBodies(page).count()
    await pickSkirting(page, skirtingBodies(page).first())
    await expect(page.getByTestId('skirting-field-label')).toHaveValue('Skirting SK-1')
    const side = (await page.getByTestId('skirting-field-side').textContent())!

    await page.getByTestId('skirting-flip-side').click()
    await expect(page.getByTestId('skirting-field-side')).not.toHaveText(side)

    // Two faces are two records, never one record with two faces (#78 criterion 6).
    await page.getByTestId('skirting-duplicate-other-side').click()
    await expect(skirtingBodies(page)).toHaveCount(before + 1)
    await expect(page.getByTestId('skirting-field-label')).toHaveValue('Skirting SK-2')
  })

  test('stands in the Section at the Bottom and Top the inspector prints', async ({ page }) => {
    await openPlan(page)
    await page.getByTestId('elevation-view-picker').selectOption(section.id)
    await expect(page.getByTestId('elevation-pane')).toBeVisible()

    // The same record, picked from the Section rather than the Plan View.
    const row = page.locator(`[data-testid="elevation-canvas"] [data-ref="${SKIRTING_1}"]`).first()
    const rowBox = (await row.boundingBox())!
    await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
    await expect(page.getByTestId('skirting-inspector')).toBeVisible()
    await expect(page.getByTestId('skirting-field-label')).toHaveValue('Skirting SK-1')
    await expect(page.getByTestId('skirting-field-bottom')).toHaveValue('0')
    await expect(page.getByTestId('skirting-field-height')).toHaveValue('100')
    await expect(page.getByTestId('skirting-field-top')).toContainText('100')
  })

  test('is deleted and returned by one Undo, and offered to the export', async ({ page }) => {
    await openPlan(page)
    await page.getByTestId('export-open').click()
    await page.getByTestId('export-tab-lists').click()
    await expect(page.getByTestId('export-lists-rows-skirting')).toContainText('2')
    await page.getByTestId('export-lists-close').click()

    // The Section reaches the strip the Plan View paints under the Wall it is skirted to. Picked after
    // the export closed, because closing the dialog takes the selection back with it.
    await page.getByTestId('elevation-view-picker').selectOption(section.id)
    const rowBox = (
      await page.locator(`[data-testid="elevation-canvas"] [data-ref="${SKIRTING_1}"]`).first().boundingBox()
    )!
    await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
    await expect(page.getByTestId('skirting-inspector')).toBeVisible()

    await page.getByTestId('skirting-delete').click()
    await expect(page.getByTestId('skirting-inspector')).toHaveCount(0)
    await expect(skirtingBodies(page)).toHaveCount(1)

    await page.getByTestId('undo-button').click()
    await expect(skirtingBodies(page)).toHaveCount(2)
    await waitForFonts(page)
  })
})
