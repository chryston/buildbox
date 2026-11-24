/**
 * Warnings in the browser (#66 criteria 1, 3, 4, 6, 7).
 *
 * Five things about a warning can only be seen by clicking on one:
 *
 *   - that the words on the row come from the model, not from a fixture — the measured overlap is
 *     what the two Walls actually do, and the thirteen Junctions in the same scene say nothing,
 *     because a join is the thing that removes the warning (criterion 1);
 *   - that the three statuses are three different rows, and that a reopened one keeps the note the
 *     user wrote rather than announcing itself alone (criterion 3);
 *   - that looking at the plan is not changing the model: panning, zooming, and collapsing and
 *     re-expanding the strip leave an acknowledgement acknowledged (criterion 4);
 *   - that `Acknowledge` and `Note` are Edit Transactions, so `Undo` takes the decision back and
 *     `Redo` puts it, with its note, exactly where it was (criterion 6);
 *   - that deleting a Wall takes its warning and that warning's acknowledgement with it in one
 *     transaction, and one `Undo` restores all three (criterion 7).
 *
 * Nothing here is drawn through the Wall tool. The scene arrives in the seed
 * (`scripts/make-warnings-scene-seed.ts`) — the walled Plan View with three Walls left unjoined,
 * and two Acknowledgements whose signatures were read back out of the engine — because a warning
 * drawn behind a gesture would put the thing under test behind the thing under test.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary, redoButton, saveStatus, undoButton } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const warningsSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'warnings-scene.json'), 'utf8'),
) as PreviewSeed
const projectName = warningsSeed.library.find((record) => record.id === warningsSeed.projects[0]!.id)!.name

/** The stored Project, read the way the app reads it: the rows the strip will render. */
const stored = warningsSeed.projects[0]!.data as {
  floors: { id: string }[]
  existingModel: { walls: { id: string; ref: string }[] }
}

/** The Wall the fixture names, by its plan reference (`W-13`). */
const wallIdByRef = (ref: string): string =>
  stored.existingModel.walls.find((wall) => wall.ref === ref)!.id

/**
 * The three pairs the producer finds, in engine order, as the fixture writes them.
 *
 * Read out of the fixture rather than typed in, so a scene that moved updates the assertions with
 * it instead of failing for a reason that has nothing to do with warnings.
 */
const OPEN_ROW = 'W-13 crosses W-4 without a join: 200 mm overlap.'
const REOPENED_ROW = 'W-15 crosses W-5 without a join: 330.3 mm overlap.'
const SEEN_ROW = 'W-14 runs along W-3 for 2400 mm without a join.'
const SEEN_NOTE = 'Checked on site: the duct runs above both.'
const REOPENED_NOTE = 'Re-measure after the partition moves.'

/** The Wall whose deletion takes a warning *and that warning's acknowledgement* with it. */
const PRUNED_WALL_REF = 'W-14'

const strip = (page: Page): Locator => page.getByTestId('warning-strip')
const count = (page: Page): Locator => page.getByTestId('warning-count')
const rows = (page: Page): Locator => page.getByTestId('warning-list').locator('li')

/** The row whose sentence is `sentence`, as its own locator. */
function rowFor(page: Page, sentence: string): Locator {
  return page.getByTestId('warning-list').locator('li').filter({ hasText: sentence })
}

