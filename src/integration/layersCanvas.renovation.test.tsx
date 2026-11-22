/**
 * What a saved view's Drawing Layers do to its Plan View (#71 §4, acceptance criteria 9, 10, 11).
 *
 * The Layers list writes settings; this file is about the settings being *obeyed*: what reaches the
 * canvas, what a click can reach, and what a press is allowed to change. Those answers live in
 * `derive` (`layerAccessOf`) and in the two places that consult it — `PlanViewCanvas`'s paint and
 * pick, and `FloorWorkspace`'s gates — so the only honest witness is the real workspace drawing the
 * real fixture.
 *
 * `fixtures/domain/v8/layers.json` supplies the three positions the criteria name: `Floor 1` says
 * nothing about any layer, `Option A · Proposed` hides Furniture and recolours Structure, and
 * `Option B · Combined` makes Structure read-only. Where a criterion needs the opposite of what a
 * view stores, the test changes it through the Layers list — the same control a person uses — rather
 * than by editing the Project behind the app's back.
 *
 * The canvas is addressed by the `data-testid` its own renderer promises: `placed-object-<id>` is the
 * group a drag starts on, `wall-band-<id>` the band a pick lands on, `wall-handle-<id>` a handle that
 * must not be there.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import type { Project } from '../domain'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore, type WorkspaceServices } from '../ui'
import type { Viewport, ViewportCache } from '../ui'
import { openTestView, renderWithBindings as render, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

// jsdom ships no PointerEvent in every build, and the canvas picks and drags through pointer events.
if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const FLOOR_1 = 'seed-view-001'
const PROPOSED = 'views-view-014'
const FURNITURE = 'layers-001'
const STRUCTURE = 'layers-003'
const ISLAND = 'fp-island'
const SOFA = 'fp-sofa'
const WALL = 'seed-wall-002'

function sceneProject(): Project {
  const text = readFileSync(join(fixturesRoot, 'domain', 'v8', 'layers.json'), 'utf8')
  return structuredClone((JSON.parse(text) as { domainSchemaVersion: number; project: Project }).project)
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

async function renderWorkspace(project: Project): Promise<void> {
  view = await openTestView(project)
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
}

async function openView(viewId: string): Promise<void> {
  await userEvent.setup().selectOptions(screen.getByTestId('view-picker'), [viewId])
  await waitFor(() => expect(screen.getByTestId('view-picker')).toHaveValue(viewId))
}

/** Open one row's view section, which is where the three boxes live. */
async function expand(key: string): Promise<void> {
  const toggle = screen.getByTestId(`layer-toggle-${key}`)
  if (toggle.getAttribute('aria-expanded') !== 'true') await userEvent.setup().click(toggle)
}

/** A press on the element the drawing gave that entity, where the drawing puts one. */
function press(testId: string): void {
  fireEvent.pointerDown(screen.getByTestId(testId), { button: 0, buttons: 1, clientX: 40, clientY: 40 })
}

/** Every warning this view badges, by the entity behind it. */
const badged = (): string[] =>
  screen.getAllByTestId(/warning-badge-/).map((node) => node.getAttribute('data-ref') ?? '').sort()

describe('a saved view’s Drawing Layers on its Plan View', () => {
  beforeEach(async () => {
    await renderWorkspace(sceneProject())
  })

  it('takes a hidden layer off the canvas and keeps its warnings (#71 criterion 9)', async () => {
    await openView(FLOOR_1)
    expect(screen.getByTestId(`placed-object-${ISLAND}`)).toBeInTheDocument()
    const before = badged()

    // `Option A · Proposed` has Furniture's Visible box unchecked and nothing else said about it.
    await openView(PROPOSED)
    expect(screen.queryByTestId(`placed-object-${ISLAND}`)).toBeNull()
    expect(screen.queryByTestId(`placed-object-${SOFA}`)).toBeNull()
    // What it did not hide is still drawn, in the same places.
    expect(screen.getByTestId(`wall-band-${WALL}`)).toBeInTheDocument()
    // Hiding is a decision about this view, not about the building: the Warnings List goes on
    // counting what this canvas stopped drawing (#71 §4, and the tables below).
    expect(badged()).toEqual(before)
  })

  it('lets a click pass through a layer this view will not let be picked (#71 criterion 10)', async () => {
    await openView(FLOOR_1)
    await expand(STRUCTURE)
    await userEvent.setup().click(screen.getByTestId(`layer-selectable-${STRUCTURE}`))
    expect(screen.getByTestId(`layer-mark-unselectable-${STRUCTURE}`)).toBeInTheDocument()

    // The Wall is still drawn — Selectable is not Visible — but the press finds nothing to select.
    expect(screen.getByTestId(`wall-band-${WALL}`)).toBeInTheDocument()
    press(`wall-band-${WALL}`)
    expect(screen.queryByTestId('wall-inspector')).toBeNull()
    expect(workspaceStore.getState().selection).toBeNull()
  })

  it('keeps a non-selectable layer out of the overlap cycle (#71 criterion 10)', async () => {
    // `Option A · Proposed` is a view with a Design Option open, where a press walks a cycle of
    // everything under the pointer rather than one entity. The fixture's Placed Items stand on
    // Furniture, so Furniture is what the cycle would offer first.
    await openView(PROPOSED)
    await expand(FURNITURE)
    await userEvent.setup().click(screen.getByTestId(`layer-selectable-${FURNITURE}`))
    press(`wall-band-${WALL}`)
    // The Item is still drawn where it stands — Selectable is not Visible — it is simply no longer a
    // candidate, so the press cannot land on it.
    expect(screen.queryByTestId(`placed-object-${SOFA}`)).toBeNull()
    expect(workspaceStore.getState().selection).not.toBe(SOFA)
  })

  it('selects a read-only Wall and hands it no handles (#71 criterion 11)', async () => {
    await openView(FLOOR_1)
    await expand(STRUCTURE)
    await userEvent.setup().click(screen.getByTestId(`layer-editable-${STRUCTURE}`))
    expect(screen.getByTestId(`layer-mark-readonly-${STRUCTURE}`)).toBeInTheDocument()

    press(`wall-band-${WALL}`)
    // Read-only is still selectable — the inspector is the point of it — and the handles are the
    // affordance that has to go, because a handle is a drag waiting to write an edit.
    expect(screen.getByTestId('wall-inspector')).toBeInTheDocument()
    expect(screen.queryAllByTestId(/wall-handle-/)).toHaveLength(0)
  })

  it('refuses to drag an Item off a read-only layer and says so (#71 criterion 11)', async () => {
    await openView(FLOOR_1)
    await expand(FURNITURE)
    await userEvent.setup().click(screen.getByTestId(`layer-editable-${FURNITURE}`))
    expect(screen.getByTestId(`layer-mark-readonly-${FURNITURE}`)).toBeInTheDocument()
    const written = JSON.stringify(view.project())
    const label = view.session.getSnapshot().history.undoLabel

    press(`placed-object-${ISLAND}`)
    expect(screen.getByTestId('hidden-tool-notice')).toHaveTextContent(
      'Furniture is read-only in this view — inspect only',
    )
    // The refusal is the whole gesture: nothing was written, so nothing new is there to undo.
    expect(view.project()).toEqual(JSON.parse(written))
    expect(view.session.getSnapshot().history.undoLabel).toBe(label)
    // The press still inspected it: the Item is selected, which is what read-only is for.
    expect(screen.getByTestId('selection-inspector')).toBeInTheDocument()
  })
})
