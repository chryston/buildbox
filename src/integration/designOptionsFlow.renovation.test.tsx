/**
 * The `Design Options` section of Project settings, and the review a delete asks for first
 * (#69 §15, criteria 14 and 15).
 *
 * The scene is the committed fixture — Walls W-1…W-6, two Options standing empty — driven through
 * a real session, so every assertion reads the Project the session committed rather than a double
 * of it. That matters most for the rule this section exists to hold: an Option is created, renamed
 * and deleted by one Intent each, so undo of the last step is undo of that step alone, and the
 * Existing Model is never half-touched.
 *
 * The section runs in the browser project, where the Design Options panel is reachable.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '../domain'
import { designOptionsOf } from '../domain'
import {
  DesignOptionsSection,
  PLAN_IMAGE_ACCEPT,
  WorkspaceProvider,
  workspaceStore,
  type WorkspaceServices,
} from '../ui'
import { openTestView, TEST_EXPORT_PORT, type TestView } from '../ui/legacy/testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

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

async function renderSection(project: Project = sceneProject()): Promise<void> {
  view = await openTestView(project)
  render(
    <WorkspaceProvider
      session={view.session}
      services={servicesFor(view)}
      onReturnToProjects={() => {}}
      onShowSaveFailure={() => {}}
    >
      <DesignOptionsSection />
    </WorkspaceProvider>,
  )
}

const names = (): string[] => designOptionsOf(view.project()).map((option) => option.name)
const idOf = (name: string): string => designOptionsOf(view.project()).find((option) => option.name === name)!.id

beforeEach(() => {
  workspaceStore.getState().reset()
})

describe('the Design Options section', () => {
  it('says there is none, and the first one created is Option A', async () => {
    const user = userEvent.setup()
    await renderSection(sceneProject(false))
    expect(screen.getByTestId('design-options-none')).toHaveTextContent('No Design Options yet.')

    await user.click(screen.getByTestId('design-option-add'))

    await waitFor(() => expect(names()).toEqual(['Option A']))
    // A second press takes the next letter, never a second Option A (#69 criterion 14).
    await user.click(screen.getByTestId('design-option-add'))
    await waitFor(() => expect(names()).toEqual(['Option A', 'Option B']))
  })

  it('renames inline, and one undo puts the old name back', async () => {
    const user = userEvent.setup()
    await renderSection()
    const optionB = idOf('Option B')

    await user.clear(screen.getByTestId(`design-option-name-${optionB}`))
    await user.type(screen.getByTestId(`design-option-name-${optionB}`), 'Knock through to the garden')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(names()).toEqual(['Option A', 'Knock through to the garden']))
    await act(async () => {
      view.session.undo()
    })
    expect(names()).toEqual(['Option A', 'Option B'])
  })

  it('refuses a name another Option already has, in the field, and writes nothing', async () => {
    const user = userEvent.setup()
    await renderSection()
    const optionB = idOf('Option B')

    await user.clear(screen.getByTestId(`design-option-name-${optionB}`))
    await user.type(screen.getByTestId(`design-option-name-${optionB}`), 'Option A')
    await user.keyboard('{Enter}')

    expect(await screen.findByTestId(`design-option-name-error-${optionB}`)).toHaveTextContent(
      'An option called "Option A" already exists.',
    )
    expect(names()).toEqual(['Option A', 'Option B'])
  })

  it('asks before deleting, counts what the Option owns, and changes nothing on Cancel', async () => {
    const user = userEvent.setup()
    await renderSection()
    const optionB = idOf('Option B')
    // One demolition makes Option B own something: the counts are the preview's, so the dialog has
    // a row to show and a zero row to leave out.
    const w6 = view.project().existingModel.walls.find((wall) => wall.ref === 'W-6')!
    const window3 = view.project().existingModel.openings.find((opening) => opening.hostWallId === w6.id)!
    await view.dispatch('renovation.demolish', {
      entityId: w6.id,
      dependants: [window3.id],
      target: { designOptionId: optionB },
    })

    await user.click(screen.getByTestId(`design-option-delete-${optionB}`))

    const dialog = await screen.findByTestId('delete-option-dialog')
    expect(dialog).toHaveTextContent('Delete Option B?')
    // The Wall and the Window on it both come down, so the Option owns two records.
    expect(screen.getByTestId('delete-option-demolished')).toHaveTextContent('2 Existing entities removed')
    // An Option that owns no proposed Wall shows no Wall row: seven zeroes teach a person to stop
    // reading the list (#69 criterion 9).
    expect(screen.queryByTestId('delete-option-walls')).toBeNull()
    expect(screen.getByTestId('delete-option-unchanged')).toHaveTextContent(
      'Nothing in the Existing Model changes.',
    )

    await user.click(screen.getByTestId('delete-option-cancel'))
    expect(screen.queryByTestId('delete-option-dialog')).toBeNull()
    expect(names()).toEqual(['Option A', 'Option B'])
  })

  it('deletes the Option and nothing else, and one undo brings it back', async () => {
    const user = userEvent.setup()
    await renderSection()
    const optionA = idOf('Option A')
    const wallsBefore = view.project().existingModel.walls.length

    await user.click(screen.getByTestId(`design-option-delete-${optionA}`))
    await user.click(await screen.findByTestId('delete-option-confirm'))

    await waitFor(() => expect(names()).toEqual(['Option B']))
    // Only the Option's records went: the Existing Model is the same document it was (#69 §15).
    expect(view.project().existingModel.walls.length).toBe(wallsBefore)
    await act(async () => {
      view.session.undo()
    })
    expect(names()).toEqual(['Option A', 'Option B'])
  })
})
