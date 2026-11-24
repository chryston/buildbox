/**
 * The Item Detail shape editor, wired to a real session (#58 §3–§6).
 *
 * What is pinned here is the seam the components cannot pin for themselves: a keystroke in a
 * Shape-tab field reaches the controller, the controller's answer decides whether the Project
 * changes, and when it does not the Project is *exactly* what it was — same revision, same
 * history, nothing written. That is the whole argument for putting an invalid proposal behind a
 * controller rather than in front of the Intent, and it is only visible with a session under it.
 *
 * The pointer gestures are driven here by saying what the canvas is drawn as — jsdom lays
 * nothing out, but it will dispatch a pointer event wherever it is told to land. What it cannot
 * do is lay out text, so the chip sizes are checked as geometry, not as pixels; the pixels are
 * `e2e/smoke/shape-editor.spec.ts`.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { CornerRadii, Preset } from '../derive'
import { vertices } from '../derive'
import type { ItemDesign, ItemFootprint, PlacedItem, Project } from '../domain'
import { footprintPath, rectangleFootprint } from '../domain'
import { openTestView, renderWithBindings as render, type TestView } from '../ui/legacy/testing'
import { testProject } from '../session/testing'
import { workspaceStore } from '../ui'

const DESIGN = 'p-1-sofa'
const PLACE = 'p-1-sofa-place'
const PLACE_2 = 'p-1-sofa-place-2'

/** A generic Item Design of `footprint`, placed once (or twice) on the Project's one Floor. */
function withSofa(project: Project, footprint: ItemFootprint, placements: 1 | 2 = 1): Project {
  const design: ItemDesign = {
    id: DESIGN,
    kind: 'generic',
    name: 'Sofa',
    footprint,
    origin: { x: 0, y: 0 },
    height: 850,
    heightIsTypical: true,
    color: '#7a8b99',
  }
  const placed: PlacedItem[] = [
    { id: PLACE, itemDesignId: DESIGN, floorId: 'p-1-floor', translation: { x: 2000, y: 1500 }, rotationDeg: 0, baseElevation: 0 },
  ]
  if (placements === 2) {
    placed.push({ id: PLACE_2, itemDesignId: DESIGN, floorId: 'p-1-floor', translation: { x: 4000, y: 1500 }, rotationDeg: 0, baseElevation: 0 })
  }
  return {
    ...project,
    itemDesigns: [...project.itemDesigns, design],
    existingModel: { ...project.existingModel, placedItems: [...project.existingModel.placedItems, ...placed] },
  }
}

/** A Rounded Rectangle with four separate corner radii, so the per-corner fields are showing. */
function rounded(width: number, depth: number, radii: CornerRadii): ItemFootprint {
  return {
    kind: 'preset',
    preset: { kind: 'roundedRectangle', width, depth, radii },
    centre: { x: width / 2, y: depth / 2 },
    orientationDeg: 0,
  }
}

/** The parameters the Project's Sofa holds, which is what a Shape-tab field edits. */
function presetOf(project: Project): Preset {
  const design = sofa(project)
  if (design.footprint.kind !== 'preset') throw new Error('the Sofa is not a preset any more')
  return design.footprint.preset
}

/** The Project's Sofa design, read back out of the session. */
const sofa = (project: Project): Extract<ItemDesign, { kind: 'generic' }> => {
  const design = project.itemDesigns.find((each) => each.id === DESIGN)
  if (design === undefined || design.kind !== 'generic') throw new Error('the Sofa design is gone')
  return design
}

/** Arrive at Item Detail the way a person does: select the Placed Item, then open its design. */
async function openShapeEditor(project: Project): Promise<TestView> {
  const view = await openTestView(project)
  render(<App />, view, { onWorkspace: true })
  await screen.findByTestId('floor-plan-canvas')
  act(() => workspaceStore.getState().select(PLACE))
  await userEvent.click(await screen.findByTestId('open-item-detail'))
  await screen.findByTestId('shape-editor')
  return view
}

/** The number in a Shape-tab field, as the Project's unit shows it. */
async function fieldOf(testId: string): Promise<string> {
  const field = await screen.findByTestId(testId)
  expect(field).toBeInstanceOf(HTMLInputElement)
  return (field as HTMLInputElement).value
}

