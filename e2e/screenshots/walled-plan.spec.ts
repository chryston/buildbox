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
// The same Floor with every Opening the tool offers drawn on it (#65 criterion 10): five doors and
// one removed section along W-1, three windows along W-2 and one door on the arc W-3, all of it
// placed through the real Intents by `scripts/make-openings-scene-seed.ts`.
const openingsSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'openings-scene.json'), 'utf8'),
) as PreviewSeed

const walledProjectName = walledSeed.library.find((record) => record.id === walledSeed.projects[0]!.id)!.name
const openingsProjectName = openingsSeed.library.find((record) => record.id === openingsSeed.projects[0]!.id)!.name

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

// The Openings photograph (#65 criterion 10). It is the only place the suite looks at a whole
// Flat's worth of Openings at once, which is what makes it worth a baseline: the band cut at each
// jamb, the leaf standing on the reference line, the sliding pair, the three lines of a window,
// the dashed nothing of a removed section and the one door drawn square to the chord of an arc all
// have to agree with each other and with the Walls they sit in.
//
// The counts come first because a photograph of a scene that lost a door still looks like a
// photograph: the marks are what the scene promises, so the suite counts them before it judges
// them. `maxDiffPixels: 0`, as above — the baseline is the assertion.
test('walled Plan View with openings: every preset, three windows, a removed section, a door on an arc', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, openingsSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()
  await cardButton(page, openingsProjectName, 'Open').click()

  const canvas = floorPlanCanvas(page)
  await expect(canvas).toBeVisible()
  const image = canvas.locator('image')
  await expect(image).toHaveCount(1)
  await waitForImageDecode(image)
  await waitForFonts(page)
  await waitForStablePaint(canvas.locator('g').first())

  // Five hinged doors — four along W-1 and one on the arc — plus a sliding pair, which draws
  // panels instead of a leaf; three windows of three lines each; one removed section of two.
  await expect(canvas.locator('[data-testid^="opening-leaf-"]')).toHaveCount(5)
  await expect(canvas.locator('[data-testid^="opening-panel-"]')).toHaveCount(2)
  await expect(canvas.locator('[data-testid^="opening-window-"]')).toHaveCount(9)
  await expect(canvas.locator('[data-testid^="opening-removed-"]')).toHaveCount(2)
  // The footprints are invisible, so the only thing that says they are there is that each Opening
  // has one: a door nobody can click is a door that cannot be selected.
  await expect(canvas.locator('[data-testid^="opening-hit-"]')).toHaveCount(10)
  await expect(canvas).toHaveScreenshot('openings-plan.png')
})
