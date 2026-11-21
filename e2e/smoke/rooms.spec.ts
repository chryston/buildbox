/**
 * Rooms in the browser (#67 criteria 2, 7, 9, 11, 12, 15).
 *
 * Six things about a Room can only be seen by clicking on the Plan View:
 *
 *   - that four clicks and a `Close` leave a Room the inspector can measure, and that the length
 *     chip reads the geometry the cursor described rather than a rounded guess (criterion 2);
 *   - that an Outline overlapping another Room is refused *while it is being drawn* — the sentence
 *     is on the bar and `Close` will not commit it (criterion 7);
 *   - that the household shelter is one click, and that one click is a Room, four Walls and a door
 *     in the same transaction (criterion 9);
 *   - that an Edge can be attached to a Wall face through a preview that says what it will do, and
 *     detached again without moving the geometry (criterion 11);
 *   - that a Wall a Room is standing on cannot be deleted, in the words the refusal uses, until it
 *     is detached (criterion 12);
 *   - that a Placed Item says which Room it is in, or which it straddles (criterion 15).
 *
 * The scene arrives in the seed (`scripts/make-rooms-scene-seed.ts`): Walls W-1…W-5, a Kitchen as
 * an L-shaped Custom Path with three Edges on Wall faces, a Bedroom from the Rectangle preset, and
 * the Item Design `Base 600` with one Placed Item inside the Kitchen and one across it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const roomsSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'odd-shape-30.json'), 'utf8'),
) as PreviewSeed
const projectName = roomsSeed.library.find((record) => record.id === roomsSeed.projects[0]!.id)!.name

/** The Kitchen's six Edge ids, in order, as the fixture writes them. */
const KITCHEN_EDGES = ['seed-room-013', 'seed-room-014', 'seed-room-015', 'seed-room-016', 'seed-room-017', 'seed-room-018']
/** W-1, the Wall the Kitchen's first Edge stands on. */
const W1 = 'seed-wall-002'

type Pt = { x: number, y: number }

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

/** Move the cursor to a Floor point without pressing anything. */
async function hoverMm(page: Page, mm: Pt): Promise<void> {
  const p = px(await scene(page), mm)
  await page.mouse.move(p.x, p.y)
}

/** One click at a Floor point, wherever the Plan View has put it. */
async function clickMm(page: Page, mm: Pt): Promise<void> {
  const p = px(await scene(page), mm)
  await page.mouse.click(p.x, p.y)
}

/** The chip's leading number, in millimetres: `3,400 · 0°` reads 3400. */
async function chipMm(page: Page): Promise<number> {
  const text = await page.getByTestId('room-draft-chip').textContent()
  return Number((text ?? '').split(' ')[0]!.replace(/[^0-9.-]/g, ''))
}

/** Every painted Room, counted as its two shapes: the fill and the hit shape over it. The draft's
 * own path and the face preview are not Rooms. */
const roomShapes = (page: Page): Locator => page
  .locator('path[data-testid^="room-"]:not([data-testid^="room-draft-"]):not([data-testid^="room-face-"])')
const wallBands = (page: Page): Locator => page.locator('[data-testid^="wall-band-"]')

/**
 * A readout as a number. Firefox lands a pointer a fraction of a device pixel away from
 * Chromium, so a drawn Outline comes out a few millimetres off its intended corners; the
 * measurements are asserted to tolerance, never to the exact string.
 */
const readout = async (page: Page, testId: string): Promise<number> =>
  Number((await page.getByTestId(testId).innerText()).replace(/[^0-9.]/g, ''))
const doorLeaves = (page: Page): Locator => page.locator('[data-testid^="opening-leaf-"]')

async function openRoomsPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, roomsSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
  await expect(wallBands(page)).toHaveCount(5)
}

/** Take a Shapes tool, with the menu opened the way a person does it. */
async function armShape(page: Page, testId: string): Promise<void> {
  await page.getByTestId('shapes-menu').click()
  await page.getByTestId(testId).click()
}

test('four clicks and a Close leave a Room the inspector can measure', async ({ page }) => {
  await openRoomsPlan(page)
  // Two Rooms, each painted twice: its fill and its hit shape.
  await expect(roomShapes(page)).toHaveCount(4)
  await armShape(page, 'draw-line')

  await clickMm(page, { x: 4600, y: 5000 })
  // Aiming the rubber band: the chip is the geometry the cursor describes, not a rounded guess.
  await hoverMm(page, { x: 8000, y: 5000 })
  expect(Math.abs((await chipMm(page)) - 3400)).toBeLessThanOrEqual(20)
  await clickMm(page, { x: 8000, y: 5000 })
  await clickMm(page, { x: 8000, y: 6500 })
  await clickMm(page, { x: 4600, y: 6500 })
  await expect(page.getByTestId('room-draft-close')).toBeEnabled()
  await page.getByTestId('room-draft-close').click()

  await expect(page.getByTestId('room-inspector')).toBeVisible()
  expect(await page.getByTestId('room-name-input').inputValue()).toMatch(/^Room \d+$/)
  // 3,400 × 1,500 mm: 5.1 m², and a perimeter of 9,800 mm.
  expect(await readout(page, 'room-measurements-area')).toBeCloseTo(5.1, 1)
  expect(Math.abs((await readout(page, 'room-measurements-perimeter')) - 9800)).toBeLessThanOrEqual(40)
  await expect(roomShapes(page)).toHaveCount(6)
})

