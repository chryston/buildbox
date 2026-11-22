/**
 * `Move to a Design Option?` — baseline data that was surveyed by mistake becomes one Option's own
 * work (#69 §13, criterion 8), and the inspector action that asks for it.
 *
 * The scene is the committed renovation fixture driven through a real session. Three things are
 * under test that only a live preview can show: the danger paragraph is about the Existing Model and
 * not about the Option being chosen; the effect is read *per Option* and changes when the target
 * select changes; and an Option that cannot take the move says so before the press rather than
 * refusing after it.
 *
 * Dark in a flag-off build, so it runs only in the `renovation-dom` project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, render, screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import type { PayloadOf } from '../edit'
import type { Project } from '../domain'
import {
  MoveToOptionAction,
  openMoveToOptionDialog,
  PLAN_IMAGE_ACCEPT,
  RenovationOverlays,
  WorkspaceProvider,
  workspaceStore,
  type WorkspaceServices,
} from '../ui'
import { openTestView, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

/** The Wall the Kitchen is built against, and the Wall Option B is made to replace. */
const WALL_5 = 'seed-wall-010'
const WALL_6 = 'seed-wall-013'
const SOFA = 'fp-sofa'

/** The renovation scene as committed, optionally with its two Options taken back out. */
function sceneProject(withOptions = true): Project {
  const seed = JSON.parse(
    readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
  ) as { projects: { data: Project }[] }
  const project = structuredClone(seed.projects[0]!.data)
  if (!withOptions) project.designOptions = []
  return project
}

const noAssets: WorkspaceServices['assetUrls'] = {
  subscribe: () => () => {},
  urlFor: () => null,
  load: () => {},
  put: () => {},
}

function servicesFor(view: TestView): WorkspaceServices {
  return {
    intent: view.services.intent,
    assetUrls: noAssets,
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [],
    viewportCache: { read: async () => undefined, write: () => {}, readActive: async () => null, writeActive: () => {} },
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView
let mounted: RenderResult | undefined

async function renderWorkspace(
  project: Project = sceneProject(),
  children: ReactNode = <RenovationOverlays />,
): Promise<void> {
  view = await openTestView(project)
  mounted = render(
    <WorkspaceProvider
      session={view.session}
      services={servicesFor(view)}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      {children}
    </WorkspaceProvider>,
  )
}

/** A store write from outside React: the workspace does it from a click, a test has to say so. */
const ask = (open: () => void): Promise<void> => act(async () => { open() })

/** An edit made straight through the session, to put the Project into the state being tested. */
async function dispatch<T extends 'renovation.demolish' | 'renovation.replace'>(type: T, payload: PayloadOf<T>): Promise<void> {
  await act(async () => {
    const result = view.session.dispatch(view.services.intent.build(type, payload))
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
  })
}

beforeEach(() => {
  workspaceStore.getState().reset()
})

// This suite renders a different Project per case, and a stale tree would answer for the wrong one.
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})

describe('the Move to a Design Option review', () => {
  it('names what leaves the baseline, per Option, and re-previews when the target changes', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await ask(() => openMoveToOptionDialog([WALL_5]))

    const dialog = await screen.findByTestId('move-to-option-dialog')
    expect(dialog).toHaveTextContent('Move to a Design Option?')
    expect(screen.getByTestId('move-danger')).toHaveTextContent(
      'This changes the survey baseline, not a Design Option. Every Design Option will see these items leave the Existing Model:',
    )
    expect(screen.getByTestId(`move-item-${WALL_5}`)).toHaveTextContent('W-5')
    expect(screen.getByTestId('move-count')).toHaveTextContent('1 entity')
    // Each Option gets its own line, because each one loses something different — here, nothing.
    expect(screen.getByTestId('move-option-option-a')).toHaveTextContent('Option A')
    expect(screen.getByTestId('move-option-option-b')).toHaveTextContent('Option B')
    expect(screen.queryByTestId('move-option-detaches-option-a')).toBeNull()
    expect(screen.queryByTestId('move-option-drops-option-a')).toBeNull()
    expect(screen.queryByTestId('move-option-blocked-option-a')).toBeNull()
    expect(screen.getByTestId('move-to-option-confirm')).toHaveTextContent('Move to Option A')

    // Choosing another target asks the preview again; the dialog computes nothing of its own.
    await user.selectOptions(screen.getByTestId('move-target-option'), 'option-b')
    await waitFor(() => expect(screen.getByTestId('move-to-option-confirm')).toHaveTextContent('Move to Option B'))
    expect(screen.getByTestId('move-target-option')).toHaveValue('option-b')
  })

  it('says when the target Option no longer has to demolish the entity', async () => {
    await renderWorkspace()
    await dispatch('renovation.demolish', { entityId: SOFA, target: { designOptionId: 'option-b' } })
    await ask(() => openMoveToOptionDialog([SOFA]))

    await screen.findByTestId('move-to-option-dialog')
    expect(screen.getByTestId('move-option-drops-option-b')).toHaveTextContent(
      'Drops 1 demolition record — the entity is no longer Existing work here.',
    )
    expect(screen.queryByTestId('move-option-drops-option-a')).toBeNull()
  })

  it('refuses a move an Option cannot take, before it is pressed', async () => {
    await renderWorkspace()
    // Option B stands W-6 up again as its own successor, so the baseline cannot simply take W-6 away.
    await dispatch('renovation.replace', { entityId: WALL_6, edit: { thickness: 250 }, target: { designOptionId: 'option-b' } })
    await ask(() => openMoveToOptionDialog([WALL_6]))

    const dialog = await screen.findByTestId('move-to-option-dialog')
    // Replacing W-6 carried its Window too, so the Option holds a successor of both (#69 §7).
    expect(screen.getByTestId('move-option-blocked-option-b')).toHaveTextContent('This Option cannot take the move:')
    expect(screen.getByTestId('move-option-blocked-option-b')).toHaveTextContent(/Restore W-6 in Option B first\./)
    expect(dialog).toHaveTextContent('Restore W-6 in Option B first.')
    expect(screen.getByTestId('move-to-option-confirm')).toBeDisabled()
  })

  it('hides the inspector action while the Project has no Option', async () => {
    await renderWorkspace(sceneProject(false), <MoveToOptionAction entityId={WALL_5} />)
    // Nothing to move something to: a command that can only be refused is not offered (#69 §13).
    expect(screen.queryByTestId('move-to-option-action')).toBeNull()
  })

  it('opens the review from the inspector action', async () => {
    const user = userEvent.setup()
    await renderWorkspace(sceneProject(), <><MoveToOptionAction entityId={WALL_5} /><RenovationOverlays /></>)
    const action = await screen.findByTestId('move-to-option-action')
    expect(action).toHaveTextContent('Move to a Design Option…')
    await user.click(action)
    await screen.findByTestId('move-to-option-dialog')
  })

  it('keeps naming the entity it refused, next to the reason', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    await ask(() => openMoveToOptionDialog([SOFA]))
    await screen.findByTestId('move-to-option-dialog')

    // Nothing here opens a correction, so the write is refused (#69 §12) — and the review that was
    // confirmed has to stay on the screen the reason appears on, or the person is told the move
    // changed nothing about a list of nothing.
    await user.click(screen.getByTestId('move-to-option-confirm'))
    await screen.findByTestId('move-problem')
    expect(screen.getByTestId('move-danger')).toHaveTextContent('these items leave the Existing Model')
    expect(screen.getByTestId(`move-item-${SOFA}`)).toHaveTextContent('Sofa')
    expect(screen.getByTestId('move-count')).toHaveTextContent('1 entity')
  })
})