async function openWarnedPlan(page: Page): Promise<Locator> {
  await seedPreviewDb(page, warningsSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  const canvas = floorPlanCanvas(page)
  await expect(canvas).toBeVisible()
  await page.getByTestId('warning-toggle').click()
  // The three junction rows of #66, plus the eight the vertical producers derive from this
  // scene's furniture (#76 §5).
  await expect(rows(page)).toHaveCount(11)
  return canvas
}

test('the warnings come from the model: three unjoined pairs speak, thirteen joins say nothing', async ({ page }) => {
  await openWarnedPlan(page)

  // Every row names both Walls it is about and says what they do, in millimetres — the measured
  // copy of range-prototype behaviour 22, not a generic "check this".
  await expect(page.getByText(OPEN_ROW, { exact: false })).toBeVisible()
  await expect(page.getByText(REOPENED_ROW, { exact: false })).toBeVisible()
  await expect(page.getByText(SEEN_ROW, { exact: false })).toBeVisible()

  // The same Floor holds a closed ring, four hosted partitions, an arc and a four-way cross:
  // thirteen Junctions, and not one warning among them. A join is the answer to the warning, and
  // BuildBox never infers one, so the count is the producer's whole contract in one number.
  await expect(count(page)).toHaveText('10 open · 1 seen')

  // One `!` badge per entity involved in something unacknowledged: the four Walls of the two
  // junction rows, plus the five Walls and six furniture pieces of the eight vertical rows
  // (#76 §5) — eleven entities, whatever the number of warnings each is in the middle of.
  await expect(page.getByTestId('floor-plan-canvas').locator('[data-testid^="warning-badge-"]')).toHaveCount(11)
})

test('the three statuses are three rows, and a reopened one keeps its note', async ({ page }) => {
  await openWarnedPlan(page)

  // Open: no status label at all, and an `Acknowledge` to offer.
  const open = rowFor(page, OPEN_ROW)
  await expect(open).toHaveAttribute('data-status', 'open')
  await expect(open.locator('[data-testid^="warning-status-"]')).toHaveCount(0)

  // Reopened: the model moved after the user looked at it, and the note they wrote stays.
  const reopened = rowFor(page, REOPENED_ROW)
  await expect(reopened).toHaveAttribute('data-status', 'reopened')
  await expect(reopened.locator('[data-testid^="warning-status-"]')).toHaveText(
    `Reopened after change · ${REOPENED_NOTE}`,
  )

  // Acknowledged: `Seen ✓` with the note, and `Note` in place of `Acknowledge` — the decision is
  // made, so what is offered is editing the record of it.
  const seen = rowFor(page, SEEN_ROW)
  await expect(seen).toHaveAttribute('data-status', 'acknowledged')
  await expect(seen.locator('[data-testid^="warning-status-"]')).toHaveText(`Seen ✓ · ${SEEN_NOTE}`)
  await expect(seen.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0)
  await expect(seen.getByRole('button', { name: 'Note' })).toBeVisible()

  // Open and reopened rows come first, and within each group the rows follow engine order. The
  // vertical rows (#76 §5) join the open group, so the three junction rows are located by name.
  const texts = await rows(page).allInnerTexts()
  const indexOf = (sentence: string): number => texts.findIndex((text) => text.includes(sentence))
  expect(indexOf(OPEN_ROW)).toBeLessThan(indexOf(REOPENED_ROW))
  expect(indexOf(SEEN_ROW)).toBe(texts.length - 1)
})

test('looking at the plan never reopens a warning', async ({ page }) => {
  const canvas = await openWarnedPlan(page)

  const box = await canvas.boundingBox()
  if (box === null) throw new Error('the canvas has no box to pan inside')
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  // Pan, then zoom, then the two things a person does to a view that are not edits at all:
  // collapsing the strip and opening it again. None of them touches the model, so none of them
  // may turn `Seen ✓` back into something that needs looking at.
  //
  // The pan is the middle button, which the canvas takes as a pan wherever it lands: a left-drag
  // on a Wall body would move the Wall, and a test that reopened a warning with an edit would be
  // proving the opposite of what it means.
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(centre.x - 140, centre.y - 90, { steps: 6 })
  await page.mouse.up({ button: 'middle' })
  await page.mouse.wheel(0, -400)
  await expect(canvas).toBeVisible()

  await page.getByTestId('warning-toggle').click()
  await expect(page.getByTestId('warning-list')).toHaveCount(0)
  await page.getByTestId('warning-toggle').click()

  await expect(rowFor(page, SEEN_ROW)).toHaveAttribute('data-status', 'acknowledged')
  await expect(rowFor(page, SEEN_ROW).locator('[data-testid^="warning-status-"]')).toHaveText(
    `Seen ✓ · ${SEEN_NOTE}`,
  )
  await expect(count(page)).toHaveText('10 open · 1 seen')
})

test('Acknowledge and Note are Edit Transactions: undo takes them back, redo puts them back', async ({ page }) => {
  await openWarnedPlan(page)
  const open = rowFor(page, OPEN_ROW)
  const key = (await open.getAttribute('data-testid'))!.replace('warning-row-', '')

  await open.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(page.getByTestId(`warning-note-${key}`)).toBeVisible()
  await expect(page.getByLabel('Note (optional)')).toBeVisible()
  await page.getByTestId(`warning-note-${key}`).fill('Left open deliberately: the client will confirm.')
  await page.getByTestId(`warning-save-${key}`).click()

  await expect(open).toHaveAttribute('data-status', 'acknowledged')
  await expect(open.locator('[data-testid^="warning-status-"]')).toHaveText(
    'Seen ✓ · Left open deliberately: the client will confirm.',
  )
  await expect(count(page)).toHaveText('9 open · 2 seen')
  await expect(saveStatus(page)).toContainText('Saved locally')

  // One undo takes the decision back, note and all — it was one transaction, not two.
  await undoButton(page).click()
  await expect(open).toHaveAttribute('data-status', 'open')
  await expect(open.locator('[data-testid^="warning-status-"]')).toHaveCount(0)
  await expect(count(page)).toHaveText('10 open · 1 seen')

  // Redo restores the acknowledgement exactly as it was made.
  await redoButton(page).click()
  await expect(open).toHaveAttribute('data-status', 'acknowledged')
  await expect(open.locator('[data-testid^="warning-status-"]')).toHaveText(
    'Seen ✓ · Left open deliberately: the client will confirm.',
  )
  await expect(count(page)).toHaveText('9 open · 2 seen')
})

test('deleting a Wall takes its warning and its acknowledgement in one transaction', async ({ page }) => {
  await openWarnedPlan(page)
  const wallId = wallIdByRef(PRUNED_WALL_REF)

  // W-14 is the acknowledged overlap's subject, so this deletes a Wall, a warning and a
  // acknowledgement carrying a note — all three have to go together, and come back together.
  await expect(rowFor(page, SEEN_ROW)).toBeVisible()
  // W-14 lies along the bottom of the ring, which is exactly where the expanded strip is
  // overlaid, so the strip comes down before the plan is clicked — the strip never resizes the
  // canvas, but it does sit on top of it.
  await page.getByTestId('warning-toggle').click()
  await expect(page.getByTestId('warning-list')).toHaveCount(0)
  await page.getByTestId(`wall-band-${wallId}`).click()
  await expect(page.getByTestId('wall-inspector')).toBeVisible()
  await page.getByTestId('wall-delete').click()
  await page.getByTestId('warning-toggle').click()

  await expect(rows(page)).toHaveCount(10)
  await expect(page.getByText(SEEN_ROW, { exact: false })).toHaveCount(0)
  // The note went with it: nothing anywhere still claims the overlap was seen.
  await expect(page.getByText(SEEN_NOTE, { exact: false })).toHaveCount(0)
  await expect(count(page)).toHaveText('10 open · 0 seen')

  // One undo, not two: the Wall, the warning and the acknowledgement with its note.
  await undoButton(page).click()
  await expect(rows(page)).toHaveCount(11)
  await expect(rowFor(page, SEEN_ROW)).toHaveAttribute('data-status', 'acknowledged')
  await expect(rowFor(page, SEEN_ROW).locator('[data-testid^="warning-status-"]')).toHaveText(
    `Seen ✓ · ${SEEN_NOTE}`,
  )
  await expect(count(page)).toHaveText('10 open · 1 seen')
  await expect(strip(page)).toBeVisible()
})
