import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { libraryHeading, previewSeed } from '../support/libraryApp'
import { FIRST_PROJECT, openItemDetail, openProjectFromLibrary, showFloorPlan } from '../support/previewApp'
import { compareWithPrototype } from '../support/prototypeCompare'
import type { PrototypeSource } from '../support/prototypeCompare'
import { reseedPreviewDb, seedPreviewDb } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

/**
 * The Shape editor photographed at the prototype's own size (#58 criterion 24).
 *
 * Variant A of `prototype/odd-shape-drawing` published three PNGs — a preset state, the Convert
 * dialog, and a refused proposal — and each one is a claim about hierarchy: labelled tool groups
 * in one row, a tabbed inspector with a label/field grid, `Convert to Custom Path…` where the
 * destructive action belongs, and a centred modal with an eyebrow, a heading, a body and
 * right-aligned actions. The prototype is never a baseline (#39 §3), so each state is kept two
 * ways: as a production baseline of its own, and as a side-by-side against the reference PNG for
 * the PR to be read against.
 *
 * 1600 × 1000 rather than the suite's 1440 × 1000, because that is the size the prototype was
 * captured at and the comparison is only legible at matching widths. The clock is frozen so the
 * toolbar's save line cannot move between two runs.
 */

test.use({ viewport: { width: 1600, height: 1000 } })

const PROTOTYPE_VIEWPORT = { width: 1600, height: 1000 }
const WASHER = 'fp-washer'
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const shapeEditor = (page: Page): Locator => page.getByTestId('shape-editor')
const field = (page: Page, id: string): Locator => page.getByTestId(`shape-${id}`)

/**
 * The Washer's Item Design, from a database put back to its seed.
 *
 * One Placed Item, so no edit is a multi-placement preview and the Shape tab shows the footprint
 * alone. The delete-and-reload form works only on the app's own origin, and a comparison's
 * production page is already there while a test's page is not — so the blank one navigates first.
 */
async function openShapeEditor(page: Page): Promise<void> {
  await seedPreviewDb(page, previewSeed)
  if (page.url() === 'about:blank') await page.goto('./', { waitUntil: 'networkidle' })
  await reseedPreviewDb(page, previewSeed)
  await expect(libraryHeading(page)).toBeVisible()
  await openProjectFromLibrary(page, FIRST_PROJECT)
  await showFloorPlan(page)
  await openItemDetail(page, WASHER)
  await expect(shapeEditor(page)).toBeVisible()
}

async function setField(page: Page, id: string, value: string): Promise<void> {
  await field(page, id).fill(value)
  await field(page, id).press('Enter')
  await expect(field(page, id)).toHaveValue(value)
}

/**
 * Pick a preset and place it with a click, at the canvas centre.
 *
 * The Washer has one Placed Item, so a placement the controller accepts is committed as it is
 * made (#58 criterion 4 puts `Apply` on a design with two placements, not one).
 */
async function placePreset(page: Page, kind: string): Promise<void> {
  await page.getByTestId('shapes-menu').click()
  await page.getByTestId(`shape-preset-${kind}`).click()
  const canvas = page.getByTestId('footprint-canvas')
  await expect(canvas).toHaveAttribute('data-placing', kind)
  await canvas.click()
  await expect(canvas).toHaveAttribute('data-placing', 'none')
}

/** The last paint must have settled: a capture of a shape mid-preview is not a baseline. */
async function settle(page: Page): Promise<void> {
  await waitForFonts(page)
  await waitForStablePaint(shapeEditor(page))
}

/**
 * (a) preset: a Rounded Rectangle 2,600 × 2,000 with `Corner radius` 300, the Shape tab open —
 * the same shape Variant A drew, on the label/field grid that replaced its free-form panel.
 */
async function showPreset(page: Page): Promise<void> {
  await openShapeEditor(page)
  await placePreset(page, 'roundedRectangle')
  await setField(page, 'width', '2600')
  await setField(page, 'depth', '2000')
  await setField(page, 'radius', '300')
  await expect(page.getByTestId('shape-kind')).toHaveText('Rounded Rectangle')
  await expect(page.getByTestId('shape-draft-bar')).toHaveCount(0)
  await settle(page)
}

/**
 * (b) convert: the modal for a Rectangle 3,400 × 2,400, opened and left standing. Its body names
 * width, depth and orientation — the parameters this preset really stores — and nothing else.
 */
async function showConvert(page: Page): Promise<void> {
  await openShapeEditor(page)
  await setField(page, 'width', '3400')
  await setField(page, 'depth', '2400')
  await page.getByTestId('shape-convert').click()
  await expect(page.getByTestId('convert-modal')).toBeVisible()
  await expect(page.getByTestId('convert-cancel')).toBeFocused()
  await waitForFonts(page)
  await waitForStablePaint(page.getByTestId('convert-modal'))
}

/**
 * (c) invalid: fixture 8 refused. A Rounded Rectangle 2,000 × 3,000 whose top corners exactly
 * meet was committed, then `Top-right` 1,001 was typed — one millimetre over. The refused
 * proposal is drawn in red over the ghost of the last valid one, one field is marked, one
 * sentence is on screen, and `Apply` cannot be reached.
 */
async function showInvalid(page: Page): Promise<void> {
  await openShapeEditor(page)
  await placePreset(page, 'roundedRectangle')
  await setField(page, 'width', '2000')
  await setField(page, 'depth', '3000')
  await page.getByTestId('shape-per-corner-radii').check()
  await setField(page, 'topLeft', '1000')
  await setField(page, 'topRight', '1000')
  await field(page, 'topRight').fill('1001')
  await field(page, 'topRight').press('Enter')
  await expect(page.getByTestId('shape-topRight-row')).toHaveAttribute('data-invalid', 'true')
  await expect(page.getByTestId('footprint-ghost')).toBeVisible()
  await expect(page.getByTestId('shape-problem-message')).toHaveCount(1)
  await settle(page)
}

const states = [
  { name: 'shape-editor-preset', title: 'a Rounded Rectangle on the Shape tab', prepare: showPreset },
  { name: 'shape-editor-convert', title: 'the Convert dialog for a Rectangle', prepare: showConvert },
  { name: 'shape-editor-invalid', title: 'a refused corner radius', prepare: showInvalid },
] as const

for (const { name, title, prepare } of states) {
  test(`#58 the Shape editor: ${title}`, async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await prepare(page)
    await expect(page).toHaveScreenshot(`${name}.png`)
  })
}

// The prototype side of each pair is the reference PNG at `cadf2d5`; the production side is the
// state above, rebuilt on a clean page so nothing of one leaks into the other (#39 §3). The
// requests are spelled out one by one because `scripts/run-screenshots.mjs` stages the prototypes
// by reading these literals — a built path would stage nothing.
const comparisons: {
  name: string
  state: string
  prototype: PrototypeSource
  prepare: (page: Page) => Promise<void>
}[] = [
  {
    name: 'a-preset-58',
    state: 'the preset state',
    prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/A-preset.png' },
    prepare: showPreset,
  },
  {
    name: 'a-convert-58',
    state: 'the Convert dialog',
    prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/A-convert.png' },
    prepare: showConvert,
  },
  {
    name: 'a-invalid-58',
    state: 'the refused proposal',
    prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/A-invalid.png' },
    prepare: showInvalid,
  },
]

for (const { name, state, prototype, prepare } of comparisons) {
  test(`#58 ${name}: ${state} beside Variant A`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await compareWithPrototype(page, testInfo, {
      name,
      prototype,
      production: { route: './', prepare },
      viewport: PROTOTYPE_VIEWPORT,
    })
  })
}
