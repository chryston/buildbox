import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { expectStableCanvas } from '../support/expectStableCanvas'
import { openItemDetail, openPreviewApp, showFloorPlan, undoButton } from '../support/previewApp'

/**
 * Drawing a Custom Path, in a real browser (#59).
 *
 * The unit tests hold the rules and the jsdom specs hold the fields. What only a browser can
 * answer is the set of questions that are about geometry on a screen rather than numbers in a
 * model: does a typed length survive the trip from the keyboard to a vertex drawn where the
 * pointer pointed; does a snap put the vertex on the canonical millimetre rather than under the
 * cursor, which is the difference between 120 mm and 118.6 mm on the saved Placed Item; do the
 * Snaps checkboxes line up with their labels the way criterion 17 demands, which is a statement
 * about laid-out boxes that jsdom cannot make at all; and does the draft bar appear without
 * moving the canvas by a pixel, which is the failure the prototype's `A-custom` ribbon had.
 *
 * Everything is drawn on the seeded Washer, whose footprint is a 120 × 120 rectangle at the
 * origin. Its corners are canonical millimetres and the canvas shows them as snap targets, which
 * is what makes the snap assertion decisive: a snap that landed on the cursor instead of the
 * target would leave a bounding box that is not a whole number of millimetres. The drawing tests
 * start from the rectangle rather than a converted path on purpose — a committed Custom Path
 * draws a handle at every corner, and a press on a handle selects a vertex instead of starting a
 * draft, which is the right behaviour and the wrong fixture.
 */

const WASHER = 'fp-washer'
/** The Washer's own corners, which are also the snap targets every drawing test aims at. */
const A = { x: 0, y: 0 }
const B = { x: 120, y: 0 }
const C = { x: 120, y: 120 }
const D = { x: 0, y: 120 }
/** The middle of the Washer, which is inside the rectangle and so never widens a bounding box. */
const MID = { x: 60, y: 60 }

const canvas = (page: Page): Locator => page.getByTestId('footprint-canvas')
const shapeEditor = (page: Page): Locator => page.getByTestId('shape-editor')
const draft = (page: Page): Locator => page.getByTestId('shape-draft')

/** Be on the Washer's Item Design, on the Shape tab. */
async function openShapeEditor(page: Page): Promise<void> {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openItemDetail(page, WASHER)
  await expect(shapeEditor(page)).toBeVisible()
  await expect(page.getByTestId('shape-tab')).toBeVisible()
}

interface Mapper {
  /** Millimetres in a screen pixel, so "six pixels off" is stated in the units the canvas uses. */
  readonly mmPerPx: number
  readonly at: (mm: { x: number, y: number }) => { x: number, y: number }
}

/**
 * Where the canvas's millimetre grid sits on the screen: the `viewBox` the component chose,
 * mapped through the box the browser laid it out in. Read rather than assumed, because the
 * canvas auto-fits the shape it is showing and the padding is its own business.
 */
async function mapper(page: Page): Promise<Mapper> {
  const box = await canvas(page).boundingBox()
  if (box === null) throw new Error('the shape canvas has no box to draw in')
  const parts = (await canvas(page).getAttribute('viewBox'))?.split(' ').map(Number) ?? []
  const [minX = 0, minY = 0, w = 1, h = 1] = parts
  const mmPerPx = Math.max(w / box.width, h / box.height)
  const offX = (box.width - w / mmPerPx) / 2
  const offY = (box.height - h / mmPerPx) / 2
  return {
    mmPerPx,
    at: (mm) => ({ x: box.x + offX + (mm.x - minX) / mmPerPx, y: box.y + offY + (mm.y - minY) / mmPerPx }),
  }
}

async function clickMm(page: Page, mm: { x: number, y: number }): Promise<void> {
  const map = await mapper(page)
  const p = map.at(mm)
  await page.mouse.click(p.x, p.y)
}

