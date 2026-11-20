import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openPreviewApp, showFloorPlan } from '../support/previewApp'

/**
 * Walls snap to what the plan shows (#64 criteria 5 and 6).
 *
 * Neither question can be answered in jsdom: the acquisition radius is measured in CSS pixels at
 * a real zoom, and the words a pointer calls up are the words a person reads. Both are checked
 * here against Walls drawn through the tool itself on the seeded Floor, which has none — so the
 * L whose corners are hovered is the L the join indicator promised while it was being drawn.
 *
 * The geometry is one 100 mm-thick L: W-1 runs east from (200,200) to (600,200), W-2 turns south
 * to (600,500). Its tidied faces therefore meet at (650,150) outside the bend and (550,250)
 * inside it, and the free caps end at x = 200 and y = 500.
 */

type Pt = { x: number, y: number }

const START: Pt = { x: 200, y: 200 }
const BEND: Pt = { x: 600, y: 200 }
const TAIL: Pt = { x: 600, y: 500 }
/** Where the two outer faces meet: 50 mm north of the bend's face and 50 mm east of W-2's. */
const OUTER: Pt = { x: 650, y: 150 }
/** One corner of W-2's free cap, the shown end of the Wall. */
const CAP: Pt = { x: 650, y: 500 }

const hoverLabel = (page: Page): Locator => page.getByTestId('wall-hover-label')
const joinIndicator = (page: Page): Locator => page.getByTestId('wall-join-indicator')
const bands = (page: Page): Locator => page.locator('[data-testid^="wall-band-"]')
const rubberBand = (page: Page): Locator => page.getByTestId('wall-draft-rubber-band')

type Scene = { zoom: number, panX: number, panY: number, left: number, top: number }

/** The Plan View's own transform: Floor millimetres to CSS pixels, as the browser sees them. */
async function scene(page: Page): Promise<Scene> {
  const canvas = floorPlanCanvas(page)
  const box = await canvas.boundingBox()
  const matrix = /matrix\(([^,]+),0,0,[^,]+,([^,]+),([^)]+)\)/
    .exec(await canvas.locator('g').first().getAttribute('transform') ?? '')
  if (box === null || matrix === null) throw new Error('the Plan View has no scene to click in')
  return { zoom: Number(matrix[1]), panX: Number(matrix[2]), panY: Number(matrix[3]), left: box.x, top: box.y }
}

/** Where a Floor point is on the screen. */
const px = (s: Scene, mm: Pt): Pt => ({ x: s.left + mm.x * s.zoom + s.panX, y: s.top + mm.y * s.zoom + s.panY })

/**
 * Zoom past `target`, about the point that matters so it does not wander off the canvas. The
 * wheel is the only zoom a person has and its step is a factor of 1.25, so the view lands at or
 * just past the round number rather than on it; the transform is the only honest reading of the
 * zoom the app settled on, and it is the one the caller measures against.
 */
async function setZoom(page: Page, about: Pt, target: number): Promise<Scene> {
  let s = await scene(page)
  const focus = px(s, about)
  await page.mouse.move(focus.x, focus.y)
  for (let step = 0; step < 60; step += 1) {
    s = await scene(page)
    if (target > 1 ? s.zoom >= target : s.zoom <= target) return s
    await page.mouse.wheel(0, target > 1 ? -60 : 60)
  }
  throw new Error(`the Plan View would not reach ${target}× (stopped at ${s.zoom})`)
}

/** Be on the Plan View with the Wall tool in hand at its default 100 mm thickness. */
async function startWalls(page: Page): Promise<void> {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await page.getByTestId('tool-wall').click()
  await expect(page.getByTestId('wall-tool-options')).toBeVisible()
  await expect(page.getByTestId('wall-thickness-field')).toHaveValue('100')
}

/** Draw the L as one chain, which is what joins its two segments (#64 §8). */
async function drawTheL(page: Page): Promise<void> {
  await startWalls(page)
  const s = await scene(page)
  for (const mm of [START, BEND, TAIL]) {
    const p = px(s, mm)
    await page.mouse.click(p.x, p.y)
  }
  // Three clicks are two segments and nothing else: a click that placed a point twice would
  // finish as three Walls, and the L would not be the L.
  await expect(page.locator('[data-testid="wall-draft-layer"] path')).toHaveCount(2)
  await page.getByTestId('wall-finish').click()
  await expect(bands(page)).toHaveCount(2)
}

/** The words on screen must never be the prototype's (#64 D6). */
function expectNoShorthand(text: string | null): void {
  const words = (text ?? '').toLowerCase()
  expect(words).not.toMatch(/\bl\b|\br\b/)
  expect(words).not.toContain('left')
  expect(words).not.toContain('right')
  expect(words).not.toContain('centreline')
}

test('the join a Wall offers is named after the geometry a person can see', async ({ page }) => {
  await drawTheL(page)
  await startWalls(page)

  // The words on screen at each hover, collected as they appear: `allTextContents` answers the
  // empty list for a join that is not offered, where `textContent` would wait for one forever.
  const words: string[] = []
  const scan = async (): Promise<void> => {
    words.push(...(await hoverLabel(page).allTextContents()), ...(await joinIndicator(page).allTextContents()))
  }

  // The shown end of W-2: a cap corner, named as an end.
  const s = await scene(page)
  const cap = px(s, CAP)
  await page.mouse.move(cap.x, cap.y)
  await expect(hoverLabel(page)).toHaveText('End of W-2')
  await expect(joinIndicator(page)).toHaveText('Join to end of W-2')
  await scan()

  // The bend, named after both Walls rather than after either reference line.
  const outer = px(s, OUTER)
  await page.mouse.move(outer.x, outer.y)
  await expect(hoverLabel(page)).toHaveText('Corner of W-1 and W-2')
  await scan()

  // Empty space promises nothing.
  const free = px(s, { x: 200, y: 600 })
  await page.mouse.move(free.x, free.y)
  await expect(joinIndicator(page)).toHaveCount(0)
  await scan()

  for (const text of words) expectNoShorthand(text)
})

