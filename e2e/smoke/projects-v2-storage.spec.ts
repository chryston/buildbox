import { expect, test } from '../support/fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addFloorPlanObject, FIRST_PROJECT, openProjectFromLibrary, showFloorPlan } from '../support/previewApp'
import { libraryHeading, previewSeed } from '../support/libraryApp'
import { databaseNames, projectRevision, seedPreviewDb } from '../support/seedPreviewDb'

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
  await seedPreviewDb(page, previewSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  // #52 criterion 1: a browser that still holds legacy data opens on the Migration review rather
  // than on the Library, so this spec passes through that flow too. It is a second subject here and
  // not an obstacle — the review is the thing that runs on a real browser that has used today's
  // app, and `Do this later` is the one exit that promises to write nothing. The snapshot is taken
  // after it for that reason: the review's own read of the key is then inside the assertion.
  await expect(page.getByRole('heading', { level: 1, name: 'Review where your existing work belongs' })).toBeVisible()
  await page.getByRole('button', { name: 'Do this later' }).click()
  await expect(libraryHeading(page)).toBeVisible()
  const before = await localStorageSnapshot(page)

  await openProjectFromLibrary(page, FIRST_PROJECT)

  await page.getByTestId('void-unit-kitchen-base-hanging').click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: 'Add Shelf' }).click()
  await showFloorPlan(page)
  await addFloorPlanObject(page, 'Fridge')

  // Both edits have to be on disk before "nothing else changed" says anything.
  await expect.poll(() => projectRevision(page, previewSeed.projects[0].id)).toBeGreaterThanOrEqual(3)

  expect(await localStorageSnapshot(page)).toBe(before)
  await expect.poll(() => databaseNames(page)).toEqual(['buildbox-preview'])
})
