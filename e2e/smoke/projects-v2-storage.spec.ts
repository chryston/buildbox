import { expect, test } from '../support/fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addFloorPlanObject, openPreviewApp, previewSeed, showFloorPlan } from '../support/previewApp'
import { databaseNames, projectRevision } from '../support/seedPreviewDb'

// Criterion 8 (#49): the flagged build writes only `buildbox-preview`. Today's app persists
// through `localStorage['buildbox-store']`, and a build that wrote both would put two
// histories behind one user's work — so this asserts the old key is untouched, byte for byte,
// after real edits in both views.
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const v3 = readFileSync(join(fixturesRoot, 'legacy', 'v3', 'buildbox-store.json'), 'utf8')

/** Every localStorage entry, as one string: any change anywhere shows up here. */
const localStorageSnapshot = (page: Page) =>
  page.evaluate(() => {
    const entries: Record<string, string> = {}
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key !== null) entries[key] = window.localStorage.getItem(key) ?? ''
    }
    return JSON.stringify(entries, Object.keys(entries).sort())
  })

test('editing writes no localStorage key and opens no other database', async ({ page }) => {
  // Seed the legacy key too: the point is that the flagged build leaves it alone even when
  // it is present, which is the state a real browser is in after using today's app.
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    ['buildbox-store', v3],
  )
  await openPreviewApp(page)
  const before = await localStorageSnapshot(page)

  await page.getByTestId('void-unit-kitchen-base-hanging').click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: 'Add Shelf' }).click()
  await showFloorPlan(page)
  await addFloorPlanObject(page, 'Fridge')

  // Both edits have to be on disk before "nothing else changed" says anything.
  await expect.poll(() => projectRevision(page, previewSeed.projects[0].id)).toBeGreaterThanOrEqual(3)

  expect(await localStorageSnapshot(page)).toBe(before)
  await expect.poll(() => databaseNames(page)).toEqual(['buildbox-preview'])
})
