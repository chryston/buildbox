/**
 * Elevation Views in the browser (#75 criteria 8, 10, 11, 12, 14, 16, 22).
 *
 * Six things about a split workspace only happen in a browser, because every one of them is about
 * where a pointer lands in a picture that is being laid out as it is drawn:
 *
 *   - the saved-view card opens an Elevation View into a second pane beside the Plan View, and the
 *     pane draws the Floor standing on its Datum (criterion 8);
 *   - selecting in either pane selects in both, because there is one selection and one Project
 *     behind them: a click on a cabinet in the plan puts handles on its row in the pane, and a click
 *     on a sunk box's face in the pane puts that box in the inspector (criterion 11);
 *   - dragging a row's handle moves the entity vertically and nothing else, and one Undo puts it
 *     back (criteria 10, 11);
 *   - a handle released near the Floor Datum lands on it — the guide says so while the pointer is
 *     down and the number that arrives is exactly 0 — and pressing Escape instead writes nothing
 *     (criteria 12, 14);
 *   - below 960 CSS px the two panes stand one above the other rather than sharing a width nobody
 *     can read (criterion 16);
 *   - and the Export dialog offers the Elevation View as a drawing of its own, whose sheet says
 *     which view it was looked from (criterion 22).
 *
 * The scene arrives in the seed (`scripts/make-elevation-seed.ts`): a 4 m × 3 m shell with a window
 * at 900–2 100 standing 1 500 along W-1, two `Base cabinet`s at Base 0, a `Wall cabinet` at 1 500,
 * a `Sump box` sunk 150 below the Datum at Floor x = 2 200, and the `Kitchen elevation` stood on a
 * line across the room at y = 1 400, looking at the run of cabinets.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { readDownload } from '../support/libraryApp'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import type { Project } from '../../src/domain'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const elevationSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'elevation.json'), 'utf8'),
) as PreviewSeed
const projectName = elevationSeed.library.find((record) => record.id === elevationSeed.projects[0]!.id)!.name

const scene0 = elevationSeed.projects[0]!.data as unknown as Project
const kitchen = scene0.elevationViews!.find((view) => view.name === 'Kitchen elevation')!
const WALL = scene0.existingModel.walls[0]!.id
const WINDOW = scene0.existingModel.openings[0]!.id
const CABINET = scene0.existingModel.placedItems
  .find((item) => item.baseElevation === 0)!.id
const SUMP = scene0.existingModel.placedItems
  .find((item) => scene0.itemDesigns.find((d) => d.id === item.itemDesignId)?.name === 'Sump box')!.id

type Pt = { x: number, y: number }
/** An affine the app owns: `screenX = left + a·x + panX`, `screenY = top + d·y + panY`. */
type Scene = { a: number, d: number, panX: number, panY: number, left: number, top: number }

const readScene = async (page: Page, testId: string): Promise<Scene> => {
  const canvas = page.getByTestId(testId)
  const box = await canvas.boundingBox()
  const matrix = /matrix\(([^,]+),0,0,([^,]+),([^,]+),([^)]+)\)/
    .exec(await canvas.locator('g[transform^="matrix"]').first().getAttribute('transform') ?? '')
  if (box === null || matrix === null) throw new Error(`${testId} has no scene to click in`)
  return {
    a: Number(matrix[1]),
    d: Number(matrix[2]),
    panX: Number(matrix[3]),
    panY: Number(matrix[4]),
    left: box.x,
    top: box.y,
  }
}

/**
 * The Elevation pane's transform: drawing millimetres to CSS pixels.
 *
 * The pane draws x across the view line and y as height above the Floor Datum, so a point in that
 * space is the station and the height a person would read off the ruler — which is what lets the
 * gestures below be written in millimetres. The matrix is read rather than assumed because it is
 * the pane's, not the spec's: it says which way the drawing's y runs.
 */
const elevationScene = (page: Page): Promise<Scene> => readScene(page, 'elevation-canvas')

async function openElevationPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, elevationSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
  await page.getByTestId('elevation-view-picker').selectOption(kitchen.id)
  await expect(page.getByTestId('elevation-pane')).toBeVisible()
}

/**
 * The Kitchen elevation's line runs (0,1400) → (4000,1400) looking left, so the Floor point at
 * `(x, y)` is drawn at `4000 − x` across. Every entity this spec clicks stands at y = 600 or y = 0,
 * inside the 2 000 the view looks.
 *
 * Nothing below assumes which way the pane turns its y axis: a target is the element the pane drew
 * for that entity, and a distance is read off the pane's own scale and pointed at the Datum.
 */
