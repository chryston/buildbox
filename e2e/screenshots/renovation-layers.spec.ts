/**
 * The Drawing Layers as baselines (#71).
 *
 * Four surfaces a person reads a layer through, none of which a DOM assertion can describe: the
 * collapsed list, where a row has to say visible, named and marked in one line; the same row opened,
 * where the view's own settings sit above the Project's; the deletion review, whose whole job is the
 * sentence under the count; and the empty state, which is what a Project that has never heard of
 * layers shows. The fifth frame is the one this feature is actually for — a hidden layer with its
 * content gone off the drawing and its warning still on the list, saying why.
 *
 * The scenes are the layers twin of the renovation-views kitchen (`fixtures/e2e/preview-seed/
 * renovation-layers.json`), except the empty state, which is the same kitchen before any layer was
 * made.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const load = (name: string): PreviewSeed =>
  JSON.parse(readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', name), 'utf8')) as PreviewSeed
const layersSeed = load('renovation-layers.json')
const plainSeed = load('renovation-views.json')

// A frozen clock keeps the persisted timestamp out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const FLOOR_1 = 'seed-view-001'
const COMBINED = 'views-view-016'
const STRUCTURE = 'layers-003'

const canvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')
const layersSection = (page: Page): Locator => page.getByTestId('layers-section')

/** The two surfaces whose pixels follow the clock or the pointer rather than the scene. */
const masks = (page: Page): Locator[] => [page.getByTestId('save-status'), page.getByTestId('pick-filter')]

async function settle(page: Page): Promise<void> {
  await expect(canvas(page)).toBeVisible()
  await waitForFonts(page)
  // Auto-fit runs once on the first measured frame; the scene group settles with it.
  await waitForStablePaint(canvas(page).locator('g').first())
}

async function openPlan(page: Page, seed: PreviewSeed, viewId: string | null = null): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, { ...seed})
  await page.goto('./', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Open' }).first().click()
  await settle(page)
  if (viewId !== null) {
    await page.getByTestId('view-picker').selectOption(viewId)
    await settle(page)
  }
}

async function expandRow(page: Page, layerKey: string): Promise<void> {
  const toggle = page.getByTestId(`layer-toggle-${layerKey}`)
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
    await expect(canvas(page)).toBeVisible()
  }
}

test('the list of layers a view is drawn from', async ({ page }) => {
  await openPlan(page, layersSeed, FLOOR_1)
  // Three rows and the Unlayered row, each collapsed to one line: the box, the swatch, the name,
  // and the marks that say what else this view says about them.
  await expect(layersSection(page)).toHaveScreenshot('layers-list.png')
})

test('one layer opened to its own settings', async ({ page }) => {
  await openPlan(page, layersSeed, FLOOR_1)
  await expandRow(page, STRUCTURE)
  await expect(layersSection(page)).toHaveScreenshot('layers-row-expanded.png')
})

test('the review a layer deletion asks for', async ({ page }) => {
  await openPlan(page, layersSeed, FLOOR_1)
  await expandRow(page, STRUCTURE)
  await page.getByTestId(`layer-delete-${STRUCTURE}`).click()
  await expect(page.getByTestId('delete-layer-dialog')).toBeVisible()
  await expect(page.getByTestId('delete-layer-dialog')).toHaveScreenshot('layers-delete-review.png')
})

test('a read-only layer, its colour its own, its content off the drawing', async ({ page }) => {
  await openPlan(page, layersSeed, COMBINED)
  // `Option B · Combined` made Structure read-only; this gives it a colour of its own, which is the
  // override mark, the swatch and the Walls on the canvas all at once.
  await expandRow(page, STRUCTURE)
  await page.getByTestId(`layer-view-colour-${STRUCTURE}`).fill('#5fb3ff')
  await settle(page)
  await expect(page.getByTestId('workspace-rail')).toHaveScreenshot('layers-view-overrides.png', { mask: masks(page) })
})

test('a hidden layer, with its warning left behind', async ({ page }) => {
  await openPlan(page, layersSeed, FLOOR_1)
  await page.getByTestId('layer-visible-layers-001').uncheck()
  await page.getByTestId('warning-toggle').click()
  await settle(page)
  // The whole viewport, because the point is the pair of them: an empty stretch of drawing where the
  // Furniture was, and the Warnings List still counting it with the suffix that explains the gap.
  await expect(page).toHaveScreenshot('layers-hidden-canvas.png', { mask: masks(page) })
})

test('a Project that has never heard of layers', async ({ page }) => {
  await openPlan(page, plainSeed)
  await expect(layersSection(page)).toHaveScreenshot('layers-none.png')
})
