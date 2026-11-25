/**
 * `Demolish W-3?` — the review a demolition asks for and what its answer writes (#69 §8, §9,
 * criterion 3).
 *
 * The scene is the committed renovation fixture driven through a real session: W-3 carries
 * `Door 1` and `Window 2`, W-5 is the Wall the Kitchen is built against, and both Options start
 * empty. The dialog is opened the way the workspace opens it — through the store seam — and every
 * assertion reads the Project the session committed, because the rule under test is that a
 * demolition writes records into *one* Option and touches the Existing Model not at all.
 *
 * It runs in the browser project, where the panel and its overlays are reachable.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../domain/testing'
import type { Project } from '../domain'
import { designOptionsOf } from '../domain'
import {
  openDemolishDialog,
  PLAN_IMAGE_ACCEPT,
  RenovationOverlays,
  WorkspaceProvider,
  workspaceStore,
  type WorkspaceServices,
} from '../ui'
import { openTestView, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const WALL_3 = 'seed-wall-004'
const WALL_4 = 'seed-wall-005'
const WALL_5 = 'seed-wall-010'
const DOOR_1 = 'seed-opening-014'
const WINDOW_2 = 'seed-opening-015'

function sceneProject(): Project {
  const seed = JSON.parse(
    readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
  ) as { projects: { data: Project }[] }
  return currentSchemaOf(seed.projects[0]!.data, 8)
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
    now: () => '2026-01-01T00:00:00.000Z',
    readPlanImage: () => Promise.reject(new Error('jsdom models no file reader')),
    planImageAccept: PLAN_IMAGE_ACCEPT,
    planCatalogue: [],
    viewportCache: { read: async () => undefined, write: () => {}, readActive: async () => null, writeActive: () => {}, readPane: async () => null, writePane: () => {} },
    exportDrawings: TEST_EXPORT_PORT,
  }
}

let view: TestView

async function renderOverlays(project: Project = sceneProject()): Promise<void> {
  view = await openTestView(project)
  render(
    <WorkspaceProvider
      session={view.session}
      services={servicesFor(view)}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <RenovationOverlays />
    </WorkspaceProvider>,
  )
}

/** The demolition records one Option holds, in the order the model stores them. */
const demolishedOf = (optionName: string): string[] =>
  designOptionsOf(view.project()).find((option) => option.name === optionName)!.demolishedIds

/** A store write from outside React: the workspace does it from a click, a test has to say so. */
const ask = (open: () => void): Promise<void> => act(async () => { open() })

/** A proposed Opening of the Option's own, cut into an Existing Wall. */
async function proposeOpening(hostWallId: string, label: string): Promise<void> {
  await act(async () => {
    const result = view.session.dispatch(
      view.services.intent.build('renovation.placeOpening', {
        floorId: 'seed-001',
        hostWallId,
        kind: 'door',
        label,
        start: 5000,
        width: 900,
        sill: 0,
        head: 2100,
        swing: 'left',
        hingeSide: 'start',
        target: { designOptionId: 'option-a' },
      }),
    )
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
  })
}

beforeEach(() => {
  workspaceStore.getState().reset()
})

describe('the Demolish review', () => {
  it('lists the Openings on the Wall and counts them in the action', async () => {
    const user = userEvent.setup()
    await renderOverlays()
    const before = JSON.stringify(view.project())
    await ask(() => openDemolishDialog(WALL_3, 'option-a'))

    const dialog = await screen.findByTestId('demolish-dialog')
    expect(dialog).toHaveTextContent('Demolish W-3?')
    expect(dialog).toHaveTextContent('This goes with it:')
    expect(screen.getByTestId(`demolish-dependency-${DOOR_1}`)).toHaveTextContent('Door 1')
    expect(screen.getByTestId(`demolish-dependency-${WINDOW_2}`)).toHaveTextContent('Window 2')
    expect(screen.getByTestId('demolish-confirm')).toHaveTextContent('Demolish wall and 2 openings')
    expect(screen.getByTestId('demolish-confirm')).toBeEnabled()

    // Cancel is not an edit: the Project is the same text it was before the question was asked.
    await user.click(screen.getByTestId('demolish-cancel'))
    await waitFor(() => expect(screen.queryByTestId('demolish-dialog')).toBeNull())
    expect(JSON.stringify(view.project())).toBe(before)
  })

  it('demolishes in one Option, leaves the other standing, and one undo puts it back', async () => {
    const user = userEvent.setup()
    await renderOverlays()
    const wallsBefore = view.project().existingModel.walls.length
    await ask(() => openDemolishDialog(WALL_3, 'option-a'))

    await user.click(await screen.findByTestId('demolish-confirm'))

    await waitFor(() => expect(screen.queryByTestId('demolish-dialog')).toBeNull())
    // One record per entity — the Wall and both Openings — and nothing anywhere else (#69 §3).
    expect(demolishedOf('Option A')).toEqual([DOOR_1, WINDOW_2, WALL_3])
    expect(demolishedOf('Option B')).toEqual([])
    expect(view.project().existingModel.walls).toHaveLength(wallsBefore)

    await act(async () => {
      view.session.undo()
    })
    expect(demolishedOf('Option A')).toEqual([])
  })

  it('will not demolish a Wall a Room is built against', async () => {
    await renderOverlays()
    await ask(() => openDemolishDialog(WALL_5, 'option-a'))

    const dialog = await screen.findByTestId('demolish-dialog')
    expect(dialog).toHaveTextContent('These have to be dealt with first:')
    expect(screen.getByTestId('demolish-blockers')).toHaveTextContent(/Kitchen edge \d+ refers to W-5\./)
    expect(screen.getByTestId('demolish-confirm')).toBeDisabled()
  })

  it('will not demolish a Wall the Option has cut its own Opening into', async () => {
    await renderOverlays()
    await proposeOpening(WALL_4, 'Door 3')
    await ask(() => openDemolishDialog(WALL_4, 'option-a'))

    const dialog = await screen.findByTestId('demolish-dialog')
    expect(dialog).toHaveTextContent('Demolish W-4?')
    expect(screen.getByTestId('demolish-blockers')).toHaveTextContent('Remove Door 3 from this option first.')
    expect(screen.getByTestId('demolish-confirm')).toBeDisabled()
    // The Option's own work is untouched by a question it refused.
    expect(demolishedOf('Option A')).toEqual([])
  })
})
