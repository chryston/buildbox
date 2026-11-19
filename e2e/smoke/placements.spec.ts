import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { canonical, previewSeed, storedProject } from '../support/libraryApp'
import {
  addFloorPlanObject,
  dragBy,
  FIRST_PROJECT,
  floorPlanCanvas,
  openPreviewApp,
  openProjectFromLibrary,
  placedObject,
  revealOnCanvas,
  showFloorPlan,
} from '../support/previewApp'
import { persistedPlacedItemTranslation } from '../support/seedPreviewDb'

/**
 * Placed Items on the Plan View (#57): turning an item about its Item Origin, the numbers the
 * canvas shows while it is selected, picking the origin on the canvas, and what a shared Item
 * Design does when one placement of several is edited.
 *
 * These are the behaviours a screenshot cannot check — the rotation the Project ends up
 * holding, that a drag is one undo step, that a preview touches every placement of the design
 * and nothing else — so they live in the smoke suite next to the other Plan View tests.
 */

const rotation = (page: Page) => page.getByTestId('inspector-rotation')

/** The Item Origin crosshairs, as `x,y` per placement, in render order. */
const origins = (page: Page) => page
  .locator('[data-testid^="origin-marker-"]')
  .evaluateAll((nodes) => nodes.map((node) => `${node.dataset.x},${node.dataset.y}`))

/** The menu names a design with its own words; `Sofa (3-seat)` has to stay literal. */
const escapeForName = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A second placement of the design the last add made: `Add item` → `In this Project`, which
 * reuses that design instead of minting another copy of the catalogue entry.
 */
async function placeAgain(page: Page, label: string): Promise<string> {
  const placed = page.locator('[data-testid^="placed-object-"]')
  const before = await placed.count()
  await page.getByTestId('add-item-menu').click()
  await page.getByRole('button', { name: new RegExp(escapeForName(label)) }).click()
  await expect(placed).toHaveCount(before + 1)
  const ids = await placed.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-testid')!.slice('placed-object-'.length)))
  return ids[ids.length - 1] as string
}

