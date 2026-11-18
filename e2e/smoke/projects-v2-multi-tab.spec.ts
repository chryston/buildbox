import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import {
  addFloorPlanObject,
  FIRST_PROJECT,
  floorPlanObjectIds,
  openPreviewApp,
  openProjectFromLibrary,
  placedObject,
  showFloorPlan,
} from '../support/previewApp'
import { previewSeed, toast } from '../support/libraryApp'
import { projectRevision } from '../support/seedPreviewDb'

/**
 * Two tabs, one Project (#51 criterion 11; #20 §5, §13.10).
 *
 * The second page shares the first one's browser context, which is what makes it a second tab:
 * same IndexedDB, same Web Locks, same `buildbox:library` BroadcastChannel. The first page holds
 * the Project's lock from the moment it opens it, so the second one is read-only until the first
 * lets go.
 */

const PROJECT_ID = previewSeed.projects[0].id

const voidCount = (page: Page): Promise<number> => page.getByTestId(/^void-/).count()

test('a second tab reads the Project, refuses edits, follows the first, and takes over when it closes', async ({
  page,
  context,
}) => {
  await openPreviewApp(page)

  const second = await context.newPage()
  const problems: string[] = []
  second.on('pageerror', (error) => problems.push(error.message))
  await second.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(second, FIRST_PROJECT)

  // The strip, with its words: this tab is showing the latest saved state and nothing more.
  const strip = second.locator('.read-only-strip')
  await expect(strip).toHaveText(
    'This Project is open for editing in another tab. This tab is read-only and shows the latest saved state.',
  )
  await expect(page.locator('.read-only-strip')).toHaveCount(0)

  // Refused: the click lands on a real shelf button, the session says no, and the count stays.
  const shelves = await voidCount(second)
  await second.getByTestId('void-unit-kitchen-base-hanging').click({ position: { x: 10, y: 10 } })
  await second.getByRole('button', { name: 'Add Shelf' }).dispatchEvent('click')
  await second.waitForTimeout(300)
  expect(await voidCount(second)).toBe(shelves)
  expect(await projectRevision(second, PROJECT_ID)).toBe(previewSeed.library.find((row) => row.id === PROJECT_ID)!.revision)

  // The first tab's next edit shows up in the second within two seconds, without a reload.
  await showFloorPlan(second)
  await showFloorPlan(page)
  const sofa = await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect(placedObject(second, sofa)).toBeVisible({ timeout: 2_000 })

  // Closing the first tab frees the lock: the second becomes editable, says so, and edits.
  await page.close()
  await expect(strip).toHaveCount(0)
  await expect(toast(second)).toContainText(`This tab can now edit ${FIRST_PROJECT}.`)
  const before = await floorPlanObjectIds(second)
  const added = await addFloorPlanObject(second, 'Armchair')
  expect(await floorPlanObjectIds(second)).toHaveLength(before.length + 1)
  await expect(placedObject(second, added)).toBeVisible()
  await expect(placedObject(second, sofa)).toBeVisible()
  expect(problems).toEqual([])
})
