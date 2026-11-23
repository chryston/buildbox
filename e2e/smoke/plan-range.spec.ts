/**
 * The Plan View Range in the browser (#74 criteria 4, 5, 9, 13).
 *
 * Four things about a range only happen in a browser, because they are about what the picture does
 * while the Project stays where it was:
 *
 *   - the saved-view card opens with the range the view carries — `Lower 0`, `Upper 1200` — and the
 *     gauge's two stops stand where those two numbers say (criterion 4);
 *   - moving `Upper` from 1200 to 1510 brings `Wall cabinet` into the picture as solid ink without
 *     editing one entity: the undo step that follows changes the view and nothing else, and taking
 *     it back dashes the cabinet again (criterion 2, §4);
 *   - one click inside the two cabinets that share a footprint selects the standing one, the second
 *     click walks to the Above-range one and says so in its row, and the third comes back
 *     (criterion 9);
 *   - typing a new `Top` into the inspector moves the item rather than stretching it, and one undo
 *     puts it back on 1500 (criterion 13).
 *
 * The scene arrives in the seed (`scripts/make-plan-range-seed.ts`): a 4 m × 3 m shell with a window
 * at 900–2 100, `Base cabinet` twice at Base 0, `Wall cabinet` at Base 1 500 standing over the first
 * of them, and a `Sump box` sunk 150 below the Floor Datum.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import type { Project } from '../../src/domain'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const planRangeSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'plan-range.json'), 'utf8'),
) as PreviewSeed
const projectName = planRangeSeed.library.find((record) => record.id === planRangeSeed.projects[0]!.id)!.name

const scene0 = planRangeSeed.projects[0]!.data as unknown as Project
const designId = (name: string): string =>
  scene0.itemDesigns.find((design) => design.name === name)!.id
/** The first placement of a Design: for `Base cabinet`, the one the Wall cabinet stands over. */
const placedId = (name: string): string =>
  scene0.existingModel.placedItems.find((item) => item.itemDesignId === designId(name))!.id

const BASE = placedId('Base cabinet')
const WALL = placedId('Wall cabinet')
const SUMP = placedId('Sump box')

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

const px = (s: Scene, mm: Pt): Pt => ({ x: s.left + mm.x * s.zoom + s.panX, y: s.top + mm.y * s.zoom + s.panY })

/** One click at a Floor point, wherever the Plan View has put it. */
async function clickMm(page: Page, mm: Pt, offset: Pt = { x: 0, y: 0 }): Promise<void> {
  const p = px(await scene(page), mm)
  await page.mouse.click(p.x + offset.x, p.y + offset.y)
}

/** The ink of one Placed Item: the first path of the group the canvas drew for it. */
const ink = (page: Page, placedItemId: string): Locator =>
  page.locator(`[data-testid="placed-object-${placedItemId}"] path`).first()

/** Both cabinets stand on the same 600 × 500 footprint centred on this point. */
const STACK: Pt = { x: 600, y: 600 }

async function openRangePlan(page: Page): Promise<void> {
  await seedPreviewDb(page, planRangeSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

test.describe('the Plan View Range', () => {
  test('the card shows the range and the canvas classes the scene by it (#74 criterion 4)', async ({ page }) => {
    await openRangePlan(page)
    await expect(page.getByTestId('plan-view-range-section')).toBeVisible()
    await expect(page.getByTestId('range-lower-field')).toHaveValue('0')
    await expect(page.getByTestId('range-upper-field')).toHaveValue('1200')
    await expect(page.getByTestId('range-stop-lower-label')).toHaveText('Lower 0')
    await expect(page.getByTestId('range-stop-upper-label')).toHaveText('Upper 1200')

    // In range is the normal graphics: solid ink, full strength.
    await expect(ink(page, BASE)).not.toHaveCSS('fill', 'none')
    await expect(ink(page, BASE)).toHaveCSS('stroke-dasharray', 'none')
    // Above range keeps its colour and loses its fill, and its stroke is dashed.
    await expect(ink(page, WALL)).toHaveCSS('fill', 'none')
    await expect(ink(page, WALL)).not.toHaveCSS('stroke-dasharray', 'none')
    // Below range is the one opacity token, and nothing is hidden.
    await expect(ink(page, SUMP)).toHaveCSS('opacity', '0.28')
    await expect(page.locator(`[data-testid="placed-object-${SUMP}"]`)).toBeVisible()
  })

  test('widening the range edits no entity, and undo takes the picture back (#74 §4)', async ({ page }) => {
    await openRangePlan(page)
    const upper = page.getByTestId('range-upper-field')
    await upper.fill('1510')
    await upper.press('Enter')
    await expect(ink(page, WALL)).not.toHaveCSS('fill', 'none')

    // The item never moved. With both cabinets In range the cycle starts from the one drawn on top,
    // which is the Wall cabinet, and it still stands on the Base 1500 the undo will find again.
    await clickMm(page, STACK)
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('1500')

    await page.getByTestId('undo-button').click()
    await expect(upper).toHaveValue('1200')
    await expect(ink(page, WALL)).toHaveCSS('fill', 'none')
  })

  test('one footprint, two cabinets: the cycle walks the Range (#74 criterion 9)', async ({ page }) => {
    await openRangePlan(page)
    await clickMm(page, STACK)
    await expect(page.getByTestId('overlap-header')).toHaveText('Overlap 1/2 · click again to cycle')
    await expect(page.getByTestId(`overlap-row-${WALL}`)).toHaveText('[Existing] 2 of 2 · Wall cabinet · Above range')
    // The In-range cabinet was selected, so its rows are the ones in the rail.
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('0')
    await expect(page.getByTestId('placed-extent-top')).toHaveValue('860')

    // 4 CSS px away: the same spot, so the cycle continues rather than starting again.
    await clickMm(page, STACK, { x: 4, y: 0 })
    await expect(page.getByTestId('overlap-header')).toHaveText('Overlap 2/2 · click again to cycle')
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('1500')
    await expect(page.getByTestId('placed-extent-top')).toHaveValue('2200')

    await clickMm(page, STACK, { x: 2, y: 0 })
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('0')

    // Escape takes the list away and leaves the selection it made.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('overlap-cycle')).toHaveCount(0)
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('0')
  })

  test('a new Top moves the item, and one undo puts it back (#74 criterion 13)', async ({ page }) => {
    await openRangePlan(page)
    await clickMm(page, STACK)
    await clickMm(page, STACK, { x: 4, y: 0 })
    const top = page.getByTestId('placed-extent-top')
    await top.fill('2160')
    await top.press('Enter')
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('1460')
    await expect(page.getByTestId('placed-extent-height-line')).toHaveText(
      '700 mm · from Item Design Wall cabinet · shared by 1 placement',
    )

    await page.getByTestId('undo-button').click()
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('1500')
    await expect(top).toHaveValue('2200')
  })
})