// The canvas gestures. jsdom lays nothing out, so every element is a zero-by-zero box and a
// pointer would land nowhere; saying what the canvas is drawn as is the one thing a jsdom test
// has to supply for itself. `clientFor` then reads the viewBox the component chose and inverts
// it, so a gesture is aimed at the geometry on screen rather than at a number this file guessed.

interface ScreenBox { left: number; top: number; width: number; height: number }

function drawCanvas(widthPx: number, heightPx: number): HTMLElement {
  const canvas = screen.getByTestId('footprint-canvas')
  const box: ScreenBox = { left: 0, top: 0, width: widthPx, height: heightPx }
  canvas.getBoundingClientRect = () => ({
    ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}),
  }) as DOMRect
  return canvas
}

function clientFor(canvas: HTMLElement, mm: { x: number; y: number }): { x: number; y: number } {
  const [minX = 0, minY = 0, w = 1, h = 1] = (canvas.getAttribute('viewBox') ?? '').split(' ').map(Number)
  const box = canvas.getBoundingClientRect()
  const mmPerPx = Math.max(w / box.width, h / box.height)
  return {
    x: box.left + (box.width - w / mmPerPx) / 2 + (mm.x - minX) / mmPerPx,
    y: box.top + (box.height - h / mmPerPx) / 2 + (mm.y - minY) / mmPerPx,
  }
}

function pointerAt(canvas: HTMLElement, type: string, mm: { x: number; y: number }, extra: { button?: number; buttons?: number }): void {
  const at = clientFor(canvas, mm)
  act(() => {
    // jsdom has no PointerEvent, so a MouseEvent under the pointer name is what React sees. It
    // carries the coordinates, which is all the canvas reads out of it.
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      button: extra.button ?? 0,
      buttons: extra.buttons ?? 0,
    })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    canvas.dispatchEvent(event)
  })
}

function dragCanvas(
  canvas: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  pointerAt(canvas, 'pointerdown', from, { button: 0, buttons: 1 })
  pointerAt(canvas, 'pointermove', to, { buttons: 1 })
  pointerAt(canvas, 'pointerup', to, { button: 0 })
}

function clickCanvas(canvas: HTMLElement, at: { x: number; y: number }): void {
  dragCanvas(canvas, at, at)
}

/** The rectangle an SVG element is drawn at, read off its attributes. */
function boxOf(testId: string): ScreenBox {
  const shape = (screen.getByTestId(testId).querySelector('rect') ?? screen.getByTestId(testId)) as SVGGraphicsElement
  const number = (name: string): number => Number(shape.getAttribute(name) ?? 0)
  return { left: number('x'), top: number('y'), width: number('width'), height: number('height') }
}

const overlaps = (a: ScreenBox, b: ScreenBox): boolean =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

