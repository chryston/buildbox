import { expect, test } from '../support/fixtures'
import {
  addFloorPlanObject,
  dragBy,
  floorPlanObjectIds,
  openPreviewApp,
  openProjectTab,
  placedObject,
  previewSeed,
  redoButton,
  showFloorPlan,
  undoButton,
} from '../support/previewApp'

// Criteria 2 and 3 (#49): floor-plan edits are inside the shared undo/redo history — finding
// 7 of #11 — and each Project carries its own floor plan and its own history — finding 4.

/** The two Projects the seed holds, by name, newest `savedAt` first. */
const [firstProject, secondProject] = previewSeed.library.map((record) => record.name)

test('a floor-plan add and move undo and redo from the floor-plan view', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)

  await expect(undoButton(page)).toBeDisabled()
  const sofaId = await addFloorPlanObject(page, 'Sofa 2-seater')
  // The toolbar's Undo is live in floor-plan mode, not only in the cabinet editor.
  await expect(undoButton(page)).toBeEnabled()

  const sofa = placedObject(page, sofaId)
  const spawn = await sofa.boundingBox()
  if (spawn === null) throw new Error('the placed sofa has no box')

  await dragBy(page, sofa, 120, 60)
  const moved = await sofa.boundingBox()
  expect(moved).not.toBeNull()
  expect(moved!.x).toBeGreaterThan(spawn.x + 40)

  // One undo returns it to where it spawned: the drag was one transaction, not eight.
  await page.keyboard.press('Control+z')
  const back = await sofa.boundingBox()
  expect(back!.x).toBeCloseTo(spawn.x, 0)
  expect(back!.y).toBeCloseTo(spawn.y, 0)

  // The next undo is the add itself.
  await page.keyboard.press('Control+z')
  await expect(sofa).toHaveCount(0)
  await expect(undoButton(page)).toBeDisabled()
  await expect(redoButton(page)).toBeEnabled()

  await page.keyboard.press('Control+y')
  await expect(sofa).toBeVisible()
  const redone = await sofa.boundingBox()
  expect(redone!.x).toBeCloseTo(spawn.x, 0)
})

test('each Project has its own floor plan, and a switch starts an empty history', async ({ page }) => {
  await openPreviewApp(page)

  // Two Projects with nothing in them, so "only the bed" means exactly that.
  await page.getByRole('button', { name: 'New project' }).click()
  await showFloorPlan(page)
  await expect.poll(() => floorPlanObjectIds(page)).toHaveLength(0)
  const bedId = await addFloorPlanObject(page, 'Single Bed')
  await expect(undoButton(page)).toBeEnabled()

  await page.getByRole('button', { name: 'New project' }).click()
  await expect.poll(() => floorPlanObjectIds(page)).toHaveLength(0)
  const fridgeId = await addFloorPlanObject(page, 'Fridge')

  const tabs = page.getByRole('button', { name: /^Cabinet \d+$/ })
  const names = await tabs.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''))
  // The Library lists Projects newest-saved first, so the two just created are the first two
  // tabs — and in the opposite order to the one they were made in.
  expect(names).toHaveLength(2)
  const [projectB, projectA] = names

  await openProjectTab(page, projectA)
  await expect.poll(() => floorPlanObjectIds(page)).toEqual([bedId])
  // A new Project session has no history to walk back into (#26).
  await expect(undoButton(page)).toBeDisabled()
  await expect(redoButton(page)).toBeDisabled()

  await openProjectTab(page, projectB)
  await expect.poll(() => floorPlanObjectIds(page)).toEqual([fridgeId])
  await expect(undoButton(page)).toBeDisabled()

  await openProjectTab(page, projectA)
  await expect.poll(() => floorPlanObjectIds(page)).toEqual([bedId])
})

test('the seeded Projects keep their own floor plans', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const kitchenObjects = await floorPlanObjectIds(page)
  expect(kitchenObjects.length).toBeGreaterThan(0)

  await openProjectTab(page, secondProject)
  await expect.poll(() => floorPlanObjectIds(page)).toHaveLength(0)

  await openProjectTab(page, firstProject)
  await expect.poll(() => floorPlanObjectIds(page)).toEqual(kitchenObjects)
})
