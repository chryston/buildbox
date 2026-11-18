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
import { canonical, dialogHeading, previewSeed, storedLibrary, storedProject } from '../support/libraryApp'
import { projectRevision } from '../support/seedPreviewDb'

/**
 * Two tabs and no Web Locks (#51 criterion 12; #20 §5).
 *
 * Without locks nothing stops two tabs editing the same Project, so the revision check is the
 * only safeguard left, and it is the commit that finds out. The init script hides the API from
 * both pages the way an old browser does: not a rejecting `request`, but no `navigator.locks`.
 */

const PROJECT_ID = previewSeed.projects[0].id

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'locks', { value: undefined, configurable: true })
  })
})

test('the second commit says the Project changed, keeps the first, and can import itself as a copy', async ({
  page,
  context,
}) => {
  await openPreviewApp(page)
  expect(await page.evaluate(() => navigator.locks)).toBeUndefined()
  await showFloorPlan(page)

  const second = await context.newPage()
  await second.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(second, FIRST_PROJECT)
  await expect(second.locator('.read-only-strip')).toHaveCount(0)
  await showFloorPlan(second)

  // Both tabs edit; the first one's commit lands first.
  const revision = await projectRevision(page, PROJECT_ID)
  const firstSofa = await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect.poll(() => projectRevision(page, PROJECT_ID)).toBe(revision + 1)
  const winner = await storedProject(page, PROJECT_ID)

  await addFloorPlanObject(second, 'Armchair')

  // The second tab's commit finds a newer revision: the dialog, and the store untouched.
  await expect(dialogHeading(second)).toHaveText('This Project changed in another tab')
  await expect(second.getByRole('dialog')).toContainText(
    `Another tab saved a newer version of ${FIRST_PROJECT}. Your latest changes in this tab are not stored.`,
  )
  expect(canonical(await storedProject(second, PROJECT_ID))).toBe(canonical(winner))
  expect(await projectRevision(second, PROJECT_ID)).toBe(revision + 1)

  // Importing as a copy stores this tab's Project under a new name and a new id, and opens it.
  await second.getByRole('button', { name: 'Import my changes as a copy', exact: true }).click()
  await expect(second.getByRole('dialog')).toHaveCount(0)
  await expect
    .poll(async () => (await storedLibrary(second)).map((row) => row.name))
    .toContain(`${FIRST_PROJECT} — Copy`)
  const rows = await storedLibrary(second)
  const copy = rows.find((row) => row.name === `${FIRST_PROJECT} — Copy`)!
  expect(copy.id).not.toBe(PROJECT_ID)
  // The copy has the second tab's content, which the first tab's does not have, and the
  // original still holds the first tab's and not the second's.
  const designs = (project: unknown): string => JSON.stringify(project)
  const copied = designs(await storedProject(second, copy.id))
  const original = designs(await storedProject(second, PROJECT_ID))
  const count = (text: string, word: RegExp): number => text.match(word)?.length ?? 0
  // The seeded Project already holds some of each, so the proof is the difference: the copy has
  // the Armchair the original lacks, and the original has the Sofa the copy lacks.
  expect(count(copied, /armchair/gi)).toBeGreaterThan(count(original, /armchair/gi))
  expect(count(original, /sofa/gi)).toBeGreaterThan(count(copied, /sofa/gi))
  expect(canonical(await storedProject(second, PROJECT_ID))).toBe(canonical(winner))
  await expect(second.getByRole('dialog')).toHaveCount(0)
  expect(await floorPlanObjectIds(page)).toContain(firstSofa)
})

test('Reload the latest version drops this tab\'s changes for the other tab\'s', async ({ page, context }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const second = await context.newPage()
  await second.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(second, FIRST_PROJECT)
  await showFloorPlan(second)

  const revision = await projectRevision(page, PROJECT_ID)
  const firstSofa = await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect.poll(() => projectRevision(page, PROJECT_ID)).toBe(revision + 1)
  const secondArmchair = await addFloorPlanObject(second, 'Armchair')
  await expect(dialogHeading(second)).toHaveText('This Project changed in another tab')

  await second.getByRole('button', { name: 'Reload the latest version', exact: true }).click()

  await expect(second.getByRole('dialog')).toHaveCount(0)
  await expect(second.locator('span[role="status"]')).toContainText('Saved locally')
  await expect(placedObject(second, firstSofa)).toBeVisible()
  await expect(placedObject(second, secondArmchair)).toHaveCount(0)
})
