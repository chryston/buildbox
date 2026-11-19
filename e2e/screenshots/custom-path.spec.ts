import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { libraryHeading, previewSeed } from '../support/libraryApp'
import { FIRST_PROJECT, openItemDetail, openProjectFromLibrary, showFloorPlan } from '../support/previewApp'
import { compareWithPrototype } from '../support/prototypeCompare'
import type { PrototypeSource } from '../support/prototypeCompare'
import { reseedPreviewDb, seedPreviewDb } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

/**
 * A Custom Path draft photographed at the prototype's own size (#59 criterion 24).
 *
 * `prototype/odd-shape-drawing` published `A-custom.png` as its claim about drawing: labelled
 * drawing tools in one toolbar row, a hint bar centred at the top of the canvas, a chip beside
 * every segment, and a snap marker with its own words. The draft below is the same sentence told
 * in the app's own chrome — one line, one circular arc and one elliptical arc, left open so the
 * chips are live rather than a picture of a finished shape.
 *
 * The prototype is never a baseline (#39 §3), so the state is kept two ways: as a production
 * baseline of its own, and as a side-by-side against the reference PNG for the PR to be read
 * against.
 *
 * 1600 × 1000 rather than the suite's 1440 × 1000, because that is the size the prototype was
 * captured at. The clock is frozen so the toolbar's save line cannot move between two runs.
 */

test.use({ viewport: { width: 1600, height: 1000 } })

const PROTOTYPE_VIEWPORT = { width: 1600, height: 1000 }
const WASHER = 'fp-washer'
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

const shapeEditor = (page: Page): Locator => page.getByTestId('shape-editor')

/** The Washer's Item Design, from a database put back to its seed. */
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

/**
 * Millimetres to screen pixels, read off the canvas each time.
 *
 * The frame fits the whole draft including the rubber band, so it re-fits after every click and a
 * mapping taken once would drift off the shape by the third vertex.
 */
async function mapper(page: Page): Promise<(mm: { x: number, y: number }) => { x: number, y: number }> {
  const canvas = page.getByTestId('footprint-canvas')
  const box = await canvas.boundingBox()
  const parts = (await canvas.getAttribute('viewBox'))?.split(' ').map(Number) ?? []
  const [minX = 0, minY = 0, w = 1, h = 1] = parts
  if (box === null) throw new Error('the shape canvas has no box to map into')
  const mmPerPx = Math.max(w / box.width, h / box.height)
  const offX = (box.width - w / mmPerPx) / 2
  const offY = (box.height - h / mmPerPx) / 2
  return (mm) => ({
    x: box.x + offX + (mm.x - minX) / mmPerPx,
    y: box.y + offY + (mm.y - minY) / mmPerPx,
  })
}

async function clickMm(page: Page, mm: { x: number, y: number }): Promise<void> {
  const at = await (await mapper(page))(mm)
  await page.mouse.click(at.x, at.y)
}

/**
 * The draft: a line along the Washer's top edge, a circular arc down its right side, and an
 * elliptical arc back along the bottom.
 *
 * Each arc is two clicks — the end point, then the bulge it has to pass through — which is the
 * gesture behaviour 10 describes and the reason the chips are worth photographing: the arc's chip
 * is the only place its radius is written down while it is being drawn. Both bulges bow outward,
 * so the three Edges enclose a shape rather than crossing themselves — a crossing draft is
 * refused, and a refused draft has nothing to photograph. They stay inside the frame the canvas
 * had already fitted, because a click outside it lands on the page rather than the canvas. The
 * draft is left open on purpose: a closed shape has no chips, and the prototype's picture is of a
 * drawing in progress.
 */
async function showDraft(page: Page): Promise<void> {
  await openShapeEditor(page)
  await page.getByTestId('draw-line').click()
  await clickMm(page, { x: 0, y: 0 })
  await clickMm(page, { x: 120, y: 0 })
  await page.getByTestId('draw-arc').click()
  await clickMm(page, { x: 120, y: 120 })
  await clickMm(page, { x: 150, y: 60 })
  await page.getByTestId('draw-elliptical-arc').click()
  await clickMm(page, { x: 0, y: 120 })
  await clickMm(page, { x: 60, y: 150 })
  // The pointer finishes on the Washer's own far corner, so the picture carries the snap marker
  // and the words that go with it — the fourth thing the prototype's caption names. It is a hover,
  // not a click: the draft stays open with its three Edges exactly as they were placed.
  const atCorner = await (await mapper(page))({ x: 120, y: 120 })
  await page.mouse.move(atCorner.x, atCorner.y)
  // Three Edges, three chips, and the draft bar still offering `Close`: the picture is of a
  // gesture in progress, so none of this may have settled away.
  await expect(page.getByTestId('shape-draft-edge-1')).toHaveCount(1)
  await expect(page.getByTestId('shape-draft-edge-3')).toHaveCount(1)
  await expect(page.getByTestId('shape-draft-chip-3')).toBeVisible()
  await expect(page.getByTestId('shape-snap')).toBeVisible()
  expect(await page.getByTestId('shape-snap-label').evaluate((el) => el.textContent ?? '')).toMatch(/Washer/)
  await expect(page.getByTestId('shape-close-path')).toBeEnabled()
  await waitForFonts(page)
  await waitForStablePaint(shapeEditor(page))
}

test('#59 Custom Path: a line, a circular arc and an elliptical arc, with live chips', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await showDraft(page)
  await expect(page).toHaveScreenshot('custom-path-draft.png')
})

// The prototype side of the pair is the reference PNG at `cadf2d5`; the production side is the
// draft above, rebuilt on a clean page so nothing of one leaks into the other (#39 §3). The
// request is spelled out one by one because `scripts/run-screenshots.mjs` stages the prototypes by
// reading these literals — a built path would stage nothing.
const comparisons: {
  name: string
  state: string
  prototype: PrototypeSource
  prepare: (page: Page) => Promise<void>
}[] = [
  {
    name: 'a-custom-59',
    state: 'a draft of a line and two arcs',
    prototype: { kind: 'reference-png', commit: 'cadf2d5', path: 'prototype-screenshots/A-custom.png' },
    prepare: showDraft,
  },
]

for (const { name, state, prototype, prepare } of comparisons) {
  test(`#59 ${name}: ${state} beside Variant A`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await compareWithPrototype(page, testInfo, {
      name,
      prototype,
      production: { route: './', prepare },
      viewport: PROTOTYPE_VIEWPORT,
    })
  })
}
