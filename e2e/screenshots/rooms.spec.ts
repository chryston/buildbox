import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures'
import { floorPlanCanvas, openProjectFromLibrary, showFloorPlan } from '../support/previewApp'
import { seedPreviewDb, type PreviewSeed } from '../support/seedPreviewDb'
import { waitForFonts, waitForStablePaint } from '../support/stability'

/**
 * Rooms photographed (#67 criteria 7 and 11).
 *
 * One frame that holds the four things a Room is: two Rooms on the Floor with their names
 * painted on them, the Kitchen's claimed Edges carrying their anchor chips in the inspector, and
 * a proposal that would take floor the Bedroom already holds — refused while it is drawn, the
 * shared area filled, the sentence on the bar and `Close` dimmed and unreachable.
 *
 * The proposal crosses the Bedroom rather than the Kitchen because the Kitchen is selected, and
 * arming the tool restates the selected Room: the Room being drawn is the one Room an overlap
 * check cannot report. The Bedroom is not, and the refusal is the same sentence either way.
 *
 * The scene is the #67 fixture (`scripts/make-rooms-scene-seed.ts`): Walls W-1…W-5, the Kitchen
 * as an L-shaped Custom Path with three Edges on Wall faces, and the Bedroom from the Rectangle
 * preset. The clock is frozen so the toolbar's save line cannot move between two runs.
 */

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const roomsSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'odd-shape-30.json'), 'utf8'),
) as PreviewSeed
const projectName = roomsSeed.library.find((record) => record.id === roomsSeed.projects[0]!.id)!.name
const FIXED_NOW = '2026-01-01T09:00:00+08:00'

type Pt = { x: number, y: number }

/** Where a Floor point is on the screen, through the Plan View's own transform. */
async function at(page: Page, mm: Pt): Promise<Pt> {
  const canvas = floorPlanCanvas(page)
  const box = await canvas.boundingBox()
  const matrix = /matrix\(([^,]+),0,0,[^,]+,([^,]+),([^)]+)\)/
    .exec(await canvas.locator('g').first().getAttribute('transform') ?? '')
  if (box === null || matrix === null) throw new Error('the Plan View has no scene to click in')
  return { x: box.x + mm.x * Number(matrix[1]) + Number(matrix[2]), y: box.y + mm.y * Number(matrix[1]) + Number(matrix[3]) }
}

async function clickMm(page: Page, mm: Pt): Promise<void> {
  const p = await at(page, mm)
  await page.mouse.click(p.x, p.y)
}

test('a Room selected and an Outline refused', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await seedPreviewDb(page, roomsSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, projectName)
  await showFloorPlan(page)
  // The fixture's Plan Image is a scanned photograph; behind a hairline refusal sentence and a
  // dashed hairline it is noise. The Room state is the subject, so the drawing is switched off —
  // a production state of its own, reached the way a user reaches it.
  await page.getByRole('checkbox', { name: 'Show Plan Image' }).uncheck()

  // The Kitchen, so the inspector opens on a Room whose Edges are claimed: the anchor badge
  // marks the Edge that stands on W-1's Room-side face.
  await clickMm(page, { x: 1500, y: 2000 })
  await expect(page.getByTestId('room-inspector')).toBeVisible()
  await expect(page.getByTestId('room-edge-anchor-seed-room-013')).toBeVisible()

  // A proposal across the Bedroom, drawn to the last corner and left standing. The Kitchen is
  // the Room being restated by the tool, so it is the one Room this draft cannot overlap-report;
  // the Bedroom is, and the refusal is the same sentence either way.
  await page.getByTestId('shapes-menu').click()
  await page.getByTestId('draw-line').click()
  await clickMm(page, { x: 6500, y: 1000 })
  await clickMm(page, { x: 9000, y: 1000 })
  await clickMm(page, { x: 9000, y: 2500 })
  await clickMm(page, { x: 8000, y: 3500 })
  await clickMm(page, { x: 6500, y: 2500 })
  // Park the pointer off the canvas: the draft reads the live pointer (the chip, and the
  // provisional corner the overlap is measured with), and where a click leaves it differs per
  // runner (#138). With no pointer the draft is only its committed corners.
  await page.mouse.move(5, 5)

  await expect(page.getByTestId('room-draft-blocked')).toContainText('Overlaps Bedroom by')
  await expect(page.getByTestId('room-draft-close')).toBeDisabled()
  await expect(page.getByTestId('room-inspector')).toBeVisible()

  await waitForFonts(page)
  await waitForStablePaint(page.getByTestId('room-draft-blocked'))
  // The draft chip reads the live pointer (length · angle from the last corner); where the pointer
  // rests after the last click is not part of the Room state under test and differs per runner.
  await expect(page).toHaveScreenshot('rooms-refused-outline-with-anchor-badge.png', {
    mask: [page.getByTestId('room-draft-chip')],
  })
})
