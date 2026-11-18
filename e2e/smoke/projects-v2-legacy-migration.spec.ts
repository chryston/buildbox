import { expect, test } from '../support/fixtures'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  card,
  dialogHeading,
  libraryHeading,
  previewSeed,
  restoreBackupButton,
  storedLibraryNames,
  toast,
} from '../support/libraryApp'
import { LEGACY_STORE_KEY, readLegacyStore, seedLegacyStore } from '../support/legacyStore'
import { E2E_DB_NAME, seedPreviewDb } from '../support/seedPreviewDb'
import type { PreviewSeed } from '../support/seedPreviewDb'
import type { Page } from '@playwright/test'

/**
 * The Migration review end to end (#52 criteria 1, 2, 3, 6, 10, 17, 18, 20).
 *
 * The pipeline itself is proven over the whole fixture corpus in `src/test/legacyMigration.test.ts`
 * and stage by stage in `src/session/migration.test.ts`. What only a browser can prove is the
 * promise the surface makes about one particular value in `localStorage`: that it is still there,
 * byte for byte, after every path through the flow — including the paths that stop.
 *
 * The seed is the `migration-review` fixture the issue names: three active Designs and one
 * standalone floor plan with a 2400 × 1800 Plan Image.
 */

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/legacy')
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')

const REVIEW = read('migration-review/buildbox-store.json')
const SKETCHES = read('sketches/buildbox-store.json')

const REVIEW_HEADING = 'Review where your existing work belongs'
const SUCCESS_HEADING = 'Your legacy work is ready'
const PAUSED = "This browser isn't letting BuildBox store Projects right now, so migration is paused."

const reviewHeading = (page: Page) => page.getByRole('heading', { level: 1, name: REVIEW_HEADING })
const successHeading = (page: Page) => page.getByRole('heading', { level: 1, name: SUCCESS_HEADING })

/** The Library, seeded, with old data in `localStorage` and the review therefore open. */
async function openReview(page: Page, store: string, seed: PreviewSeed = previewSeed): Promise<void> {
  await seedPreviewDb(page, seed)
  await seedLegacyStore(page, store)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(reviewHeading(page)).toBeVisible()
}

/** Choose a destination, continue, and let the pipeline run to the Back up step. */
async function migrate(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Continue to review' })).toBeDisabled()
  await page.getByLabel('Attach it to').selectOption('separate')
  await page.getByRole('button', { name: 'Continue to review' }).click()
  await page.getByRole('button', { name: 'Migrate and verify' }).click()
  await expect(successHeading(page)).toBeVisible()
}

/**
 * Seed only when the key is absent, so a later `setItem` survives a reload.
 *
 * `seedLegacyStore` re-writes on every navigation, which is what makes the byte-identity
 * assertions honest — and would also silently undo the one change this test needs to make.
 */
async function seedLegacyStoreOnce(page: Page, store: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value)
    },
    [LEGACY_STORE_KEY, store],
  )
}

test('the review opens on its own, lists every Design, and writes nothing until the button (#52 criteria 1, 2, 3, 10)', async ({
  page,
}) => {
  await openReview(page, REVIEW)

  // Criterion 1: the four steps, in order, with the first one active.
  const dots = page.locator('.stepper-dot')
  await expect(dots).toHaveCount(4)
  await expect(dots.nth(0)).toHaveClass(/active/)
  await expect(dots.nth(1)).not.toHaveClass(/active|done/)

  // Criterion 2: three rows, one per active Design, each tagged New Project.
  await expect(page.locator('.migration-item')).toHaveCount(3)
  for (const name of ['Cabinet 1', 'Kitchen Renovation', 'Wardrobe Study']) {
    await expect(page.locator('.migration-item').filter({ hasText: name })).toBeVisible()
  }
  await expect(page.getByText('New Project', { exact: true })).toHaveCount(3)

  // Criterion 3: no destination is pre-selected, and the flow cannot be left this screen.
  await expect(page.getByLabel('Attach it to')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Continue to review' })).toBeDisabled()
  await expect(page.getByText('we will not guess')).toBeVisible()
  await expect(page.getByText('The source data stays untouched until all new records verify successfully.')).toBeVisible()

  // Nothing has been written: the store still holds exactly the Projects it was seeded with.
  const before = await storedLibraryNames(page)
  expect(before.map((entry) => entry.name).sort()).toEqual(previewSeed.library.map((entry) => entry.name).sort())

  await migrate(page)

  // Criterion 2 again, on the far side: three Projects, plus the floor plan's own.
  for (const name of ['Cabinet 1', 'Kitchen Renovation', 'Wardrobe Study']) {
    await expect(page.locator('.result-list li').filter({ hasText: `${name} → New Project` })).toBeVisible()
  }
  await expect(page.getByText('Standalone floor plan → Separate Project')).toBeVisible()

  await page.getByRole('button', { name: 'Return to Projects' }).click()
  await expect(libraryHeading(page)).toBeVisible()
  for (const name of ['Cabinet 1', 'Kitchen Renovation', 'Wardrobe Study']) {
    await expect(card(page, name)).toBeVisible()
  }
  const after = await storedLibraryNames(page)
  expect(after).toHaveLength(previewSeed.library.length + 4)

  // Criterion 10: the source is byte-identical, and the Projects that were already here are too.
  expect(await readLegacyStore(page)).toBe(REVIEW)
})

test('reloading does not reopen the review, and a changed source does (#52 criterion 20)', async ({ page }) => {
  await seedPreviewDb(page, previewSeed)
  await seedLegacyStoreOnce(page, REVIEW)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(reviewHeading(page)).toBeVisible()
  await migrate(page)
  await page.getByRole('button', { name: 'Return to Projects' }).click()

  // The completion record names this exact hash, so the reader goes back to their Projects.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()
  await expect(reviewHeading(page)).toHaveCount(0)

  // Different bytes are different data: the review is available again, and the Projects that the
  // first migration made are still standing.
  const migrated = await storedLibraryNames(page)
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [LEGACY_STORE_KEY, SKETCHES])
  await page.reload({ waitUntil: 'networkidle' })
  await expect(reviewHeading(page)).toBeVisible()
  expect(await storedLibraryNames(page)).toEqual(migrated)
})

