import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { readLegacyStore, seedLegacyStore } from '../support/legacyStore'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/legacy')
const readFixture = (name: string) =>
  readFileSync(join(fixturesRoot, name, 'buildbox-store.json'), 'utf8')

const voids = (page: Page) => page.getByTestId(/^void-/)
/** The node ids behind the rendered voids, read off their test ids. */
const voidIds = (page: Page) =>
  voids(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')!.slice('void-'.length)))

test('load renders the cabinet canvas', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('cabinet-canvas')).toBeVisible()
  await expect(page).toHaveTitle('BuildBox')
})

test('a cabinet edit survives a reload', async ({ page }) => {
  await page.goto('./')
  await expect(voids(page)).toHaveCount(1)

  const before = await voidIds(page)
  // The space-label click-to-edit rect (DimensionLabels.tsx) covers the middle half of
  // every void and swallows clicks aimed at its centre, so a real click has to land in
  // the outer quarter — which is where a user's click actually reaches the void.
  await voids(page).first().click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: 'Add Shelf' }).click()
  await expect(voids(page)).toHaveCount(2)

  // Adding a shelf turns the clicked void into a panel and leaves a fresh void beside
  // it, so both rendered ids are new. Poll the persisted value rather than sleeping:
  // the write is async behind React.
  const added = (await voidIds(page)).filter((id) => !before.includes(id))
  expect(added).toHaveLength(2)
  for (const id of added) {
    await expect.poll(() => readLegacyStore(page)).toContain(id)
  }

  await page.reload()
  await expect(voids(page)).toHaveCount(2)
})

// Seeded fixtures never touch a real user's storage, and the live smoke runs against a
// fresh browser context, so they are excluded there.
// @local-only is the grep-invert tag static.yml's smoke-live job uses.
const legacyFixtures = [
  { name: 'v0', projects: ['Kitchen Base', 'Kitchen Tall', 'Bathroom Vanity'], planImage: false },
  { name: 'v1', projects: ['Kitchen Wall', 'Bathroom Vanity'], planImage: false },
  { name: 'v2', projects: ['Kitchen Wall', 'Bathroom Vanity'], planImage: false },
  { name: 'v3', projects: ['Kitchen Wall', 'Bathroom Vanity'], planImage: true },
  { name: 'v3-large-image', projects: ['Kitchen Wall', 'Bathroom Vanity'], planImage: true },
]

for (const fixture of legacyFixtures) {
  test(`legacy fixture ${fixture.name} loads @local-only`, async ({ page }) => {
    await seedLegacyStore(page, readFixture(fixture.name))
    await page.goto('./')

    await expect(page.getByTestId('cabinet-canvas')).toBeVisible()
    for (const name of fixture.projects) {
      // exact: each tab also renders a "Delete <name>" button, which substring matching
      // would pick up.
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }

    if (fixture.planImage) {
      await page.getByRole('button', { name: 'Floor Plan', exact: true }).click()
      await expect(page.getByTestId('floor-plan-canvas').locator('image')).toHaveCount(1)
    }
  })
}
