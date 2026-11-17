import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { seedLegacyStore } from '../support/legacyStore'
import { waitForFonts, waitForImageDecode, waitForStablePaint } from '../support/stability'

// The two scenes today's app has to keep rendering identically through the migration
// (#39 §2, #20 §13.15): the cabinet editor, and a floor plan with an image, objects and
// annotations. Both come from the untouched v3 legacy fixture, so a baseline is a promise
// about real persisted data, not about a fixture the app invented.
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/legacy')
const v3 = readFileSync(join(fixturesRoot, 'v3', 'buildbox-store.json'), 'utf8')

const cabinetCanvas = (page: Page): Locator => page.getByTestId('cabinet-canvas')
const floorPlanCanvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')

// Persisted text carries timestamps; a frozen clock keeps them out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedLegacyStore(page, v3)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(cabinetCanvas(page)).toBeVisible()
  await waitForFonts(page)
  // The first project is active, nothing is selected and the view is at the default
  // zoom — the state a user lands in, and the one S4 has to reproduce.
  await waitForStablePaint(cabinetCanvas(page))
})

test('cabinet scene', async ({ page }) => {
  await expect(cabinetCanvas(page)).toHaveScreenshot('cabinet-scene.png')
})

test('cabinet scene with a void selected', async ({ page }) => {
  const firstVoid = page.getByTestId(/^void-/).first()
  // The space-label rect covers the middle half of every void, so a real click lands in
  // the outer quarter — the same position e2e/smoke/app.spec.ts uses.
  await firstVoid.click({ position: { x: 10, y: 10 } })
  await expect(firstVoid).toHaveAttribute('stroke', '#7c3aed')
  await waitForStablePaint(cabinetCanvas(page))

  await expect(cabinetCanvas(page)).toHaveScreenshot('cabinet-scene-selected.png')
})

/**
 * Auto-fit fits the calibrated image, not the scene: the v3 fixture's image is 1024 mm wide
 * while its placed objects reach 2300 mm, so the fitted view clips five of the seven
 * objects and both annotation shapes. The baseline has to contain them — that is the scene
 * S4 must reproduce — so zoom out with the app's own control until the whole scene is
 * inside the canvas, the same way a user would to see the whole plan.
 */
async function zoomUntilSceneFits(page: Page, canvas: Locator): Promise<void> {
  const zoomOut = page.getByRole('button', { name: 'Zoom out' })
  for (let attempt = 0; attempt < 10; attempt++) {
    const clipped = await canvas.evaluate((svg) => {
      const box = svg.getBoundingClientRect()
      const probes = document.querySelectorAll('[data-testid^="placed-object-"], [data-layer="annotations"] > *')
      return [...probes].some((element) => {
        const rect = element.getBoundingClientRect()
        return (
          rect.left < box.left || rect.top < box.top || rect.right > box.right || rect.bottom > box.bottom
        )
      })
    })
    if (!clipped) return
    await zoomOut.click()
    await waitForStablePaint(canvas.locator('g').first())
  }
  throw new Error('the floor-plan scene never fitted inside the canvas')
}

test('floor plan scene', async ({ page }) => {
  await page.getByRole('button', { name: /floor plan/i }).click()

  const canvas = floorPlanCanvas(page)
  await expect(canvas).toBeVisible()
  const image = canvas.locator('image')
  await expect(image).toHaveCount(1)
  await waitForImageDecode(image)
  // Auto-fit runs on image and scale change; watch the transformed group, because the
  // canvas host itself never changes size.
  await waitForStablePaint(canvas.locator('g').first())
  await zoomUntilSceneFits(page, canvas)

  // Calibrated image, placed objects in all four rotations, the custom shape, the
  // wall-hack polyline and the tile-zone rectangle.
  await expect(canvas).toHaveScreenshot('floor-plan-scene.png')
})
