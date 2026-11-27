/**
 * The Notes switches and the Comment Register in a real browser (#83 criteria 2, 3, 4, 7, 8, 9, 16).
 *
 * What jsdom cannot answer is the last inch of the chain: that the switches reach a Worker, that the
 * Worker's SVG really has the pins the preview showed and none of the Comment bodies, that the file
 * arrives with the name the contract spells, and that the switches a person left behind are there
 * when the dialog is opened again — from the device's own preference store, not from the Project.
 *
 * The scene is `notes-review-scene.json` (`scripts/make-notes-review-seed.ts`), the issue's own
 * fixture: C-001 to C-008 with C-005 Resolved, A-001 to A-004, `Base 600` placed twice, and a second
 * Floor. C-004's body is the sentence that must never reach a drawing.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { readDownload } from '../support/libraryApp'
import { projectRevision, seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'notes-review-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name
const projectId = seed.projects[0]!.id

/** C-004's body. A pin shows reference, title and status; this is the sentence that proves it does not. */
const C004_BODY = 'The dishwasher needs its 50 mm. Move this unit, not the note.'

/** The provenance the sheet carries, of which the three switches are this spec's business. */
interface SheetMetadata {
  recipe: {
    /** The recipe as the dialog wrote it, in the recipe's own camelCase. */
    notes?: { viewAnnotations: boolean; commentPins: boolean; includeResolvedPins: boolean }
    composition?: Array<{ notes?: { view_annotations: boolean; comment_pins: boolean; include_resolved_pins: boolean } }>
  }
}

