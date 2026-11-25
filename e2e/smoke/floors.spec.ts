import { expect, type Page, test } from '@playwright/test'
import {
  canonical,
  cardButton,
  downloadBackupOf,
  libraryHeading,
  restoreFile,
  storedRecord,
  toast,
} from '../support/libraryApp'
import { persistedPlacedItemTranslation } from '../support/seedPreviewDb'
import {
  activeFloor,
  addFloor,
  addFloorPlanObject,
  calibrateByMeasuring,
  FIRST_PROJECT,
  floorOptions,
  openManageFloors,
  openPreviewApp,
  placedObject,
  returnToProjects,
  showFloorPlan,
  undoButton,
  uploadPlanImage,
} from '../support/previewApp'

/**
 * Floors end to end (#56): the Manage Floors dialog, one Plan Image per Floor, calibration that
 * moves nothing already placed, the deletion that refuses, the duplicate that copies only what it
 * was asked for, and a two-Floor Project that survives Backup and Restore.
 *
 * The seeded Project is the one with a calibrated Plan Image — 256 × 192 px at 4 mm to the pixel —
 * so "this Floor has an image" is the starting state and "this one does not" is one `+ Floor`
 * away. The uploaded image is the seed's own asset: a real PNG the browser decodes for real.
 */

const PROJECT = FIRST_PROJECT
const RECORD = 'proj-kitchen-wall'
const FLOOR_ONE = 'Floor 1'

test.use({ viewport: { width: 1440, height: 1000 } })

const last = <T>(items: T[]): T => items[items.length - 1] as T

/**
 * Back into the Plan View after a reload.
 *
 * A reload either lands on the Project Library or goes straight back to the Project the session
 * had open, and the Plan View is where opening one lands now (#57) — so this is a wait, with the
 * Library card in front of it when the reload came back to the list.
 */
async function reopenFloorPlan(page: Page, name: string): Promise<void> {
  if (await libraryHeading(page).isVisible()) await cardButton(page, name, 'Open').click()
  await showFloorPlan(page)
}

// The stored record read as data, narrowed to what these criteria look at.
interface StoredFloor {
  id: string
  name: string
  planImage: { pixelsPerMm: number | null } | null
}

interface StoredPlacedItem {
  id: string
  floorId: string
  itemDesignId: string
  translation: { x: number; y: number }
}

function floorsOf(data: unknown): StoredFloor[] {
  return field<{ floors: StoredFloor[] }>(data).floors
}

function placedItemsOf(data: unknown): StoredPlacedItem[] {
  return field<{ existingModel: { placedItems: StoredPlacedItem[] } }>(data).existingModel.placedItems
}

function field<T>(data: unknown): T {
  if (typeof data !== 'object' || data === null) throw new Error('a Project record should hold an object')
  return data as T
}

/**
 * The Floor names on disk, in order — or null while nothing is written yet. Polling this to the
 * wanted value is how these tests know the session's write has landed.
 */
function storedFloorNames(page: Page): Promise<string[] | null> {
  return storedRecord(page, RECORD)
    .then((record) => record === null ? null : floorsOf(record.data).map((floor) => floor.name))
}

async function storedData(page: Page): Promise<unknown> {
  const record = await storedRecord(page, RECORD)
  if (record === null) throw new Error('the session wrote no record')
  return record.data
}

