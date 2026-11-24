// The shared-height panel with its dashed previews, and the Clearance Envelope group with its
// envelope on the plan — the two photographs #76 asks for. The scene is the clearance fixture:
// a `Base cabinet` shared by two Placed Items and owning an 860 mm Clearance Envelope, its Floor
// limited to 2 600 mm, so typing 2 700 opens a `floor_limit_above` promise on both rows before
// anything is committed, and the dashed outlines are the same promise on the plan.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { cardButton, libraryHeading } from '../support/libraryApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'clearance-envelope.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name

async function openPlan(page: Page): Promise<Locator> {
  await seedPreviewDb(page, seed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()
  await cardButton(page, projectName, 'Open').click()
  const canvas = page.getByTestId('floor-plan-canvas')
  await expect(canvas).toBeVisible()
  await waitForFonts(page)
  await waitForStablePaint(canvas.locator('g').first())
  return canvas
}

/** Click the second placement of the shared design on its own drawn group, once the fit settles. */
async function selectBaseCabinet(page: Page): Promise<void> {
  const canvas = page.getByTestId('floor-plan-canvas')
  const base = canvas.getByTestId('placed-object-pr-016').locator('path').first()
  await expect.poll(async () => {
    const c = await canvas.boundingBox()
    const p = await base.boundingBox()
    return c !== null && p !== null && p.x >= c.x && p.x + p.width <= c.x + c.width && p.y >= c.y && p.y + p.height <= c.y + c.height
  }, { timeout: 15_000 }).toBe(true)
  const box = await base.boundingBox()
  if (box === null) throw new Error('the second Base cabinet is not drawn')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('clearance-height')).toBeVisible()
}

test('the shared-height panel over the plan, with the dashed preview outlines and the Clearance Envelope', async ({ page }) => {
  const canvas = await openPlan(page)
  await selectBaseCabinet(page)
  // The selected placement's own envelope is dashed on the plan before the panel even opens.
  await expect(page.getByTestId('plan-clearance-outlines')).toBeVisible()
  await page.getByTestId('edit-shared-design').click()
  await page.getByTestId('shared-design-height').fill('2700')
  await expect(page.getByTestId('plan-preview-outlines')).toBeVisible()
  // The card sits low in the inspector; pull it fully into the viewport so the photograph shows
  // the whole field, spinner and all, rather than a clipped bottom edge.
  await page.getByTestId('shared-design-height').scrollIntoViewIfNeeded()
  await waitForStablePaint(canvas.locator('g').first())
  await expect(page).toHaveScreenshot('clearance-shared-design-panel.png')
})

test('the Clearance Envelope group with its Bottom, Height and Remove, and the envelope dashed', async ({ page }) => {
  const canvas = await openPlan(page)
  await selectBaseCabinet(page)
  const section = page.getByTestId('clearance-envelope-section')
  await section.scrollIntoViewIfNeeded()
  await waitForStablePaint(canvas.locator('g').first())
  await expect(page).toHaveScreenshot('clearance-envelope-section.png')
})
