import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { openItemDetail, openPreviewApp, showFloorPlan, undoButton } from '../support/previewApp'

/**
 * The Shape editor end to end (#58).
 *
 * The unit tests hold the rules; what only a browser can show is the three things a jsdom
 * render cannot: a pointer drag that draws a box of the size it was dragged, a chip that does
 * not sit on the geometry it labels once real layout has happened, and the words the app
 * actually paints — the prototype's shorthand (#58 criterion 23) was made of labels, and a
 * label only counts as absent when nothing on the screen says it.
 *
 * Every scenario edits the seeded Washer: one Placed Item, so `needsPreview` is false and a
 * gesture the controller accepts is committed as it is made. That is the rule the issue sets
 * (criterion 4 puts `Apply` on a design with two placements, not one), and it is why most of
 * these tests read the toolbar's revision line rather than a draft bar.
 */

const WASHER = 'fp-washer'

const shapeEditor = (page: Page): Locator => page.getByTestId('shape-editor')
const canvas = (page: Page): Locator => page.getByTestId('footprint-canvas')
const field = (page: Page, id: string): Locator => page.getByTestId(`shape-${id}`)

/**
 * Be on the Washer's Item Design, with the Shape tab open.
 *
 * Whether a gesture reached the model is never read off this page — Item Detail has no save
 * line or Undo button of its own — it is read back from the Placed Item on the Plan View, by
 * `placedSize` below. That is the stronger claim anyway: the toolbar reports what the session
 * thinks it stored, the Placed Item is the thing that was stored.
 */
async function openShapeEditor(page: Page): Promise<void> {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openItemDetail(page, WASHER)
  await expect(shapeEditor(page)).toBeVisible()
  await expect(page.getByTestId('shape-tab')).toBeVisible()
}

/** The Placed Item's own Width and Depth readings, in millimetres: what the model holds. */
async function placedSize(page: Page): Promise<{ width: number, depth: number }> {
  await showFloorPlan(page)
  const read = async (testId: string): Promise<number> => {
    const digits = (await page.getByTestId(testId).innerText()).match(/[\d,]+/)?.[0] ?? ''
    return Number(digits.replace(/,/g, ''))
  }
  return { width: await read('placed-width'), depth: await read('placed-depth') }
}

/** The number in one field, whatever grouping the display unit puts in it. */
async function fieldValue(page: Page, id: string): Promise<number> {
  return Number((await field(page, id).inputValue()).replace(/[\s,]/g, ''))
}

async function setField(page: Page, id: string, value: string): Promise<void> {
  await field(page, id).fill(value)
  await field(page, id).press('Enter')
  await expect(field(page, id)).toHaveValue(value)
}

/** Pick a preset from `Shapes ▾`; the editor is then placing it, and has changed nothing. */
async function pickPreset(page: Page, kind: string): Promise<void> {
  await page.getByTestId('shapes-menu').click()
  await page.getByTestId(`shape-preset-${kind}`).click()
  await expect(page.getByTestId('shape-placing')).toBeVisible()
  await expect(canvas(page)).toHaveAttribute('data-placing', kind)
}

/** The centre of the shape canvas, in viewport coordinates. */
async function canvasCentre(page: Page): Promise<{ x: number, y: number }> {
  const box = await canvas(page).boundingBox()
  if (box === null) throw new Error('the shape canvas has no box to draw in')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Press and drag, leaving the button held: the gesture the editor reads as a box. */
async function holdBox(page: Page, from: { x: number, y: number }, to: { x: number, y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 9, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 10 })
}

/**
 * #58 criterion 22: a chip that sat on the shape it was describing hid the very corner it
 * named, which is the defect the prototype carried. Every chip is checked against the box
 * being drawn — no edge of the one may fall inside the other.
 */
async function expectChipsClearOfTheGeometry(page: Page, geometry: Locator): Promise<void> {
  const shape = await geometry.boundingBox()
  if (shape === null) throw new Error('there is no drawn geometry to measure the chips against')
  for (const testId of ['footprint-chip-width', 'footprint-chip-depth']) {
    const chip = page.getByTestId(testId)
    await expect(chip).toBeVisible()
    const box = await chip.boundingBox()
    if (box === null) throw new Error(`${testId} has no box`)
    const clear
      = box.x + box.width <= shape.x + 1
        || box.x >= shape.x + shape.width - 1
        || box.y + box.height <= shape.y + 1
        || box.y >= shape.y + shape.height - 1
    expect(clear, `${testId} covers the geometry it labels`).toBe(true)
  }
}