/** Move the pointer without pressing: the rubber band follows it, and so does the snap marker. */
async function hoverMm(page: Page, mm: { x: number, y: number }): Promise<void> {
  const map = await mapper(page)
  const p = map.at(mm)
  await page.mouse.move(p.x, p.y)
}

/** A point `dx`/`dy` screen pixels away from `mm` — the way a cursor misses a corner. */
function offset(mm: { x: number, y: number }, mmPerPx: number, dxPx: number, dyPx: number): { x: number, y: number } {
  return { x: mm.x + dxPx * mmPerPx, y: mm.y + dyPx * mmPerPx }
}

/** Arm the Line tool. */
async function armLine(page: Page): Promise<void> {
  await page.getByTestId('draw-line').click()
  await expect(page.getByTestId('draw-line')).toHaveAttribute('aria-pressed', 'true')
}

/** The Placed Item's bounding box, read on the Plan View: what the Project really holds. */
async function placedSize(page: Page): Promise<{ width: number, depth: number }> {
  await showFloorPlan(page)
  const read = async (testId: string): Promise<number> => {
    const digits = (await page.getByTestId(testId).innerText()).match(/[\d.,]+/)?.[0] ?? ''
    return Number(digits.replace(/,/g, ''))
  }
  return { width: await read('placed-width'), depth: await read('placed-depth') }
}

/** Back to the Item Design after a trip to the Plan View. */
async function backToDesign(page: Page): Promise<void> {
  await page.getByTestId('open-item-detail').click()
  await expect(shapeEditor(page)).toBeVisible()
}

/** The Edges tab's Length column for edge `oneBased`, in millimetres. */
async function edgeLength(page: Page, oneBased: number): Promise<number> {
  await page.getByTestId('shape-tab-edges').click()
  const text = await page.getByTestId(`edge-length-${oneBased}`).innerText()
  await page.getByTestId('shape-tab-shape').click()
  // The column reads `30 mm`; the unit is the display's, the number is the model's.
  return Number(text.replace(/[^\d.]/g, ''))
}

