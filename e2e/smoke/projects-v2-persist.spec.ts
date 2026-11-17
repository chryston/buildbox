import { expect, test } from '../support/fixtures'
import type { Page } from '@playwright/test'
import {
  addFloorPlanObject,
  cabinetCanvas,
  floorPlanObjectIds,
  openPreviewApp,
  placedObject,
  saveStatus,
  showFloorPlan,
} from '../support/previewApp'

// Criterion 5 (#49): the flagged build's edits are real saves. One edit in each view, then a
// reload — the floor-plan edit in particular is the one today's app cannot make durable per
// Project, which is finding 4 of #11.
const voidIds = (page: Page) =>
  page
    .getByTestId(/^void-/)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')!.slice('void-'.length)))

test('a cabinet edit and a floor-plan edit survive a reload', async ({ page }) => {
  await openPreviewApp(page)

  const voidsBefore = await voidIds(page)
  // The space-label rect covers the middle half of every void, so a real click has to land
  // in the outer quarter (e2e/smoke/app.spec.ts explains the same quirk).
  await page.getByTestId(/^void-/).first().click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: 'Add Shelf' }).click()
  const voidsAfter = await voidIds(page)
  expect(voidsAfter.length).toBeGreaterThan(voidsBefore.length)

  await showFloorPlan(page)
  const objectsBefore = await floorPlanObjectIds(page)
  const sofaId = await addFloorPlanObject(page, 'Sofa 2-seater')

  await expect(saveStatus(page)).toContainText('Saved locally')

  await page.reload({ waitUntil: 'networkidle' })
  await expect(cabinetCanvas(page)).toBeVisible()
  await expect.poll(() => voidIds(page)).toEqual(voidsAfter)

  await showFloorPlan(page)
  await expect(placedObject(page, sofaId)).toBeVisible()
  await expect(floorPlanObjectIds(page)).resolves.toHaveLength(objectsBefore.length + 1)
  await expect(saveStatus(page)).toContainText('Saved locally')
})
