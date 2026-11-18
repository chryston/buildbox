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

/**
 * Open a Project session the way the app does, over the in-memory store.
 *
 * `project` defaults to a New Project: one Floor, one cabinet called *Unit 1* with a single
 * void space. A test that needs a particular cabinet tree passes one built from that.
 */
export async function openTestView(project: Project = testProject('p-1')): Promise<TestView> {
  // Selection, module and tool are UI state, not Project data: they outlive a Project in the
  // app, so they outlive a test unless this says otherwise.
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
      readPlanImage: () => Promise.reject(new Error('this double models no file reader')),
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

export function renderWithBindings(
  ui: ReactElement,
  view: TestView,
  options?: RenderOptions,
): RenderResult {
  return render(
    <LegacyViewRoot
      session={view.session}
      services={view.services}
      onSaveFailure={view.showSaveFailure}
      onReturnToProjects={view.returnToProjects}
    >
      {ui}
    </LegacyViewRoot>,
    options,
  )
}
