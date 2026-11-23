/**
 * Copy in one Project, paste into another, in a real browser (#72 criteria 1, 2, 3, 5, 6, 11, 12).
 *
 * The integration tests answer what the review does to the record. What they cannot answer is the
 * crossing itself: that a copy made in `Unit 4 Fitout` is still in the tab's clipboard after a
 * Library round trip to `14 Elm St` — a Project switch tears the workspace down and rebuilds it —
 * that the footer button knows which side of that trip it is on, and that the mapping review the
 * person answers really is the one the paste Intent previews. So this spec drives the pair through
 * Chromium: a press on the drawing, Ctrl+C, the Library, the other Project's `Option A · Combined`,
 * `Paste from other Project…`, one answer, `Paste with this mapping`, and one undo.
 *
 * The scene is `fixtures/e2e/preview-seed/paste-pair.json` (`scripts/make-paste-seed.ts`): the two
 * Projects in one database, `Unit 4 Fitout` with `Tall pantry` on `Furniture` and `GPO-9` on
 * `Services`, and `14 Elm St` holding `Furniture` by name and no `Services` at all — so one copy has
 * a name match to be offered and the other has nothing to answer with but a new layer.
 *
 * The workspace has one selection, not a set, so each Copy takes one record; the multi-record copy
 * is exercised at the edit layer.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanObjectIds, openProjectFromLibrary, openProjectTab, placedObject, undoButton } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const pairSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'paste-pair.json'), 'utf8'),
) as PreviewSeed
const nameOf = (id: string): string => pairSeed.library.find((record) => record.id === id)!.name
const FITOUT = nameOf('proj-paste-fitout')
const ELM = nameOf('proj-paste-elm')

/** A preview build never opens the database real work lives in (#53); the seed has to land where it looks. */
const PREVIEW_DB_NAME = 'buildbox-preview'

/** `Option A · Combined` of 14 Elm St — a Display a paste is allowed into. */
const COMBINED = 'views-view-014'
const FURNITURE = 'layers-001'
const SERVICES = 'layers-002'
const TALL_PANTRY = 'seed-003'
const GPO = 'seed-item-028'

async function openPair(page: Page, projectName: string): Promise<void> {
  await seedPreviewDb(page, { ...pairSeed, dbName: PREVIEW_DB_NAME })
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanObjectIds(page)).resolves.not.toHaveLength(0)
}

async function openView(page: Page, viewId: string): Promise<void> {
  await page.getByTestId('view-picker').selectOption(viewId)
  await expect(page.getByTestId('view-picker')).toHaveValue(viewId)
}

/** Select one record on the drawing and put it in this tab's clipboard. */
async function copy(page: Page, itemId: string): Promise<void> {
  await placedObject(page, itemId).click()
  await page.keyboard.press('Control+c')
}

/** Cross into 14 Elm St, answer the review, paste, and hand back the one record that arrived. */
async function pasteIntoElm(page: Page, answerRow: () => Promise<void>): Promise<string> {
  await openProjectTab(page, ELM)
  await openView(page, COMBINED)
  const before = await floorPlanObjectIds(page)
  await expect(page.getByTestId('renovation-paste-button')).toBeEnabled()
  await page.getByTestId('renovation-paste-button').click()
  await expect(page.getByTestId('paste-dialog-title')).toHaveText('Paste from “Unit 4 Fitout” — map Drawing Layers')
  await answerRow()
  await page.getByTestId('paste-dialog-confirm').click()
  await expect(page.getByTestId('paste-dialog')).toHaveCount(0)
  const after = await floorPlanObjectIds(page)
  const landed = after.filter((id) => !before.includes(id))
  expect(landed).toHaveLength(1)
  return landed[0]!
}

test('a copy survives the Library round trip and pastes onto the layer the answer named', async ({ page }) => {
  await openPair(page, FITOUT)

  await copy(page, TALL_PANTRY)
  // Here, where the copy was made, the footer button has nothing to offer (#72 criterion 12) — and a
  // copy writes nothing, so the Project is untouched: no undo is waiting.
  await expect(page.getByTestId('renovation-paste-button')).toBeDisabled()
  await expect(undoButton(page)).toBeDisabled()

  // The Project switch tears the workspace down; the copy is the tab's, and stays (#72 criterion 11).
  await openProjectTab(page, ELM)
  await openView(page, COMBINED)
  await expect(page.getByTestId('renovation-paste-button')).toBeEnabled()
  await page.getByTestId('renovation-paste-button').click()

  await expect(page.getByTestId('paste-dialog-title')).toHaveText('Paste from “Unit 4 Fitout” — map Drawing Layers')
  await expect(page.getByTestId('paste-dialog-intro')).toContainText('1 entity from “Unit 4 Fitout”')
  // One row, for the one layer the copy brings. Its name matches a layer here, and that is offered —
  // the select still says `— choose —` and the primary is still shut (#72 criteria 2, 3).
  const row = page.getByTestId(`paste-row-target-${FURNITURE}`)
  await expect(row).toHaveValue('')
  await expect(row.locator('option', { hasText: 'Furniture (name match)' })).toHaveCount(1)
  await expect(page.getByTestId('paste-dialog-confirm')).toBeDisabled()

  const before = await floorPlanObjectIds(page)
  await page.getByTestId(`paste-row-use-${FURNITURE}`).click()
  await expect(page.getByTestId('paste-dialog-confirm')).toBeEnabled()
  await page.getByTestId('paste-dialog-confirm').click()
  await expect(page.getByTestId('paste-dialog')).toHaveCount(0)

  const landed = (await floorPlanObjectIds(page)).filter((id) => !before.includes(id))
  expect(landed).toHaveLength(1)
  const pasted = landed[0]!
  expect(pasted).not.toBe(TALL_PANTRY)
  // Drawn, selected, and filed on the layer the answer named (#72 criteria 1, 5).
  await expect(placedObject(page, pasted)).toBeVisible()
  await expect(page.getByTestId('renovation-inspector')).toBeVisible()
  await expect(page.getByTestId('renovation-inspector-layer')).toHaveValue(FURNITURE)

  // One undo takes the whole paste back (#72 criterion 6).
  await undoButton(page).click()
  await expect(placedObject(page, pasted)).toHaveCount(0)
  await expect.poll(() => floorPlanObjectIds(page)).toHaveLength(before.length)
})

test('the layer a copy needs is created when the answer says to create it', async ({ page }) => {
  await openPair(page, FITOUT)
  await copy(page, GPO)

  const landed = await pasteIntoElm(page, async () => {
    const row = page.getByTestId(`paste-row-target-${SERVICES}`)
    // `Services` exists in the source and not here: no name match is offered, and the only answer
    // that is not a lie is a new one (#72 criterion 3).
    await expect(row.locator('option', { hasText: '(name match)' })).toHaveCount(0)
    await expect(row.locator('option', { hasText: 'Create “Services” here' })).toHaveCount(1)
    await expect(page.getByTestId('paste-dialog-confirm')).toBeDisabled()
    await row.selectOption('new')
  })

  // The pasted record is selected, and its Layer row names a layer that did not exist a moment ago.
  await expect(placedObject(page, landed)).toBeVisible()
  const layer = await page.getByTestId('renovation-inspector-layer').inputValue()
  expect(layer).not.toBe('')
  expect(layer).not.toBe(SERVICES)
  await expect(page.getByTestId(`layer-item-${layer}`)).toContainText('Services')
})