test.describe('a Placed Item on the Plan View', () => {
  test.beforeEach(async ({ page }) => {
    await openPreviewApp(page)
    await showFloorPlan(page)
  })

  test('the rotate handle turns it about its Item Origin in one undo step', async ({ page }) => {
    const id = await addFloorPlanObject(page, 'Sofa 2-seater')
    const origin = page.getByTestId(`origin-marker-${id}`)
    const start = await rotation(page).inputValue()
    const originBefore = await origin.evaluate((node) => [node.dataset.x, node.dataset.y])
    const handle = page.getByTestId('rotate-handle')
    await revealOnCanvas(page, handle)
    const at = await origin.boundingBox()
    expect(at).not.toBeNull()

    // The handle straight above the Item Origin, dragged to level with it on the right: that
    // is a quarter turn, and the only thing it can turn about is the Item Origin.
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(at!.x + at!.width / 2 + 160, at!.y + at!.height / 2, { steps: 8 })
    await page.mouse.up()

    await expect(rotation(page)).toHaveValue('90')
    // The one point the turn happens about does not move.
    expect(await origin.evaluate((node) => [node.dataset.x, node.dataset.y])).toEqual(originBefore)

    await page.keyboard.press('Control+z')
    await expect(rotation(page)).toHaveValue(start)
  })

  test('the quarter turns wrap through zero, from the buttons and from [ and ]', async ({ page }) => {
    await addFloorPlanObject(page, 'Sofa 2-seater')
    await rotation(page).fill('350')
    await rotation(page).press('Enter')
    await expect(rotation(page)).toHaveValue('350')
    await page.getByTestId('rotate-plus-90').click()
    await expect(rotation(page)).toHaveValue('80')

    await rotation(page).fill('10')
    await rotation(page).press('Enter')
    await page.getByTestId('rotate-minus-90').click()
    await expect(rotation(page)).toHaveValue('280')

    await page.keyboard.press(']')
    await expect(rotation(page)).toHaveValue('10')
    await page.keyboard.press('[')
    await expect(rotation(page)).toHaveValue('280')
  })

  test('the labels stay upright while the Floor bounds grow with the turn', async ({ page }) => {
    const id = await addFloorPlanObject(page, 'Sofa 2-seater')
    const layer = page.getByTestId('plan-text-layer')
    // No text is inside the rotated group, so none of it can read upside down at 180°.
    expect(await layer.evaluate((node) => node.getAttribute('transform'))).toBeNull()
    await expect(page.getByTestId('dimension-width')).toBeVisible()
    await expect(page.getByTestId('dimension-depth')).toBeVisible()
    await expect(page.getByTestId('dimension-width-line')).toHaveCount(1)
    await expect(page.getByTestId('dimension-depth-line')).toHaveCount(1)
    const chip = page.getByTestId('floor-bounds-chip')
    await expect(chip).toBeVisible()
    // The chip is an SVG group, so its text is read as textContent, not innerText.
    const chipText = () => chip.evaluate((node) => node.textContent ?? '')
    const at0 = await chipText()

    await page.getByTestId('rotate-plus-90').click()
    expect(await chipText()).not.toBe(at0)

    await rotation(page).fill('180')
    await rotation(page).press('Enter')
    await expect(page.getByTestId(`item-label-${id}`)).toBeVisible()
    expect(await layer.evaluate((node) => node.getAttribute('transform'))).toBeNull()
  })

  test('picking the origin on the canvas previews it before anything is written', async ({ page }) => {
    const id = await addFloorPlanObject(page, 'Sofa 2-seater')
    const footprint = page.getByTestId(`placed-object-${id}`)
    await revealOnCanvas(page, footprint)
    const box = await footprint.boundingBox()
    expect(box).not.toBeNull()

    await page.getByTestId('origin-pick').click()
    // The next click on the selected placement is a pick, not a move: it opens the preview and
    // snaps to the footprint vertex under the pointer (#57 criterion 11).
    await page.mouse.click(box!.x + 8, box!.y + 8)
    await expect(page.getByTestId('selection-inspector')).toBeVisible()
    await expect(page.getByTestId('design-preview')).toBeVisible()
    await expect(page.getByTestId('affects-count')).toHaveText('Affects 1 placement')
    await expect(page.getByTestId(`origin-preview-${id}`)).toBeVisible()

    await page.getByTestId('preview-cancel').click()
    await expect(page.getByTestId('design-preview')).toHaveCount(0)
    // Cancelling wrote nothing: the item is where it was and no history step exists.
    await expect(rotation(page)).toHaveValue('0')

    await page.getByTestId('origin-pick').click()
    await page.mouse.click(box!.x + 8, box!.y + 8)
    await page.getByTestId('preview-apply').click()
    await expect(page.getByTestId('design-preview')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('design-preview')).toHaveCount(0)
  })

  test('a new Item Origin previews on every placement and applies as one step', async ({ page }) => {
    const first = await addFloorPlanObject(page, 'Sofa 2-seater')
    const second = await placeAgain(page, 'Sofa 2-seater')
    const before = await origins(page)

    await page.getByTestId('origin-bottom-left').click()
    await expect(page.getByTestId('design-preview')).toBeVisible()
    await expect(page.getByTestId('affects-count')).toHaveText('Affects 2 placements')
    // D3: the person sees the new origin on each of them before committing to anything.
    await expect(page.getByTestId(`origin-preview-${first}`)).toBeVisible()
    await expect(page.getByTestId(`origin-preview-${second}`)).toBeVisible()
    await page.getByTestId('preview-cancel').click()
    await expect(page.getByTestId('design-preview')).toHaveCount(0)
    expect(await origins(page)).toEqual(before)

    await page.getByTestId('origin-bottom-left').click()
    await page.getByTestId('preview-apply').click()
    await expect(page.getByTestId('design-preview')).toHaveCount(0)
    const applied = await origins(page)
    expect(applied).not.toEqual(before)

    await page.keyboard.press('Control+z')
    expect(await origins(page)).toEqual(before)
  })

  test('forking gives this placement a design of its own', async ({ page }) => {
    await addFloorPlanObject(page, 'Sofa 2-seater')
    await placeAgain(page, 'Sofa 2-seater')
    const title = page.getByTestId('item-design-title')
    const shared = (await title.innerText()).toLowerCase()
    expect(shared).toContain('shared by 2 placements')

    await page.getByTestId('fork-design').click()
    await expect(page.getByTestId('fork-design-dialog')).toBeVisible()
    await expect(page.getByTestId('fork-design-note')).toHaveText('Only this placement will use the new design.')
    await page.getByTestId('fork-design-confirm').click()

    const own = (await title.innerText()).toLowerCase()
    expect(own).not.toBe(shared)
    expect(own).toContain('sofa 2-seater')
    expect(own).toContain('shared by 1 placement')
    // One Edit Transaction: undo puts the placement back on the design it shared.
    await page.keyboard.press('Control+z')
    expect((await title.innerText()).toLowerCase()).toContain('shared by 2 placements')
  })
})

/**
 * The two migrated cabinet units of the seeded Kitchen Wall are Placed Items like any other
 * (#57 criterion 18): each one turns and moves on the Floor on its own, and the Floor keeps both.
 */
