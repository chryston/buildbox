import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { previewSeed, storedProject } from '../support/libraryApp'
import {
  addFloorPlanObject,
  cabinetCanvas,
  dragBy,
  openItemDetail,
  openPreviewApp,
  placedObject,
  showFloorPlan,
} from '../support/previewApp'
import { persistedPlacedItemTranslation } from '../support/seedPreviewDb'

/**
 * The one drawing behind both surfaces (#60 criterion 17).
 *
 * The Plan View and the Item Detail are drawn by the same display list now, which means the
 * interactions that used to live in each canvas live in one place — and that a change to it can
 * silently take a control away from both at once. A screenshot cannot catch that: a handle that
 * no longer answers a pointer looks exactly like a handle that does. So these tests press the
 * real things and read back what the Project ended up holding.
 *
 * Every selector is a `data-testid` the display list itself writes, which is the other half of
 * the criterion: the names the suite selected on before the switch still name the same shapes.
 */

const recordId = previewSeed.projects[0]!.id

/** The millimetre field a dimension label opens — a portal on `document.body`, not in the SVG. */
const mmField = (page: Page): Locator => page.getByTestId('dimension-editor')

/**
 * A point a section actually answers at.
 *
 * A section is the rectangle underneath everything it contains — the drawer fronts, the pulls,
 * the words — so its centre belongs to whatever is painted on top of it. That was true of the
 * canvas this replaced and it is true of this one, so the test looks for a pixel the section is
 * the topmost element at, which is where a person aiming at a section would click.
 */
const openPointOf = (target: Locator): Promise<{ x: number; y: number }> =>
  target.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const spots = [
      [0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85],
      [0.5, 0.08], [0.08, 0.5], [0.92, 0.5], [0.5, 0.92],
    ]
    for (const [fx, fy] of spots) {
      const x = box.x + box.width * fx
      const y = box.y + box.height * fy
      if (document.elementFromPoint(x, y) === node) return { x, y }
    }
    throw new Error(`nothing on ${node.getAttribute('data-testid')} is topmost`)
  })

/** Every `splitRatio` the stored Project holds, in document order. */
const storedRatios = async (page: Page): Promise<unknown> => {
  const project = await storedProject(page, recordId)
  return JSON.stringify(project).match(/"splitRatio":[0-9.eE+-]+/g) ?? []
}