/**
 * #64 criterion 5: the candidate list holds no reference-line endpoint, so the name a pointer
 * calls up at a Wall's end is the name of the tidied face corner. Half a 100 mm Wall is 50 mm,
 * which is inside the twelve-pixel radius only at or below 0.24×, so this is the zoom the
 * sentence is checked at — the one where the shown corner really is the nearest candidate.
 */
test('the exact centreline end of a Wall reads as its shown end', async ({ page }) => {
  await drawTheL(page)
  await startWalls(page)
  const s = await setZoom(page, TAIL, 0.2)
  expect(s.zoom).toBeLessThanOrEqual(0.25)

  const tail = px(s, TAIL)
  await page.mouse.move(tail.x, tail.y)
  await expect(hoverLabel(page)).toHaveText(/^(End of W-2|Corner of .+)$/)
  expectNoShorthand(await hoverLabel(page).textContent())
})

/**
 * #64 criterion 5: acquisition is twelve CSS pixels at every zoom. Eleven pixels from a face
 * corner acquires it; thirteen does not, and what is offered instead is never a Wall.
 */
for (const zoom of [0.5, 1, 4]) {
  test(`a Wall corner is acquired within twelve CSS pixels at ${zoom}×`, async ({ page }) => {
    await drawTheL(page)
    await startWalls(page)
    // Zoom about the corner itself: at 4× a corner 50 mm above the anchor would be pushed off
    // the top of the canvas, and a pointer outside the canvas is not a pointer failing to snap.
    const s = await setZoom(page, { x: START.x, y: START.y - 50 }, zoom)
    // One wheel step is a factor of 1.25, so the view sits between the target and one step past it.
    expect(s.zoom).toBeGreaterThan(zoom * 0.8)
    expect(s.zoom).toBeLessThan(zoom * 1.25)

    const corner = px(s, { x: START.x, y: START.y - 50 })
    await page.mouse.move(corner.x - 11, corner.y)
    await expect(joinIndicator(page)).toHaveText('Join to end of W-1')
    await expect(hoverLabel(page)).toHaveText('End of W-1')

    await page.mouse.move(corner.x - 13, corner.y)
    await expect(joinIndicator(page)).toHaveCount(0)
    const label = (await hoverLabel(page).textContent()) ?? ''
    expect(label).not.toMatch(/W-\d/)
  })
}

/**
 * The tidied corner the plan actually holds. The first chain was drawn on an empty Floor, so its
 * points are wherever the pixels landed — a whole pixel in Chromium, a fraction in Firefox — and
 * the corner the join kernel made from them is the target, not the idealised point asked for.
 */
async function drawnCornerNear(page: Page, near: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const numbers = ((await bands(page).first().getAttribute('d')) ?? '').match(/-?\d+(?:\.\d+)?/g) ?? []
  let best = Infinity
  let corner = { x: NaN, y: NaN }
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const point = { x: Number(numbers[i]), y: Number(numbers[i + 1]) }
    const d2 = (point.x - near.x) ** 2 + (point.y - near.y) ** 2
    if (d2 < best) {
      best = d2
      corner = point
    }
  }
  return corner
}

/**
 * #64 criterion 6, the prototype's `A-snap`: the outer corner of an L is a target in its own
 * right, and acquiring it lands the point on the tidied face corner exactly — not on the
 * centreline crossing, which is 70.7 mm away and the point the prototype used.
 */
test('the outer corner of an L is the tidied corner, to the millimetre', async ({ page }) => {
  await drawTheL(page)
  await startWalls(page)
  const s = await scene(page)
  const outer = px(s, OUTER)
  await page.mouse.move(outer.x, outer.y)
  await expect(hoverLabel(page)).toHaveText('Corner of W-1 and W-2')
  await expect(joinIndicator(page)).toHaveText('Join to end of W-1')

  await page.mouse.click(outer.x, outer.y)
  const away = px(s, { x: 900, y: 150 })
  await page.mouse.move(away.x, away.y)
  const corner = await drawnCornerNear(page, OUTER)
  // The draft's own geometry, in Floor millimetres: the point placed is the corner vertex, to
  // well under a micrometre (the drawn band itself is printed to three decimal places).
  const placed = ((await rubberBand(page).getAttribute('d')) ?? '').split(' L ')[0].replace(/^M /, '').split(' ').map(Number)
  expect(Math.hypot(placed[0] - corner.x, placed[1] - corner.y)).toBeLessThan(0.002)
  // And it is the corner, not the crossing of the two reference lines 70.7 mm away.
  expect(Math.hypot(corner.x - OUTER.x, corner.y - OUTER.y)).toBeLessThan(2)
  expect(Math.hypot(corner.x - BEND.x, corner.y - BEND.y)).toBeGreaterThan(50)
})
