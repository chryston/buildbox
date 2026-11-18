import { expect, test } from '../support/fixtures'
import { addFloor, floorOptions, floorPlanCanvas, openManageFloors, openPreviewApp, showFloorPlan, uploadPlanImage } from '../support/previewApp'
import { waitForFonts, waitForImageDecode, waitForStablePaint } from '../support/stability'

/**
 * The two surfaces Floors add (#56): the Manage Floors dialog, where a Floor is named, ordered,
 * bounded, duplicated and deleted; and the workspace looking at a Floor whose Plan Image has no
 * scale yet, where the reason a measured shape cannot be drawn has to be on screen.
 *
 * Whole page, not the canvas: the canvas is the scene, and `plan-view.spec.ts` owns that. What is
 * new here is chrome — rows, limits, a warning strip — and the header prints a save time, so the
 * clock is frozen the way the Library and Recovery specs freeze theirs.
 */

const FIXED_NOW = '2026-01-01T09:00:00+08:00'

test('Manage Floors: two Floors, their names, order and limits', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openManageFloors(page)
  await page.getByTestId('add-floor').click()
  const second = (await floorOptions(page)).slice(-1)[0]!
  await page.getByTestId(`floor-name-${second.value}`).fill('Mezzanine')
  await page.getByTestId(`floor-name-${second.value}`).press('Enter')
  // The row's settings open, so the shot shows everything a row can show: limits, in the
  // Project's own unit, about to be saved.
  await page.getByTestId(`floor-settings-${second.value}`).click()
  await page.getByTestId(`floor-lower-${second.value}`).fill('900')
  await page.getByTestId(`floor-upper-${second.value}`).fill('2400')
  await expect(page.getByTestId(`floor-limits-${second.value}`)).toBeVisible()
  await page.mouse.move(0, 999)
  await waitForFonts(page)
  await waitForStablePaint(page.getByTestId('manage-floors-dialog'))
  await expect(page).toHaveScreenshot('manage-floors.png')
})

test('a Floor whose Plan Image is not calibrated says why', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await openPreviewApp(page)
  await showFloorPlan(page)
  await addFloor(page)
  await uploadPlanImage(page)
  await expect(page.getByTestId('uncalibrated-hint')).toBeVisible()
  await expect(page.getByTestId('plan-image-scale')).toHaveText('Plan Image not calibrated')

  const canvas = floorPlanCanvas(page)
  const image = canvas.locator('image')
  await expect(image).toHaveCount(1)
  await waitForImageDecode(image)
  await waitForFonts(page)
  await page.mouse.move(0, 999)
  await waitForStablePaint(canvas.locator('g').first())
  await expect(page).toHaveScreenshot('floor-uncalibrated.png')
})
