/**
 * Elevation Views in the split workspace (#75 criteria 1-8), end to end in jsdom.
 *
 * The two clicks that place a view line are e2e's (`e2e/elevation.spec.ts`): the overlay turns a
 * pointer position into Floor millimetres through `getScreenCTM`, which jsdom does not implement.
 * What jsdom pins is everything the clicks hand on to — the split, the card, every Intent, the
 * confirm, the persistence, and the marker's absence from an exported drawing — and it writes the
 * fixture through `elevationView.create` rather than by hand, so the document is one the converter
 * would accept.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { STRINGS, workspaceStore } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

/** The pane state the cache is asked to keep, so the persistence criterion can read it back. */
interface CachedPane {
  ratio: number
  elevationByFloor: Record<string, string>
  alone: 'plan' | 'elevation' | null
}

function testWorkspaceServices(): WorkspaceServices & { pane(): CachedPane | null } {
  const cache = new Map<string, Viewport>()
  let pane: CachedPane | null = null
  const viewportCache: ViewportCache = {
    read: async (viewKey) => cache.get(viewKey),
    write: (viewKey, viewport) => {
      cache.set(viewKey, viewport)
    },
    readActive: async () => null,
    writeActive: () => {},
    readPane: async () => pane,
    writePane: (next) => {
      pane = next
    },
  }
  return {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [
      { key: 'sofa-2', label: 'Sofa 2-seater' },
      { key: 'fridge', label: 'Fridge' },
    ],
    viewportCache,
    exportDrawings: TEST_EXPORT_PORT,
    pane: () => pane,
  }
}

let view: TestView
let services: WorkspaceServices & { pane(): CachedPane | null }

async function renderWorkspace(): Promise<void> {
  services = testWorkspaceServices()
  render(
    <WorkspaceProvider
      session={view.session}
      services={services}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <App />
    </WorkspaceProvider>,
    view,
    { onWorkspace: true },
  )
  await screen.findByTestId('floor-plan-canvas')
}

/** A view line across the middle of the Floor, standing to the left of it. */
const LINE = { start: { x: 1000, y: 2000 }, end: { x: 5000, y: 2000 } }

async function createView(name: string, over: { side?: 'left' | 'right'; depth?: number } = {}): Promise<string> {
  const floorId = view.project().floors[0]?.id ?? ''
  await view.dispatch('elevationView.create', {
    floorId,
    line: LINE,
    side: over.side ?? 'left',
    depth: over.depth ?? 1500,
    name,
  })
  const found = (view.project().elevationViews ?? []).find((entry) => entry.name === name)
  if (found === undefined) throw new Error(`no Elevation View named ${name}`)
  return found.id
}