test.describe('Custom Path', () => {
  test.beforeEach(async ({ page }) => {
    await openShapeEditor(page)
  })

  test('a typed length lands exactly on the pointer direction', async ({ page }) => {
    await armLine(page)
    await clickMm(page, MID)
    // The cursor is 50 mm along the edge, nowhere near 30: the number is what places the vertex,
    // and the cursor only says which way to go.
    await hoverMm(page, { x: 110, y: 60 })
    const length = page.getByTestId('draft-length')
    await page.keyboard.press('3')
    await expect(length).toBeVisible()
    await length.fill('30')
    await length.press('Enter')
    await expect(length).toBeHidden()
    await clickMm(page, D)
    await expect(page.getByTestId('shape-close-path')).toBeEnabled()
    await page.getByTestId('shape-close-path').click()
    await expect(draft(page)).toBeHidden()
    // The saved Edge is the typed number to the millimetre — not a measurement of where the
    // cursor happened to be when Enter was pressed.
    expect(await edgeLength(page, 1)).toBe(30)
  })

  test('a self-crossing loop is named once, Close is inert, and Esc writes nothing', async ({ page }) => {
    const settled = await placedSize(page)
    await backToDesign(page)
    await armLine(page)
    // A bowtie: edge 1 and edge 3 cross, the one thing a closed path may not do.
    for (const point of [A, C, B, D]) await clickMm(page, point)
    const messages = page.getByTestId('shape-problem-message')
    await expect(messages).toHaveCount(1)
    await expect(messages.first()).toContainText('cross')
    // One sentence, and no coordinates: the prototype printed a pair nobody could point at.
    expect(await messages.first().innerText()).not.toMatch(/\(\s*-?\d/)
    await expect(page.getByTestId('shape-draft-bar')).toHaveAttribute('data-invalid', 'true')
    await expect(page.getByTestId('footprint-canvas')).toHaveAttribute('data-invalid', 'true')
    await expect(page.getByTestId('shape-close-path')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(draft(page)).toBeHidden()
    expect(await placedSize(page)).toEqual(settled)
  })

  test('Backspace removes the last point, Enter closes, Esc cancels', async ({ page }) => {
    await armLine(page)
    for (const point of [A, B, C, D]) await clickMm(page, point)
    await expect(page.getByTestId('shape-draft-edge-3')).toHaveCount(1)
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('shape-draft-edge-3')).toHaveCount(0)
    await expect(page.getByTestId('shape-draft-edge-2')).toHaveCount(1)
    // Enter closes what is on the screen, and the triangle is the shape that gets saved.
    await page.keyboard.press('Enter')
    await expect(draft(page)).toBeHidden()
    await page.getByTestId('shape-tab-edges').click()
    await expect(page.getByTestId('edge-length-3')).toHaveCount(1)
    await expect(page.getByTestId('edge-length-4')).toHaveCount(0)

    // Three fresh points, none of them a corner: the shape is a Custom Path now, so its corners
    // carry vertex handles, and a press on a handle selects a corner rather than opening a draft.
    // Closing also stands the tool down, so it has to be armed again.
    await armLine(page)
    for (const point of [MID, { x: 110, y: 40 }, { x: 30, y: 100 }]) await clickMm(page, point)
    await expect(draft(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(draft(page)).toBeHidden()
    // Cancelling a draft leaves the shape it started from, untouched.
    await page.getByTestId('shape-tab-edges').click()
    await expect(page.getByTestId('edge-length-3')).toHaveCount(1)
    await expect(page.getByTestId('edge-length-4')).toHaveCount(0)
  })

  test('the draft bar never moves the toolbar or the canvas', async ({ page }) => {
    const targets = { toolbar: page.getByTestId('shape-toolbar'), canvas: page.getByTestId('shape-canvas-host') }
    // The prototype's `A-custom` ribbon reflowed into three rows and pushed the canvas down.
    // Every one of these transitions adds chrome above or below the drawing; none may move it.
    await expectStableCanvas(page, async () => { await armLine(page) }, targets)
    // A bowtie, one vertex at a time: the fourth is the one that makes the draft invalid.
    await expectStableCanvas(page, async () => { await clickMm(page, A) }, targets)
    await expectStableCanvas(page, async () => { await clickMm(page, C) }, targets)
    await expectStableCanvas(page, async () => { await clickMm(page, B) }, targets)
    // The invalid state adds a sentence to the draft bar. It is still one row of chrome.
    await expectStableCanvas(page, async () => {
      await clickMm(page, D)
      await expect(page.getByTestId('shape-draft-bar')).toHaveAttribute('data-invalid', 'true')
    }, targets)
    await expectStableCanvas(page, async () => {
      await page.keyboard.press('Escape')
      await expect(draft(page)).toBeHidden()
    }, targets)
  })

  test('dragging a vertex handle moves that corner, and Undo gives it back', async ({ page }) => {
    await page.getByTestId('shape-convert').click()
    await page.getByTestId('convert-confirm').click()
    await expect(page.getByTestId('shape-kind')).toHaveText('Custom Path')
    const before = await placedSize(page)
    await backToDesign(page)
    const box = await page.getByTestId('shape-handle-2').boundingBox()
    if (box === null) throw new Error('the vertex handle has no box to grab')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 6 })
    await page.mouse.up()
    // The whole drag is one transaction, and it is the corner that was grabbed that moved: the
    // two corners beside it are where they were, so the neighbours were trimmed, not dragged.
    const corners = await page.locator('[data-testid^="shape-handle-"]').evaluateAll((els) => els
      .map((el) => ({ x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')) })))
    expect(corners[0]).toEqual(A)
    expect(corners[2]).toEqual(C)
    expect(corners[3]).toEqual(D)
    expect(corners[1].x).toBeGreaterThan(B.x)
    expect(corners[1].y).toBeGreaterThan(B.y)
    const moved = await placedSize(page)
    expect(moved.width).toBeGreaterThan(before.width)
    await undoButton(page).click()
    await expect(page.getByTestId('placed-width')).toHaveText(new RegExp(String(before.width)))
  })

  test('a snapped vertex lands on the canonical millimetre, not under the cursor', async ({ page }) => {
    const settled = await placedSize(page)
    await backToDesign(page)
    // Grid, angle and axis off, so the only thing that can catch the cursor is a corner of the
    // shape's own geometry. A corner that is also a grid point, an axis line or a 15° ray from
    // the last vertex would pass this test for the wrong reason — those three are the candidates
    // that sit *on* the cursor and so win on distance, and none of them is a canonical point.
    await page.getByTestId('snaps-menu').click()
    for (const id of ['snap-grid', 'snap-angle', 'snap-axis']) await page.getByTestId(id).uncheck()
    await page.getByTestId('snaps-menu').click()
    const { mmPerPx } = await mapper(page)
    await armLine(page)
    // Each aim is six pixels off one of the Washer's own corners — well inside the twelve pixel
    // acquisition radius, and far enough that the vertex could not have landed there by accident.
    await clickMm(page, offset(A, mmPerPx, 6, 6))
    for (const [corner, dx, dy] of [[B, 6, 6], [C, 6, 6]] as const) {
      const at = offset(corner, mmPerPx, dx, dy)
      await hoverMm(page, at)
      await expect(page.getByTestId('shape-snap')).toBeVisible()
      // The label is SVG `<text>`, which has no innerText, so it is read off the DOM.
      const label = await page.getByTestId('shape-snap-label').evaluate((el) => el.textContent ?? '')
      expect(label).toMatch(/corner/i)
      await clickMm(page, at)
    }
    await page.getByTestId('shape-close-path').click()
    await expect(draft(page)).toBeHidden()
    // The triangle spans exactly the corners it was aimed at. A vertex that landed under the
    // cursor instead of on the target would leave a bounding box that is not a whole number.
    const drawn = await placedSize(page)
    expect(drawn.width).toBe(settled.width)
    expect(drawn.depth).toBe(settled.depth)
  })

  test('the Snaps rows are checkboxes beside their own labels', async ({ page }) => {
    await page.getByTestId('snaps-menu').click()
    await expect(page.getByTestId('snaps-panel')).toBeVisible()
    const rows: readonly [checkbox: string, row: string][] = [
      ['snap-grid', 'snap-row-grid'],
      ['snap-endpoints', 'snap-row-endpoints'],
      ['snap-centres', 'snap-row-centres'],
      ['snap-intersections', 'snap-row-intersections'],
      ['snap-wall-faces', 'snap-row-wallFaces'],
      ['snap-axis', 'snap-row-axis'],
      ['snap-angle', 'snap-row-angle'],
      ['snap-perpendicular', 'snap-row-perpendicular'],
      ['snap-tangent', 'snap-row-tangent'],
    ]
    for (const [checkboxId, rowId] of rows) {
      const checkbox = page.getByTestId(checkboxId)
      await expect(checkbox).toBeVisible()
      const box = await checkbox.boundingBox()
      const text = await page.getByTestId(rowId).locator('span').first().boundingBox()
      if (box === null || text === null) throw new Error(`the ${checkboxId} row has no boxes to measure`)
      // A real checkbox, to the left of the words it belongs to, on the same line: the prototype
      // drew a square and painted a tick, which is not a control a keyboard can reach.
      expect(box.width).toBeGreaterThan(8)
      expect(text.x - (box.x + box.width)).toBeLessThanOrEqual(8)
      expect(Math.abs(box.y + box.height / 2 - (text.y + text.height / 2))).toBeLessThanOrEqual(2)
    }
  })
})
