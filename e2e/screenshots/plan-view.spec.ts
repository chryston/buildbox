import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { cardButton, libraryHeading } from '../support/libraryApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForImageDecode, waitForStablePaint } from '../support/stability'

// The Plan View baselines #55 replaces the retired legacy floor-plan scene with
// (criterion 12): the empty Plan View of a brand-new Project, and the populated Plan
// View of the `v3-large-image` fixture migrated — its 1200 × 1000 Plan Image and all
// seven Placed Items. Both at the suite's 1440 × 1000 viewport.
//
// The canvas element is the screenshot target, as it was for the legacy scene: the
// workspace chrome around it (rail, toolbar, save status) carries text that moves with
// timing and hover state, while the canvas is pure scene geometry.
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const emptySeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'legacy-v3.json'), 'utf8'),
) as PreviewSeed
const populatedSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'legacy-v3-large-image.json'), 'utf8'),
) as PreviewSeed

const populatedProjectName = populatedSeed.library.find((record) => record.id === populatedSeed.projects[0]!.id)!.name

// Persisted text carries timestamps; a frozen clock keeps them out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const floorPlanCanvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')

test('empty Plan View: a new Project with no image and no items', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, emptySeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()
  await page.locator('.new-card').click()

  const canvas = floorPlanCanvas(page)
  await expect(canvas).toBeVisible()
  await waitForFonts(page)
  // No image and no items: the auto-`Fit` settles on the default viewport, so the first
  // painted frame is the last one. Watch the transformed group — the host never resizes.
  await waitForStablePaint(canvas.locator('g').first())
  await expect(canvas).toHaveScreenshot('plan-view-empty.png')
})

test('populated Plan View: the v3-large-image Plan Image and every Placed Item', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, populatedSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await cardButton(page, populatedProjectName, 'Open').click()

  const canvas = floorPlanCanvas(page)
  await expect(canvas).toBeVisible()
  const image = canvas.locator('image')
  await expect(image).toHaveCount(1)
  await waitForImageDecode(image)
  await waitForFonts(page)
  // Auto-fit runs once on the first measured frame; the scene group settles with it.
  await waitForStablePaint(canvas.locator('g').first())
  // Nine, not the fixture's seven generic objects: the two migrated cabinet units are Placed
  // Items on the Floor too now (#57), which is what lets them be moved independently.
  await expect(canvas.locator('[data-testid^="placed-object-"]')).toHaveCount(9)
  await expect(canvas).toHaveScreenshot('plan-view-populated.png')
})
