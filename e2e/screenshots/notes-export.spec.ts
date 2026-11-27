/**
 * The Notes switches photographed (#83 criterion 18).
 *
 * Three frames of the Export dialog at 1440×1000, each put next to the published prototype at
 * `62b24c2` (`prototype-static/prototype-notes-annotations.html?variant=A`, the "Export" item) and
 * each baselined on the production side:
 *
 *   - the defaults a person meets: `View Annotations` on, `Comment Pins` off, `include Resolved pins`
 *     off and disabled, the preview holding Annotations but no pins;
 *   - pins on: the preview drawing each pin as dot, leader and `C-nnn <title> · Open`;
 *   - pins and Resolved on: the Resolved pin added in the muted style, labelled `· Resolved`.
 *
 * What must match is the switch row, its order, the third chip's disabled state and the pin label
 * anatomy. Named deviations, all of them deliberate:
 *
 *  1. the Register is a Lists-tab output, not the inline `<pre>` of CSV text the prototype paints
 *     inside the drawing dialog — the issue puts it there and #84 gives it a PDF of its own;
 *  2. production prints a pin's full title where the prototype cuts it at 16 characters
 *     (`c.title.slice(0, 16)`), because a truncated title on a printed sheet is a title nobody can
 *     match to the note it speaks for;
 *  3. there is no `Try deleting "Kitchen · North Elevation"` demo button, and no state log: the
 *     prototype's are props for reviewing the dependency review, which #82 shipped for real;
 *  4. production's sheet is the real composed A4 sheet — title block, scale statement and frame —
 *     where the prototype draws a bare plan; and the dialog carries the whole #61 recipe (format,
 *     sheet, scale, layers, scope) that the prototype never pretended to have.
 *
 * The scene is the Notes seed (`scripts/make-notes-review-seed.ts`), whose Floor is `Floor 1`. The
 * clock is frozen so the toolbar's save line cannot move between two runs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { compareWithPrototype } from '../support/prototypeCompare'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { reseedAndReload } from '../support/libraryApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'notes-review-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const NOTES_31 = { commit: '62b24c2', dir: 'prototype-static', entry: 'prototype-static/prototype-notes-annotations.html', query: '?variant=A' } as const

/** The prototype's own switch row, clicked by the words on it. */
async function prototypeSwitches(page: Page, pins: boolean, resolved: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Export…' }).click()
  if (pins) await page.getByText('Comment Pins').click()
  if (resolved) await page.getByText('include Resolved pins').click()
  await page.locator('.export-preview svg').first().waitFor()
}

/** Production's dialog, opened on the scene's plan view with the switches in one of three states. */
async function productionDialog(page: Page, pins: boolean, resolved: boolean): Promise<void> {
  // The comparison helper has already navigated this page, so the seeder would find a database
  // already created and write nothing: the seed is installed by deleting what is there and reloading.
  await reseedAndReload(page, seed)
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
  await page.getByTestId('export-open').click()
  if (pins) await page.getByTestId('export-notes-pins').check()
  if (resolved) await page.getByTestId('export-notes-resolved').check()
  await expect(page.getByTestId('export-preview-svg')).toBeVisible()
  await waitForFonts(page)
  await waitForStablePaint(page.getByTestId('export-preview'))
}

const STATES = [
  { name: 'notes-export-dialog-defaults', pins: false, resolved: false },
  { name: 'notes-export-dialog-pins', pins: true, resolved: false },
  { name: 'notes-export-dialog-pins-resolved', pins: true, resolved: true },
]

for (const state of STATES) {
  test(`#83 ${state.name}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await compareWithPrototype(page, testInfo, {
      name: state.name,
      prototype: { kind: 'static-archive', ...NOTES_31, prepare: (p) => prototypeSwitches(p, state.pins, state.resolved) },
      production: { route: './', prepare: (p) => productionDialog(p, state.pins, state.resolved) },
    })
  })
}

// The production side, baselined: the prototype is a review artifact and never a baseline, but the
// dialog's own pixels are a contract with the person who opens it tomorrow.
for (const state of STATES) {
  test(`the Export dialog's Notes row: ${state.name}`, async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await seedPreviewDb(page, seed)
    await page.goto('./', { waitUntil: 'networkidle' })
    await openProjectFromLibrary(page, projectName)
    await expect(floorPlanCanvas(page)).toBeVisible()
    await page.getByTestId('export-open').click()
    if (state.pins) await page.getByTestId('export-notes-pins').check()
    if (state.resolved) await page.getByTestId('export-notes-resolved').check()
    await expect(page.getByTestId('export-preview-svg')).toBeVisible()
    await waitForFonts(page)
    await waitForStablePaint(page.getByTestId('export-preview'))
    await expect(page).toHaveScreenshot(`${state.name}.png`)
  })
}
