/**
 * Openings in the browser (#65 criteria 1, 4, 7, 9, 11).
 *
 * Four things can only be seen in a browser: the ghost that follows a pointer along a Wall and
 * turns the colour of a refusal before the click; a placed Opening redrawing itself when the Wall
 * it lives on changes; the review that names each Opening a Wall would take with it; and whether a
 * mark on the plan is actually clickable.
 *
 * The host is not drawn here. It arrives in the seed (`scripts/make-openings-plan-seed.ts`, one
 * 2 500 mm × 100 mm Wall through the real `wall.createChain`), because a host drawn through the
 * Wall tool would put the geometry under test — the tidied faces, the usable stretch — behind a
 * gesture that is itself under test. W-1 runs east from (600, 3 000) with two free ends, so the
 * stretch an Opening may use is the whole 2 500 mm of it, with no junction to reason about.
 *
 * The view is zoomed to 0.22×, where the whole host is on canvas and one pixel is about 4.5 mm.
 * The
 * chips are therefore read as numbers with a few millimetres of play — a pointer lands on a
 * device pixel, not on a millimetre — while what is asserted exactly is the *relationship* between
 * them: the room to each end is counted to the usable ends, and the two rooms plus the width are
 * the whole 2 400 mm stretch.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { openProjectFromLibrary, undoButton } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const openingsSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'openings-plan.json'), 'utf8'),
) as PreviewSeed
const projectName = openingsSeed.library.find((record) => record.id === openingsSeed.projects[0]!.id)!.name

type Pt = { x: number, y: number }

/** The host's middle, in Floor millimetres: 1 250 mm along W-1. */
const MIDDLE: Pt = { x: 1850, y: 3000 }
/** 2 300 mm along W-1: a 900 door centred here ends at 2 750, past the Wall's own end. */
const NEAR_END: Pt = { x: 2900, y: 3000 }
/** 550 mm along W-1: a 900 door from 100 to 1 000. */
const DOOR_AT: Pt = { x: 1150, y: 3000 }
/** 1 800 mm along W-1: a 1 200 window from 1 200 to 2 400, clear of the door. */
const WINDOW_AT: Pt = { x: 2400, y: 3000 }
/** Empty canvas, 600 mm clear of every Wall. */
const FREE: Pt = { x: 1850, y: 3600 }

/** The usable stretch of a free-ended Wall is the Wall itself, and the door the tool opens on. */
const USABLE = 2500
const DOOR_WIDTH = 900

const bands = (page: Page): Locator => page.locator('[data-testid^="wall-band-"]')
const leaves = (page: Page): Locator => page.locator('[data-testid^="opening-leaf-"]')
const windows = (page: Page): Locator => page.locator('[data-testid^="opening-window-"]')
const fitMessage = (page: Page): Locator => page.getByTestId('opening-fit-message')
const inspector = (page: Page): Locator => page.getByTestId('opening-inspector')

type Scene = { zoom: number, panX: number, panY: number, left: number, top: number }

/** The Plan View's own transform: Floor millimetres to CSS pixels, as the browser sees them. */
async function scene(page: Page): Promise<Scene> {
  const canvas = page.getByTestId('floor-plan-canvas')
  const box = await canvas.boundingBox()
  const matrix = /matrix\(([^,]+),0,0,[^,]+,([^,]+),([^)]+)\)/
    .exec(await canvas.locator('g').first().getAttribute('transform') ?? '')
  if (box === null || matrix === null) throw new Error('the Plan View has no scene to click in')
  return { zoom: Number(matrix[1]), panX: Number(matrix[2]), panY: Number(matrix[3]), left: box.x, top: box.y }
}

/** Where a Floor point is on the screen. */
const px = (s: Scene, mm: Pt): Pt => ({ x: s.left + mm.x * s.zoom + s.panX, y: s.top + mm.y * s.zoom + s.panY })

const hover = async (page: Page, mm: Pt): Promise<void> => {
  const p = px(await scene(page), mm)
  await page.mouse.move(p.x, p.y)
}

const click = async (page: Page, mm: Pt): Promise<void> => {
  const p = px(await scene(page), mm)
  await page.mouse.click(p.x, p.y)
}

