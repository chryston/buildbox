import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { cardButton } from '../support/libraryApp'
import { floorPlanCanvas, openItemDetail } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

// The scene the app has to keep rendering identically through the migration (#39 §2,
// #20 §13.15): the cabinet editor, from the untouched v3 legacy fixture converted into
// Project Backups, so a baseline is a promise about real persisted data and not about a
// fixture the app invented.
//
// The floor-plan scene that used to live here was retired by #55: the legacy floor-plan
// page is gone, and `plan-view.spec.ts` captures the Plan View that replaced it.
//
// Since #53 there is one artifact and one seed: the converted fixture, in the database the app
// opens. The baselines are the ones #49 captured from the flag-on build, so this spec is the
// proof that the migrated scenes still draw the same pixels.
const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const previewSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'legacy-v3.json'), 'utf8'),
) as PreviewSeed

const cabinetCanvas = (page: Page): Locator => page.getByTestId('cabinet-canvas')

// Persisted text carries timestamps; a frozen clock keeps them out of the diff (#39 notes).
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

// The app opens on the Project Library (#50), so the scene lives one card behind;
// the seed's first Project is the one every scene is captured in.
const firstProjectName = previewSeed.library.find((record) => record.id === previewSeed.projects[0]!.id)!.name

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  // One seed and one artifact since #53: the v3 fixture converted into Project Backups, in the
  // database the app opens.
  await seedPreviewDb(page, previewSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await cardButton(page, firstProjectName, 'Open').click()
  await expect(floorPlanCanvas(page)).toBeVisible()
  // The cabinet editor is reached through a Placed Item's Item Detail now (#57), so the scene
  // is captured from the migrated `Base Unit` the way a person reaches it.
  await openItemDetail(page, 'seed-002')
  await waitForFonts(page)
  // The first project is active, no void is selected and the view is at the default
  // zoom — the state a user lands in, and the one S4 has to reproduce.
  await waitForStablePaint(cabinetCanvas(page))
})

test('cabinet scene', async ({ page }) => {
  await expect(cabinetCanvas(page)).toHaveScreenshot('cabinet-scene.png')
})

test('cabinet scene with a void selected', async ({ page }) => {
  const firstVoid = page.getByTestId(/^void-/).first()
  // The space-label rect covers the middle half of every void, so a real click lands in
  // the outer quarter — the same position e2e/smoke/app.spec.ts uses.
  await firstVoid.click({ position: { x: 10, y: 10 } })
  await expect(firstVoid).toHaveAttribute('stroke', '#7c3aed')
  await waitForStablePaint(cabinetCanvas(page))

  await expect(cabinetCanvas(page)).toHaveScreenshot('cabinet-scene-selected.png')
})