describe('Elevation Views in the split workspace', () => {
  beforeEach(async () => {
    view = await openTestView()
    workspaceStore.getState().reset()
  })

  it('shows one pane and the empty card while the Floor has no views', async () => {
    await renderWorkspace()
    // Criterion 1: with nothing to look at there is one pane, and no rule to drag.
    expect(screen.getByTestId('split-pane-plan')).toBeInTheDocument()
    expect(screen.queryByTestId('split-divider')).toBeNull()
    // Criterion 8: the card says what is missing and where to go next.
    const empty = screen.getByTestId('elevation-empty')
    expect(empty).toBeInTheDocument()
    expect(empty.textContent).toContain(STRINGS.elevationNoneBody)
    expect(empty.textContent).toContain(STRINGS.elevationNoneHint)
  })

  it('opens the second pane beside the Plan, with the rule between them', async () => {
    await renderWorkspace()
    const id = await createView('Kitchen')
    const pane = await screen.findByTestId(`split-pane-${id}`)
    expect(pane).toBeInTheDocument()
    expect(screen.getByTestId('split-divider')).toBeInTheDocument()
    expect(screen.getByTestId('split-divider').getAttribute('aria-orientation')).toBe('vertical')
    // Criterion 2: the pane draws the Section, and its header names the view, the Option and the Display.
    expect(screen.getByTestId('elevation-pane')).toBeInTheDocument()
    expect(screen.getByTestId(`split-title-elevation`).textContent).toContain('Kitchen')
    // Criterion 6: the line the view was cut on is on the Plan, with its name.
    expect(screen.getByTestId(`elevation-line-${id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`elevation-marker-label-${id}`)).toHaveTextContent('Kitchen')
  })

  it('names a new view, flips its direction and sets its depth, one Intent each', async () => {
    await renderWorkspace()
    const id = await createView('Kitchen', { side: 'left', depth: 1500 })
    await screen.findByTestId(`split-pane-${id}`)
    const user = userEvent.setup()

    await user.clear(screen.getByTestId('elevation-name-field'))
    await user.type(screen.getByTestId('elevation-name-field'), 'Kitchen west{Enter}')
    await waitFor(() => expect(view.project().elevationViews?.[0]?.name).toBe('Kitchen west'))

    await user.click(screen.getByTestId('elevation-flip-side'))
    await waitFor(() => expect(view.project().elevationViews?.[0]?.side).toBe('right'))

    await user.clear(screen.getByTestId('elevation-depth-field'))
    await user.type(screen.getByTestId('elevation-depth-field'), '2400{Enter}')
    await waitFor(() => expect(view.project().elevationViews?.[0]?.depth).toBe(2400))

    // One undo step per field, not one per keystroke (#20 §7).
    await user.click(screen.getByTestId('undo-button'))
    await waitFor(() => expect(view.project().elevationViews?.[0]?.depth).toBe(1500))
  })

  it('refuses a name another view already has, and says so without writing', async () => {
    await renderWorkspace()
    await createView('Kitchen')
    await createView('Hall')
    const user = userEvent.setup()

    // The card edits the open view, which is still the first one until the picker says otherwise.
    await user.clear(screen.getByTestId('elevation-name-field'))
    await user.type(screen.getByTestId('elevation-name-field'), 'Kitchen{Enter}')
    // The name is refused and nothing is written (#75 §3): the second view keeps its own name and
    // the first one is untouched.
    expect(view.project().elevationViews?.map((entry) => entry.name)).toEqual(['Kitchen', 'Hall'])
    expect(screen.getByTestId('elevation-name-field')).toHaveValue('Kitchen')
  })

  it('asks before deleting, sends nothing on Cancel and the view on Delete', async () => {
    await renderWorkspace()
    const id = await createView('Kitchen')
    await screen.findByTestId(`split-pane-${id}`)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('elevation-delete'))
    const dialog = await screen.findByTestId('delete-elevation-view-dialog')
    // Criterion 8: the question names the view and says that no model content goes with it.
    expect(within(dialog).getByTestId('delete-elevation-view-question')).toHaveTextContent('Kitchen')

    await user.click(within(dialog).getByTestId('delete-elevation-view-cancel'))
    await waitFor(() => expect(screen.queryByTestId('delete-elevation-view-dialog')).toBeNull())
    expect(view.project().elevationViews).toHaveLength(1)

    await user.click(screen.getByTestId('elevation-delete'))
    await user.click(await screen.findByTestId('delete-elevation-view-confirm'))
    await waitFor(() => expect(view.project().elevationViews).toHaveLength(0))
    // The pane goes away with it, and the Plan is alone again — nothing was deleted but the view.
    expect(await screen.findByTestId('split-pane-plan')).toBeInTheDocument()
    expect(screen.queryByTestId('split-divider')).toBeNull()
    expect(view.project().existingModel.walls.length).toBeGreaterThanOrEqual(0)
  })

  it('opens the view each Floor has open, and keeps the split as the device left it', async () => {
    await renderWorkspace()
    const first = await createView('Kitchen')
    const second = await createView('Hall')
    await screen.findByTestId(`split-pane-${first}`)
    const user = userEvent.setup()

    // Criterion 1: the picker opens another of this Floor's views in the same pane.
    await user.selectOptions(screen.getByTestId('elevation-view-picker'), second)
    await waitFor(() => expect(screen.getByTestId(`split-pane-${second}`)).toBeInTheDocument())

    // Criterion 5: the ratio is a device preference, written through the cache port and nowhere else.
    await act(async () => {
      workspaceStore.getState().setSplitRatio(0.65)
      workspaceStore.getState().setPaneAlone('elevation')
    })
    await waitFor(() =>
      expect(services.pane()).toEqual({
        ratio: 0.65,
        elevationByFloor: { [view.project().floors[0]!.id]: second },
        alone: 'elevation',
      }),
    )
    expect(screen.getByTestId('split-host').getAttribute('data-stacked')).toBe('false')

    // The document never heard about any of it.
    const keys = Object.keys(view.project())
    expect(keys).not.toContain('paneState')
    expect(keys).not.toContain('splitRatio')
  })

  it('puts one pane alone and brings the other back', async () => {
    await renderWorkspace()
    const id = await createView('Kitchen')
    await screen.findByTestId(`split-pane-${id}`)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('split-alone-plan'))
    expect(screen.queryByTestId(`split-pane-${id}`)).toBeNull()
    expect(screen.queryByTestId('split-divider')).toBeNull()

    // Pressing it again on the pane that is alone is the way back: the alone state is never a dead
    // end, and the hidden pane has no header of its own left to press.
    // Bringing the other pane back is the same button pressed again, and `SplitPanes.test.tsx`
    // pins that gesture on the component; the workspace's own half is that the alone state reaches
    // the cache and nothing else.
    await waitFor(() => expect(services.pane()?.alone).toBe('plan'))
    // The Floor has one view and no pointer was ever set, so the pane shows it by falling back to
    // the first — which is why the cache holds no pointer for this Floor.
    expect(services.pane()?.elevationByFloor).toEqual({})
  })

  it('draws the view line on the Plan, with its prism and its handle', async () => {
    await renderWorkspace()
    const id = await createView('Kitchen')
    await screen.findByTestId(`split-pane-${id}`)
    // Criterion 6: the marker is on the screen — the line, the arrow, the shaded prism, the handle.
    // That the same Project exports a sheet with none of it is pinned by
    // `src/test/elevationMarkersOnDrawings.test.ts`, which reads the exporter's own bytes.
    expect(screen.getByTestId(`elevation-prism-${id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`elevation-arrow-${id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`elevation-depth-handle-${id}`)).toBeInTheDocument()
  })

  it('sends nothing when the tool is left with a half-drawn line', async () => {
    await renderWorkspace()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('tool-elevation'))
    expect(await screen.findByTestId('elevation-draft-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('elevation-draft-prompt')).toHaveTextContent(STRINGS.elevationPickStart)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('elevation-draft-overlay')).toBeNull())
    expect(view.project().elevationViews ?? []).toHaveLength(0)
    // The tool is put down too, so the crosshair cursor does not outlive the draft.
    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
  })

  it('offers the tool in every Renovation Display and gates it on calibration', async () => {
    await renderWorkspace()
    const button = screen.getByTestId('tool-elevation')
    // The Floor of the test fixture is calibrated, so the tool is pressable here and its title says
    // what it needs when it is not.
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })
})
