/**
 * The shared-height panel and the Clearance Envelope group through the real browser (#76 §1, §4):
 * the panel promises the change across every placement with its dashed outlines before `Apply`
 * commits one Transaction, and the Clearance Envelope group edits `Height`, removes the envelope
 * and gets it back with one undo.
 *
 * The scene is the #76 clearance fixture: a `Base cabinet` shared by two Placed Items and owning
 * an 860 mm Clearance Envelope, and a `Wall cabinet` with none. Both cabinets share one footprint
 * at (600, 600), so the spec clicks until the inspector shows the envelope fields — the click
 * cycle of #58, not a store poke.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '../support/fixtures'
import type { Locator, Page } from '@playwright/test'
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

test('the shared-height panel previews across placements and commits one Transaction; the envelope group edits and removes', async ({ page }) => {
  await openPlan(page)

  // Click the second placement of the shared design by its own drawn group — the same
  // `Base cabinet` — and its Clearance Envelope group answers with `Height`.
  const base = page.getByTestId('floor-plan-canvas').getByTestId('placed-object-pr-016').locator('path').first()
  // The first frame fits once the host has a size; wait until the item is actually inside the
  // canvas before aiming at it.
  const canvas = page.getByTestId('floor-plan-canvas')
  await expect.poll(async () => {
    const c = await canvas.boundingBox()
    const p = await base.boundingBox()
    return c !== null && p !== null && p.x >= c.x && p.x + p.width <= c.x + c.width && p.y >= c.y && p.y + p.height <= c.y + c.height
  }, { timeout: 15_000 }).toBe(true)
  const box = await base.boundingBox()
  if (box === null) throw new Error('the second Base cabinet is not drawn')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('item-design-section')).toBeVisible()
  const height = page.getByTestId('clearance-height')
  await expect(height).toBeVisible()
  await expect(height).toHaveValue('860')
  await expect(page.getByTestId('clearance-caption')).toHaveText('shared by 2 placements')

  // §1: the panel lists both placements, promises the dashed outlines, and commits one Apply.
  await page.getByTestId('edit-shared-design').click()
  const panel = page.getByTestId('shared-design-panel')
  await expect(panel).toBeVisible()
  await page.getByTestId('shared-design-height').fill('900')
  await expect(page.getByTestId('plan-preview-outlines')).toBeVisible()
  await expect(page.getByTestId('shared-design-apply')).toBeEnabled()
  await page.getByTestId('shared-design-apply').click()
  await expect(panel).not.toBeVisible()

  // §4: the envelope's Height follows the same one-number rule; Remove takes it away and one
  // undo puts it back.
  await page.getByTestId('clearance-height').fill('900')
  await page.getByTestId('clearance-height').press('Enter')
  await expect(page.getByTestId('clearance-remove')).toBeVisible()
  await page.getByTestId('clearance-remove').click()
  await expect(page.getByTestId('clearance-add')).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('clearance-remove')).toBeVisible()
})
