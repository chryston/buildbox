import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { seedPreviewDb, type PreviewSeed } from './seedPreviewDb'

/**
 * The pieces the `projects-v2` smoke specs share (#49): open the flag-on build against the
 * seeded preview database, and drive the two views it renders.
 */

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

/** The converted v3 legacy fixture: Kitchen Wall (with the floor plan) and Bathroom Vanity. */
export const previewSeed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'legacy-v3.json'), 'utf8'),
) as PreviewSeed

export const cabinetCanvas = (page: Page): Locator => page.getByTestId('cabinet-canvas')
export const floorPlanCanvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')

/** Load the app and wait for the cabinet view of the Project the database lists first. */
export async function openPreviewApp(page: Page): Promise<void> {
  await seedPreviewDb(page, previewSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await expect(cabinetCanvas(page)).toBeVisible()
}

export async function showFloorPlan(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Floor Plan', exact: true }).click()
  await expect(floorPlanCanvas(page)).toBeVisible()
}

/** The ids of the Placed Items the floor plan is showing, in render order. */
export async function floorPlanObjectIds(page: Page): Promise<string[]> {
  return floorPlanCanvas(page)
    .locator('[data-testid^="placed-object-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')!.slice('placed-object-'.length)))
}

/** Click a catalog button in the floor-plan sidebar and wait for its object to appear. */
export async function addFloorPlanObject(page: Page, label: string): Promise<string> {
  const before = await floorPlanObjectIds(page)
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect.poll(() => floorPlanObjectIds(page), { message: `${label} was not placed` }).toHaveLength(before.length + 1)
  return (await floorPlanObjectIds(page)).find((id) => !before.includes(id)) as string
}

export const placedObject = (page: Page, id: string): Locator => page.getByTestId(`placed-object-${id}`)

/** Drag an object by a screen offset, the way a pointer does it: down, moves, up. */
export async function dragBy(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  const box = await target.boundingBox()
  if (box === null) throw new Error('the placed object has no box to drag from')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

/** The toolbar's Undo button; its disabled state is the observable history state. */
export const undoButton = (page: Page): Locator => page.getByRole('button', { name: 'Undo' })
export const redoButton = (page: Page): Locator => page.getByRole('button', { name: 'Redo' })

/** The save status the session reports (#14), rendered before Undo in the toolbar. */
export const saveStatus = (page: Page): Locator => page.getByRole('status')

/**
 * Select a Project by its tab and wait for the view to follow. A Project with no cabinet
 * design has no cabinet canvas, and switching Projects keeps the module the user is in, so
 * the view following means one of the two canvases is on screen again.
 */
export async function openProjectTab(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  await expect(cabinetCanvas(page).or(floorPlanCanvas(page)).first()).toBeVisible()
}