/** #58 criterion 23: the labels the prototype used and this app rejected. */
const BANNED: readonly (string | RegExp)[] = [
  'ell ', '∠', 'Floor bbox', '(local)', 'face L', 'face R', 'Origin X', 'Origin Y',
  /W-\d+ · \d+ centre/,
]

/**
 * Say none of them of anything on screen.
 *
 * `where` is the region under test rather than the page, because the page also carries the
 * Project name and the toolbar — a scan that passed because it looked at too little would be
 * worse than one that looked at too much.
 */
async function expectNoPrototypeShorthand(where: Locator, label: string): Promise<void> {
  const text = await where.innerText()
  expect(text.length, `${label} rendered no text at all`).toBeGreaterThan(40)
  for (const banned of BANNED) {
    expect(text, `${label} says "${banned instanceof RegExp ? banned.source : banned}"`).not.toMatch(banned)
  }
}

test('the Item Design editor shows the footprint on local axes, with eight presets and no wall reference', async ({ page }) => {
  await openShapeEditor(page)

  // #58 criterion 17: the Shape, Edges and Measurements tabs, in the left inspector, over the
  // footprint on its own axes with the Item Origin marked.
  for (const tab of ['shape', 'edges', 'measurements']) {
    await expect(page.getByTestId(`shape-tab-${tab}`)).toBeVisible()
  }
  await expect(canvas(page)).toBeVisible()
  // The axes are lines, so they have no area to be "visible" by — their place in the drawing is
  // what matters, and the screenshot in criterion 24 is the evidence that they are painted.
  await expect(page.getByTestId('footprint-axis-x')).toHaveCount(1)
  await expect(page.getByTestId('footprint-axis-y')).toHaveCount(1)
  await expect(page.getByTestId('footprint-origin')).toBeVisible()

  // …and nothing that measures from a wall, because an Item Footprint has no wall to have.
  await expect(page.getByTestId('floor-bounds')).toHaveCount(0)

  // #58 criterion 1: eight presets, by name, in the order the issue lists them — plus Custom
  // Path, which #59 criterion 16 adds as the ninth entry so a drawn shape is reached the same
  // way a preset is.
  await page.getByTestId('shapes-menu').click()
  const entries = page.getByRole('menuitemradio')
  await expect(entries).toHaveCount(9)
  await expect(entries).toHaveText([
    'Square', 'Rectangle', 'Rounded Rectangle', 'Circle', 'Ellipse', 'Capsule', 'Triangle', 'Regular Polygon',
    'Custom Path',
  ])
  // #58 criterion 22: the palette is a menu of named entries, not a row of icons.
  for (const entry of await entries.all()) {
    expect(((await entry.textContent()) ?? '').trim().length).toBeGreaterThan(1)
  }

  // Opening and closing it must not move the canvas or the toolbar it lives in.
  const before = await canvas(page).boundingBox()
  await page.getByTestId('shapes-menu').click()
  await expect(page.getByRole('menuitemradio')).toHaveCount(0)
  await page.getByTestId('shapes-menu').click()
  await expect(page.getByTestId('shape-preset-circle')).toBeVisible()
  await page.getByTestId('shapes-menu').click()
  expect(await canvas(page).boundingBox()).toEqual(before)
})