test('a Floor is added, renamed and reordered, and the rail and the disk follow', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  expect(await floorOptions(page)).toEqual([{ value: 'seed-001', label: FLOOR_ONE }])

  await openManageFloors(page)
  await page.getByTestId('add-floor').click()
  const added = last(await floorOptions(page))
  expect(added.label).toBe('Floor 2')

  // Renaming is the row's own field; the rail's switcher shows the same name.
  const name = page.getByTestId(`floor-name-${added.value}`)
  await name.fill('Kitchen level')
  await name.press('Enter')
  await expect(activeFloor(page)).toContainText('Kitchen level')

  // Two Floors cannot share a name, and a Floor cannot be nameless: the row says which, in
  // words, rather than eating the edit.
  await name.fill(FLOOR_ONE)
  await name.press('Enter')
  await expect(page.getByTestId(`floor-name-error-${added.value}`))
    .toHaveText(`Another Floor is already called ${FLOOR_ONE}`)
  await name.fill('   ')
  await name.press('Enter')
  await expect(page.getByTestId(`floor-name-error-${added.value}`)).toHaveText('Give this Floor a name')
  await name.fill('Kitchen level')
  await name.press('Enter')
  await expect(page.getByTestId(`floor-name-error-${added.value}`)).toHaveCount(0)

  // Reorder: the new Floor moves above the seeded one.
  await page.getByTestId(`floor-up-${added.value}`).click()
  await expect.poll(() => floorOptions(page)).toEqual([
    { value: added.value, label: 'Kitchen level' },
    { value: 'seed-001', label: FLOOR_ONE },
  ])

  await page.getByTestId('manage-floors-close').click()
  await expect.poll(() => storedFloorNames(page)).toEqual(['Kitchen level', FLOOR_ONE])

  // The order and the name are the document's, not the session's: a reload proves it.
  await page.reload({ waitUntil: 'networkidle' })
  await reopenFloorPlan(page, PROJECT)
  await expect.poll(() => floorOptions(page)).toEqual([
    { value: added.value, label: 'Kitchen level' },
    { value: 'seed-001', label: FLOOR_ONE },
  ])
})

test('each Floor has its own Plan Image, and an uncalibrated one says why', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)

  // The seeded Floor's image is calibrated: 4 mm to the pixel, in the Project's own unit.
  await expect(page.getByTestId('plan-image-scale')).toHaveText('Plan Image scale: 1 px = 4.00 mm')

  const second = await addFloor(page)

  // The new Floor has no Plan Image at all: no scale, nothing to show, and Upload offered —
  // Replace and Calibrate have nothing to act on.
  await expect(page.getByTestId('plan-image-scale')).toHaveCount(0)
  await page.getByTestId('plan-image-menu').click()
  await expect(page.getByTestId('upload-image')).toBeEnabled()
  await expect(page.getByTestId('replace-image')).toBeDisabled()
  await expect(page.getByTestId('calibrate-scale')).toBeDisabled()
  await page.keyboard.press('Escape')

  await uploadPlanImage(page)
  await expect(page.getByTestId('plan-image-scale')).toHaveText('Plan Image not calibrated')
  await expect(page.getByTestId('uncalibrated-hint')).toBeVisible()

  // Criterion 6: while the Floor is uncalibrated, the reason sits on the control that fixes it.
  await expect(page.getByTestId('calibrate-action')).toHaveAttribute(
    'title',
    "Calibrate this Floor's Plan Image to draw measured shapes",
  )

  await calibrateByMeasuring(page, 480)
  await expect(page.getByTestId('plan-image-scale')).toHaveText(/^Plan Image scale: 1 px = \d+\.\d\d mm$/)
  await expect(page.getByTestId('uncalibrated-hint')).toHaveCount(0)
  await expect(page.getByTestId('calibrate-action')).not.toHaveAttribute('title', /.*/)
  await expect.poll(() => storedFloorNames(page)).toEqual([FLOOR_ONE, 'Floor 2'])

  // Only this Floor's Plan Image was written; the seeded one is untouched.
  const [first, added] = floorsOf(await storedData(page))
  expect([first.name, first.planImage?.pixelsPerMm]).toEqual([FLOOR_ONE, 0.25])
  expect(added.id).toBe(second)
  expect(added.name).toBe('Floor 2')
  expect(added.planImage?.pixelsPerMm).toBeGreaterThan(0)

  // And the rail says the same thing about each Floor as the switcher moves between them.
  await activeFloor(page).selectOption('seed-001')
  await expect(page.getByTestId('plan-image-scale')).toHaveText('Plan Image scale: 1 px = 4.00 mm')
})

