import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { addFloorPlanObject, openPreviewApp, showFloorPlan } from '../support/previewApp'
import { previewSeed } from '../support/libraryApp'
import { projectRevision } from '../support/seedPreviewDb'

/**
 * The persistent-storage request (#51 criterion 15; #20 §14).
 *
 * Asked after meaningful work and not before: opening a Project, or looking at the Library, is
 * not work. `persisted()` is forced to `false` and `persist()` to a counted `true`, because the
 * real answers are the browser's to give and a spec cannot make a headless profile say no.
 */

const PROJECT_ID = previewSeed.projects[0].id

interface Spied {
  persistCalls?: number
}

const persistCalls = (page: Page): Promise<number> =>
  page.evaluate(() => (window as Spied).persistCalls ?? 0)

test('persist() is called once, after the first Edit Transaction, and never before', async ({ page }) => {
  await page.addInitScript(() => {
    const spied = window as Spied
    spied.persistCalls = 0
    Object.defineProperty(StorageManager.prototype, 'persisted', { value: () => Promise.resolve(false), configurable: true })
    Object.defineProperty(StorageManager.prototype, 'persist', {
      value: () => {
        spied.persistCalls = (spied.persistCalls ?? 0) + 1
        return Promise.resolve(true)
      },
      configurable: true,
    })
  })

  await openPreviewApp(page)
  await showFloorPlan(page)
  // Opened, shown, switched views: no edit yet, so no request. A beat is given for a request that
  // would be made asynchronously to show up.
  await page.waitForTimeout(500)
  expect(await persistCalls(page)).toBe(0)

  const revision = await projectRevision(page, PROJECT_ID)
  await addFloorPlanObject(page, 'Sofa 2-seater')
  await expect.poll(() => projectRevision(page, PROJECT_ID)).toBe(revision + 1)
  await expect.poll(() => persistCalls(page)).toBe(1)

  // A second Edit Transaction does not ask again.
  await addFloorPlanObject(page, 'Armchair')
  await expect.poll(() => projectRevision(page, PROJECT_ID)).toBe(revision + 2)
  await page.waitForTimeout(500)
  expect(await persistCalls(page)).toBe(1)
})
