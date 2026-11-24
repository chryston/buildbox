/**
 * A Skirting through the real browser (#78 criteria 3, 4, 5, 6, 7, 9, 11, 13, 15, 17).
 *
 * One strip drawn on a face nobody had skirted, then lived with: the tool's one click and the bar's
 * three numbers, the record answering a click on the Plan View with the two names the issue asks for,
 * the same record standing in the Section at the Bottom and Top the inspector prints, the face flipped
 * and the other face filled by a second record, the strip deleted and returned by one Undo, and the
 * Skirting table offering its rows to the export.
 *
 * The scene is the #78 fixture without its Design Options (`scripts/make-skirting-seed.ts`): the Floor
 * with `Skirting SK-1` at the foot of `W-1`, `Skirting SK-3` on `W-4`, and the Kitchen section looking
 * at `W-1`. No Option means nothing shares these records, so each gesture commits as it always did —
 * the locked-baseline half of #70 §7c is `existingDisplay`'s to test, for every kind at once. The new
 * strip goes on `W-2`, which the fixture leaves bare, so its label is the second and its geometry
 * cannot be confused with a record the fixture already carried.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts } from '../support/stability'
import type { Project } from '../../src/domain'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'skirting-plain.json'), 'utf8'),
) as PreviewSeed
const projectName = seed.library.find((record) => record.id === seed.projects[0]!.id)!.name

const scene0 = seed.projects[0]!.data as unknown as Project
const section = scene0.elevationViews!.find((view) => view.name === 'Kitchen section')!
const SKIRTING_1 = scene0.existingModel.skirting!.find((each) => each.label === 'Skirting SK-1')!.id
/** Every Skirting the fixture already draws: anything else on the surface was made by the test. */
const SEEDED_IDS = scene0.existingModel.skirting!.map((each) => each.id)
/**
 * The face the tool is aimed at: `W-1`'s other side. `Skirting SK-1` stands on the left side of that
 * Wall, so the right side is the one the fixture leaves bare — and it is the only bare face the
 * Plan View's pane reaches at the opening zoom.
 */
const BARE_WALL = scene0.existingModel.walls.find((wall) => wall.ref === 'W-1')!
const BARE_SIDE = 'right'
const BARE_LENGTH = Math.round(Math.hypot(BARE_WALL.line.end.x - BARE_WALL.line.start.x, BARE_WALL.line.end.y - BARE_WALL.line.start.y))

/** The Plan View's Skirting bodies: one path per derived run, so a broken face gives one record two. */
const skirtingBodies = (page: Page): Locator =>
  page.locator('[data-testid="floor-plan-canvas"] [data-ref-role="skirting"]')