const rowOf = (page: Page, ref: string): Locator =>
  page.locator(`[data-testid="elevation-canvas"] [data-ref="${ref}"]`)

/** One click on the middle of an entity's own face in the pane. */
async function clickRow(page: Page, ref: string): Promise<void> {
  const box = await rowOf(page, ref).first().boundingBox()
  if (box === null) throw new Error(`the pane drew no face for ${ref}`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * One click on an entity's own face in the Plan View.
 *
 * The click is aimed at the face the Plan View drew, not at a Floor point: the plan's viewport is
 * whatever the person left it at, and a point of the Floor can well lie outside the pane that shows
 * it. So the face's centre is pulled back inside the Plan pane before it is clicked — the face is
 * bigger than the pane here, and the point that reaches it is the one the person would have to use.
 */
async function clickPlanRow(page: Page, ref: string): Promise<void> {
  const face = await page.locator(`[data-testid="floor-plan-canvas"] [data-ref="${ref}"]`).first().boundingBox()
  const pane = await page.getByTestId('split-pane-plan').boundingBox()
  if (face === null) throw new Error(`the Plan View drew no face for ${ref}`)
  if (pane === null) throw new Error('the Plan pane was not laid out')
  const x = Math.min(Math.max(face.x + face.width / 2, pane.x + 4), pane.x + pane.width - 4)
  const y = Math.min(Math.max(face.y + face.height / 2, pane.y + 4), pane.y + pane.height - 4)
  await page.mouse.click(x, y)
}

/** The centre of a handle, in CSS pixels: where a pointer has to land to drag it. */
async function handlePoint(page: Page, handle: 'top' | 'bottom' | 'body'): Promise<Pt> {
  const box = await page.getByTestId(`elevation-handle-${handle}`).boundingBox()
  if (box === null) throw new Error(`the ${handle} handle was not drawn`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * The Datum's own line on the screen, and how many CSS pixels one millimetre is in the pane: the
 * two things needed to say "move this handle 110 mm towards the Floor Datum" without knowing how
 * the pane happens to be turned.
 */
async function datum(page: Page): Promise<{ y: number, pxPerMm: number }> {
  const scene = await elevationScene(page)
  // The Datum's own words, which the pane draws beside its line: near enough to say which way the
  // line is from here, which is all a gesture needs.
  const box = await page.locator('[data-testid="elevation-canvas"] text', { hasText: 'Floor Datum' })
    .first().boundingBox()
  if (box === null) throw new Error('the pane drew no Floor Datum')
  return { y: box.y + box.height / 2, pxPerMm: Math.abs(scene.a) }
}

/** `+1` when `to` lies below `from` on the screen, `-1` when above: the pane's own sense of up. */
const towards = (to: number, from: number): number => (to > from ? 1 : -1)

/**
 * The share of a rectangle the page paints with the drawing's own near-white ink.
 *
 * A Wall's face is filled with the same token the Plan View draws its Walls with, so a face that shows
 * none of it is a face with something painted over it. Nothing in the DOM says so — the element is
 * there, sized where the pane put it, with the fill it asked for — which is why this reads pixels.
 */
async function inkShare(page: Page, box: { x: number, y: number, width: number, height: number }): Promise<number> {
  const shot = await page.screenshot()
  return page.evaluate(async ({ data, x, y, w, h }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(x, y, w, h).data
    let ink = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 200 && px[i + 1] > 200 && px[i + 2] > 200) ink++
    }
    return ink / (w * h)
  }, {
    data: shot.toString('base64'),
    x: Math.round(box.x) + 2,
    y: Math.round(box.y) + 2,
    w: Math.round(box.width) - 4,
    h: Math.round(box.height) - 4,
  })
}

test.describe('Elevation Views in the split workspace', () => {
  test('the card opens an Elevation View beside the Plan View (#75 criterion 8)', async ({ page }) => {
    await openElevationPlan(page)

    // Two panes, each with its own title: the Plan View is still there and still the one the person
    // was in.
    await expect(page.getByTestId(`split-pane-${kitchen.id}`)).toBeVisible()
    await expect(page.getByTestId('split-title-plan')).toBeVisible()
    await expect(page.getByTestId('split-title-elevation')).toContainText('Kitchen elevation')
    // The pane draws the Floor standing on its Datum, and the run of cabinets the view was stood in
    // front of is in it.
    await expect(
      page.locator('[data-testid="elevation-canvas"] text', { hasText: 'Floor Datum' }).first(),
    ).toBeVisible()
    // And it stands on that Datum rather than hanging from it: the words that name the Floor's upper
    // limit are higher up the screen than the words that name the Datum. Drawn the other way round the
    // room reads as a hole in the floor, which is the mistake a reader cannot catch.
    const datumY = (await page.locator('[data-testid="elevation-canvas"] text', { hasText: 'Floor Datum' })
      .first().boundingBox())!.y
    const limitY = (await page.locator('[data-testid="elevation-canvas"] text', { hasText: 'Upper limit' })
      .first().boundingBox())!.y
    expect(limitY).toBeLessThan(datumY)

    // And the pane shows the drawing rather than a card over it (#75 criterion 27). The canvas host
    // fills every svg it holds, which is right for a canvas and wrong for the direction badge: filled
    // across the pane, the badge paints its own card colour over the room and every element underneath
    // stays correct, so only the pixels say so.
    const glyph = (await page.getByTestId('elevation-direction').boundingBox())!
    expect(glyph.width).toBeLessThan(60)
    expect(glyph.height).toBeLessThan(60)
    const face = (await rowOf(page, WALL).first().boundingBox())!
    expect(await inkShare(page, face)).toBeGreaterThan(0.5)
    // Nothing the pane drew is cropped by the pane. The ruler's words stand off the drawing's left
    // edge, so they are the first thing a fit that centres the drawing's size rather than its box
    // slides out of sight — and a cropped number is a drawing that lies about a height.
    const paneBox = (await page.getByTestId('elevation-pane').boundingBox())!
    const words = await page.locator('[data-testid="elevation-canvas"] text').all()
    expect(words.length).toBeGreaterThan(0)
    for (const word of words) {
      const box = (await word.boundingBox())!
      const text = await word.textContent() ?? ''
      expect(box.x, text).toBeGreaterThanOrEqual(paneBox.x)
      expect(box.x + box.width, text).toBeLessThanOrEqual(paneBox.x + paneBox.width)
    }
  })

  test('every height’s words stand on a card that covers them (#75 criterion 14)', async ({ page }) => {
    await openElevationPlan(page)
    // The words that name a height are the drawing's own ink and a Wall's face is filled with that
    // same ink, so laid straight onto the picture they are the colour of the thing behind them. The
    // card underneath is what makes them read — and it only makes them read if it covers the glyphs
    // the browser actually painted, which is the width the drawing measured for them. A word measured
    // as some other string than the one drawn is a card the word walks off the end of, and only the
    // rendered boxes say so.
    const cards = page.locator('[data-testid="elevation-canvas"] path[fill*="bg-card"]')
    expect(await cards.count()).toBe(2)
    for (const name of ['Floor Datum', 'Upper limit']) {
      const box = (await page.locator('[data-testid="elevation-canvas"] text', { hasText: name })
        .first().boundingBox())!
      expect(box.width, name).toBeGreaterThan(40)
      let covered = false
      for (const card of await cards.all()) {
        const c = (await card.boundingBox())!
        covered = covered || (c.x <= box.x && c.y <= box.y
          && c.x + c.width >= box.x + box.width && c.y + c.height >= box.y + box.height)
      }
      expect(covered, name).toBe(true)
    }
  })

  test('selecting in either pane selects in both (#75 criterion 11)', async ({ page }) => {
    await openElevationPlan(page)

    // Plan → elevation: the cabinet picked in the plan gets the handles in the pane, because the pane
    // is looking at the same single selection. A Placed Item moves as a whole, so it gets the one
    // body handle and no top or bottom.
    await clickPlanRow(page, CABINET)
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('0')
    await expect(page.getByTestId('elevation-handle-body')).toBeVisible()
    await expect(page.getByTestId('elevation-handle-bottom')).toHaveCount(0)

    // Elevation → plan: the same click the other way round, on a face only the elevation shows — the
    // Sump box is sunk below the Plan View Range, so the plan could not have been clicked for it.
    await clickRow(page, SUMP)
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('-150')
    await expect(page.getByTestId('elevation-handle-body')).toBeVisible()
  })

  test('a handle drag moves the entity vertically, and one Undo puts it back (#75 criteria 10, 11)', async ({ page }) => {
    await openElevationPlan(page)
    await clickRow(page, WINDOW)
    await expect(page.getByTestId('opening-extent-base')).toHaveValue('900')
    await expect(page.getByTestId('elevation-handle-bottom')).toBeVisible()

    const floor = await datum(page)
    const from = await handlePoint(page, 'bottom')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    // The sill 300 mm towards the Datum: far enough from it to be its own answer, and far enough from
    // every other height in the room that nothing takes the drag.
    await page.mouse.move(from.x, from.y + 300 * floor.pxPerMm * towards(floor.y, from.y), { steps: 8 })
    await expect(page.getByTestId('elevation-drag-chip')).toBeVisible()
    // The sill moved to the number the drag itself reported while the pointer was down, and so did the
    // height: the chip promises both, the head holds, and the record keeps what the chip said — so the
    // assertion reads the pane's own answer and cannot drift from it.
    const chip = (await page.getByTestId('elevation-drag-chip').textContent())!
    const promised = Number(/Base (-?\d+) mm/.exec(chip)![1])
    const promisedHeight = Number(/Height (-?\d+) mm/.exec(chip)![1])
    await page.mouse.up()
    await expect(page.getByTestId('opening-extent-base')).toHaveValue(String(promised))
    expect(promised).toBeLessThan(900)
    // Criterion 17: the bottom handle resizes with the head fixed, so the height is the head minus the
    // new sill — not the 1 200 the opening was.
    expect(promisedHeight).toBe(2100 - promised)
    await expect(page.getByTestId('opening-extent-height')).toHaveValue(String(promisedHeight))

    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('opening-extent-base')).toHaveValue('900')
  })

  test('a handle released near the Floor Datum lands on it; Escape writes nothing (#75 criteria 12, 14)', async ({ page }) => {
    await openElevationPlan(page)
    // The Sump box, sunk 150 below the Datum: the nearest height above it is the Datum itself.
    await clickRow(page, SUMP)
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('-150')

    const floor = await datum(page)
    const from = await handlePoint(page, 'body')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    // 110 mm towards the Datum, which leaves the box's underside 40 mm short of it — well inside
    // the 12 CSS px the snap is stated in, and nowhere near the number the pointer was moved by.
    await page.mouse.move(from.x, from.y + 110 * floor.pxPerMm * towards(floor.y, from.y), { steps: 6 })
    // The guide is a horizontal rule, so it has no box to be "visible" by; its own words say what it
    // stands for, and they name the Datum the pointer was pulled to.
    await expect(page.getByTestId('elevation-snap-guide')).toHaveCount(1)
    await expect(page.getByTestId('elevation-snap-label')).toContainText('Floor Datum')
    await page.mouse.up()

    // Not −40, not −38: the Datum, exactly.
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('0')

    // The same gesture, cancelled: the number stays where it was and the ghost is gone.
    const again = await handlePoint(page, 'body')
    await page.mouse.move(again.x, again.y)
    await page.mouse.down()
    await page.mouse.move(again.x, again.y - 200, { steps: 6 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.getByTestId('placed-extent-base')).toHaveValue('0')
    await expect(page.getByTestId('elevation-drag-chip')).toHaveCount(0)
  })

  test('below 960 CSS px the two panes stand one above the other (#75 criterion 16)', async ({ page }) => {
    await openElevationPlan(page)
    await expect(page.getByTestId('split-host')).toHaveAttribute('data-stacked', 'false')

    await page.setViewportSize({ width: 900, height: 900 })
    await expect(page.getByTestId('split-host')).toHaveAttribute('data-stacked', 'true')
    // Stacked means one over the other, not one over the other in name only.
    const plan = await page.getByTestId('split-pane-plan').boundingBox()
    const elevation = await page.getByTestId(`split-pane-${kitchen.id}`).boundingBox()
    expect(plan).not.toBeNull()
    expect(elevation).not.toBeNull()
    expect(elevation!.y).toBeGreaterThanOrEqual(plan!.y + plan!.height - 2)
  })

  test('the Export dialog offers the Elevation View as a drawing (#75 criterion 22)', async ({ page }) => {
    await openElevationPlan(page)
    await page.getByTestId('export-open').click()
    await expect(page.getByTestId('export-tab-drawing')).toBeVisible()

    const box = page.getByTestId(`export-view-elevation:${kitchen.id}`)
    await expect(box).toBeVisible()
    // The Plan View it opened on is in the recipe already; take it out so the file is one drawing.
    await page.getByTestId('export-views').locator('input:checked').first().uncheck()
    await box.check()

    const pending = page.waitForEvent('download')
    await page.getByTestId('export-run').click()
    const file = await readDownload(await pending)
    // The sheet says which view it was looked from, which is the one thing a Plan View's sheet could
    // not have said.
    expect(file.buffer.toString('utf8')).toContain('Kitchen elevation')
  })
})
