import { expect, test } from '../support/fixtures'
import type { Page } from '@playwright/test'
import { libraryHeading, previewSeed } from '../support/libraryApp'
import { FIRST_PROJECT, openProjectFromLibrary, placedObject, revealOnCanvas } from '../support/previewApp'
import { compareWithPrototype } from '../support/prototypeCompare'
import type { PrototypeSource } from '../support/prototypeCompare'
import { reseedPreviewDb, seedPreviewDb } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

/**
 * The three prototype defects of #57, photographed in the real app (criterion 19).
 *
 * `A-rotate`, `B-rotate` and `C-origin` on the prototype branch are defect evidence: text that
 * turned with the item, a Floor-bounds chip stacked on the footprint, and an Item Origin change
 * that committed immediately and dragged every placement with it. The prototype is never a
 * baseline (#39 §3), so each one is shown two ways here — the production state captured as a
 * baseline of its own, and a side-by-side against the reference PNG at `cadf2d5` for the PR.
 *
 * Both are at the suite's 1440 × 1000, on the seeded Kitchen Wall, with the clock frozen so the
 * save status cannot move.
 */

const SOFA = 'fp-sofa'
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const canvas = (page: Page) => page.getByTestId('floor-plan-canvas')
const rotation = (page: Page) => page.getByTestId('inspector-rotation')

/**
 * The seeded Project, opened on its Plan View, from a database put back to its seed.
 *
 * The delete-and-reload form works only on the app's own origin, and a comparison's production
 * page is already there while a test's page is not — so the blank one navigates first.
 */
async function openSeededPlanView(page: Page): Promise<void> {
  await seedPreviewDb(page, previewSeed)
  if (page.url() === 'about:blank') await page.goto('./', { waitUntil: 'networkidle' })
  await reseedPreviewDb(page, previewSeed)
  await expect(libraryHeading(page)).toBeVisible()
  await openProjectFromLibrary(page, FIRST_PROJECT)
}

/**
 * The seeded sofa turned to 37° and selected: dimension lines along its own axes, the Floor-bounds
 * chip clear of it, and its Item Origin marker at the translation point rather than a corner.
 */
async function showRotated(page: Page): Promise<void> {
  await openSeededPlanView(page)
  await revealOnCanvas(page, placedObject(page, SOFA))
  await placedObject(page, SOFA).click()
  await rotation(page).fill('37')
  await rotation(page).press('Enter')
  await expect(rotation(page)).toHaveValue('37')
  await expect(page.getByTestId('dimension-width')).toBeVisible()
  await waitForFonts(page)
  await waitForStablePaint(canvas(page).locator('g').first())
}

/**
 * Two placements of one design with the Item Origin preview open on `Bottom-left`: the new pivot
 * drawn on both, the footprints where they were, and `Affects 2 placements` above `Apply`.
 */
async function showOriginPreview(page: Page): Promise<void> {
  await openSeededPlanView(page)
  await page.getByTestId('add-item-menu').click()
  const placed = canvas(page).locator('[data-testid^="placed-object-"]')
  const before = await placed.count()
  await page.getByRole('button', { name: /Sofa \(3-seat\)/ }).click()
  await expect(placed).toHaveCount(before + 1)
  await revealOnCanvas(page, placedObject(page, SOFA))
  await placedObject(page, SOFA).click()
  await page.getByTestId('origin-bottom-left').click()
  await expect(page.getByTestId('design-preview')).toBeVisible()
  await expect(page.getByTestId('affects-count')).toHaveText('Affects 2 placements')
  await waitForFonts(page)
  await waitForStablePaint(canvas(page).locator('g').first())
}

test('a Placed Item at 37°, selected: upright text and dimensions along its own axes', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await showRotated(page)
  await expect(canvas(page)).toHaveScreenshot('plan-view-rotated-37.png')
})

test('the Item Origin preview: the new pivot on every placement, footprints unmoved', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await showOriginPreview(page)
  await expect(page).toHaveScreenshot('plan-view-origin-preview.png')
})

// The prototype side of each pair is the reference PNG at `cadf2d5`; the production side is the
// state above, rebuilt on a clean page so nothing of one leaks into the other (#39 §3). The
// requests are spelled out one by one because `scripts/run-screenshots.mjs` stages the prototypes
// by reading these literals — a built path would stage nothing.
const comparisons: {
  name: string
  defect: string
  prototype: PrototypeSource
  prepare: (page: Page) => Promise<void>
}[] = [
  {
    name: 'a-rotate-57',
    defect: 'text that turned with the item',
    prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/A-rotate.png' },
    prepare: showRotated,
  },
  {
    name: 'b-rotate-57',
    defect: 'the Floor-bounds chip stacked on the footprint',
    prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/B-rotate.png' },
    prepare: showRotated,
  },
  {
    name: 'c-origin-57',
    defect: 'an origin change that committed and moved every placement',
    prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/C-origin.png' },
    prepare: showOriginPreview,
  },
]

for (const { name, defect, prototype, prepare } of comparisons) {
  test(`#57 ${name}: ${defect} is absent here`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await compareWithPrototype(page, testInfo, {
      name,
      prototype,
      production: { route: './', prepare },
    })
  })
}
