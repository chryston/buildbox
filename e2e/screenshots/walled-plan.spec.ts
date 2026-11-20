import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { cardButton, libraryHeading } from '../support/libraryApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForImageDecode, waitForStablePaint } from '../support/stability'

// The walled Plan View baseline (#64 criterion 12): the two-bedroom outline
// `scripts/make-walled-plan-seed.ts` draws with the real Wall Intents — a closed 200 mm ring,
// three 100 mm partitions and one arc Wall whose ends are hosted on the Walls they meet, and a
// four-way cross in the right-hand room — over the converted floor-plan scan, recalibrated to
// 0.025 px/mm so the 256 × 192 px image is a 10.24 m × 7.68 m Floor.
//
// It is the one place the suite photographs Walls at rest rather than mid-drag: the tidied faces,
// the mitred corners, the mixed thickness and the curve all have to survive the derivation, the
// display list and the browser's rasteriser together, and `maxDiffPixels: 0` means the baseline
// is the assertion. The canvas is the target, as in `plan-view.spec.ts`: the workspace chrome
// around it carries text that moves with timing and hover state.
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const walledSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'walled-plan.json'), 'utf8'),
) as PreviewSeed

const walledProjectName = walledSeed.library.find((record) => record.id === walledSeed.projects[0]!.id)!.name

// Persisted text carries timestamps; a frozen clock keeps them out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const floorPlanCanvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')

test('walled Plan View: twelve Walls, every junction shape, over a calibrated Plan Image', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, walledSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()
  await cardButton(page, walledProjectName, 'Open').click()

  const canvas = floorPlanCanvas(page)
  await expect(canvas).toBeVisible()
  const image = canvas.locator('image')
  await expect(image).toHaveCount(1)
  await waitForImageDecode(image)
  await waitForFonts(page)
  // Auto-fit runs once on the first measured frame and the scene group settles with it; the
  // Walls are part of what it fits, since the outline reaches past the Plan Image on one side.
  await waitForStablePaint(canvas.locator('g').first())
  await expect(canvas).toHaveScreenshot('walled-plan.png')
})
