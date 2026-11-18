import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { cardButton, libraryHeading, previewSeed } from './libraryApp'
import { seedPreviewDb } from './seedPreviewDb'

/**
 * The pieces the Project smoke specs share (#49): open the app against the
 * seeded preview database, and drive the two views it renders.
 */

/**
 * The Project every one of these specs edits. The specs assert against
 * `previewSeed.projects[0]`'s revision, so this resolves that record's own name rather than
 * trusting the Library to list it first — the grid is ordered by `savedAt`, not by id.
 */
export const FIRST_PROJECT = previewSeed.library.find((record) => record.id === previewSeed.projects[0]!.id)!.name

export const cabinetCanvas = (page: Page): Locator => page.getByTestId('cabinet-canvas')
export const floorPlanCanvas = (page: Page): Locator => page.getByTestId('floor-plan-canvas')

/**
 * Load the app and reach the cabinet view of the Project the database lists first.
 *
 * The app opens on the Project Library (#50), so getting to an editor is two steps
 * now: land on the Library, then open the Project. Which Project is not left to chance — the
 * specs assert against `previewSeed.projects[0]`'s revision, so this opens that one by name.
 */
export async function openPreviewApp(page: Page): Promise<void> {
  await seedPreviewDb(page, previewSeed)
  await page.goto('./', { waitUntil: 'networkidle' })
  await openProjectFromLibrary(page, FIRST_PROJECT)
}