test('Remove old copy is the only thing that deletes the source (#52 criterion 6)', async ({ page }) => {
  await openReview(page, REVIEW)
  await migrate(page)

  // Opening the confirm decides nothing.
  await page.getByRole('button', { name: 'Remove old copy', exact: true }).click()
  await expect(page.getByText('This deletes the old BuildBox data from this browser.')).toBeVisible()
  expect(await readLegacyStore(page)).toBe(REVIEW)

  await page.locator('.migration-confirm').getByRole('button', { name: 'Remove old copy' }).click()
  await expect(toast(page)).toContainText('Old copy removed.')
  expect(await readLegacyStore(page)).toBeNull()

  // And with the source gone, the review has nothing to offer and says so. No reload here:
  // `seedLegacyStore` re-writes the key on every navigation, which is what makes the byte-identity
  // assertions above honest and would hand this one a source back.
  await page.getByRole('button', { name: 'Return to Projects' }).click()
  await expect(libraryHeading(page)).toBeVisible()
  await page.getByRole('button', { name: 'Migration review' }).click()
  await expect(page.getByText('BuildBox found no old data in this browser.')).toBeVisible()
})

test('a legacy file picked from Restore Backup goes to the review instead (#52 criterion 17)', async ({ page }) => {
  await seedPreviewDb(page, previewSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(libraryHeading(page)).toBeVisible()

  await restoreBackupButton(page).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'old-workspace.buildbox.json',
    mimeType: 'application/json',
    buffer: Buffer.from(REVIEW),
  })
  await expect(dialogHeading(page)).toHaveText('That file is old BuildBox data. Review it instead?')

  // Cancelled: nothing was staged, nothing was written, and the browser's own copy is untouched.
  await page.getByRole('button', { name: 'Cancel' }).click()
  expect(await storedLibraryNames(page)).toHaveLength(previewSeed.library.length)

  await page.locator('input[type="file"]').setInputFiles({
    name: 'old-workspace.buildbox.json',
    mimeType: 'application/json',
    buffer: Buffer.from(REVIEW),
  })
  await page.getByRole('button', { name: 'Review this file' }).click()
  await expect(reviewHeading(page)).toBeVisible()

  // Nothing until `Migrate and verify` succeeds.
  expect(await storedLibraryNames(page)).toHaveLength(previewSeed.library.length)
  await migrate(page)
  expect(await storedLibraryNames(page)).toHaveLength(previewSeed.library.length + 4)

  // The browser's own copy was never the file the reader picked, and is still absent.
  expect(await readLegacyStore(page)).toBeNull()
})

test('with IndexedDB unavailable the review pauses, and both downloads still work (#52 criterion 18)', async ({
  page,
}) => {
  await seedLegacyStore(page, REVIEW)
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('The user denied permission to access the database.', 'SecurityError')
    }
  })
  await page.goto('./', { waitUntil: 'networkidle' })

  await expect(page.getByText(PAUSED)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Migrate and verify' })).toHaveCount(0)

  const original = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download original data' }).click()
  const file = await original
  expect(file.suggestedFilename()).toBe('buildbox-original-data.json')
  const bytes = await file.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  })
  // Byte-identical to the source, which is the only promise this button makes.
  expect(bytes.toString('utf8')).toBe(REVIEW)

  const backups = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download old data as Backup' }).click()
  expect((await backups).suggestedFilename()).toMatch(/\.buildbox$/)

  // Nothing was written anywhere: the source is untouched, and no Project was created.
  expect(await readLegacyStore(page)).toBe(REVIEW)
  expect(await page.evaluate((name) => indexedDB.databases().then((dbs) => dbs.some((db) => db.name === name)), E2E_DB_NAME)).toBe(
    false,
  )
  await expect(toast(page)).toHaveCount(0)
})