test.describe('the Item Detail drawn from the display list', () => {
  test.beforeEach(async ({ page }) => {
    await openPreviewApp(page)
    await showFloorPlan(page)
    await openItemDetail(page, 'seed-002')
    await expect(cabinetCanvas(page)).toBeVisible()
  })

  test('names every unit and every section it draws', async ({ page }) => {
    // One group per unit, each saying which unit it holds: the group a click lands on.
    await expect(page.getByTestId('unit-group')).toHaveCount(2)
    const ids = await page.locator('[data-unit-id]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-unit-id')))
    expect(ids).toEqual(['unit-kitchen-base', 'unit-kitchen-tall'])
    // Five sections in each of them, and the words that go with the sections and the dividers.
    await expect(page.locator('[data-testid^="void-"]')).toHaveCount(10)
    await expect(page.locator('[data-testid^="divider-"]')).toHaveCount(8)
    await expect(page.locator('[data-testid^="dim-label-"]')).toHaveCount(20)
    await expect(page.locator('[data-testid^="space-label-"]')).toHaveCount(10)
  })

  test('a section answers a click, and the drawing says it is selected', async ({ page }) => {
    const section = page.getByTestId('void-unit-kitchen-base-drawers')
    await expect(section).toHaveAttribute('stroke', 'transparent')

    const at = await openPointOf(section)
    await page.mouse.click(at.x, at.y)
    // Emphasis is a style the drawing picks, not a class the host adds: the selected section is
    // stroked with the accent, on the same element the click landed on.
    await expect(section).toHaveAttribute('stroke', '#7c3aed')
    // A neighbour is untouched by it.
    await expect(page.getByTestId('void-unit-kitchen-base-hanging'))
      .toHaveAttribute('stroke', 'transparent')
    // And the divider that bounds it is stroked the same way, because the section above a
    // divider is what selects it.
    await expect(page.getByTestId('divider-unit-kitchen-base-drawers-divider'))
      .toHaveAttribute('stroke', '#7c3aed')
  })

  test('a dimension label opens the field and Enter writes one Edit Transaction', async ({ page }) => {
    const label = page.getByTestId('dim-label-unit-kitchen-base-drawers-w')
    const before = await label.textContent()
    expect(before).not.toBeNull()

    await label.click()
    const field = mmField(page)
    await expect(field).toBeVisible()
    await field.fill('300')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect(label).not.toHaveText(before as string)

    // One step back, not several: typing a number is one transaction, so a single undo returns
    // the section to the width it had.
    await page.keyboard.press('Control+z')
    await expect(label).toHaveText(before as string)
  })

  test('a locked section shows its padlock and refuses the field', async ({ page }) => {
    // A section whose size is fixed by what surrounds it cannot be typed into. The padlock is
    // how the drawing says so — it is drawn by the list, not pasted over it — and the label that
    // carries one is faded rather than underlined.
    const locked = page.getByTestId('dim-label-unit-kitchen-base-microwave-w')
    await expect(locked).toHaveAttribute('opacity', '0.4')
    const id = await locked.evaluate((node) => node.getAttribute('data-ref'))
    expect(id).not.toBeNull()
    await expect(page.getByTestId(`lock-icon-${id}-w`)).toBeVisible()

    await locked.click()
    await expect(mmField(page)).toHaveCount(0)
  })

  test('dragging a divider handle is one Edit Transaction', async ({ page }) => {
    const handle = page.getByTestId('drag-handle-unit-kitchen-base-drawers-divider')
    await expect(handle).toBeVisible()
    const before = await storedRatios(page)

    await dragBy(page, handle, 30, 0)
    // The drag wrote the Project once, on pointer-up: eight pointer moves and no keystroke.
    const moved = await storedRatios(page)
    expect(moved).not.toEqual(before)
    const changed = (before as string[]).filter((each, i) => each !== (moved as string[])[i])
    expect(changed).toHaveLength(1)

    // One undo returns every ratio, which is what one transaction means.
    await page.keyboard.press('Control+z')
    await expect.poll(() => storedRatios(page)).toEqual(before)
  })

  test('every unit carries its own handles, not only the one being edited', async ({ page }) => {
    // The tall unit is not active and its dividers are still draggable: pressing one is how it
    // becomes active, so a handle that only appeared afterwards would be a control hiding itself.
    await expect(page.getByTestId('drag-handle-unit-kitchen-base-drawers-divider')).toBeVisible()
    await expect(page.getByTestId('drag-handle-unit-kitchen-tall-drawers-divider')).toBeVisible()
    await expect(page.getByTestId('drag-handle-unit-kitchen-tall-hanging-divider')).toBeVisible()
    await expect(page.locator('[data-testid^="drag-handle-"]')).toHaveCount(8)
  })
})

test.describe('the Plan View drawn from the same list', () => {
  test.beforeEach(async ({ page }) => {
    await openPreviewApp(page)
    await showFloorPlan(page)
  })

  test('a drag moves the footprint and writes one Edit Transaction on pointer-up', async ({ page }) => {
    const id = await addFloorPlanObject(page, 'Sofa 2-seater')
    const footprint = placedObject(page, id)
    // The footprint is the display list's own element, named by the placement it draws.
    await expect(footprint).toHaveAttribute('data-ref-role', 'placed-item')

    const stored = () => persistedPlacedItemTranslation(page, recordId, id)
    await expect.poll(stored).not.toBeNull()
    const atAdd = await stored()

    await dragBy(page, footprint, 40, 20)
    await expect.poll(stored).not.toEqual(atAdd)

    // The whole drag was one step: the pointer went down, moved eight times and came up, and
    // only the coming-up wrote. One undo returns the placement to where it was added.
    await page.keyboard.press('Control+z')
    await expect.poll(stored).toEqual(atAdd)
  })
})
