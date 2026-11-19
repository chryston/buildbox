import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { canonical, libraryHeading, previewSeed, storedProject } from '../support/libraryApp'
import { readLegacyStore, seedLegacyStore } from '../support/legacyStore'
import { FIRST_PROJECT, openItemDetail, openPreviewApp, openProjectFromLibrary } from '../support/previewApp'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/legacy')
const readFixture = (name: string) =>
  readFileSync(join(fixturesRoot, name, 'buildbox-store.json'), 'utf8')

const voids = (page: Page) => page.getByTestId(/^void-/)
/** The node ids behind the rendered voids, read off their test ids. */
const voidIds = (page: Page) =>
  voids(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')!.slice('void-'.length)))

// The boot story since #53: the app opens on the Project Library, an editor is one card away,
// and the only way old persisted data reaches the screen is the Migration review.

test('load renders the Project Library', async ({ page }) => {
  await page.goto('./')
  await expect(libraryHeading(page)).toBeVisible()
  await expect(page).toHaveTitle('BuildBox')
})

test('a cabinet edit survives a reload', async ({ page }) => {
  await openPreviewApp(page)
  // The cabinet editor is one Placed Item deep now (#57): the migrated `Base Unit`.
  await openItemDetail(page, 'seed-002')
  const projectId = previewSeed.projects[0]!.id
  const before = await voidIds(page)
  const storedBefore = canonical(await storedProject(page, projectId))

  // The space-label click-to-edit rect (DimensionLabels.tsx) covers the middle half of
  // every void and swallows clicks aimed at its centre, so a real click has to land in
  // the outer quarter — which is where a user's click actually reaches the void.
  await page.getByTestId('void-unit-kitchen-base-hanging').click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: 'Add Shelf' }).click()

  // Poll the stored Project rather than sleeping: the session writes behind React (#14).
  await expect.poll(async () => canonical(await storedProject(page, projectId))).not.toBe(storedBefore)
  const after = await voidIds(page)
  expect(after).not.toEqual(before)

  await page.reload({ waitUntil: 'networkidle' })
  // Opened again, not reseeded: the point is that the shelf is in the database the app wrote.
  await openProjectFromLibrary(page, FIRST_PROJECT)
  await openItemDetail(page, 'seed-002')
  await expect.poll(() => voidIds(page)).toEqual(after)
})

// Seeded fixtures never touch a real user's storage, and the live smoke runs against a
// fresh browser context, so they are excluded there.
// @local-only is the grep-invert tag static.yml's smoke-live job uses.
const legacyFixtures = [
  { name: 'v0', projects: ['Kitchen Base', 'Kitchen Tall', 'Bathroom Vanity'] },
  { name: 'v1', projects: ['Kitchen Wall', 'Bathroom Vanity'] },
  { name: 'v2', projects: ['Kitchen Wall', 'Bathroom Vanity'] },
  { name: 'v3', projects: ['Kitchen Wall', 'Bathroom Vanity'] },
  { name: 'v3-large-image', projects: ['Kitchen Wall', 'Bathroom Vanity'] },
]

for (const fixture of legacyFixtures) {
  test(`legacy fixture ${fixture.name} offers its work to the Migration review @local-only`, async ({ page }) => {
    const raw = readFixture(fixture.name)
    await seedLegacyStore(page, raw)
    await page.goto('./', { waitUntil: 'networkidle' })

    // The app no longer boots from this key: it reads it once and asks (#52). Every Design the
    // fixture holds is listed, and the source is left exactly as it was found.
    await expect(page.getByRole('heading', { level: 1, name: 'Review where your existing work belongs' })).toBeVisible()
    for (const name of fixture.projects) {
      await expect(page.locator('.migration-item').filter({ hasText: name })).toBeVisible()
    }
    expect(await readLegacyStore(page)).toBe(raw)
  })
}