test('calibrating a Floor moves nothing that was already placed', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const second = await addFloor(page)
  await uploadPlanImage(page)

  const sofa = await addFloorPlanObject(page, 'Sofa 2-seater')
  const stored = () => persistedPlacedItemTranslation(page, RECORD, sofa)
  await expect.poll(stored).not.toBeNull()
  const atAdd = await stored()
  const box = await placedObject(page, sofa).boundingBox()

  await calibrateByMeasuring(page, 480)

  // The same millimetres in the same pixels: calibration rescales the drawing underneath, never
  // the Placed Items on top of it. The write to look at is the one calibration itself makes.
  const floors = () => storedRecord(page, RECORD)
    .then((record) => record === null ? null : floorsOf(record.data).find((floor) => floor.id === second)?.planImage?.pixelsPerMm ?? null)
  await expect.poll(floors).not.toBeNull()
  expect(await stored()).toEqual(atAdd)
  expect(await placedObject(page, sofa).boundingBox()).toEqual(box!)
})

test('a Floor with things on it cannot be deleted, and the dialog names them', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openManageFloors(page)

  await page.getByTestId('floor-delete-seed-001').click()
  await expect(page.getByTestId('delete-floor-dialog')).toBeVisible()
  await expect(page.getByTestId('delete-floor-confirm')).toBeDisabled()
  await expect(page.getByTestId('dependency-placedItems')).toContainText('Placed Item')
  await expect(page.getByTestId('dependency-planImage')).toContainText('Plan Image')
  await expect(page.getByTestId('dependency-planViews')).toContainText('Plan View')
  await expect(page.getByTestId('delete-floor-dialog'))
    .toContainText('Delete what is on this Floor first. Nothing is deleted or moved for you.')

  await page.getByTestId('delete-floor-cancel').click()
  await expect(page.getByTestId('delete-floor-dialog')).toHaveCount(0)
  expect(await floorOptions(page)).toHaveLength(1)

  // An empty Floor is deletable, and its default Plan View goes with it.
  await page.getByTestId('add-floor').click()
  const spare = last(await floorOptions(page))
  await page.getByTestId(`floor-delete-${spare.value}`).click()
  await expect(page.getByTestId('delete-floor-confirm')).toBeEnabled()
  await page.getByTestId('delete-floor-confirm').click()
  // Deleting closes the dialog with it: there is no row left to act on.
  await expect(page.getByTestId('delete-floor-dialog')).toHaveCount(0)
  await expect(page.getByTestId('manage-floors-dialog')).toHaveCount(0)
  await expect.poll(() => floorOptions(page)).toEqual([{ value: 'seed-001', label: FLOOR_ONE }])
  await expect.poll(() => storedFloorNames(page)).toEqual([FLOOR_ONE])
})

test('duplicating a Floor copies what was asked for and nothing else', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openManageFloors(page)

  await page.getByTestId('floor-duplicate-seed-001').click()
  await expect(page.getByTestId('duplicate-floor-dialog')).toBeVisible()
  // The Plan Image is the one thing never copied unless it is asked for.
  await expect(page.getByTestId('duplicate-include-plan-image')).not.toBeChecked()
  await page.getByTestId('duplicate-name').fill('Kitchen level copy')
  await page.getByTestId('duplicate-confirm').click()
  await expect(page.getByTestId('duplicate-floor-dialog')).toHaveCount(0)

  const copy = last(await floorOptions(page))
  expect(copy.label).toBe('Kitchen level copy')
  await page.getByTestId('manage-floors-close').click()
  await expect.poll(() => storedFloorNames(page)).toEqual([FLOOR_ONE, 'Kitchen level copy'])

  const data = await storedData(page)
  const duplicated = floorsOf(data).find((floor) => floor.id === copy.value)!
  expect(duplicated.planImage).toBeNull()

  // Every Placed Item came across, onto the new Floor, with its own id and the same position.
  const placed = placedItemsOf(data)
  const byDesign = (items: StoredPlacedItem[]): unknown[] => items
    .slice()
    .sort((a, b) => a.itemDesignId.localeCompare(b.itemDesignId))
    .map((item) => [item.itemDesignId, item.translation])
  const onSource = placed.filter((item) => item.floorId === 'seed-001')
  const onCopy = placed.filter((item) => item.floorId === copy.value)
  expect(byDesign(onCopy)).toEqual(byDesign(onSource))
  expect(onCopy.some((item) => onSource.some((each) => each.id === item.id))).toBe(false)

  // And the copy is looking at no Plan Image while the source still has its own.
  await activeFloor(page).selectOption(copy.value)
  await expect(page.getByTestId('plan-image-scale')).toHaveCount(0)
  await activeFloor(page).selectOption('seed-001')
  await expect(page.getByTestId('plan-image-scale')).toHaveText('Plan Image scale: 1 px = 4.00 mm')
})