/** One record's own strip, by id — the leftmost run of it is picked by `pickSkirting`. */
const skirtingBody = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="floor-plan-canvas"] [data-ref-role="skirting"][data-ref="${id}"]`).first()

/** How many records the Plan View is drawing, counted by the record each body belongs to. */
async function skirtingRecords(page: Page): Promise<number> {
  const refs = await skirtingBodies(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ref') ?? ''))
  return new Set(refs).size
}

/**
 * One click at the left end of `target`, where the Plan View's pane can reach it.
 *
 * The Flat is 9 m across and the pane is the column beside the Section, so a long run's middle lies
 * outside the pane at the opening zoom. The left end of anything drawn on `W-1` does not.
 */
async function clickInPane(page: Page, target: Locator): Promise<void> {
  const box = (await target.boundingBox())!
  await page.mouse.click(box.x + 30, box.y + box.height / 2)
}

/**
 * Whether the plan surface offers itself at this screen point, or something drawn over the Plan View
 * — an Elevation View's marker, say — is what a click there would really land on.
 */
function exposed(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(([px, py]) => {
    const top = document.elementFromPoint(px, py)
    if (top === null) return false
    if ((top.getAttribute('data-testid') ?? '').startsWith('elevation-')) return false
    return top.closest('[data-testid="floor-plan-canvas"]') !== null
  }, [x, y])
}

/**
 * The strip under the pointer, reached the way a person reaches it: a 15 mm strip lies under the run
 * of the 200 mm Wall it is skirted to, so where they overlap the first click takes the Wall and the
 * cycle moves on (#70 §18). The same point is clicked until the record that answers is `label` — a
 * different point starts the cycle again, which is why this never moves the pointer.
 */
async function pickSkirting(page: Page, body: Locator, label: string): Promise<void> {
  const id = (await body.getAttribute('data-ref'))!
  const field = page.getByTestId('skirting-field-label')
  const bodies = page.locator(`[data-testid="floor-plan-canvas"] [data-ref-role="skirting"][data-ref="${id}"]`)
  const boxes: { x: number; y: number; width: number; height: number }[] = []
  for (let at = 0; at < (await bodies.count()); at += 1) {
    const box = await bodies.nth(at).boundingBox()
    if (box !== null) boxes.push(box)
  }
  // The leftmost run first: it is the one the pane is sure to reach at the opening zoom.
  boxes.sort((a, b) => a.x - b.x)
  for (const box of boxes) {
    const y = box.y + box.height / 2
    for (let offset = 30; offset < box.width - 10; offset += 40) {
      const x = box.x + offset
      if (!(await exposed(page, x, y))) continue
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await page.mouse.click(x, y)
        if ((await field.isVisible()) && (await field.inputValue()) === label) return
      }
    }
  }
  throw new Error(`the Skirting ${id} (${label}) never answered the pointer on its own body`)
}

/**
 * The Skirting's row in the Section, reached the same way as in the Plan View: the row is painted at
 * its host Wall's depth, so the Wall it is skirted to is in the same stack and the cycle walks it
 * (#70 §18). The same point is clicked until the Skirting answers.
 */
async function pickSkirtingInSection(page: Page, row: Locator): Promise<void> {
  const box = (await row.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.mouse.click(x, y)
    if (await page.getByTestId('skirting-inspector').isVisible()) return
  }
  throw new Error('the Skirting never answered the pointer on its own Section row')
}

async function openPlan(page: Page): Promise<void> {
  await seedPreviewDb(page, seed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await expect(floorPlanCanvas(page)).toBeVisible()
}

test.describe('a Skirting', () => {
  test('skirts the whole face it was clicked on, and answers a click', async ({ page }) => {
    await openPlan(page)
    const before = await skirtingRecords(page)

    await page.getByTestId('tool-skirting').click()
    await expect(page.getByTestId('skirting-tool-layer')).toBeVisible()
    // The bar arrives with the two numbers the issue pre-fills, each captioned `measure yours`.
    await expect(page.getByTestId('skirting-draft-height')).toHaveValue('100')
    await expect(page.getByTestId('skirting-draft-thickness')).toHaveValue('15')
    await expect(page.getByTestId('skirting-draft-height-caption')).toHaveText('measure yours')
    await page.getByTestId('skirting-draft-height').fill('120')
    await page.getByTestId('skirting-draft-thickness').fill('20')

    // One click on the face, and the whole face is skirted — no second click to place an end.
    const face = page.getByTestId(`skirting-face-hit-${BARE_WALL.id}|${BARE_SIDE}`)
    await expect(face).toBeVisible()
    await clickInPane(page, face)
    await expect(page.getByTestId('skirting-tool-layer')).toHaveCount(0)

    await expect.poll(() => skirtingRecords(page)).toBe(before + 1)
    await expect(page.locator('[data-testid="floor-plan-canvas"] text', { hasText: 'Skirting SK-2' })).toBeVisible()

    await pickSkirting(page, skirtingBodies(page).last(), 'Skirting SK-2')
    await expect(page.getByTestId('skirting-field-label')).toHaveValue('Skirting SK-2')
    // The host and the face are named, never `L`/`R`: the Wall's reference on one row and the Room
    // the face borders on the next, or the face's own stable number where no Room claims it.
    await expect(page.getByTestId('skirting-field-wall')).toContainText('W-1')
    await expect(page.getByTestId('skirting-field-side')).toContainText('Kitchen side')
    await expect(page.getByTestId('skirting-field-side')).not.toContainText('left')
    // The range is the whole tidied face — the face as the joined Walls leave it, never a fixed
    // length — so it lies inside the Wall and gives up only what the Walls returning onto it take.
    const start = Number(await page.getByTestId('skirting-field-start').inputValue())
    const end = Number(await page.getByTestId('skirting-field-end').inputValue())
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeLessThanOrEqual(BARE_LENGTH)
    expect(end - start).toBeGreaterThan(BARE_LENGTH - 400)
    await expect(page.getByTestId('skirting-field-height')).toHaveValue('120')
    await expect(page.getByTestId('skirting-field-thickness')).toHaveValue('20')
    // The Top is the sum of Bottom and Height, printed and never a box of its own.
    await expect(page.getByTestId('skirting-field-top')).toContainText('120')
    // Gross and Net are both printed: the body minus whatever the derivation took out of it.
    await expect(page.getByTestId('skirting-field-gross')).not.toContainText('—')
    await expect(page.getByTestId('skirting-field-net')).not.toContainText('—')
  })

  test('puts the tool down on Escape with nothing written', async ({ page }) => {
    await openPlan(page)
    const before = await skirtingRecords(page)
    await page.getByTestId('tool-skirting').click()
    await expect(page.getByTestId('skirting-tool-layer')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('skirting-tool-layer')).toHaveCount(0)
    await expect(page.getByTestId('tool-skirting')).not.toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => skirtingRecords(page)).toBe(before)
  })

  test('flips to the other face, and fills the other face with a second record', async ({ page }) => {
    await openPlan(page)
    const before = await skirtingRecords(page)
    await pickSkirting(page, skirtingBody(page, SKIRTING_1), 'Skirting SK-1')
    await expect(page.getByTestId('skirting-field-label')).toHaveValue('Skirting SK-1')
    const side = (await page.getByTestId('skirting-field-side').textContent())!

    await page.getByTestId('skirting-flip-side').click()
    await expect(page.getByTestId('skirting-field-side')).not.toHaveText(side)

    // Two faces are two records, never one record with two faces (#78 criterion 6).
    await page.getByTestId('skirting-duplicate-other-side').click()
    await expect.poll(() => skirtingRecords(page)).toBe(before + 1)
    // The copy is a record of its own, with the next free label: picked off the surface, because
    // duplicating leaves the selection where it was.
    const copy = page.locator(
      `[data-testid="floor-plan-canvas"] [data-ref-role="skirting"]${SEEDED_IDS.map((id) => `:not([data-ref="${id}"])`).join('')}`,
    ).first()
    await pickSkirting(page, copy, 'Skirting SK-2')
    await expect(page.getByTestId('skirting-field-label')).toHaveValue('Skirting SK-2')
  })

  test('stands in the Section at the Bottom and Top the inspector prints', async ({ page }) => {
    await openPlan(page)
    await page.getByTestId('elevation-view-picker').selectOption(section.id)
    await expect(page.getByTestId('elevation-pane')).toBeVisible()

    // The same record, picked from the Section rather than the Plan View.
    const row = page.locator(`[data-testid="elevation-canvas"] [data-ref="${SKIRTING_1}"]`).first()
    await pickSkirtingInSection(page, row)
    await expect(page.getByTestId('skirting-inspector')).toBeVisible()
    await expect(page.getByTestId('skirting-field-label')).toHaveValue('Skirting SK-1')
    await expect(page.getByTestId('skirting-field-bottom')).toHaveValue('0')
    await expect(page.getByTestId('skirting-field-height')).toHaveValue('100')
    await expect(page.getByTestId('skirting-field-top')).toContainText('100')
  })

  test('is deleted and returned by one Undo, and offered to the export', async ({ page }) => {
    await openPlan(page)
    await page.getByTestId('export-open').click()
    await page.getByTestId('export-tab-lists').click()
    await expect(page.getByTestId('export-lists-rows-skirting')).toContainText('2')
    await page.getByTestId('export-lists-close').click()

    // The Section reaches the strip the Plan View paints under the Wall it is skirted to. Picked after
    // the export closed, because closing the dialog takes the selection back with it.
    await page.getByTestId('elevation-view-picker').selectOption(section.id)
    await pickSkirtingInSection(
      page,
      page.locator(`[data-testid="elevation-canvas"] [data-ref="${SKIRTING_1}"]`).first(),
    )
    await expect(page.getByTestId('skirting-inspector')).toBeVisible()

    await page.getByTestId('skirting-delete').click()
    await expect(page.getByTestId('skirting-inspector')).toHaveCount(0)
    await expect.poll(() => skirtingRecords(page)).toBe(1)

    await page.getByTestId('undo-button').click()
    await expect.poll(() => skirtingRecords(page)).toBe(2)
    await waitForFonts(page)
  })
})
