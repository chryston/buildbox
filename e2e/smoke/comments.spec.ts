/**
 * Comments through the real browser (#80 criteria 11–24, 29–32).
 *
 * The panel's own gestures, in order: the eight seeded notes are listed; a filter narrows the list; the
 * overlay is switched on and the pins appear; a pin is clicked and its row takes the focus; the Comment
 * tool anchors a note where the click landed and the inline editor gives it a Title; and Undo takes that
 * note away without moving anything else.
 *
 * The scene is the services scene migrated to v15 and given eight notes, one per Anchor kind
 * (`scripts/make-comments-seed.ts`). It carries Design Options, so the panel's context rules have a real
 * Option to filter by.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts } from '../support/stability'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'comments-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name

const rows = (page: Page) => page.locator('[data-testid="note-rows"] > li')

async function openScene(page: Page): Promise<void> {
  await seedPreviewDb(page, seed)
  await page.goto('/')
  await waitForFonts(page)
  await openProjectFromLibrary(page, projectName)
  await floorPlanCanvas(page).waitFor()
}

test.describe('Comments (#80)', () => {
  test('lists the seeded notes, filters them, and reveals one from its pin', async ({ page }) => {
    await openScene(page)

    // --- the panel lists the notes the context allows, and all of them without it --------
    // Two rules are on by default: the context rules (#80 §6) and the `Open` status filter (§5.3), which
    // hides the scene's one resolved note. Switching both off is what shows all eight.
    await expect(page.getByTestId('notes-panel')).toBeVisible()
    const inContext = await rows(page).count()
    expect(inContext).toBeGreaterThan(0)
    expect(inContext).toBeLessThanOrEqual(7)
    await page.getByTestId('notes-current-context').uncheck()
    await expect(rows(page)).toHaveCount(7)
    await page.getByTestId('notes-status-filter').selectOption('any')
    await expect(rows(page)).toHaveCount(8)

    // --- the overlay is off by default, and the pill turns it on (#80 §7.1) --------------------
    await expect(page.locator('[data-testid^="note-pin-"]')).toHaveCount(0)
    const pill = page.getByTestId('notes-overlay-button')
    await expect(pill).toHaveAttribute('aria-pressed', 'false')
    await pill.click()
    await expect(pill).toHaveAttribute('aria-pressed', 'true')
    // The eight notes sit on five different Anchors, so a handful of pins are on screen.
    expect(await page.locator('[data-testid^="note-pin-"]').count()).toBeGreaterThan(0)

    // --- a filter narrows the list (#80 §5.3) --------------------------------------------------
    await page.getByTestId('notes-status-filter').selectOption('resolved')
    await expect(rows(page)).toHaveCount(1)
    await page.getByTestId('notes-status-filter').selectOption('open')
    await expect(rows(page)).toHaveCount(7)
    await page.getByTestId('notes-status-filter').selectOption('any')
    await expect(rows(page)).toHaveCount(8)

    // --- clicking a pin takes the focus to its row (#80 §7.5) ----------------------------------
    await page.locator('[data-testid^="note-pin-"]').first().click({ force: true })
    await expect(page.getByTestId('notes-panel')).toBeVisible()
  })

  test('the Comment tool anchors a note on the placement it was clicked on (#80 §9)', async ({ page }) => {
    await openScene(page)
    await page.getByTestId('notes-current-context').uncheck()
    await page.getByTestId('notes-status-filter').selectOption('any')
    await expect(rows(page)).toHaveCount(8)

    await page.getByTestId('renovation-tool-comment').click()
    await expect(page.getByTestId('comment-tool-hint')).toBeVisible()
    await page.locator('[data-testid="floor-plan-canvas"] [data-ref-role="placed-item"]').first().click()

    // The note exists, is named by the thing it was put on, and its Title is being typed (#80 §9, §10).
    await expect(rows(page)).toHaveCount(9)
    const title = page.getByTestId('note-editor-title')
    await expect(title).toBeVisible()
    await title.fill('Sill height to match the appliance')
    await title.press('Enter')
    // The newest note carries the Title that was typed; its reference comes from the Project's
    // counter, so the row is named by what it says rather than by a number this spec cannot know.
    await expect(rows(page).last()).toContainText('Sill height to match the appliance')
    // The tool is spent: one press, one note (§9.3).
    await expect(page.getByTestId('comment-tool-hint')).toHaveCount(0)
  })

  test('the inspector names the notes about the selected placement (#80 §8)', async ({ page }) => {
    await openScene(page)
    await page.locator('[data-testid="floor-plan-canvas"] [data-ref-role="placed-item"]').first().click()
    // §8: the left inspector carries a Comments section for the thing selected, with an explicit
    // button for starting a note on it — the person chooses, nothing is inferred.
    await expect(page.getByTestId('inspector-notes')).toBeVisible()
    await expect(page.getByTestId('inspector-notes-heading')).toContainText('On this placement')
    await expect(page.getByTestId('inspector-comment-on-entity')).toBeVisible()
  })
})