test('an Outline that would take floor from the Kitchen is refused while it is drawn', async ({ page }) => {
  await openRoomsPlan(page)
  await armShape(page, 'draw-line')
  // Across the Kitchen's partition Edge: floor the Kitchen already holds.
  await clickMm(page, { x: 2000, y: 2000 })
  await clickMm(page, { x: 5000, y: 2000 })
  await clickMm(page, { x: 5000, y: 4000 })
  await clickMm(page, { x: 2000, y: 4000 })

  await expect(page.getByTestId('room-draft-blocked')).toContainText('Overlaps Kitchen by')
  await expect(page.getByTestId('room-draft-close')).toBeDisabled()
  // Nothing was written: still the two Rooms the scene holds.
  await expect(roomShapes(page)).toHaveCount(4)
})

test('one click puts down the shelter: its Room, its four Walls and its door', async ({ page }) => {
  await openRoomsPlan(page)
  await armShape(page, 'place-household-shelter')
  await clickMm(page, { x: 6000, y: 5500 })

  await expect(roomShapes(page)).toHaveCount(6)
  await expect(wallBands(page)).toHaveCount(10)
  await expect(doorLeaves(page)).toHaveCount(1)
  // Placing the shelter leaves nothing selected, so the Room is picked like any other.
  await page.getByTestId('tool-select').click()
  await clickMm(page, { x: 6000, y: 5500 })
  await expect(page.getByTestId('room-inspector')).toBeVisible()
})

test('an Edge is previewed onto a Wall face, claimed, and given back without moving', async ({ page }) => {
  await openRoomsPlan(page)
  await armShape(page, 'draw-line')
  // Its first Edge lies along W-3's Room-side face, y = 6,900.
  await clickMm(page, { x: 4600, y: 6900 })
  await clickMm(page, { x: 8000, y: 6900 })
  await clickMm(page, { x: 8000, y: 5200 })
  await clickMm(page, { x: 4600, y: 5200 })
  await page.getByTestId('room-draft-close').click()
  await expect(page.getByTestId('room-inspector')).toBeVisible()

  // The first Edge's row offers its face; opening the list is not a write.
  const attach = page.locator('[data-testid^="room-edge-attach-"]').first()
  await attach.click()
  const face = page.locator('[data-testid="room-face-seed-wall-004|right"]')
  await expect(face).toBeVisible()
  // Picking it previews: the Edge is already on the face, so the preview says so.
  await page.locator('[data-testid^="room-face-pick-"]:not([data-testid="room-face-pick-on-canvas"])').first().click()
  await expect(page.locator('[data-testid^="room-face-move-"]')).toHaveText('No move')
  await page.locator('[data-testid^="room-face-attach-"]').first().click()

  // The claim is on the row, in the words that name the Wall.
  await expect(page.locator('[data-testid^="room-edge-anchor-"]').first()).toContainText('Attached to W-3')
  await page.locator('[data-testid^="room-edge-detach-"]').first().click()
  await expect(page.locator('[data-testid^="room-edge-anchor-"]')).toHaveCount(0)
  // Detach is about the reference alone: the Room is still the 3,400 × 1,700 mm it was.
  expect(Math.abs((await readout(page, 'room-measurements-perimeter')) - 10200)).toBeLessThanOrEqual(40)
})

test('a Wall a Room is standing on cannot be deleted until the Room lets go', async ({ page }) => {
  await openRoomsPlan(page)
  await page.getByTestId('tool-select').click()
  await clickMm(page, { x: 5000, y: 600 })
  await expect(page.getByTestId('wall-inspector')).toBeVisible()

  const sentence = 'W-1 is referenced by Kitchen edge 1. Detach, reattach, or remove the Room delta first.'
  await expect(page.getByTestId('wall-delete-blocked')).toHaveText(sentence)
  await expect(page.getByTestId('wall-delete')).toBeDisabled()
  await page.getByTestId('wall-delete').click({ force: true })
  await expect(page.getByTestId(`wall-band-${W1}`)).toBeVisible()

  // Detach is the way out the sentence names; the same Delete then works.
  await clickMm(page, { x: 2000, y: 1000 })
  await expect(page.getByTestId('room-inspector')).toBeVisible()
  await page.getByTestId(`room-edge-detach-${KITCHEN_EDGES[0]}`).click()
  await clickMm(page, { x: 5000, y: 600 })
  await expect(page.getByTestId('wall-delete-blocked')).toHaveCount(0)
  await expect(page.getByTestId('wall-delete')).toBeEnabled()
  await page.getByTestId('wall-delete').click()
  await expect(page.getByTestId(`wall-band-${W1}`)).toHaveCount(0)
})

test('a Placed Item says which Room it is in, and which it straddles', async ({ page }) => {
  await openRoomsPlan(page)
  await page.getByTestId('tool-select').click()

  await clickMm(page, { x: 2000, y: 1800 })
  await page.getByTestId('shape-tab-measurements').click()
  await expect(page.getByTestId('measurements-room')).toHaveText('Inside Kitchen')

  // The other one stands across the Kitchen's partition Edge.
  await clickMm(page, { x: 3950, y: 1800 })
  await page.getByTestId('shape-tab-measurements').click()
  await expect(page.getByTestId('measurements-room')).toHaveText('Crosses Kitchen')
})
