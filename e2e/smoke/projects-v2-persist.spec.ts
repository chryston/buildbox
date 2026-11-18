import { expect, test } from '../support/fixtures'
import type { Page } from '@playwright/test'
import {
  addFloorPlanObject,
  FIRST_PROJECT,
  floorPlanObjectIds,
  openPreviewApp,
  placedObject,
    saveStatus,
  openProjectFromLibrary,
  showFloorPlan,
} from '../support/previewApp'
import { previewSeed } from '../support/libraryApp'
import { projectRevision } from '../support/seedPreviewDb'

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
  // Two things decide this target: the space-label click-to-edit rect covers the middle half
  // of every void, so a real click has to land in the outer quarter (e2e/smoke/app.spec.ts
  // explains the quirk); and the seeded Kitchen Wall's first void is a drawer space, which no
  // engine will split with a shelf. The hanging space is a plain one.
  await page.getByTestId('void-unit-kitchen-base-hanging').click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: 'Add Shelf' }).click()
  const voidsAfter = await voidIds(page)
  expect(voidsAfter.length).toBeGreaterThan(voidsBefore.length)

  await showFloorPlan(page)
  const objectsBefore = await floorPlanObjectIds(page)
  const sofaId = await addFloorPlanObject(page, 'Sofa 2-seater')

  // The write has to be on disk before a reload can prove anything: the status line reads
  // "Saved locally" for the seeded revision too, so it says nothing on its own.
  await expect.poll(() => projectRevision(page, previewSeed.projects[0].id)).toBeGreaterThanOrEqual(3)

  await page.reload({ waitUntil: 'networkidle' })
  // A reload lands on the Library (#50), which is the point: the edit survived because opening
  // the Project again shows it, not because the same page is still in memory.
  await openProjectFromLibrary(page, FIRST_PROJECT)
  await expect.poll(() => voidIds(page)).toEqual(voidsAfter)

  await showFloorPlan(page)
  await expect(placedObject(page, sofaId)).toBeVisible()
  await expect.poll(() => floorPlanObjectIds(page)).toHaveLength(objectsBefore.length + 1)
  await expect(saveStatus(page)).toContainText('Saved locally')
})
