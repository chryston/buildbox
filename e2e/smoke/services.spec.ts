/**
 * Services through the real browser (#79 criteria 1–9).
 *
 * The issue's own four gestures, in order: a Run drawn on the Plan View with two clicks, a Riser drawn
 * with one, a Service's `Bottom` edited in the inspector, and a Service dragged in the Elevation View
 * with Esc pressed mid-drag — which must leave the number exactly where it was.
 *
 * The scene is the #79 fixture without its Design Options (`scripts/make-service-seed.ts`): the Floor
 * with two Runs, a Riser, an underfloor trunking Run, and the Service section looking along the Riser.
 * No Option means nothing shares these records, so each gesture commits as it always did — the
 * locked-baseline half of #70 §7c is `existingDisplay`'s to test, for every kind at once.
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
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'services-plain.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name

const scene = seed.projects[0]!.data as unknown as Project
const section = scene.elevationViews!.find((view) => view.name === 'Service section')!
/** Every Service the fixture already draws: anything else on the surface was made by the test. */
const SEEDED_IDS = (scene.existingModel.services ?? []).map((each) => each.id)
/** The underfloor trunking Run: the one Service whose Bottom is negative, so the drag is legible. */
const TRUNKING = (scene.existingModel.services ?? []).find((each) => each.label === 'Underfloor trunking')!.id

/** The Plan View's Service bodies, counted by the record each belongs to. */
const planBodies = (page: Page): Locator =>
  page.locator('[data-testid="floor-plan-canvas"] [data-ref-role="service"]')

async function planServiceCount(page: Page): Promise<number> {
  const refs = await planBodies(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ref') ?? ''))
  return new Set(refs).size
}

/**
 * The Service under the pointer, reached the way a person reaches it: a Service lies behind the Walls
 * and Openings it passes, so where they overlap the first click takes the Wall and the cycle moves on
 * (#70 §18). The same point is clicked until the record that answers is `id`.
 */
async function pickService(page: Page, id: string): Promise<void> {
  const pane = (await page.getByTestId('floor-plan-canvas').boundingBox())!
  const bodies = page.locator(`[data-testid="floor-plan-canvas"] [data-ref-role="service"][data-ref="${id}"]`)
  const boxes: { x: number; y: number; width: number; height: number }[] = []
  for (let at = 0; at < (await bodies.count()); at += 1) {
    const box = await bodies.nth(at).boundingBox()
    if (box !== null) boxes.push(box)
  }
  boxes.sort((a, b) => a.x - b.x)
  for (const box of boxes) {
    const y = box.y + box.height / 2
    for (let offset = 20; offset < Math.max(box.width, 40); offset += 30) {
      const x = box.x + offset
      if (x < pane.x || x > pane.x + pane.width) continue
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await page.mouse.click(x, y)
        if (await page.getByTestId('service-inspector').isVisible()) {
          const shown = (await page.getByTestId('inspector-service-extent').textContent()) ?? ''
          if (shown.length > 0) return
        }
      }
    }
  }
  throw new Error(`the Service ${id} never answered the pointer on its own body`)
}

async function openScene(page: Page): Promise<void> {
  await seedPreviewDb(page, seed)
  await page.goto('/')
  await waitForFonts(page)
  await openProjectFromLibrary(page, projectName)
  await floorPlanCanvas(page).waitFor()
}

test.describe('Services (#79)', () => {
  test('draws a Run with two clicks, a Riser with one, edits a Bottom, and cancels an Elevation drag', async ({ page }) => {
    await openScene(page)
    const before = await planServiceCount(page)
    expect(before).toBe(SEEDED_IDS.length)

    // --- a Run, two clicks ---------------------------------------------------------------------
    await page.getByTestId('tool-service').click()
    await expect(page.getByTestId('service-tool-layer')).toBeVisible()
    const pane = (await floorPlanCanvas(page).boundingBox())!
    await page.mouse.click(pane.x + 120, pane.y + 320)
    await expect(page.getByTestId('service-rubber')).toBeVisible()
    await page.mouse.click(pane.x + 320, pane.y + 320)
    await expect(page.getByTestId('service-tool-layer')).toHaveCount(0)
    expect(await planServiceCount(page)).toBe(before + 1)

    // --- a Riser, one click --------------------------------------------------------------------
    await page.getByTestId('tool-service').click()
    await page.getByTestId('service-shape-riser').click()
    await page.mouse.click(pane.x + 220, pane.y + 420)
    await expect(page.getByTestId('service-tool-layer')).toHaveCount(0)
    expect(await planServiceCount(page)).toBe(before + 2)

    // --- `Bottom` edited in the inspector ------------------------------------------------------
    await pickService(page, TRUNKING)
    const bottom = page.getByTestId('inspector-service-bottom')
    await bottom.fill('250')
    await bottom.blur()
    await expect(page.getByTestId('inspector-service-extent')).toContainText('250')

    // --- the Elevation drag, cancelled mid-drag ------------------------------------------------
    await page.getByTestId('elevation-view-tab').getByText(section.name).click()
    const row = page.locator(`[data-testid="elevation-canvas"] [data-ref-role="service"][data-ref="${TRUNKING}"]`).first()
    await row.waitFor()
    const box = (await row.boundingBox())!
    const startY = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, startY)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, startY - 60, { steps: 6 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    // Esc mid-drag sends nothing: the record is where it was before the press.
    await pickService(page, TRUNKING)
    await expect(page.getByTestId('inspector-service-extent')).toContainText('250')
  })
})