test('dragging a box proposes the box it describes, and the chips sit outside it', async ({ page }) => {
  await openShapeEditor(page)

  await pickPreset(page, 'rectangle')
  // Picking a preset is not an edit: nothing is drawn, and nothing is even proposed.
  await expect(page.getByTestId('footprint-drag')).toHaveCount(0)
  await expect(page.getByTestId('shape-draft-bar')).toHaveCount(0)
  const committed = { width: await fieldValue(page, 'width'), depth: await fieldValue(page, 'depth') }

  const centre = await canvasCentre(page)
  const from = { x: centre.x - 110, y: centre.y - 80 }
  const to = { x: centre.x + 130, y: centre.y + 90 }
  await holdBox(page, from, to)

  const drawn = page.getByTestId('footprint-drag')
  await expect(drawn).toBeVisible()
  const box = await drawn.boundingBox()
  if (box === null) throw new Error('the drag drew no box')
  // The box is the pointer's own rectangle, to within the rounding of a pixel.
  expect(Math.abs(box.width - (to.x - from.x))).toBeLessThanOrEqual(2)
  expect(Math.abs(box.height - (to.y - from.y))).toBeLessThanOrEqual(2)

  // The chips read the size being drawn, in millimetres: not the committed footprint the
  // fields still hold, and not the box's width in pixels.
  const widthChip = (await page.getByTestId('footprint-chip-width').textContent())?.trim() ?? ''
  const depthChip = (await page.getByTestId('footprint-chip-depth').textContent())?.trim() ?? ''
  expect(widthChip).toMatch(/^W \d+(\.\d+)?$/)
  expect(depthChip).toMatch(/^D \d+(\.\d+)?$/)
  const chipMm = (chip: string): number => Number(chip.slice(2))
  expect(chipMm(widthChip)).toBeGreaterThan(0)
  expect(chipMm(depthChip)).toBeGreaterThan(0)
  expect(chipMm(widthChip)).not.toBe(Math.round(box.width))
  expect(chipMm(widthChip)).not.toBe(committed.width)
  expect(await fieldValue(page, 'width')).toBe(committed.width)

  // #58 criterion 22, in the preset state: neither chip touches the box it labels.
  await expectChipsClearOfTheGeometry(page, drawn)

  // Still held: the box is on the canvas and nowhere else.
  await expect(page.getByTestId('shape-draft-bar')).toHaveCount(0)

  await page.mouse.up()
  await expect(page.getByTestId('footprint-drag')).toHaveCount(0)
  await expect(canvas(page)).toHaveAttribute('data-placing', 'none')
  // Let go, and the numbers the chips were showing are the Item Footprint.
  expect(await fieldValue(page, 'width')).toBe(chipMm(widthChip))
  expect(await fieldValue(page, 'depth')).toBe(chipMm(depthChip))

  const size = await placedSize(page)
  expect(size.width).toBe(chipMm(widthChip))
  expect(size.depth).toBe(chipMm(depthChip))
  await expect(undoButton(page)).toBeEnabled()
})

