import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '../support/fixtures'
import { LEGACY_STORE_KEY, readLegacyStore, seedLegacyStore } from '../support/legacyStore'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/legacy')
const v3 = readFileSync(join(fixturesRoot, 'v3', 'buildbox-store.json'), 'utf8')

/** A v3 envelope whose first project has lost its list of cabinets. */
function corruptUnits(): string {
  const parsed = JSON.parse(v3)
  parsed.state.projects[0].units = {}
  return JSON.stringify(parsed)
}

/** A v3 envelope cut off mid-value, so it is not JSON any more. */
function truncate(): string {
  return v3.slice(0, v3.length - 40)
}

// These specs write to this browser's storage, so they are excluded from the live smoke
// run. @local-only is the grep-invert tag static.yml's smoke-live job uses.
const corruptions = [
  { name: 'a project whose cabinets are not a list', raw: corruptUnits(), problem: 'state.projects[0].units — Expected a list of cabinets.' },
  { name: 'a truncated value', raw: truncate(), problem: 'The file is not valid JSON.' },
]

for (const corruption of corruptions) {
  test(`recovery: ${corruption.name} opens the recovery screen and keeps the bytes @local-only`, async ({ page }) => {
    await seedLegacyStore(page, corruption.raw)
    await page.goto('./')

    await expect(page.getByTestId('recovery-screen')).toBeVisible()
    await expect(page.getByRole('heading', { name: /can't open the designs saved in this browser/i })).toBeVisible()
    await expect(page.getByText(/nothing has been changed/i)).toBeVisible()
    await expect(page.getByTestId('cabinet-canvas')).toHaveCount(0)

    await page.getByRole('button', { name: 'Show problems' }).click()
    await expect(page.getByTestId('problem-list')).toContainText(corruption.problem)

    // Five seconds of an idle app: the persist middleware never gets to write.
    await page.waitForTimeout(5000)
    expect(await readLegacyStore(page)).toBe(corruption.raw)

    await page.reload()
    await expect(page.getByTestId('recovery-screen')).toBeVisible()
    expect(await readLegacyStore(page)).toBe(corruption.raw)
  })

  test(`recovery: downloading after ${corruption.name} returns the stored bytes exactly @local-only`, async ({ page }) => {
    await seedLegacyStore(page, corruption.raw)
    await page.goto('./')
    await expect(page.getByTestId('recovery-screen')).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download raw data' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^buildbox-store-raw-\d{8}-\d{6}\.json$/)
    const path = await download.path()
    expect(readFileSync(path!, 'utf8')).toBe(corruption.raw)
    expect(await readLegacyStore(page)).toBe(corruption.raw)
  })
}

test('recovery: only a confirmed Clear removes the stored data @local-only', async ({ page }) => {
  const stored = corruptUnits()
  // No seedLegacyStore here: its init script would put the corrupt value back on the
  // reload that clearing triggers, and the point of this test is that it does not come back.
  await page.goto('./')
  await expect(page.getByTestId('cabinet-canvas')).toBeVisible()
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [LEGACY_STORE_KEY, stored])
  await page.reload()
  await expect(page.getByTestId('recovery-screen')).toBeVisible()

  await page.getByRole('button', { name: 'Clear saved data and start over…' }).click()
  await expect(page.getByRole('heading', { name: 'Clear saved data?' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Clear saved data?' })).toHaveCount(0)
  expect(await readLegacyStore(page)).toBe(stored)

  await page.getByRole('button', { name: 'Clear saved data and start over…' }).click()
  await Promise.all([
    page.waitForLoadState('load'),
    page.getByRole('button', { name: 'Clear saved data', exact: true }).click(),
  ])
  await expect(page.getByTestId('cabinet-canvas')).toBeVisible()
  expect(await readLegacyStore(page)).not.toBe(stored)
})
