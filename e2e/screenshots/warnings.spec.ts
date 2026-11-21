import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { cardButton, libraryHeading } from '../support/libraryApp'
import { compareWithPrototype } from '../support/prototypeCompare'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForImageDecode, waitForStablePaint } from '../support/stability'

// The Warning strip and the plan badges, photographed together (#66 criterion 11).
//
// The scene is the walled Plan View with three Walls left unjoined on purpose, so the first
// producer has something true to say about each pair, and two Acknowledgements stored beside it:
// one carrying the signature the engine computes, one carrying a signature that no longer
// describes what it is attached to. The strip therefore shows all three statuses the app has —
// open, `Seen ✓` with its note, and `Reopened after change` keeping the note visible — and every
// Wall involved carries one `!` badge.
//
// `scripts/make-warnings-scene-seed.ts` asserts the statuses before it writes the fixture, and
// the counts are asserted again here before the shutter opens: a photograph of a scene that lost
// a warning still looks like a photograph. `maxDiffPixels: 0`, as in `walled-plan.spec.ts` — the
// baseline is the assertion.
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const warningsSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'warnings-scene.json'), 'utf8'),
) as PreviewSeed
const warningsProjectName = warningsSeed.library.find((record) => record.id === warningsSeed.projects[0]!.id)!.name

// Persisted text carries timestamps; a frozen clock keeps them out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const floorPlanCanvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')

/** Open the warned Project and wait for the scene to stop moving. */
async function openWarnedPlan(page: Page): Promise<Locator> {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, warningsSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()
  await cardButton(page, warningsProjectName, 'Open').click()

  const canvas = floorPlanCanvas(page)
  await expect(canvas).toBeVisible()
  const image = canvas.locator('image')
  await expect(image).toHaveCount(1)
  await waitForImageDecode(image)
  await waitForFonts(page)
  await waitForStablePaint(canvas.locator('g').first())
  return canvas
}

test('the Warning strip expanded over a walled plan, with one badge per involved Wall', async ({ page }) => {
  const canvas = await openWarnedPlan(page)
  const strip = page.getByTestId('warning-strip')
  await expect(strip).toBeVisible()

  // Two of the three are unacknowledged — one never acknowledged, one reopened — and one is
  // seen, which is the count the collapsed bar carries and the Export notice reads.
  await expect(page.getByTestId('warning-count')).toHaveText('2 open · 1 seen')

  // The strip sits in the shell's `warningStrip` slot, overlaid at the bottom of the canvas
  // host (#66 criterion 11): expanding it must not resize the canvas underneath it.
  const before = await canvas.boundingBox()
  await page.getByTestId('warning-toggle').click()
  await expect(page.getByTestId('warning-list')).toBeVisible()
  await expect(page.getByTestId('warning-list').locator('li')).toHaveCount(3)

  // The badges are screen chrome over the same scene, so the canvas holds the whole story:
  // three warnings, four Walls involved, and one badge each.
  await expect(canvas.locator('[data-testid^="warning-badge-"]')).toHaveCount(4)

  await expect(strip).toHaveScreenshot('warnings-strip.png')
  const after = await canvas.boundingBox()
  expect(after).toEqual(before)
})

// The two reviews the issue names (#29 at `abdc3cd`, behaviours 22 and 23). Neither is baselined:
// these are side-by-sides attached to the run, so a person compares the styling rather than the
// suite judging it. The named deviation travels with them — the rows live in the Warning strip at
// the bottom of the canvas host, not in the prototype's inspector list, because the range
// prototype's behaviour 2 and the Notes and renovation prototypes both put warnings in the strip
// and #55 reserved that slot.
test('#29 C-cycle: plan badge styling against the range prototype', async ({ page }, testInfo) => {
  await openWarnedPlan(page)
  await compareWithPrototype(page, testInfo, {
    name: 'warnings-29-C-cycle',
    prototype: { kind: 'reference-png', commit: 'abdc3cd', path: 'prototype-screenshots/C-cycle.png' },
    production: { route: './' },
  })
})

test('#29 A-warning: warning row content against the range prototype', async ({ page }, testInfo) => {
  await openWarnedPlan(page)
  await page.getByTestId('warning-toggle').click()
  await expect(page.getByTestId('warning-list')).toBeVisible()
  await compareWithPrototype(page, testInfo, {
    name: 'warnings-29-A-warning',
    prototype: { kind: 'reference-png', commit: 'abdc3cd', path: 'prototype-screenshots/A-warning.png' },
    production: { route: './' },
  })
})