test.describe('the migrated cabinet units', () => {
  test('move and turn independently on the Floor and survive a reload', async ({ page }) => {
    const recordId = previewSeed.projects[0]!.id
    const base = placedObject(page, 'seed-002')
    const tall = placedObject(page, 'seed-003')
    const stored = (id: string) => persistedPlacedItemTranslation(page, recordId, id)

    await openPreviewApp(page)
    const baseAt = await stored('seed-002')
    const tallAt = await stored('seed-003')
    expect(baseAt).not.toBeNull()

    await revealOnCanvas(page, base)
    await base.click()
    await expect(page.getByTestId('inspector-design-label')).toContainText('Base Unit')
    await page.getByTestId('rotate-plus-90').click()
    await expect(rotation(page)).toHaveValue('90')
    await dragBy(page, base, 40, 60)
    await expect.poll(() => stored('seed-002')).not.toEqual(baseAt)

    // The other unit is untouched by its neighbour's edit: same place, same turn.
    expect(await stored('seed-003')).toEqual(tallAt)
    await revealOnCanvas(page, tall)
    await tall.click()
    await expect(rotation(page)).toHaveValue('0')

    await page.reload({ waitUntil: 'networkidle' })
    await openProjectFromLibrary(page, FIRST_PROJECT)
    await revealOnCanvas(page, base)
    await base.click()
    await expect(rotation(page)).toHaveValue('90')
    expect(await stored('seed-002')).not.toEqual(baseAt)
    await revealOnCanvas(page, tall)
    await tall.click()
    await expect(rotation(page)).toHaveValue('0')
    expect(await stored('seed-003')).toEqual(tallAt)
  })
})

/**
 * Item Detail as the way between the two views (#57 §6, §7): opening a design shows that design,
 * its `Placements` list says where it is used, and both ways out are navigation — the Project
 * does not change and nothing enters history.
 */
test.describe('Item Detail', () => {
  test.beforeEach(async ({ page }) => {
    await openPreviewApp(page)
    await showFloorPlan(page)
  })

  test('opens from a selected Placed Item and lists every placement of its design', async ({ page }) => {
    // A second placement of the same design, so the list has more than one row to show.
    const second = await placeAgain(page, 'Sofa (3-seat)')

    await placedObject(page, 'fp-sofa').click()
    const position = await page.getByTestId('inspector-position-x').inputValue()
    await page.getByTestId('open-item-detail').click()
    await expect(page.getByTestId('item-detail-view')).toBeVisible()
    // The Plan View is gone, not hidden behind: this is a view of the design, not of a Floor.
    await expect(floorPlanCanvas(page)).toHaveCount(0)
    await expect(page.getByTestId('item-detail-title')).toHaveText('Sofa (3-seat)')
    await expect(page.getByTestId('detail-name')).toHaveText('Sofa (3-seat)')
    await expect(page.getByTestId('placement-row-fp-sofa')).toBeVisible()
    await expect(page.getByTestId(`placement-row-${second}`)).toBeVisible()
    await expect(page.getByTestId('item-detail-placements')).toContainText('Floor 1')
    // A generic design has no editor of its own yet (#58), so its properties stand in here.
    await expect(page.getByTestId('cabinet-canvas')).toHaveCount(0)

    // Choosing the other placement is navigation: the Floor it is on, that one selected.
    await page.getByTestId(`placement-row-${second}`).click()
    await expect(page.getByTestId('item-detail-view')).toHaveCount(0)
    await expect(floorPlanCanvas(page)).toBeVisible()
    await expect(page.getByTestId('selection-inspector')).toBeVisible()
    await expect(page.getByTestId('inspector-position-x')).not.toHaveValue(position)
    await expect(page.getByTestId('rotate-handle-group')).toHaveCount(1)
  })

  test('back returns to the Placed Item it was opened from', async ({ page }) => {
    await revealOnCanvas(page, placedObject(page, 'fp-washer'))
    await placedObject(page, 'fp-washer').click()
    const name = await page.getByTestId('inspector-name').innerText()
    await page.getByTestId('open-item-detail').click()
    await expect(page.getByTestId('item-detail-back')).toContainText('Floor 1')
    await page.getByTestId('item-detail-back').click()
    await expect(floorPlanCanvas(page)).toBeVisible()
    await expect(page.getByTestId('selection-inspector')).toBeVisible()
    await expect(page.getByTestId('inspector-name')).toHaveText(name)
  })

  test('is the only way into the cabinet editor, and no control switches views', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Cabinet', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Floor Plan', exact: true })).toHaveCount(0)

    await placedObject(page, 'seed-002').click()
    await page.getByTestId('open-item-detail').click()
    await expect(page.getByTestId('cabinet-canvas')).toBeVisible()
    // A cabinet's design has no size or colour of its own to edit here; the editor is the body.
    await expect(page.getByTestId('item-detail-props')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cabinet', exact: true })).toHaveCount(0)

    await page.getByTestId('item-detail-back').click()
    await expect(floorPlanCanvas(page)).toBeVisible()
  })

  test('opening and leaving it changes no Project and enters no history', async ({ page }) => {
    const projectId = previewSeed.projects[0]!.id
    const before = canonical(await storedProject(page, projectId))
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()

    await placedObject(page, 'seed-002').click()
    await page.getByTestId('open-item-detail').click()
    await expect(page.getByTestId('cabinet-canvas')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await page.getByTestId('item-detail-back').click()

    expect(canonical(await storedProject(page, projectId))).toBe(before)
  })
})
