import { expect, test } from '@playwright/test'
import {
  addFloorPlanObject,
  dragBy,
  FIRST_PROJECT,
  floorPlanCanvas,
  openPreviewApp,
  openProjectFromLibrary,
  placedObject,
  redoButton,
  saveStatus,
  showFloorPlan,
  undoButton,
} from '../support/previewApp'
import { expectStableCanvas } from '../support/expectStableCanvas'
import { persistedPlacedItemTranslation } from '../support/seedPreviewDb'
import { previewSeed } from '../support/libraryApp'

// The Floor workspace smoke (#55): the toolbar contract, the drag/undo/reload loop, and
// the device-local viewport. The screenshot pair lives in e2e/screenshots/plan-view.spec.ts.

test('the toolbar is one row of 44 px from 1024 to 1920 px wide', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const toolbar = page.getByTestId('workspace-toolbar')
  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(toolbar, `toolbar at ${width} px`).toHaveCSS('height', '44px')
    // One row: every inline control sits inside the row's own box, and nothing wraps
    // below it — the row's height is the single-row token, whatever overflowed.
    const box = await toolbar.boundingBox()
    expect(box?.height).toBe(44)
    const controls = page.getByTestId('workspace-toolbar').locator('button')
    const count = await controls.count()
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index)
      if (!(await control.isVisible())) continue
      const controlBox = await control.boundingBox()
      if (controlBox === null) continue
      expect(
        controlBox.y >= box!.y - 0.5 && controlBox.y + controlBox.height <= box!.y + box!.height + 0.5,
        `a toolbar control wrapped out of the row at ${width} px`,
      ).toBe(true)
    }
  }
})

test('no toolbar control is clipped at 1024 px: everything is inline or in More', async ({ page }) => {
  await openPreviewApp(page)
  await page.setViewportSize({ width: 1024, height: 1000 })
  await showFloorPlan(page)
  const more = page.getByTestId('toolbar-more')
  if (await more.isVisible()) {
    await more.click()
  }
  // Every control the wide toolbar shows inline is reachable at 1024, directly or via More.
  for (const testId of ['tool-select', 'tool-pan', 'add-item-menu', 'plan-image-menu', 'export-svg']) {
    await expect(page.getByTestId(testId), `${testId} unreachable at 1024 px`).toBeVisible()
  }
})

// #112: the App's floor-plan wrapper is a flex row, and the workspace must grow into it.
// A workspace that shrinks to its content width leaves white space to the app's right —
// invisible to the shell's own layout tests, which render the shell directly, so this
// geometry is asserted through the real App wrapper.
test('the workspace fills the viewport width from 1024 to 1440 px', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    const workspace = page.getByTestId('floor-workspace')
    const canvasHost = page.getByTestId('workspace-canvas-host')
    await expect(workspace).toBeVisible()
    const contentWidth = await page.evaluate(() => document.documentElement.clientWidth)
    const box = await workspace.boundingBox()
    const host = await canvasHost.boundingBox()
    // The workspace spans the App's content box: flush left and as wide as the viewport.
    expect(box?.x, `workspace left at ${width} px`).toBe(0)
    expect(box?.width, `workspace width at ${width} px`).toBeGreaterThanOrEqual(contentWidth - 1)
    // The canvas host keeps everything the 300 px static rail (300 px from 1024 up) leaves it.
    expect(host?.width, `canvas host at ${width} px`).toBeGreaterThanOrEqual(contentWidth - 300 - 2)
  }
})

test('toolbar interactions never move the toolbar or resize the canvas', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const pan = page.getByTestId('tool-pan')
  const select = page.getByTestId('tool-select')
  const addItem = page.getByTestId('add-item-menu')
  const planImage = page.getByTestId('plan-image-menu')

  await expectStableCanvas(page, async () => { await pan.click() })
  await expectStableCanvas(page, async () => { await select.click() })
  await expectStableCanvas(page, async () => {
    await addItem.click()
    await expect(page.getByRole('menuitem', { name: 'Sofa 2-seater' })).toBeVisible()
    await addItem.click()
  })
  await expectStableCanvas(page, async () => {
    await planImage.click()
    await expect(page.getByRole('menuitem', { name: /upload/i })).toBeVisible()
    await planImage.click()
  })
  // Starting and cancelling calibration: the overlay is an overlay.
  await expectStableCanvas(page, async () => {
    await planImage.click()
    await page.getByTestId('calibrate-scale').click()
    await expect(page.getByTestId('calibration-overlay')).toBeVisible()
    // The gesture is two clicks; the second opens the modal, whose Cancel ends it.
    const canvasBox = await floorPlanCanvas(page).boundingBox()
    await page.mouse.click(canvasBox!.x + 200, canvasBox!.y + 200)
    await page.mouse.click(canvasBox!.x + 300, canvasBox!.y + 200)
    await expect(page.getByTestId('calibration-modal')).toBeVisible()
    await page.getByTestId('calibration-cancel').click()
    await expect(page.getByTestId('calibration-overlay')).toHaveCount(0)
  })
})

