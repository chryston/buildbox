/**
 * The Renovation Displays as baselines (#70).
 *
 * One capture per Renovation Display of `Option A · Open kitchen` — the four scenes the issue's
 * criterion 7 describes, each with its own mode-bar colour, its own hatch and its own halo — plus
 * the three surfaces that only exist once a baseline edit is refused: the forced choice, the danger
 * dialog, and the overlap list W-2 and W-2′ share. The §6 error banner is photographed too, because
 * a Display with no Design Option is the one state whose whole job is to say something.
 *
 * The whole viewport is the target, not the canvas alone: what these scenes are for is the
 * relationship between the mode bar, the rail, the tool strip and the drawing, and a defect in that
 * layout is invisible in a canvas-only crop. Two things are masked — the save status, whose words
 * follow the autosave, and the `Pick:` chips, whose pressed state follows the pointer.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const renovationSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-views.json'), 'utf8'),
) as PreviewSeed

// A frozen clock keeps the persisted timestamp out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const canvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')
const canvasHost = (page: Page): Locator => page.getByTestId('workspace-canvas-host')

/** The two surfaces whose pixels follow the clock or the pointer rather than the scene. */
const masks = (page: Page): Locator[] => [page.getByTestId('save-status'), page.getByTestId('pick-filter')]

async function settle(page: Page): Promise<void> {
  await expect(canvas(page)).toBeVisible()
  await waitForFonts(page)
  // Auto-fit runs once on the first measured frame; the scene group settles with it.
  await waitForStablePaint(canvas(page).locator('g').first())
}

async function openRenovationPlan(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, { ...renovationSeed})
  await page.goto('./', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Open' }).first().click()
  await settle(page)
}

async function showDisplay(page: Page, optionId: string, display: string): Promise<void> {
  await page.getByTestId('design-option-picker').selectOption(optionId)
  await page.getByTestId(`display-${display}`).click()
  await settle(page)
}

async function shootScene(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(name, { mask: masks(page) })
}

for (const display of ['existing', 'demolition', 'proposed', 'combined']) {
  test(`Option A · ${display}`, async ({ page }) => {
    await openRenovationPlan(page)
    await showDisplay(page, 'option-a', display)
    await shootScene(page, `renovation-${display}.png`)
  })
}

test('the forced choice a baseline edit asks for', async ({ page }) => {
  await openRenovationPlan(page)
  await showDisplay(page, 'option-a', 'proposed')
  await page.locator('[data-ref="seed-wall-002"]').first().click()
  await page.getByTestId('wall-length').fill('3000')
  await page.getByTestId('wall-length').press('Enter')
  await expect(page.getByTestId('forced-choice-dialog')).toBeVisible()
  await expect(page.getByTestId('forced-choice-dialog')).toHaveScreenshot('renovation-forced-choice.png')
})

test('the danger dialog a baseline correction asks for', async ({ page }) => {
  await openRenovationPlan(page)
  await showDisplay(page, 'option-a', 'existing')
  await page.locator('[data-ref="seed-wall-013"]').first().click()
  await page.getByTestId('renovation-inspector-action-correct').click()
  await page.getByTestId('wall-length').fill('3000')
  await page.getByTestId('wall-length').press('Enter')
  await expect(page.getByTestId('correct-existing-dialog')).toBeVisible()
  await expect(page.getByTestId('correct-existing-dialog')).toHaveScreenshot('renovation-correct-existing.png')
})

test('the overlap list two Walls on one footprint share', async ({ page }) => {
  await openRenovationPlan(page)
  await showDisplay(page, 'option-b', 'combined')
  const box = await page.locator('[data-ref="views-successor-005"]').first().boundingBox()
  if (box === null) throw new Error('the successor Wall was never painted')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('overlap-header')).toHaveText('Overlap 1/2 · click again to cycle')
  // The list belongs to the canvas, and so does the hatched pair it is choosing between.
  await expect(canvasHost(page)).toHaveScreenshot('renovation-overlap-cycle.png', { mask: masks(page) })
})

test('the banner a Display with no Design Option shows', async ({ page }) => {
  await openRenovationPlan(page)
  await page.getByTestId('display-combined').click()
  await settle(page)
  const banner = page.getByTestId('renovation-error-banner')
  await expect(banner).toBeVisible()
  // The banner is a strip of its own, above the canvas rather than inside it, so it is
  // photographed as itself: the sentence, the Option picker it hands back, and the escape hatch.
  await expect(banner).toHaveScreenshot('renovation-error-banner.png')
})