/** Open one Project from the Library and wait for its cabinet view. */
export async function openProjectFromLibrary(page: Page, name: string): Promise<void> {
  await expect(libraryHeading(page)).toBeVisible()
  await cardButton(page, name, 'Open').click()
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

/** Open `Add item ▾` in the workspace toolbar and wait for its object to appear (#55). */
export async function addFloorPlanObject(page: Page, label: string): Promise<string> {
  const before = await floorPlanObjectIds(page)
  await page.getByTestId('add-item-menu').click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
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
 * The toolbar's save line, exactly.
 *
 * `saveStatus` asks for the `status` role, which is right until a modal is up: a dialog body is
 * an `aria-live` region and the accessibility tree calls that a status too, so the role matches
 * both. Specs that assert the line while the Save failed dialog is open need the element itself.
 */
export const toolbarStatus = (page: Page): Locator => page.locator('span[role="status"]')

/**
 * The page's own switch, read by the patched `IDBObjectStore` methods above. A window property
 * rather than a closure because the init script and the test body are separate scripts.
 */
interface QuotaFlaggedWindow {
  quotaIsFull?: boolean
}

/**
 * Make every IndexedDB write in the page come back `QuotaExceededError` (#51 criterion 10).
 *
 * CDP `Storage.overrideQuotaForOrigin` was the first attempt and is dead: Chromium applies it to
 * `navigator.storage.estimate()` only, and an IndexedDB write against the overridden origin still
 * succeeds — the probe that proved it is in the history of this file. So the quota is failed where
 * a full disk fails it, on the write request itself, and the app's own error mapping
 * (`persistence/indexeddb/errors.ts`) turns it into the `quota` save failure like any other.
 *
 * The patch is installed as an init script so a reload keeps it, and starts disarmed: the seeder
 * registers its own init script first and has to be able to write.
 */
export async function quotaOverride(page: Page, full: boolean): Promise<void> {
  // An init script only runs in documents that have not loaded yet, so the patch is also applied
  // to the one that is already up: the spec arms the quota after the Project is open.
  await page.addInitScript(installQuotaPatch)
  await page.evaluate(installQuotaPatch)
  await page.evaluate((value) => {
    const flagged = window as QuotaFlaggedWindow
    flagged.quotaIsFull = value
  }, full)
}

function installQuotaPatch(): void {
  const flagged = window as QuotaFlaggedWindow
  if (flagged.quotaIsFull !== undefined) return
  flagged.quotaIsFull = false
  for (const method of ['put', 'add'] as const) {
    const original = IDBObjectStore.prototype[method]
    IDBObjectStore.prototype[method] = function patched(
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (flagged.quotaIsFull === true) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      return original.apply(this, args as Parameters<IDBObjectStore['put']>)
    }
  }
}

/**
 * Leave the editor for the Project Library. This closes the session, which is what releases its
 * Web Lock and lets a card open any Project (#53).
 */
export async function returnToProjects(page: Page): Promise<void> {
  await page.getByTestId('return-to-projects').click()
  await expect(libraryHeading(page)).toBeVisible()
}

/**
 * Switch to another Project: back to the Project Library, then open that one by name. Since #53
 * the editor holds exactly one Project and has no switcher of its own, so a Project switch is a
 * Library round trip. Which module is on screen is UI state and not Project state, so the floor
 * plan stays up across the trip; a Project with no cabinet design has no cabinet canvas, so
 * "switched" means one of the two canvases is on screen again.
 */
export async function openProjectTab(page: Page, name: string): Promise<void> {
  await returnToProjects(page)
  await cardButton(page, name, 'Open').click()
  await expect(cabinetCanvas(page).or(floorPlanCanvas(page)).first()).toBeVisible()
}

// ——— Floors (#56) ———

/** The rail's Floor switcher. */
export const activeFloor = (page: Page): Locator => page.getByTestId('floor-select')

/** Every Floor the Project has, in order, by id and by name. */
export function floorOptions(page: Page): Promise<{ value: string; label: string }[]> {
  return activeFloor(page).locator('option')
    .evaluateAll((nodes) => nodes.map((node) => ({
      value: node.getAttribute('value') ?? '',
      label: node.textContent ?? '',
    })))
}

/**
 * Open the Manage Floors dialog.
 *
 * The rail that holds it is part of the Plan View, so this is only reachable from there.
 */
export async function openManageFloors(page: Page): Promise<void> {
  await expect(activeFloor(page)).toBeVisible()
  await page.getByTestId('manage-floors').click()
  await expect(page.getByTestId('manage-floors-dialog')).toBeVisible()
}

/**
 * Add a Floor from the dialog and close it, handing back the new Floor's id.
 *
 * The workspace follows a new Floor to it — the same thing it does when a person adds one — so
 * whatever the caller does next happens on the Floor it just made.
 */
export async function addFloor(page: Page): Promise<string> {
  await openManageFloors(page)
  await page.getByTestId('add-floor').click()
  const added = (await floorOptions(page)).slice(-1)[0]!
  await page.getByTestId('manage-floors-close').click()
  await expect(activeFloor(page)).toHaveValue(added.value)
  return added.value
}

/** The Plan Image the seed carries, as the file a person would have chosen. */
export function seedPlanImageFile(): { name: string; mimeType: string; buffer: Buffer } {
  const asset = previewSeed.assets[0]
  return { name: 'floor-plan.png', mimeType: asset.mediaType, buffer: Buffer.from(asset.base64, 'base64') }
}

/** Choose a Plan Image through the toolbar's own menu, the way a person does. */
export async function uploadPlanImage(page: Page, file = seedPlanImageFile()): Promise<void> {
  await page.getByTestId('plan-image-menu').click()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('upload-image').click(),
  ])
  await chooser.setFiles(file)
}

/**
 * Measure a known distance on the Plan Image: two points 120 screen px apart, then the real
 * length they stand for. What the camera makes of those pixels is its own business — the scale
 * that comes out is the one the measurement means, which is the point of calibrating this way.
 */
export async function calibrateByMeasuring(page: Page, realMm: number): Promise<void> {
  await page.getByTestId('calibrate-now').click()
  await expect(page.getByTestId('calibration-overlay')).toBeVisible()
  const box = (await floorPlanCanvas(page).boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.click(box.x + box.width / 2 - 60, y)
  await page.mouse.click(box.x + box.width / 2 + 60, y)
  await expect(page.getByTestId('calibration-modal')).toBeVisible()
  await page.getByTestId('calibration-distance').fill(String(realMm))
  await page.getByTestId('calibration-confirm').click()
  await expect(page.getByTestId('calibration-modal')).toHaveCount(0)
}