describe('the Item Detail shape editor', () => {
  beforeEach(() => {
    workspaceStore.getState().reset()
  })

  it('shows the Item Footprint as the parameters it has', async () => {
    await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 600)))
    expect(screen.getByTestId('shape-kind')).toHaveTextContent('Rectangle')
    expect(await fieldOf('shape-width')).toBe('1200')
    expect(await fieldOf('shape-depth')).toBe('600')
    expect(await fieldOf('shape-orientation')).toBe('0')
    expect(await fieldOf('shape-position-x')).toBe('600')
    // A Rectangle has no corner radius to show, and says nothing about one.
    expect(screen.queryByTestId('shape-radius')).not.toBeInTheDocument()
    expect(screen.getByTestId('footprint-origin')).toBeInTheDocument()
    expect(screen.getByTestId('footprint-axis-x')).toBeInTheDocument()
  })

  it('writes a valid width straight to the Project when the design has one placement', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 600)))
    const before = view.session.getSnapshot().revision
    const width = screen.getByTestId('shape-width')
    await userEvent.clear(width)
    await userEvent.type(width, '900')
    // Previewing is not writing: every keystroke redraws the shape and nothing else.
    expect(presetOf(view.project())).toEqual({ kind: 'rectangle', width: 1200, depth: 600 })
    expect(view.session.getSnapshot().revision).toBe(before)
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(presetOf(view.project())).toEqual({ kind: 'rectangle', width: 900, depth: 600 }))
    expect(view.session.getSnapshot().revision).toBe(before + 1)
    expect(screen.queryByTestId('shape-draft-bar')).not.toBeInTheDocument()
  })

  it('previews first and says how many placements a shared design change would take', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 600), 2))
    const width = screen.getByTestId('shape-width')
    await userEvent.clear(width)
    await userEvent.type(width, '900{Enter}')

    const bar = screen.getByTestId('shape-draft-bar')
    expect(within(bar).getByTestId('shape-draft-affects')).toHaveTextContent('Affects 2 placements')
    expect(within(bar).getByTestId('shape-apply')).toBeEnabled()
    expect(presetOf(view.project())).toEqual({ kind: 'rectangle', width: 1200, depth: 600 })

    await userEvent.click(within(bar).getByTestId('shape-apply'))
    await waitFor(() => expect(presetOf(view.project())).toEqual({ kind: 'rectangle', width: 900, depth: 600 }))
    expect(screen.queryByTestId('shape-draft-bar')).not.toBeInTheDocument()
  })

  it('marks the offending field, says one sentence, and writes nothing at all', async () => {
    const view = await openShapeEditor(
      withSofa(testProject('p-1'), rounded(1000, 600, { topLeft: 100, topRight: 100, bottomRight: 100, bottomLeft: 100 })),
    )
    const before = view.session.getSnapshot()
    const topRight = screen.getByTestId('shape-topRight')
    await userEvent.clear(topRight)
    await userEvent.type(topRight, '901{Enter}')

    expect(topRight).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('shape-topRight-row')).toHaveAttribute('data-invalid', 'true')
    const messages = screen.getAllByTestId('shape-problem-message')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toHaveTextContent('Corner radii on the top side overlap')
    // A sentence, not a coordinate pair: the canvas marks the place, the words do not repeat it.
    expect(messages[0].textContent).not.toMatch(/\( *-?[\d.]+ *, *-?[\d.]+ *\)/)
    expect(screen.getByTestId('footprint-canvas')).toHaveAttribute('data-invalid', 'true')
    expect(screen.getByTestId('footprint-ghost')).toBeInTheDocument()
    expect(screen.getByTestId('shape-apply')).toBeDisabled()

    const after = view.session.getSnapshot()
    expect(after.revision).toBe(before.revision)
    expect(after.history).toEqual(before.history)
    expect(after.project).toEqual(before.project)
  })

  it('leaves the Project alone when an invalid number is only blurred', async () => {
    // Nothing is written on blur either: the proposal is not a change until it is applied, and
    // Apply is disabled while it is invalid. Tabbing out must not be a way round that.
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 600)))
    const before = view.session.getSnapshot()
    const width = screen.getByTestId('shape-width')
    await userEvent.clear(width)
    await userEvent.type(width, '0')
    await userEvent.tab()

    expect(screen.getByTestId('shape-width-row')).toHaveAttribute('data-invalid', 'true')
    expect(screen.getByTestId('shape-draft-bar')).toBeInTheDocument()
    expect(screen.getByTestId('shape-apply')).toBeDisabled()
    const after = view.session.getSnapshot()
    expect(after.revision).toBe(before.revision)
    expect(after.project).toEqual(before.project)
  })

  it('selecting another object discards the invalid proposal (criterion 9)', async () => {
    const view = await openShapeEditor(
      withSofa(testProject('p-1'), rounded(1000, 600, { topLeft: 100, topRight: 100, bottomRight: 100, bottomLeft: 100 })),
    )
    const before = view.session.getSnapshot()
    const topRight = screen.getByTestId('shape-topRight')
    await userEvent.clear(topRight)
    await userEvent.type(topRight, '901{Enter}')
    expect(screen.getByTestId('shape-draft-bar')).toBeInTheDocument()

    // The Item Design editor stays open — the proposal was about this design — but the proposal
    // itself is gone, not hidden: coming back must show the shape the design has.
    act(() => workspaceStore.getState().select('p-1-place'))

    expect(workspaceStore.getState().shapeDraft).toBeNull()
    expect(screen.queryByTestId('shape-draft-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('footprint-ghost')).not.toBeInTheDocument()
    expect(screen.getByTestId('footprint-canvas')).toHaveAttribute('data-invalid', 'false')
    expect((topRight as HTMLInputElement).value).toBe('100')
    expect(topRight).toHaveAttribute('aria-invalid', 'false')

    const after = view.session.getSnapshot()
    expect(after.revision).toBe(before.revision)
    expect(after.history).toEqual(before.history)
    expect(after.project).toEqual(before.project)
  })

  it('puts the one message in the draft bar when the gesture had no field to mark', async () => {
    // A Square is 600 × 600, and the Capsule that fits it is 600 long and 600 wide — which is
    // a Circle wearing a name. The kernel says so, and there is no field to say it under.
    const view = await openShapeEditor(
      withSofa(testProject('p-1'), { kind: 'preset', preset: { kind: 'square', side: 600 }, centre: { x: 300, y: 300 }, orientationDeg: 0 }),
    )
    const before = view.session.getSnapshot()
    await userEvent.click(screen.getByTestId('shapes-menu'))
    await userEvent.click(await screen.findByTestId('shape-preset-capsule'))
    clickCanvas(drawCanvas(640, 340), { x: 300, y: 300 })

    const messages = screen.getAllByTestId('shape-problem-message')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toHaveTextContent('Capsule length needs to be more than its width')
    expect(screen.getByTestId('shape-draft-bar')).toBeInTheDocument()
    expect(screen.getByTestId('footprint-ghost')).toBeInTheDocument()
    expect(screen.getByTestId('shape-apply')).toBeDisabled()
    expect(view.session.getSnapshot()).toEqual(before)
  })

  it('Esc puts the number back and leaves the Project untouched', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1000, 600)))
    const before = view.session.getSnapshot()
    const width = screen.getByTestId('shape-width')
    await userEvent.clear(width)
    await userEvent.type(width, '-5')
    expect(width).toHaveAttribute('aria-invalid', 'true')
    await userEvent.keyboard('{Escape}')

    expect(screen.getByTestId('shape-width')).toHaveValue(1000)
    expect(screen.queryByTestId('shape-draft-bar')).not.toBeInTheDocument()
    expect(screen.getByTestId('footprint-canvas')).toHaveAttribute('data-invalid', 'false')
    expect(view.session.getSnapshot()).toEqual(before)
  })

  it('converting says what is lost, and Cancel keeps every parameter', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1000, 600)))
    const before = view.session.getSnapshot()
    await userEvent.click(screen.getByTestId('shape-convert'))
    const dialog = await screen.findByTestId('convert-modal')
    expect(within(dialog).getByTestId('convert-modal-heading')).toHaveTextContent('Sofa')
    expect(within(dialog).getByTestId('convert-modal-warning')).toHaveTextContent(
      "The Rectangle's width, depth and orientation fields will be removed.",
    )
    expect(within(dialog).getByTestId('convert-cancel')).toHaveFocus()
    await userEvent.click(within(dialog).getByTestId('convert-cancel'))

    expect(screen.queryByTestId('convert-modal')).not.toBeInTheDocument()
    expect(view.session.getSnapshot()).toEqual(before)
  })

  it('Convert anyway replaces the parameters with edges, and Undo brings them back', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1000, 600)))
    await userEvent.click(screen.getByTestId('shape-convert'))
    await userEvent.click(await screen.findByTestId('convert-confirm'))

    await waitFor(() => expect(sofa(view.project()).footprint.kind).toBe('path'))
    expect(screen.getByTestId('shape-kind')).toHaveTextContent('Custom Path')
    // A Custom Path has no orientation and nothing to convert again.
    expect(screen.queryByTestId('shape-orientation')).not.toBeInTheDocument()
    expect(screen.getByTestId('shape-convert')).toBeDisabled()

    await act(async () => { view.session.undo() })
    expect(sofa(view.project()).footprint).toEqual(rectangleFootprint(1000, 600))
  })

  it('converts a Rectangle into the four edges it already was (criterion 13)', async () => {
    const footprint = rectangleFootprint(600, 400)
    const view = await openShapeEditor(withSofa(testProject('p-1'), footprint))
    const before = vertices(footprintPath(footprint))
    await userEvent.click(screen.getByTestId('shape-convert'))
    await userEvent.click(await screen.findByTestId('convert-confirm'))
    await waitFor(() => expect(sofa(view.project()).footprint.kind).toBe('path'))

    await userEvent.click(screen.getByTestId('shape-tab-edges'))
    const edges = screen.getByTestId('edges-tab')
    expect(within(edges).getAllByTestId(/^edge-row-\d+$/)).toHaveLength(4)
    for (const [index, length] of [1, 2, 3, 4].map((n, i) => [n, i % 2 === 0 ? 600 : 400] as const)) {
      expect(within(edges).getByTestId(`edge-kind-${index}`)).toHaveTextContent('Line')
      expect(within(edges).getByTestId(`edge-length-${index}`)).toHaveTextContent(`${length} mm`)
    }

    await userEvent.click(screen.getByTestId('shape-tab-measurements'))
    expect(screen.getByTestId('measurements-area')).toHaveTextContent('0.24 m²')

    // Nothing moved: the Custom Path holds the same four corners the Rectangle drew.
    const after = vertices(footprintPath(sofa(view.project()).footprint))
    expect(after).toHaveLength(before.length)
    before.forEach((point, index) => {
      const moved = after[index]
      expect(moved).toBeDefined()
      expect(Math.hypot(moved.x - point.x, moved.y - point.y)).toBeLessThan(0.01)
    })

    await act(async () => { view.session.undo() })
    expect(sofa(view.project()).footprint).toEqual(rectangleFootprint(600, 400))
  })

  it('opens a Rounded Rectangle into four corners, and the top-left is the one it says (criterion 6)', async () => {
    const shared: ItemFootprint = {
      kind: 'preset',
      preset: { kind: 'roundedRectangle', width: 1200, depth: 800, radius: 100 },
      centre: { x: 600, y: 400 },
      orientationDeg: 0,
    }
    const view = await openShapeEditor(withSofa(testProject('p-1'), shared))
    // One field while every corner shares it…
    expect(screen.getByTestId('shape-radius')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('shape-per-corner-radii'))

    // …four once they need not, named for the corner each rounds.
    for (const id of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']) {
      expect(screen.getByTestId(`shape-${id}`)).toBeInTheDocument()
    }
    expect(screen.getByText('Top-left')).toBeInTheDocument()
    expect(screen.getByText('Top-right')).toBeInTheDocument()
    expect(screen.getByText('Bottom-right')).toBeInTheDocument()
    expect(screen.getByText('Bottom-left')).toBeInTheDocument()
    expect(screen.queryByTestId('shape-radius')).not.toBeInTheDocument()

    const topLeft = screen.getByTestId('shape-topLeft')
    await userEvent.clear(topLeft)
    await userEvent.type(topLeft, '400{Enter}')
    await waitFor(() => expect(presetOf(view.project())).toEqual({
      kind: 'roundedRectangle', width: 1200, depth: 800,
      radii: { topLeft: 400, topRight: 100, bottomRight: 100, bottomLeft: 100 },
    }))

    // The 400 landed on the corner that draws at the top left: its arc is centred 400 in from
    // the left edge and 400 down from the top, while the other three stay 100 from their corners.
    const arcs = footprintPath(sofa(view.project()).footprint).segments
      .filter((segment) => segment.kind === 'arc')
      .map((segment) => segment.center)
    expect(arcs).toEqual([
      { x: 400, y: 400 },
      { x: 1100, y: 100 },
      { x: 1100, y: 700 },
      { x: 100, y: 700 },
    ])
  })

  it('defaults a Triangle’s apex to the middle of its base, and 0 squares it off (criterion 7)', async () => {
    const triangle = (apexOffset?: number): ItemFootprint => ({
      kind: 'preset',
      preset: { kind: 'triangle', baseWidth: 900, depth: 600, ...(apexOffset === undefined ? {} : { apexOffset }) },
      centre: { x: 0, y: 0 },
      orientationDeg: 0,
    })
    const view = await openShapeEditor(withSofa(testProject('p-1'), triangle()))
    // Half the base, said back as a number rather than as "the default".
    expect(await fieldOf('shape-apexOffset')).toBe('450')

    const apex = screen.getByTestId('shape-apexOffset')
    await userEvent.clear(apex)
    await userEvent.type(apex, '0{Enter}')
    await waitFor(() => expect(presetOf(view.project())).toEqual({
      kind: 'triangle', baseWidth: 900, depth: 600, apexOffset: 0,
    }))

    // A right angle at the base-left corner: the left edge goes straight up from it and the
    // base goes straight along, so the apex sits above the base's left end.
    const [baseLeft, apexPoint, baseRight] = vertices(footprintPath(sofa(view.project()).footprint))
    expect(Math.abs(apexPoint.x - baseLeft.x)).toBeLessThan(0.01)
    expect(Math.abs(baseRight.y - baseLeft.y)).toBeLessThan(0.01)
  })

  it('refuses a polygon with two sides, or three and a half, by marking the field (criterion 7)', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), {
      kind: 'preset',
      preset: { kind: 'regularPolygon', sideCount: 6, sideLength: 300 },
      centre: { x: 0, y: 0 },
      orientationDeg: 0,
    }))
    const before = view.session.getSnapshot()
    const sides = screen.getByTestId('shape-sides')

    for (const rejected of ['2', '3.5']) {
      await userEvent.clear(sides)
      await userEvent.type(sides, `${rejected}{Enter}`)
      expect(sides).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByTestId('shape-sides-row')).toHaveAttribute('data-invalid', 'true')
      expect(screen.getAllByTestId('shape-problem-message')).toHaveLength(1)
      expect(screen.getByTestId('shape-apply')).toBeDisabled()
      expect(view.session.getSnapshot()).toEqual(before)
    }

    // Five is a polygon: the mark goes and the number lands.
    await userEvent.clear(sides)
    await userEvent.type(sides, '5{Enter}')
    await waitFor(() => expect(presetOf(view.project())).toEqual({ kind: 'regularPolygon', sideCount: 5, sideLength: 300 }))
    expect(screen.getByTestId('shape-sides-row')).toHaveAttribute('data-invalid', 'false')
  })

  it('picking a preset arms a placement and changes nothing until the canvas is used (criterion 3)', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 400)))
    const revision = view.session.getSnapshot().revision
    await userEvent.click(screen.getByTestId('shapes-menu'))
    await userEvent.click(await screen.findByTestId('shape-preset-circle'))

    expect(screen.getByTestId('shape-placing')).toHaveTextContent('Placing Circle')
    expect(screen.getByTestId('shape-placing')).toHaveTextContent('click for 1200 × 400 mm')
    expect(screen.getByTestId('footprint-canvas')).toHaveAttribute('data-placing', 'circle')
    expect(view.session.getSnapshot().revision).toBe(revision)

    await userEvent.click(screen.getByTestId('shape-placing-cancel'))
    expect(screen.queryByTestId('shape-placing')).not.toBeInTheDocument()
    expect(screen.getByTestId('footprint-canvas')).toHaveAttribute('data-placing', 'none')
    expect(view.session.getSnapshot().revision).toBe(revision)
    expect(screen.getByTestId('shape-kind')).toHaveTextContent('Rectangle')
  })

  it('clicking places the default size centred on the point that was clicked (criterion 3)', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 400)))
    await userEvent.click(screen.getByTestId('shapes-menu'))
    await userEvent.click(await screen.findByTestId('shape-preset-circle'))

    const canvas = drawCanvas(640, 340)
    await clickCanvas(canvas, { x: 1500, y: 900 })

    await waitFor(() => expect(sofa(view.project()).footprint).toEqual({
      kind: 'preset',
      preset: { kind: 'circle', diameter: 400 },
      centre: { x: 1500, y: 900 },
      orientationDeg: 0,
    }))
    expect(screen.queryByTestId('shape-placing')).not.toBeInTheDocument()
  })

  it('dragging a box places the rectangle it describes, with the chips outside it (criterion 2)', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 400)))
    await userEvent.click(screen.getByTestId('shapes-menu'))
    await userEvent.click(await screen.findByTestId('shape-preset-rectangle'))

    const canvas = drawCanvas(640, 340)
    const to = { x: 700, y: 500 }
    pointerAt(canvas, 'pointerdown', { x: 100, y: 100 }, { button: 0, buttons: 1 })
    pointerAt(canvas, 'pointermove', to, { buttons: 1 })

    const box = boxOf('footprint-drag')
    const width = boxOf('footprint-chip-width')
    const depth = boxOf('footprint-chip-depth')
    expect(screen.getByTestId('footprint-chip-width')).toHaveTextContent('W 600')
    expect(screen.getByTestId('footprint-chip-depth')).toHaveTextContent('D 400')
    // Criterion 22, on the rectangles the component actually rendered.
    expect(overlaps(width, box)).toBe(false)
    expect(overlaps(depth, box)).toBe(false)

    pointerAt(canvas, 'pointerup', to, { button: 0 })

    await waitFor(() => expect(sofa(view.project()).footprint).toEqual({
      kind: 'preset',
      preset: { kind: 'rectangle', width: 600, depth: 400 },
      centre: { x: 400, y: 300 },
      orientationDeg: 0,
    }))
    expect(screen.queryByTestId('footprint-drag')).not.toBeInTheDocument()
  })

  it('Esc during a drag cancels with the revision unchanged (criterion 3)', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 400)))
    const revision = view.session.getSnapshot().revision
    await userEvent.click(screen.getByTestId('shapes-menu'))
    await userEvent.click(await screen.findByTestId('shape-preset-rectangle'))

    const canvas = drawCanvas(640, 340)
    pointerAt(canvas, 'pointerdown', { x: 100, y: 100 }, { button: 0, buttons: 1 })
    pointerAt(canvas, 'pointermove', { x: 700, y: 500 }, { buttons: 1 })
    expect(screen.getByTestId('footprint-drag')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByTestId('footprint-drag')).not.toBeInTheDocument()
    expect(screen.queryByTestId('shape-placing')).not.toBeInTheDocument()
    expect(view.session.getSnapshot().revision).toBe(revision)
    expect(sofa(view.project()).footprint).toEqual(rectangleFootprint(1200, 400))
  })

  it('placing a preset on a design with two placements asks first (criterion 4)', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 400), 2))
    const revision = view.session.getSnapshot().revision
    await userEvent.click(screen.getByTestId('shapes-menu'))
    await userEvent.click(await screen.findByTestId('shape-preset-rectangle'))

    const canvas = drawCanvas(640, 340)
    await dragCanvas(canvas, { x: 100, y: 100 }, { x: 700, y: 500 })

    expect(screen.getByTestId('shape-draft-bar')).toBeInTheDocument()
    expect(screen.getByTestId('shape-draft-affects')).toHaveTextContent('Affects 2 placements')
    expect(view.session.getSnapshot().revision).toBe(revision)

    await userEvent.click(screen.getByTestId('shape-apply'))
    await waitFor(() => expect(view.session.getSnapshot().revision).toBe(revision + 1))
    expect(presetOf(view.project())).toEqual({ kind: 'rectangle', width: 600, depth: 400 })
  })

  it('reads the shape as edges and as measurements, with nothing to type', async () => {
    await openShapeEditor(withSofa(testProject('p-1'), {
      kind: 'preset',
      preset: { kind: 'circle', diameter: 1600 },
      centre: { x: 800, y: 800 },
      orientationDeg: 0,
    }))
    await userEvent.click(screen.getByTestId('shape-tab-edges'))
    expect(screen.getByTestId('edge-kind-1')).toHaveTextContent('Arc')
    expect(screen.getByTestId('edge-row-4')).toBeInTheDocument()
    expect(screen.queryByTestId('edge-row-5')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('shape-tab-measurements'))
    expect(screen.getByTestId('measurements-area')).toHaveTextContent('2.01 m²')
    expect(screen.getByTestId('measurements-perimeter')).toHaveTextContent('5,027 mm')
    // Nothing to type in the footprint editor itself — the Clearance Envelope group beside it
    // has its own fields (#76 §4), so the claim is scoped to the editor.
    expect(within(screen.getByTestId('shape-editor')).queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('shows a cabinet’s size read-only, and says where it comes from', async () => {
    const project = testProject('p-1')
    const view = await openTestView(project)
    render(<App />, view)
    await screen.findByTestId('shape-editor')

    expect(screen.getByTestId('shape-editor')).toHaveAttribute('data-layout', 'inspector')
    expect(screen.getByTestId('shape-editor-note')).toHaveTextContent('Size comes from the cabinet construction')
    expect(await fieldOf('shape-width')).toBe('600')
    expect(screen.getByTestId('shape-width')).toHaveAttribute('readonly')
    expect(screen.getByTestId('shape-convert')).toBeDisabled()
    // The cabinet editor owns the drawing, so the shape editor brings no tools of its own.
    expect(screen.queryByTestId('shapes-menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('footprint-canvas')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('shape-width'))
    await userEvent.type(screen.getByTestId('shape-width'), '999{Enter}')
    expect(view.session.getSnapshot().project).toEqual(project)
  })
})
