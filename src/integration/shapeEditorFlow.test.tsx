/**
 * The Item Detail shape editor, wired to a real session (#58 §3–§6).
 *
 * What is pinned here is the seam the components cannot pin for themselves: a keystroke in a
 * Shape-tab field reaches the controller, the controller's answer decides whether the Project
 * changes, and when it does not the Project is *exactly* what it was — same revision, same
 * history, nothing written. That is the whole argument for putting an invalid proposal behind a
 * controller rather than in front of the Intent, and it is only visible with a session under it.
 *
 * The drag-and-drop and the pointer work are e2e's; jsdom cannot model pointer capture. What it
 * can do is type.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { CornerRadii, Preset } from '../derive'
import type { ItemDesign, ItemFootprint, PlacedItem, Project } from '../domain'
import { rectangleFootprint } from '../domain'
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

  it('puts the one message in the draft bar when the gesture had no field to mark', async () => {
    // A Square is 600 × 600, and the Capsule that fits it is 600 long and 600 wide — which is
    // a Circle wearing a name. The kernel says so, and there is no field to say it under.
    const view = await openShapeEditor(
      withSofa(testProject('p-1'), { kind: 'preset', preset: { kind: 'square', side: 600 }, centre: { x: 300, y: 300 }, orientationDeg: 0 }),
    )
    const before = view.session.getSnapshot()
    await userEvent.click(screen.getByTestId('shapes-menu'))
    await userEvent.click(await screen.findByTestId('shape-preset-capsule'))

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

  it('picking a preset keeps the position and takes the size the shape already had', async () => {
    const view = await openShapeEditor(withSofa(testProject('p-1'), rectangleFootprint(1200, 400)))
    await userEvent.click(screen.getByTestId('shapes-menu'))
    await userEvent.click(await screen.findByTestId('shape-preset-circle'))

    await waitFor(() => expect(sofa(view.project()).footprint).toEqual({
      kind: 'preset',
      preset: { kind: 'circle', diameter: 400 },
      centre: { x: 600, y: 200 },
      orientationDeg: 0,
    }))
    expect(screen.getByTestId('shape-kind')).toHaveTextContent('Circle')
    expect(await fieldOf('shape-diameter')).toBe('400')
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
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
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