/**
 * Zoom in to `target` with the wheel, about the host's middle. The wheel is the only zoom a
 * person has and its step is a factor of 1.25, so the view lands at or just past the round number
 * rather than on it; the transform is the only honest reading of the zoom the app settled on, and
 * every click below is computed from it afterwards.
 */
async function zoomIn(page: Page, about: Pt, target: number): Promise<void> {
  let s = await scene(page)
  const focus = px(s, about)
  await page.mouse.move(focus.x, focus.y)
  for (let step = 0; step < 60; step += 1) {
    s = await scene(page)
    if (s.zoom >= target) return
    await page.mouse.wheel(0, -60)
  }
  throw new Error(`the Plan View would not reach ${target}× (stopped at ${String(s.zoom)})`)
}

/** Be on the Plan View of the seeded one-Wall Project, framed on W-1 at 0.3×. */
async function openThePlan(page: Page): Promise<void> {
  await seedPreviewDb(page, openingsSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(bands(page)).toHaveCount(1)
  await zoomIn(page, MIDDLE, 0.22)
}

/** Take the Door / window tool, with the bedroom door — the row the tool opens on — in hand. */
async function startOpenings(page: Page): Promise<void> {
  await page.getByTestId('tool-opening').click()
  await expect(page.getByTestId('opening-tool-options')).toBeVisible()
  await expect(page.getByTestId('opening-preset-picker')).toHaveValue('door.bedroom')
}

/** The chip's number, in millimetres: `1,050` reads 1050. */
async function chipMm(page: Page, testId: string): Promise<number> {
  return Number((await page.getByTestId(testId).textContent() ?? '').replace(/[^0-9.-]/g, ''))
}

test('the ghost says where the Opening would go, and what would stop it', async ({ page }) => {
  await openThePlan(page)
  await startOpenings(page)

  // Over the Wall: a ghost, and the room to each end counted to the usable ends.
  await hover(page, MIDDLE)
  await expect(page.getByTestId('opening-draft-layer')).toBeVisible()
  await expect(leaves(page)).toHaveCount(1)
  await expect(fitMessage(page)).toHaveCount(0)
  const fromStart = await chipMm(page, 'opening-distance-start')
  const fromEnd = await chipMm(page, 'opening-distance-end')
  // The pointer is 1 250 mm along W-1, so a 900 door centred there starts near 800 …
  expect(Math.abs(fromStart - 800)).toBeLessThanOrEqual(5)
  // … and the two rooms plus the width are the whole stretch an Opening may use: 2 500 mm of
  // free-ended Wall, counted from the ends the Opening is allowed to touch.
  expect(Math.abs(fromStart + DOOR_WIDTH + fromEnd - USABLE)).toBeLessThanOrEqual(10)

  // Past the trimmed end: the same ghost in the colour of a refusal, and the sentence naming the
  // end it would run past — the words a person reads instead of guessing why nothing happened.
  await hover(page, NEAR_END)
  await expect(fitMessage(page)).toHaveText("Bedroom door doesn't fit here: it would run past the end of W-1.")
  await expect(leaves(page)).toHaveCount(1)

  // Off the Wall entirely: no ghost, no sentence, and a click that does nothing.
  await hover(page, FREE)
  await expect(leaves(page)).toHaveCount(0)
  await expect(fitMessage(page)).toHaveCount(0)
  await click(page, FREE)
  await expect(leaves(page)).toHaveCount(0)
})

test('a placed Opening follows the Wall it is on', async ({ page }) => {
  await openThePlan(page)
  await startOpenings(page)
  await click(page, MIDDLE)
  // The tool repeats, so the ghost is still under the pointer: leave the tool to see the plan.
  await page.getByTestId('tool-select').click()
  await expect(leaves(page)).toHaveCount(1)
  const before = await leaves(page).first().boundingBox()
  const bandBefore = await bands(page).first().boundingBox()
  if (before === null || bandBefore === null) throw new Error('the placed Opening drew no leaf')

  // The host is moved off the line it was drawn on: 200 mm to one side, from its own inspector.
  // The Opening holds a distance along the Wall and nothing else, so its marks go with it.
  await click(page, { x: 2700, y: 3000 })
  await page.getByTestId('wall-inspector-more').click()
  await page.getByTestId('wall-offset-field').fill('200')
  await page.getByTestId('wall-offset-side').selectOption('right')
  await page.getByTestId('wall-offset-apply').click()

  const after = await leaves(page).first().boundingBox()
  const bandAfter = await bands(page).first().boundingBox()
  if (after === null || bandAfter === null) throw new Error('the Opening lost its leaf')
  const moved = bandAfter.y - bandBefore.y
  // The Wall moved, the Opening moved by the same amount, and its station along the Wall is
  // untouched: it never held a coordinate of its own.
  expect(Math.abs(moved)).toBeGreaterThan(5)
  // Two engines, two ways of rounding a fractional bounding box: the marks move with the Wall to
  // within a pixel, which is what "follows" means when the plan is drawn at 0.27×.
  expect(Math.abs(after.y - before.y - moved)).toBeLessThanOrEqual(4)
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(4)
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(4)
})

test('deleting the Wall says which Openings go with it, and one undo brings them back', async ({ page }) => {
  await openThePlan(page)
  await startOpenings(page)
  await click(page, DOOR_AT)
  await page.getByTestId('opening-preset-picker').selectOption('window.standard')
  await click(page, WINDOW_AT)
  await page.getByTestId('tool-select').click()
  // A door is one leaf; a window is its three lines.
  await expect(leaves(page)).toHaveCount(1)
  await expect(windows(page)).toHaveCount(3)

  // Two Openings cut the band into three pieces; the click goes to the strip of Wall between them.
  await click(page, { x: 1700, y: 3000 })
  await page.getByTestId('wall-delete').click()
  const dialog = page.getByTestId('delete-wall-review-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Delete W-1 and its 2 openings?')
  await expect(page.getByTestId('delete-wall-review-row')).toHaveCount(2)
  await expect(page.getByTestId('delete-wall-review-confirm')).toHaveText('Delete wall and 2 openings')

  // Cancel is not a half-delete: nothing moved.
  await page.getByTestId('delete-wall-review-cancel').click()
  await expect(dialog).toHaveCount(0)
  await expect(bands(page).first()).toBeVisible()
  await expect(leaves(page)).toHaveCount(1)
  await expect(windows(page)).toHaveCount(3)

  // Confirm takes all three in one step, and one undo returns all three.
  await page.getByTestId('wall-delete').click()
  await page.getByTestId('delete-wall-review-confirm').click()
  await expect(bands(page)).toHaveCount(0)
  await expect(leaves(page)).toHaveCount(0)
  await expect(windows(page)).toHaveCount(0)
  await undoButton(page).click()
  await expect(bands(page).first()).toBeVisible()
  await expect(leaves(page)).toHaveCount(1)
  await expect(windows(page)).toHaveCount(3)
})

test('clicking an Opening selects it and nothing else', async ({ page }) => {
  await openThePlan(page)
  await startOpenings(page)
  await click(page, MIDDLE)
  await page.getByTestId('tool-select').click()
  await expect(inspector(page)).toHaveCount(0)
  // The Opening's footprint — the gap the door took, from face to face — is what the pointer
  // lands on. The marks above it are hairlines, which is a hard thing to aim at and, on Firefox,
  // a thing whose `pointerdown` never reaches the app at all.
  await click(page, MIDDLE)
  await expect(inspector(page)).toBeVisible()
  await expect(page.getByTestId('opening-inspector-kind')).toHaveText('Door')
  await expect(page.getByTestId('opening-inspector-host')).toHaveText('W-1')
  await expect(page.getByTestId('opening-inspector-swing')).toHaveText('Opens toward this side of W-1')
  // The distance the plan drew is the distance the inspector edits, verbatim.
  expect(Math.abs(Number(await page.getByTestId('opening-inspector-distance').inputValue()) - 800)).toBeLessThanOrEqual(5)
  // A click that landed on the Opening did not select the Wall under it.
  await expect(page.getByTestId('wall-inspector')).toHaveCount(0)

  await click(page, FREE)
  await expect(inspector(page)).toHaveCount(0)
})