async function openScene(page: Page): Promise<void> {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await seedPreviewDb(page, seed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await floorPlanCanvas(page).waitFor()
  // A scene that stopped validating makes the app refuse every Intent as `invalid-project`, in the
  // console only, and an export that silently does nothing would read as a missing feature.
  expect(errors.filter((text) => text.includes('refused'))).toEqual([])
}

const chip = (page: Page, which: 'annotations' | 'pins' | 'resolved') =>
  page.getByTestId(`export-notes-${which}`)

test.describe('Notes export switches (#83)', () => {
  test('starts on the contract\'s defaults and exports pins without a single body', async ({ page }) => {
    await openScene(page)
    const revisionBefore = await projectRevision(page, projectId)

    await page.getByTestId('export-open').click()
    // Criterion 2: Annotations on, Pins off, Resolved pins off — and the third one cannot be moved
    // while there are no pins to say anything about (#83 §1.1).
    await expect(chip(page, 'annotations')).toBeChecked()
    await expect(chip(page, 'pins')).not.toBeChecked()
    await expect(chip(page, 'resolved')).not.toBeChecked()
    await expect(chip(page, 'resolved')).toBeDisabled()

    await chip(page, 'pins').check()
    await expect(chip(page, 'resolved')).toBeEnabled()
    await chip(page, 'resolved').check()

    // The preview is the file: the same display list the Worker is about to serialise, so the pins
    // are on it before a byte is written (#83 §3).
    const preview = page.getByTestId('export-preview-svg')
    await expect(preview).toBeVisible()
    await expect(preview.locator('[data-testid^="note-pin-"]')).not.toHaveCount(0)

    const pending = page.waitForEvent('download')
    await page.getByTestId('export-run').click()
    const file = await readDownload(await pending)
    expect(file.name).toMatch(/\.svg$/)

    const svg = file.buffer.toString('utf8')
    // Criterion 4: the Comments this view can stand a pin on. C-002 is anchored to the Floor itself
    // and a Floor has no place to put a dot, so it is the Register that speaks for it, never the
    // sheet; C-005 is the Resolved one the third switch asked for, labelled with the status that
    // switch decides.
    for (const reference of ['C-003', 'C-004', 'C-006', 'C-005']) {
      expect(svg, `no pin for ${reference}`).toContain(reference)
    }
    expect(svg).toContain('· Resolved')
    expect(svg).toContain('· Open')
    // Criterion 2: a pin never carries the body, and neither does anything else on the sheet.
    expect(svg).not.toContain(C004_BODY)

    // Criterion 8: the file records the three switches the control offered.
    const block = /<metadata>([\s\S]*?)<\/metadata>/.exec(svg)
    expect(block, 'the SVG carries no <metadata>').not.toBeNull()
    const metadata = JSON.parse(block![1]!) as SheetMetadata
    expect(metadata.recipe.notes).toEqual({
      viewAnnotations: true,
      commentPins: true,
      includeResolvedPins: true,
    })
    // The composition is the file's own words for the same three answers, and it is the half that
    // makes a repeat export reproducible.
    expect(metadata.recipe.composition?.[0]?.notes).toEqual({
      view_annotations: true,
      comment_pins: true,
      include_resolved_pins: true,
    })

    // Criterion 7: an export is a read. The Project it was drawn from is on the same revision it was
    // on when the dialog opened, and the canvas still has the Placed Items the pins point at.
    await expect(floorPlanCanvas(page)).toBeVisible()
    expect(await projectRevision(page, projectId)).toBe(revisionBefore)
  })

  test('turning pins off clears the Resolved switch, and the switches come back next time', async ({ page }) => {
    await openScene(page)
    await page.getByTestId('export-open').click()

    await chip(page, 'pins').check()
    await chip(page, 'resolved').check()
    expect(await chip(page, 'resolved').isChecked()).toBe(true)
    // Criterion 3: pins off takes the Resolved switch with it, and disables it again.
    await chip(page, 'pins').uncheck()
    await expect(chip(page, 'resolved')).not.toBeChecked()
    await expect(chip(page, 'resolved')).toBeDisabled()

    // Put them back the way they were left, because the next assertion is about what the device
    // remembers of exactly this answer.
    await chip(page, 'pins').check()
    await chip(page, 'resolved').check()
    const pending = page.waitForEvent('download')
    await page.getByTestId('export-run').click()
    await readDownload(await pending)

    // Criterion 7: the recipe is a device preference, so the dialog opens with it — and the Project
    // it came from holds nothing that looks like a recipe.
    await page.getByTestId('export-open').click()
    await expect(chip(page, 'annotations')).toBeChecked()
    await expect(chip(page, 'pins')).toBeChecked()
    await expect(chip(page, 'resolved')).toBeChecked()
  })
})

test.describe('Comment Register (#83)', () => {
  test('downloads one CSV with the published header and the rows the dialog counted', async ({ page }) => {
    await openScene(page)
    await page.getByTestId('export-open').click()
    await page.getByTestId('export-tab-lists').click()

    const table = page.getByTestId('export-lists-table-comments')
    // One table only: a bare CSV is the file whose header and name this spec reads, and the dialog
    // refuses two tables into one CSV anyway.
    const tables = page.getByTestId(/^export-lists-table-/)
    for (let i = 0, n = await tables.count(); i < n; i += 1) {
      const box = tables.nth(i)
      if (await box.isChecked()) await box.uncheck()
    }
    await table.check()

    // Criterion 9: the Register's own name, its row count, and the Resolved box that is off until
    // somebody asks for it.
    await expect(page.getByTestId('export-lists-rows-comments')).toContainText(/(\d+) rows/)
    await expect(page.getByTestId('export-lists-include-resolved')).not.toBeChecked()
    const counted = Number(/(\d+)/.exec((await page.getByTestId('export-lists-rows-comments').textContent()) ?? '')?.[0])

    const pending = page.waitForEvent('download')
    await page.getByTestId('export-lists-run').click()
    const file = await readDownload(await pending)
    // Criterion 16: `<project>_comments_<YYYYMMDD>.csv`.
    expect(file.name).toMatch(/comments_\d{8}\.csv$/)

    const csv = file.buffer.toString('utf8')
    expect(csv.startsWith('\uFEFF'), 'no UTF-8 BOM').toBe(true)
    const [header, ...rows] = csv.slice(1).replace(/\r\n$/, '').split('\r\n')
    expect(header).toBe(
      'reference,title,body,status,priority,created_at,updated_at,resolved_at,scope,floor,design_option,target_type,target_label',
    )
    // The number the dialog printed is the number of lines in the file, and no row is a Resolved one
    // while the box is off.
    expect(rows.filter((row) => row.length > 0)).toHaveLength(counted)
    expect(csv).not.toContain(',resolved,')
  })
})