test('drag-moving an item is one undo step and survives a reload', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const sofa = await addFloorPlanObject(page, 'Sofa 2-seater')
  const object = placedObject(page, sofa)
  await expect(saveStatus(page)).toContainText('Saved locally')

  // The selection ring adds half a pixel of stroke on each side of the box, so every
  // measurement is taken with nothing selected: the same state each time.
  const deselect = async (): Promise<void> => {
    const box = await floorPlanCanvas(page).boundingBox()
    await page.mouse.click(box!.x + 10, box!.y + 10)
  }
  const position = async (): Promise<{ x: number; y: number; width: number; height: number } | null> => {
    await deselect()
    return object.boundingBox()
  }

  const before = await position()

  // The write has to be on disk before a reload can prove anything: the status line
  // reads "Saved locally" for the revision before the drag too (#50's persist trap).
  const recordId = previewSeed.projects[0].id
  const stored = () => persistedPlacedItemTranslation(page, recordId, sofa)
  await expect.poll(stored).not.toBeNull()
  const atAdd = await stored()

  await dragBy(page, object, 60, 40)
  const moved = await position()
  expect(moved?.x).toBeCloseTo(before!.x + 60, 0)
  expect(moved?.y).toBeCloseTo(before!.y + 40, 0)
  await expect.poll(stored).not.toEqual(atAdd)
  const afterDrag = await stored()

  // One drag, one Edit Transaction: a single Undo puts it back and a Redo re-applies —
  // on screen and on disk, each write awaited before the next step.
  await undoButton(page).click()
  await expect.poll(position).toEqual(before)
  await expect.poll(stored).toEqual(atAdd)
  await redoButton(page).click()
  await expect.poll(position).toEqual(moved)
  await expect.poll(stored).toEqual(afterDrag)

  // And the moved position is on disk: a reload, back through the Library, shows it.
  await page.reload({ waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, FIRST_PROJECT)
  await showFloorPlan(page)
  await expect(placedObject(page, sofa)).toBeVisible()
  await expect.poll(position).toEqual(moved)
})

test('the viewport survives a reload through the device-local cache', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const scene = floorPlanCanvas(page).locator('g').first()
  const initial = await scene.getAttribute('transform')

  // Wheel-zoom at the canvas centre; the transform is the viewport, made visible.
  const box = await floorPlanCanvas(page).boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.wheel(0, -240)
  await expect(scene).not.toHaveAttribute('transform', initial ?? '')
  const zoomed = await scene.getAttribute('transform')
  await expect(saveStatus(page)).toContainText('Saved locally')

  await page.reload({ waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, FIRST_PROJECT)
  await showFloorPlan(page)
  await expect(scene).toHaveAttribute('transform', zoomed ?? '')
})

test('the display unit changes the inspector and is one undo step', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await addFloorPlanObject(page, 'Sofa 2-seater')
  // #58: the Item Footprint's Width is read in the inspector's own read-only Shape tab now — it
  // is edited in Item Detail — so this reads the field rather than typing into it.
  const width = page.getByTestId('shape-width')
  const mmValue = await width.inputValue()

  await page.getByTestId('project-settings').click()
  await expect(page.getByTestId('project-settings-dialog')).toBeVisible()
  await page.getByTestId('settings-unit').selectOption('cm')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('shape-width')).not.toHaveValue(mmValue)
  await expect(page.getByTestId('shape-width')).not.toHaveValue('')

  // One Intent, one transaction: Undo restores mm and the original value.
  await undoButton(page).click()
  await expect(page.getByTestId('shape-width')).toHaveValue(mmValue)
})
