/**
 * Beams through the real workspace (#77 acceptance criteria 1–6, 12, 16, 17, 19).
 *
 * Every criterion here is answered by a person's gesture on the real `App`: the tool in the strip,
 * the click on the drawn body, the box in the inspector, the handle in the Section. Nothing reads
 * the Project behind the app's back except to witness what the gesture left there, because the
 * claim being tested is that the gesture and the record agree — and only the app can say so.
 *
 * Coordinates: the Plan View is at 0.05 px per mm with no pan, so a Floor point is its own client
 * pixel times twenty. The Section is at 1:1 at the origin, where a client y is a drawing y and the
 * height under the pointer is `2 600 − y` — the frame's highest height, which is both the Walls'
 * top and this Beam's. jsdom lays nothing out, so the canvas box reads as zeros and nothing else is
 * subtracted, exactly as `elevationFlow.test.tsx` relies on.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { Beam, Project } from '../domain'
import { beamTop } from '../domain'
import { PLAN_IMAGE_ACCEPT, STRINGS, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const BEAM = 'beam-1'
/** The Section's line, run along the Beam so its body straddles the view line and is projected. */
const LINE = { start: { x: -1000, y: -400 }, end: { x: 5000, y: -400 } }
/** The Beam's own midpoint, in client pixels at 0.05 px per mm. */
const BEAM_AT = { x: 2400 * 0.05, y: -400 * 0.05 }
/** The frame's highest height: the Walls are 2 600 and the Beam's Top is 2 600. */
const HIGH = 2600

/**
 * The fixture with its Design Options taken out.
 *
 * #70 §7c shuts a baseline record's fields and handles while the Project carries an Option and the
 * record is looked at in the Existing display, and the press that opens them lives in the Renovation
 * inspector, which only appears once the view has an Option selected. That interaction is
 * `existingDisplay.renovation.test.tsx`'s, for every kind at once. What this file is about is the
 * Beam's own gestures — the tool, the boxes, the handle, the delete — and with no Option in the
 * Project there is nothing sharing the record, so an Existing edit commits as it always did and the
 * gesture is the whole story.
 */
function fixtureProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v12', 'beams.json'), 'utf8')
  return structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project)
}

function sceneProject(): Project {
  return { ...fixtureProject(), designOptions: [] }
}