test('undo goes back to the Floor the edit was about', async ({ page }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  const second = await addFloor(page)

  // A new Floor is the one the workspace is looking at, so the item lands on Floor 2.
  const sofa = await addFloorPlanObject(page, 'Sofa 2-seater')
  await activeFloor(page).selectOption('seed-001')
  await expect(placedObject(page, sofa)).toHaveCount(0)

  // Undo is the add, which belongs to Floor 2: the workspace goes there rather than undoing
  // something the user cannot see.
  await undoButton(page).click()
  await expect(activeFloor(page)).toHaveValue(second)
  await expect(placedObject(page, sofa)).toHaveCount(0)
})

test('a Project with two Floors and two Plan Images survives Backup and Restore', async ({ page, browser }) => {
  await openPreviewApp(page)
  await showFloorPlan(page)
  await openManageFloors(page)
  await page.getByTestId('add-floor').click()
  const second = last(await floorOptions(page))
  const name = page.getByTestId(`floor-name-${second.value}`)
  await name.fill('Loft')
  await name.press('Enter')
  await page.getByTestId('manage-floors-close').click()
  await uploadPlanImage(page)
  await calibrateByMeasuring(page, 480)
  await expect.poll(() => storedFloorNames(page)).toEqual([FLOOR_ONE, 'Loft'])

  const before = await storedRecord(page, RECORD)
  if (before === null) throw new Error('the session wrote no record')
  // The version this build writes: 4 since #64 gave a Project Walls, Wall Junctions and a
  // default Wall height, 5 since #65 gave it Openings, 6 since #66 gave it acknowledgements,
  // 7 since #67 gave it Rooms, 8 since #69/#71 gave it Design Options and Drawing Layers,
  // 9 and 10 since #74/#75 gave it Vertical Extents and Elevation Views, 11 since #76 gave Item
  // Designs a Clearance Envelope, 12 since #77 gave the Existing Model its Beams, 13 since #78
  // gave the Walls their Skirting, and 14 since #79 gave it Services.
  expect(before.schemaVersion).toBe(15)
  expect(last(floorsOf(before.data)).planImage?.pixelsPerMm).toBeGreaterThan(0)

  await returnToProjects(page)
  await expect(libraryHeading(page)).toBeVisible()
  const backup = await downloadBackupOf(page, PROJECT)

  const fresh = await browser.newContext()
  try {
    const restored = await fresh.newPage()
    await restored.goto('./', { waitUntil: 'networkidle' })
    await restoreFile(restored, backup)
    await expect(toast(restored)).toContainText(`Restored ${PROJECT} from Backup.`)
    const after = await storedRecord(restored, RECORD)
    if (after === null) throw new Error('the restore wrote no record')
    // Both sides are the version the app writes, so this is byte for byte: Floors and their
    // order, both Plan Images with their calibration, and every Plan View id.
    expect(after.schemaVersion).toBe(15)
    expect(canonical(after.data)).toBe(canonical(before.data))
  } finally {
    await fresh.close()
  }
})
