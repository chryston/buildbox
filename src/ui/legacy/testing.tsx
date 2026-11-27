/**
 * Rendering a component that reads its state through `LegacyBindings` (#49, #53).
 *
 * Every view asks the seam for its data, so a bare `render` has nothing to read. The app
 * provides the session behind that seam; a test does the same thing here, over the in-memory
 * store, so a component suite exercises the bindings the app really builds rather than a
 * double that could drift from them. Assertions read the Project the session committed, which
 * is what `useStore.getState()` used to be.
 *
 * This is `legacy-view`'s second entry point, the one only tests may reach (#42 §7).
 */
import { act, render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { vi, type Mock } from 'vitest'
import type { ReactElement } from 'react'
import type { IntentType, PayloadOf } from '../../edit'
import type { Project } from '../../domain'
import { createMemoryAdapter } from '../../persistence'
import { openProject, type ProjectSession } from '../../session'
import { createTestDeps, flush, seedProject, testProject } from '../../session/testing'
import { createIntentFactory } from '../../app'
import { PLAN_IMAGE_ACCEPT, WorkspaceProvider, workspaceStore } from '../index'
import type { WorkspaceServices, ExportPort, ListsOptions } from '../index'
import { LegacyViewRoot } from './LegacyViewRoot'
import { uiStore } from './uiStore'
import type { AssetUrlSource, SessionViewServices } from './sessionBindings'

/** No component test loads a Plan Image, so no URL is ever asked for or handed out. */
const noAssets: AssetUrlSource = {
  subscribe: () => () => {},
  urlFor: () => null,
  load: () => {},
  put: () => {},
}

/** A session plus the services and host callbacks a root would have handed it. */
export interface TestView {
  readonly session: ProjectSession
  readonly services: SessionViewServices
  /** Spies, so a test can assert the view asked rather than reached: `expect(…toHaveBeenCalled())`. */
  readonly returnToProjects: Mock
  readonly showSaveFailure: Mock
  /** The Project the session is holding now — the document after the last commit. */
  project(): Project
  /**
   * Apply an Intent the way a view does: built by the app's factory, dispatched through the
   * session. A test that needs a document with something in it writes it this way rather than
   * by hand, so the fixture is one the converter would accept.
   */
  dispatch<T extends IntentType>(type: T, payload: PayloadOf<T>): Promise<void>
}

/** `renderWithBindings`'s options: RTL's, plus where the app should be left. */
export interface RenderViewOptions extends RenderOptions {
  /** Leave the app on the Floor workspace instead of opening the cabinet's Item Detail (#57). */
  onWorkspace?: boolean
}

/**
 * Open a Project session the way the app does, over the in-memory store.
 *
 * `project` defaults to a New Project: one Floor, one cabinet called *Unit 1* with a single
 * void space. A test that needs a particular cabinet tree passes one built from that.
 */
export async function openTestView(project: Project = testProject('p-1')): Promise<TestView> {
  // Selection and tool are UI state, not Project data: they outlive a Project in the app, so
  // they outlive a test unless this says otherwise.
  uiStore.getState().reset()
  const ports = createMemoryAdapter()
  await seedProject(ports, project)
  const { deps, clock, ids } = createTestDeps(ports)
  const opened = await openProject(project.id, deps)
  if (!opened.ok) throw new Error(`openProject refused: ${opened.error.kind}`)
  const session = opened.value
  const intent = createIntentFactory(clock, ids)
  return {
    session,
    services: {
      intent,
      assetUrls: noAssets,
      now: () => clock.now(),
    },
    returnToProjects: vi.fn(),
    showSaveFailure: vi.fn(),
    project: () => session.getSnapshot().project,
    dispatch: async (type, payload) => {
      // The session notifies on a microtask after the commit, so the render it causes lands
      // outside the caller's act scope unless this awaits it (#49).
      await act(async () => {
        session.dispatch(intent.build(type, payload))
        await flush()
      })
    },
  }
}

/**
 * An Export port that offers nothing (#61).
 *
 * The workspace tests are not export tests; they need the dialog's host present because the
 * toolbar now carries an `Export…` button, and a workspace rendered without one would not be the
 * workspace the app renders. A port with no views, no recipe and no run is the smallest thing
 * that satisfies that, and it fails loudly if a test ever presses Export expecting a file.
 */
/** The Lists choices an empty Project offers: nothing to scope by, so the Existing Model alone. */
const TEST_LISTS_OPTIONS: ListsOptions = {
  floors: [],
  designOptions: [],
  layers: [],
  defaultScope: {
    floorIds: [],
    designOptionIds: 'existing-only',
    renovationStates: ['existing', 'demolition', 'proposed'],
    drawingLayers: 'all',
  },
}

export const TEST_EXPORT_PORT: ExportPort = {
  views: () => [],
  measure: async () => ({ bounds: null }),
  unacknowledgedWarnings: () => 0,
  recall: async () => null,
  remember: () => {},
  run: () => Promise.reject(new Error('jsdom runs no export')),
  listsOptions: async () => TEST_LISTS_OPTIONS,
  drawingLayers: async () => [],
  composition: async () => null,
  blocking: async () => null,
  summariseLists: async () => ({
    statement: '',
    commentStatement: '',
    rows: { items: 0, 'cut-list': 0, rooms: 0, walls: 0, openings: 0, beams: 0, skirting: 0, services: 0, 'placed-items': 0, warnings: 0, comments: 0 },
    cutListCapable: false,
    hiddenInView: { count: 0, refs: [] },
  }),
  recallLists: async () => null,
  rememberLists: () => {},
  runLists: () => Promise.reject(new Error('jsdom runs no export')),
  cancel: () => {},
}

export function renderWithBindings(
  ui: ReactElement,
  view: TestView,
  options?: RenderViewOptions,
): RenderResult {
  const { onWorkspace, ...renderOptions } = options ?? {}
  // The Floor workspace (#55) hangs off the same session; a test that switches to the
  // Floor Plan module needs its provider present even when the test itself never opens
  // the toolbar, so the harness supplies a minimal one. Tests that drive the workspace
  // render their own provider around the `ui` and win.
  const workspaceServices: WorkspaceServices = {
    intent: view.services.intent,
    assetUrls: view.services.assetUrls,
    now: () => '2026-01-01T00:00:00.000Z',
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [{ key: 'sofa-2', label: 'Sofa 2-seater' }],
    viewportCache: { read: async () => undefined, write: () => {}, readActive: async () => null, writeActive: () => {}, readPane: async () => null, writePane: () => {} },
    exportDrawings: TEST_EXPORT_PORT,
  }
  const result = render(
    <LegacyViewRoot
      session={view.session}
      services={view.services}
      onSaveFailure={view.showSaveFailure}
      onReturnToProjects={view.returnToProjects}
    >
      <WorkspaceProvider
        session={view.session}
        services={workspaceServices}
        onReturnToProjects={view.returnToProjects}
        onShowSaveFailure={view.showSaveFailure}
      >
        {ui}
      </WorkspaceProvider>
    </LegacyViewRoot>,
    renderOptions,
  )
  // The app opens on the Floor workspace and the cabinet editor is reachable only through a
  // Placed Item's Item Detail (#57). A view test asks for the editor it has always driven by
  // arriving the way a person does — after the mount, because opening a Project's workspace
  // starts from an empty store.
  const project = view.project()
  const cabinet = project.itemDesigns.find((design) => design.kind === 'cabinet')
  const placed = project.existingModel.placedItems.find(
    (item) => cabinet !== undefined && item.itemDesignId === cabinet.id,
  ) ?? project.existingModel.placedItems[0]
  if (!onWorkspace && cabinet !== undefined && placed !== undefined) {
    act(() => {
      workspaceStore.getState().openItemDetail(cabinet.id, {
        floorId: placed.floorId,
        viewId: project.views.find((view) => view.floorId === placed.floorId)?.id ?? null,
        placedItemId: placed.id,
      })
    })
  }
  return result
}