test('clicking places the default size, and Escape during a drag commits nothing', async ({ page }) => {
  await openShapeEditor(page)

  await pickPreset(page, 'circle')
  const centre = await canvasCentre(page)
  await page.mouse.click(centre.x, centre.y)

  // A click is a placement of the default size, not a drag of nothing.
  await expect(page.getByTestId('shape-kind')).toHaveText('Circle')
  const diameter = await fieldValue(page, 'diameter')
  expect(diameter).toBeGreaterThan(0)
  await expect(canvas(page)).toHaveAttribute('data-placing', 'none')

  // Now a drag, abandoned with Escape mid-gesture.
  await pickPreset(page, 'rectangle')
  await page.mouse.move(centre.x - 90, centre.y - 70)
  await page.mouse.down()
  await page.mouse.move(centre.x + 60, centre.y + 50, { steps: 8 })
  await expect(page.getByTestId('footprint-drag')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()

  await expect(canvas(page)).toHaveAttribute('data-placing', 'none')
  await expect(page.getByTestId('footprint-drag')).toHaveCount(0)
  await expect(page.getByTestId('footprint-chip-width')).toHaveCount(0)
  await expect(page.getByTestId('shape-draft-bar')).toHaveCount(0)
  await expect(page.getByTestId('shape-kind')).toHaveText('Circle')

  // The model holds the Circle the click placed and none of the box that was let go of: its
  // bounds are the diameter twice over, and Undo has the one transaction behind it.
  const size = await placedSize(page)
  expect(size.width).toBeCloseTo(diameter, 0)
  expect(size.depth).toBeCloseTo(diameter, 0)
  await expect(undoButton(page)).toBeEnabled()
})

test('an invalid corner radius marks the field, keeps the last valid shape, and commits nothing', async ({ page }) => {
  await openShapeEditor(page)

  // Fixture 8: a Rounded Rectangle 2,000 × 3,000 whose top corners exactly meet is valid.
  await pickPreset(page, 'roundedRectangle')
  const centre = await canvasCentre(page)
  await page.mouse.click(centre.x, centre.y)
  await setField(page, 'width', '2000')
  await setField(page, 'depth', '3000')
  await page.getByTestId('shape-per-corner-radii').check()
  await setField(page, 'topLeft', '1000')
  await setField(page, 'topRight', '1000')
  await expect(page.getByTestId('shape-topRight-row')).toHaveAttribute('data-invalid', 'false')

  // One millimetre more: the proposal is refused, in one sentence, on one field.
  await field(page, 'topRight').fill('1001')
  await field(page, 'topRight').press('Enter')

  await expect(page.getByTestId('shape-topRight-row')).toHaveAttribute('data-invalid', 'true')
  await expect(field(page, 'topRight')).toHaveAttribute('aria-invalid', 'true')
  const messages = page.getByTestId('shape-problem-message')
  await expect(messages).toHaveCount(1)
  await expect(messages).toContainText('overlap')
  // #58 criterion 11: no coordinate pair in the sentence — the canvas marks the place. The
  // message may name the numbers that clash, so thousands grouping comes out first and what is
  // left must hold no `x, y`.
  const sentence = (await messages.innerText()).replace(/(?<=\d),(?=\d{3}\b)/g, '')
  expect(sentence).not.toMatch(/-?\d+(?:\.\d+)?\s*[,;]\s*-?\d+(?:\.\d+)?/)

  // The canvas shows the last valid shape as a ghost under the refused one, and marks the place.
  await expect(canvas(page)).toHaveAttribute('data-invalid', 'true')
  await expect(page.getByTestId('footprint-ghost')).toBeVisible()
  await expect(page.getByTestId('footprint-marker')).toBeVisible()

  // Nothing can be committed: the draft bar is up and `Apply` is unreachable.
  await expect(page.getByTestId('shape-draft-bar')).toBeVisible()
  await expect(page.getByTestId('shape-apply')).toBeDisabled()

  // Esc leaves the proposal, and the model still holds the shape that was accepted.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('shape-draft-bar')).toHaveCount(0)
  await expect(field(page, 'topRight')).toHaveValue('1000')

  expect(await placedSize(page)).toEqual({ width: 2000, depth: 3000 })
})

test('the chips stay clear of the geometry while a proposal is invalid', async ({ page }) => {
  await openShapeEditor(page)

  // Put the design into fixture 8's refused state first.
  await pickPreset(page, 'roundedRectangle')
  const centre = await canvasCentre(page)
  await page.mouse.click(centre.x, centre.y)
  await setField(page, 'width', '2000')
  await setField(page, 'depth', '3000')
  await page.getByTestId('shape-per-corner-radii').check()
  await setField(page, 'topLeft', '1000')
  await setField(page, 'topRight', '1001')
  await expect(canvas(page)).toHaveAttribute('data-invalid', 'true')

  // Then draw a box over it. The chips belong to the box, and the box is the geometry being
  // edited — so the same rule holds with a red outline, a ghost and a marker on screen.
  await pickPreset(page, 'roundedRectangle')
  await holdBox(page, { x: centre.x - 150, y: centre.y - 110 }, { x: centre.x + 150, y: centre.y + 110 })
  const drawn = page.getByTestId('footprint-drag')
  await expect(drawn).toBeVisible()
  await expectChipsClearOfTheGeometry(page, drawn)
  await page.mouse.up()
})

test('converting says what is lost, and Undo brings the parameters back', async ({ page }) => {
  await openShapeEditor(page)

  await setField(page, 'width', '3400')
  await setField(page, 'depth', '2400')
  await page.getByTestId('shape-convert').click()

  const modal = page.getByTestId('convert-modal')
  await expect(modal).toBeVisible()
  await expect(page.getByTestId('convert-modal-warning')).toContainText('width')
  await expect(page.getByTestId('convert-modal-warning')).toContainText('depth')
  await expect(page.getByTestId('convert-modal-warning')).toContainText('orientation')
  await expect(page.getByTestId('convert-modal-warning')).not.toContainText('radius')
  await expect(page.getByTestId('convert-cancel')).toBeFocused()

  // Cancel — keep parameters: the dialog closes and the Rectangle is still a Rectangle.
  await page.getByTestId('convert-cancel').click()
  await expect(modal).toHaveCount(0)
  await expect(page.getByTestId('shape-kind')).toHaveText('Rectangle')
  await expect(field(page, 'width')).toHaveValue('3400')

  await page.getByTestId('shape-convert').click()
  await page.getByTestId('convert-confirm').click()
  await expect(modal).toHaveCount(0)

  // The Rectangle is now a Custom Path, and its four edges are the four it already was.
  await expect(page.getByTestId('shape-kind')).toHaveText('Custom Path')
  await page.getByTestId('shape-tab-edges').click()
  await expect(page.getByTestId('edge-row-1')).toBeVisible()
  await expect(page.getByTestId('edge-row-4')).toBeVisible()
  await expect(page.getByTestId('edge-row-5')).toHaveCount(0)
  for (const n of [1, 2, 3, 4]) {
    await expect(page.getByTestId(`edge-kind-${n}`)).toContainText('Line')
  }
  await page.getByTestId('shape-tab-measurements').click()
  await expect(page.getByTestId('measurements-area')).toContainText('8.16 m²')

  // Undo is on the workspace toolbar, so the round trip leaves the design and comes back to it.
  await showFloorPlan(page)
  await undoButton(page).click()
  await openItemDetail(page, WASHER)
  await page.getByTestId('shape-tab-shape').click()
  await expect(page.getByTestId('shape-kind')).toHaveText('Rectangle')
  await expect(field(page, 'width')).toHaveValue('3400')
})

test('a Circle reads its area and perimeter over four Arc edges', async ({ page }) => {
  await openShapeEditor(page)

  await pickPreset(page, 'circle')
  const centre = await canvasCentre(page)
  await page.mouse.click(centre.x, centre.y)
  await setField(page, 'diameter', '1600')

  await page.getByTestId('shape-tab-edges').click()
  await expect(page.getByTestId('edge-row-4')).toBeVisible()
  await expect(page.getByTestId('edge-row-5')).toHaveCount(0)
  for (const n of [1, 2, 3, 4]) {
    await expect(page.getByTestId(`edge-kind-${n}`)).toContainText('Arc')
  }

  await page.getByTestId('shape-tab-measurements').click()
  await expect(page.getByTestId('measurements-area')).toContainText('2.01 m²')
  await expect(page.getByTestId('measurements-perimeter')).toContainText('5,027 mm')
  await expect(page.getByTestId('measurements-bounds')).toContainText('1,600 mm × 1,600 mm')
  // Readings, not inputs: Measurements has nothing to type into.
  await expect(page.getByTestId('measurements-tab').locator('input')).toHaveCount(0)
})

test('nothing on the shape editor or the selection inspector speaks the prototype’s shorthand', async ({ page }) => {
  await openShapeEditor(page)

  // Every tab, in both a valid and a refused state, and the Convert dialog over the top.
  await expectNoPrototypeShorthand(shapeEditor(page), 'the Shape tab')
  await page.getByTestId('shape-tab-edges').click()
  await expectNoPrototypeShorthand(shapeEditor(page), 'the Edges tab')
  await page.getByTestId('shape-tab-measurements').click()
  await expectNoPrototypeShorthand(shapeEditor(page), 'the Measurements tab')
  await page.getByTestId('shape-tab-shape').click()

  await pickPreset(page, 'roundedRectangle')
  const centre = await canvasCentre(page)
  await page.mouse.click(centre.x, centre.y)
  await page.getByTestId('shape-per-corner-radii').check()
  await setField(page, 'topLeft', '1000')
  await setField(page, 'topRight', '1001')
  await expect(canvas(page)).toHaveAttribute('data-invalid', 'true')
  await expectNoPrototypeShorthand(shapeEditor(page), 'a refused proposal')
  await page.getByTestId('shape-cancel').click()

  await page.getByTestId('shape-convert').click()
  await expectNoPrototypeShorthand(page.getByTestId('convert-modal'), 'the Convert dialog')
  await page.getByTestId('convert-cancel').click()

  // And the Floor selection inspector, which reads the same footprint read-only.
  await showFloorPlan(page)
  await expect(page.getByTestId('selection-inspector')).toBeVisible()
  await expect(page.getByTestId('inspector-shape')).toBeVisible()
  await expectNoPrototypeShorthand(page.getByTestId('selection-inspector'), 'the selection inspector')
})