function testWorkspaceServices(): WorkspaceServices {
  const cache = new Map<string, Viewport>()
  const viewportCache: ViewportCache = {
    read: async (viewKey) => cache.get(viewKey),
    write: (viewKey, viewport) => {
      cache.set(viewKey, viewport)
    },
    readActive: async () => null,
    writeActive: () => {},
    readPane: async () => null,
    writePane: () => {},
  }
  return {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [{ key: 'sofa-2', label: 'Sofa 2-seater' }],
    viewportCache,
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

async function renderWorkspace(): Promise<void> {
  view = await openTestView(sceneProject())
  workspaceStore.getState().reset()
  render(
    <WorkspaceProvider
      session={view.session}
      services={testWorkspaceServices()}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <App />
    </WorkspaceProvider>,
    view,
    { onWorkspace: true },
  )
  await screen.findByTestId('floor-plan-canvas')
  act(() => workspaceStore.getState().setViewport(`plan:${view.project().floors[0]?.id ?? ''}`, { zoom: 0.05, panX: 0, panY: 0 }))
}

const beam = (id: string = BEAM): Beam => {
  const found = (view.project().existingModel.beams ?? []).find((each) => each.id === id)
  if (found === undefined) throw new Error(`no Beam ${id}`)
  return found
}

/** The Section for the Floor, created through the Intent the tool itself sends. */
async function openSection(): Promise<void> {
  await view.dispatch('elevationView.create', {
    floorId: view.project().floors[0]?.id ?? '',
    line: LINE,
    side: 'left',
    depth: 2000,
    name: 'Kitchen',
  })
  await screen.findByTestId('elevation-pane')
}

/**
 * A number box, set to a new value and left, which is what commits it. `NumberField` keeps the
 * person's text while they type and commits once on Enter or blur, so the gesture is one change
 * followed by the pointer leaving.
 */
function setNumber(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

/**
 * The drawn Beam. The body and its invisible width target carry the same `data-testid`, because a
 * suite that clicked either means the same thing (#77 §3) — so the pair is one target, and the
 * first of them is the painted body.
 */
const beamTarget = (): HTMLElement => screen.getAllByTestId(`beam-${BEAM}`)[0] as HTMLElement

/** Select the Beam by clicking the body the Plan View drew, which is how a person does it. */
async function pickBeam(): Promise<void> {
  fireEvent.pointerDown(beamTarget(), { button: 0, buttons: 1, clientX: BEAM_AT.x, clientY: BEAM_AT.y })
  await screen.findByTestId('beam-inspector')
}

/** One click of the Beam tool's two, on the draft layer that owns the canvas while it is in hand. */
function clickDraft(x: number, y: number): void {
  const layer = screen.getByTestId('beam-draft-overlay')
  fireEvent.pointerDown(layer, { button: 0, buttons: 1, clientX: x, clientY: y })
  fireEvent.pointerUp(layer, { button: 0, buttons: 0, clientX: x, clientY: y })
}

describe('a Beam in the workspace (#77)', () => {
  beforeEach(async () => {
    await renderWorkspace()
  })

  it('draws the Beam the fixture carries, and selects it by its body (#77 criterion 16)', async () => {
    expect(beamTarget()).toBeInTheDocument()
    await pickBeam()
    expect(screen.getByTestId('beam-field-underside')).toHaveValue(2300)
    // `Top` is printed, never typed: it is the sum of the two boxes above it.
    expect(screen.getByTestId('beam-field-top')).toHaveTextContent('2,600')
  })

  it('draws a Beam with two clicks and the bar’s numbers, named for the next free label (#77 criteria 1, 2)', async () => {
    const user = userEvent.setup()
    await user.click(screen.getByTestId('tool-beam'))
    expect(await screen.findByTestId('beam-draft-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('beam-draft-prompt')).toHaveTextContent(STRINGS.beamPickStart)

    // Two clicks on the reference line, at 0.05 px per mm: (2 000, −1 200) to (6 000, −1 200).
    clickDraft(100, 60)
    clickDraft(300, 60)
    await waitFor(() => expect(screen.getByTestId('beam-draft-done')).toBeEnabled())

    setNumber(screen.getByTestId('beam-draft-width'), '150')
    setNumber(screen.getByTestId('beam-draft-underside'), '2100')
    await user.click(screen.getByTestId('beam-draft-done'))

    await waitFor(() => expect(view.project().existingModel.beams ?? []).toHaveLength(2))
    const made = (view.project().existingModel.beams ?? []).find((each) => each.id !== BEAM)
    expect(made?.width).toBe(150)
    expect(made?.underside).toBe(2100)
    expect(made?.height).toBe(300)
    // The label is the next free one, so two Beams never arrive sharing a name.
    expect(made?.label).toBe('Beam B-2')
    // The tool is put down with the draft, so no crosshair outlives the Beam.
    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends nothing when the tool is left with a half-drawn line (#77 criterion 2)', async () => {
    const user = userEvent.setup()
    await user.click(screen.getByTestId('tool-beam'))
    expect(await screen.findByTestId('beam-draft-overlay')).toBeInTheDocument()
    clickDraft(100, 60)
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('beam-draft-overlay')).toBeNull())
    expect(view.project().existingModel.beams ?? []).toHaveLength(1)
    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
  })

  it('commits each inspector box as its own Intent (#77 criteria 3, 4)', async () => {
    await pickBeam()
    const user = userEvent.setup()

    setNumber(screen.getByTestId('beam-field-width'), '240')
    await waitFor(() => expect(beam().width).toBe(240))

    // `Depth` is the UI word for the stored `height`; `Underside` is the stored `underside`.
    setNumber(screen.getByTestId('beam-field-depth'), '450')
    await waitFor(() => expect(beam().height).toBe(450))

    setNumber(screen.getByTestId('beam-field-underside'), '2000')
    await waitFor(() => expect(beam().underside).toBe(2000))

    // The printed Top followed both boxes, because it is their sum and nothing typed it.
    expect(screen.getByTestId('beam-field-top')).toHaveTextContent('2,450')
    // The plan's own geometry is untouched by a vertical edit.
    expect(beam().line).toEqual({ start: { x: 900, y: -400 }, end: { x: 3900, y: -400 } })

    await user.selectOptions(screen.getByTestId('beam-field-justification'), ['left'])
    await waitFor(() => expect(beam().justification).toBe('left'))

    await user.clear(screen.getByTestId('beam-field-label'))
    await user.type(screen.getByTestId('beam-field-label'), 'Over the kitchen door')
    await user.tab()
    await waitFor(() => expect(beam().label).toBe('Over the kitchen door'))
  })

  it('moves the Underside by a handle in the Section and keeps the Top where it was (#77 criterion 17)', async () => {
    await openSection()
    await pickBeam()
    act(() => {
      workspaceStore.getState().setViewport(`elevation:${view.project().floors[0]?.id ?? ''}:Kitchen`, { zoom: 1, panX: 0, panY: 0 })
    })
    await waitFor(() => expect(screen.getByTestId('elevation-drag-layer')).toHaveAttribute('data-row', BEAM))

    // The bottom handle at the Underside (2 300), then 640 mm lower down the screen.
    act(() => {
      fireEvent.pointerDown(screen.getByTestId('elevation-handle-bottom'), { clientX: 300, clientY: HIGH - 2300 })
      fireEvent(window, new MouseEvent('pointermove', { clientX: 300, clientY: HIGH - 1660, bubbles: true }))
      fireEvent(window, new MouseEvent('pointerup', { clientX: 300, clientY: HIGH - 1660, bubbles: true }))
    })

    await waitFor(() => expect(beam().underside).toBe(1660))
    // The Top is fixed, so the depth is what changed — the same answer the chip read while the
    // pointer moved, and the same one a Wall's bottom handle gives.
    expect(beamTop(beam())).toBe(2600)
    expect(beam().height).toBe(940)
    // A drag in the Section changes vertical values and nothing else.
    expect(beam().line).toEqual({ start: { x: 900, y: -400 }, end: { x: 3900, y: -400 } })
  })

  it('keeps one selection across both panes (#77 criteria 16, 19)', async () => {
    await openSection()
    act(() => {
      workspaceStore.getState().setViewport(`elevation:${view.project().floors[0]?.id ?? ''}:Kitchen`, { zoom: 1, panX: 0, panY: 0 })
    })
    await pickBeam()
    // The Section shows the handles of the row the Plan View was clicked on: one selection, two
    // panes, because the pane draws its handles for the sole selected row and nothing else.
    await waitFor(() => expect(screen.getByTestId('elevation-drag-layer')).toHaveAttribute('data-row', BEAM))

    // Selecting it from the Section works the other way: a click inside the band, which the pane
    // resolves through the same cycle the Plan View uses.
    act(() => {
      workspaceStore.getState().selectBeam(null)
      workspaceStore.getState().setViewport(`elevation:${view.project().floors[0]?.id ?? ''}:Kitchen`, { zoom: 1, panX: 0, panY: 0 })
    })
    await waitFor(() => expect(screen.queryByTestId('beam-inspector')).toBeNull())
    // 2 500 mm along the line and 150 px down the screen: inside the Beam's body, at 2 450 high.
    fireEvent.pointerDown(screen.getByTestId('elevation-canvas'), { button: 0, buttons: 1, clientX: 2500, clientY: 150 })
    await screen.findByTestId('beam-inspector')
    expect(screen.getByTestId('elevation-drag-layer')).toHaveAttribute('data-row', BEAM)
  })

  it('deletes the record and puts it back with Undo (#77 criteria 5, 6)', async () => {
    await pickBeam()
    const before = JSON.stringify(view.project().existingModel.beams)
    await userEvent.setup().click(screen.getByTestId('beam-delete'))
    await waitFor(() => expect(view.project().existingModel.beams ?? []).toHaveLength(0))
    expect(screen.queryByTestId('beam-inspector')).toBeNull()
    expect(screen.queryAllByTestId(`beam-${BEAM}`)).toHaveLength(0)

    await userEvent.setup().click(screen.getByTestId('undo-button'))
    await waitFor(() => expect(JSON.stringify(view.project().existingModel.beams)).toBe(before))
    expect(beamTarget()).toBeInTheDocument()
  })

})

describe('a Beam drawn into a Project that carries Design Options (#77)', () => {
  beforeEach(async () => {
    await renderWorkspace()
  })

  // Criterion 18: which collection a drawn Beam joins is the view's answer, not the tool's. A Plan
  // View bound to a Design Option proposes; a Project with no Option documents the survey.
  it('proposes the Beam in the Option whose Plan View it was drawn in (#77 criterion 18)', async () => {
    const withOption = fixtureProject()
    const option = withOption.designOptions?.[0]
    if (option === undefined) throw new Error('the beams fixture carries no Design Option')
    const bound = withOption.views.map((each) =>
      each.id === 'seed-view-001' ? { ...each, designOptionId: option.id, renovationDisplay: 'proposed' as const } : each,
    )
    view = await openTestView({ ...withOption, views: bound })

    const user = userEvent.setup()
    await user.click(screen.getByTestId('tool-beam'))
    expect(await screen.findByTestId('beam-draft-overlay')).toBeInTheDocument()
    clickDraft(100, 60)
    clickDraft(300, 60)
    await waitFor(() => expect(screen.getByTestId('beam-draft-done')).toBeEnabled())
    await user.click(screen.getByTestId('beam-draft-done'))

    await waitFor(() => expect(option.proposed.beams ?? []).toHaveLength(1))
    // The survey keeps what it said: the Option proposes, it does not rewrite.
    expect(view.project().existingModel.beams ?? []).toHaveLength(1)
    expect((view.project().existingModel.beams ?? [])[0]!.id).toBe(BEAM)
  })



})
